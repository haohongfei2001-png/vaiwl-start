import { ingest, project } from '../../research/chatgpt-tasks/result-model.mjs';
import { recordFailure, recoverSource } from './failures.js';
import type { CatalogTask, NativeTask, SourcePacket, TaskControlState, TaskState, TaskView } from './types.js';
export function taskKey(principal: string, task: NativeTask): string { return JSON.stringify([principal,task.team_id,task.id]); }
export function selectedKeys(state: TaskControlState): string[] {
  if (!state.principal) return [];
  const available = Object.values(state.catalog).filter(c=>c.scope.accountId.startsWith(state.principal! + ':'));
  const saved = state.settings.selections[state.principal];
  if (saved) return saved.filter(key=>available.some(t=>t.key===key));
  return available.filter(c=>!!c.task.conversation_id).sort((a,b)=>(b.task.last_run_time || '').localeCompare(a.task.last_run_time || '') || a.task.id.localeCompare(b.task.id)).slice(0,5).map(c=>c.key);
}
export function applyPacket(state: TaskState, principal: string, packet: SourcePacket): TaskState {
  if (state.principal !== principal) throw Error('STALE_DOCUMENT');
  if (packet.kind === 'error') { recordFailure(state,packet.target || 'legacy',packet.code,packet.observedAt); return state; }
  if (packet.kind === 'list') {
    const coverage = state.coverage[principal] ||= {filters:{},at:null};
    if (!coverage.filters[packet.filter] || packet.observedAt > coverage.filters[packet.filter].observedAt) coverage.filters[packet.filter]={cursor:packet.cursor,observedAt:packet.observedAt,firstPage:packet.firstPage};
    coverage.at = packet.observedAt > (coverage.at || '') ? packet.observedAt : coverage.at;
    const batches = new Map<string, { scope: CatalogTask['scope']; tasks: NativeTask[] }>();
    for (const task of packet.tasks) {
      const key=taskKey(principal,task), old=state.catalog[key];
      if (old && old.observedAt >= packet.observedAt) continue;
      const scope={provider:'chatgpt',profileId:'browser-profile',accountId:principal+':'+(task.team_id || 'personal')};
      state.catalog[key]={key,scope,task,observedAt:packet.observedAt,resultSyncedAt:old?.resultSyncedAt || null,readOutcome:old?.readOutcome};
      const group = JSON.stringify(scope);
      if (!batches.has(group)) batches.set(group, { scope, tasks: [] });
      batches.get(group)!.tasks.push(task);
    }
    // The inherited immutable model clones once per scope, not once per task.
    for (const batch of batches.values()) state.model=ingest(state.model,{...batch,observedAt:packet.observedAt});
  } else {
    const matches=Object.values(state.catalog).filter(c=>c.scope.accountId.startsWith(principal+':') && c.task.id===packet.taskId && c.task.conversation_id===packet.conversationId);
    if(matches.length!==1)throw Error('TASK_NOT_DISCOVERED');
    const entry=matches[0];
    if (entry.resultSyncedAt && packet.observedAt < entry.resultSyncedAt) return state;
    const version = () => { const t=project(state.model,entry.scope,{now:packet.observedAt}).tasks.find((t:any)=>t.taskId===entry.task.id); return JSON.stringify([t?.latestAvailableResult?.runId,t?.latestAvailableResult?.revision]); };
    const before=version();
    const observations = packet.results.map(result => {
      // Native turn IDs are real stable output associations, NOT scheduler run IDs.
      // No attempt start, completion time or scheduler status is invented.
      const runId=result.turnId ? 'turn:'+result.turnId : 'message:'+result.messageId;
      state.sourceEvidence[JSON.stringify([entry.key,runId])] = {messageId:result.messageId,turnId:result.turnId,conversationId:result.conversationId,complete:result.complete};
      return {...entry.task,run_details:{
        latest_result:{run_id:runId,created_at:result.createdAt,content_text:result.body,content_truncated:!result.complete,
          chat_ref:{type:'chatgpt',id:result.conversationId}},
      }};
    });
    if (observations.length) state.model=ingest(state.model,{scope:entry.scope,observedAt:packet.observedAt,tasks:observations});
    entry.readOutcome=!packet.results.length?'empty':before===version()?'unchanged':'updated';
    entry.resultSyncedAt=packet.observedAt > (entry.resultSyncedAt || '') ? packet.observedAt : entry.resultSyncedAt;
  }
  for (const bucket of Object.values(state.model.scopes)) if (bucket.scope.accountId.startsWith(principal+':')) bucket.sync.sourceChannel='chatgpt-native-page';
  recoverSource(state,packet.kind==='list'?'list:'+packet.filter:'results:'+packet.conversationId+':'+packet.taskId,packet.observedAt);
  if(packet.kind==='list' && (packet.cursor!==null || !packet.firstPage))recordFailure(state,'list:'+packet.filter,'PARTIAL_LIST',packet.observedAt);
  if (state.sync.status !== 'syncing' && !state.sync.code) {
    // Metadata-only visits do not certify a fresh result read.
    state.sync={...state.sync,status:packet.kind==='results'?'ok':state.sync.succeededAt?'ok':'never',
      succeededAt:packet.kind==='results'?packet.observedAt:state.sync.succeededAt,mode:'visit'};
  }
  return state;
}
export function projectTasks(state: TaskState, includeBodies=false): TaskView[] {
  if (!state.principal) return [];
  const selected=new Set(selectedKeys(state));
  const views=new Map<string,any>();
  return Object.values(state.catalog).filter(c=>c.scope.accountId.startsWith(state.principal!+':')).map(entry=>{
    const scopeKey=JSON.stringify(entry.scope);
    if(!views.has(scopeKey)) views.set(scopeKey,project(state.model,entry.scope,{now:new Date().toISOString(),includeBodies}));
    const task=views.get(scopeKey).tasks.find((t:any)=>t.taskId===entry.task.id);
    if (!includeBodies && task) for (const field of ['currentResult','latestAvailableResult','lastValuableResult']) {
      // Detail owns source expansion. A homepage snapshot stays bounded even when
      // a long report contains thousands of literal links.
      if (task[field]) task[field] = {...task[field], sourceUrls: task[field].sourceUrls.slice(0,20)};
    }
    return {...task,key:entry.key,selected:selected.has(entry.key),readable:!!entry.task.conversation_id,resultSyncedAt:entry.resultSyncedAt,readOutcome:entry.readOutcome,
      sourceUrl: entry.task.conversation_id ? `https://chatgpt.com/c/${entry.task.conversation_id}?automationId=${entry.task.id}&messageId=finalAgentTurnStart` : 'https://chatgpt.com/scheduled'} as TaskView;
  }).sort((a,b)=>(b.latestAvailableResult?.createdAt || b.lastRunAt || '').localeCompare(a.latestAvailableResult?.createdAt || a.lastRunAt || '') || a.taskId.localeCompare(b.taskId));
}
export function listComplete(state: TaskControlState, since?: string): boolean {
  const filters=state.principal && state.coverage[state.principal]?.filters;
  return !!filters && ['scheduled','paused','finished'].every(key=>filters[key]?.firstPage===true && filters[key]?.cursor===null && (!since || filters[key].observedAt>=since));
}
