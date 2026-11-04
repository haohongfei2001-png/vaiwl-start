import { ingest, project } from '../../research/chatgpt-tasks/result-model.mjs';
import type { CatalogTask, NativeTask, SourcePacket, TaskState, TaskView } from './types.js';
export function taskKey(principal: string, task: NativeTask): string { return JSON.stringify([principal,task.team_id,task.id]); }
export function selectedKeys(state: TaskState): string[] {
  if (!state.principal) return [];
  const available = Object.values(state.catalog).filter(c=>c.scope.accountId.startsWith(state.principal! + ':'));
  const saved = state.settings.selections[state.principal];
  if (saved) return saved.filter(key=>available.some(t=>t.key===key));
  return available.filter(c=>!!c.task.conversation_id).sort((a,b)=>(b.task.last_run_time || '').localeCompare(a.task.last_run_time || '') || a.task.id.localeCompare(b.task.id)).slice(0,5).map(c=>c.key);
}
export function applyPacket(state: TaskState, principal: string, packet: SourcePacket): TaskState {
  if (state.principal !== principal) throw Error('STALE_DOCUMENT');
  if (packet.kind === 'error') { state.sync.code = packet.code; if(state.sync.status !== 'syncing') state.sync.status='error'; return state; }
  if (packet.kind === 'list') {
    const coverage = state.coverage[principal] ||= {filters:{},at:null};
    if (!coverage.filters[packet.filter] || packet.observedAt > coverage.filters[packet.filter].observedAt) coverage.filters[packet.filter]={cursor:packet.cursor,observedAt:packet.observedAt,firstPage:packet.firstPage};
    coverage.at = packet.observedAt > (coverage.at || '') ? packet.observedAt : coverage.at;
    for (const task of packet.tasks) {
      const key=taskKey(principal,task), old=state.catalog[key];
      if (old && old.observedAt >= packet.observedAt) continue;
      const scope={provider:'chatgpt',profileId:'browser-profile',accountId:principal+':'+(task.team_id || 'personal')};
      state.catalog[key]={key,scope,task,observedAt:packet.observedAt,resultSyncedAt:old?.resultSyncedAt || null};
      state.model=ingest(state.model,{scope,observedAt:packet.observedAt,tasks:[task]});
    }
  } else {
    const matches=Object.values(state.catalog).filter(c=>c.scope.accountId.startsWith(principal+':') && c.task.id===packet.taskId && c.task.conversation_id===packet.conversationId);
    if(matches.length!==1)throw Error('TASK_NOT_DISCOVERED');
    const entry=matches[0];
    for (const result of packet.results) {
      // Native turn IDs are real stable output associations, NOT scheduler run IDs.
      // No attempt start, completion time or scheduler status is invented.
      const runId=result.turnId ? 'turn:'+result.turnId : 'message:'+result.messageId;
      state.model=ingest(state.model,{scope:entry.scope,observedAt:packet.observedAt,tasks:[{...entry.task,run_details:{
        latest_result:{run_id:runId,created_at:result.createdAt,content_text:result.body,content_truncated:!result.complete,
          chat_ref:{type:'chatgpt',id:result.conversationId}},
      }}]});
      state.sourceEvidence[JSON.stringify([entry.key,runId])] = {messageId:result.messageId,turnId:result.turnId,conversationId:result.conversationId,complete:result.complete};
    }
    entry.resultSyncedAt=packet.observedAt > (entry.resultSyncedAt || '') ? packet.observedAt : entry.resultSyncedAt;
  }
  for (const bucket of Object.values(state.model.scopes)) if (bucket.scope.accountId.startsWith(principal+':')) bucket.sync.sourceChannel='chatgpt-native-page';
  if (state.sync.status !== 'syncing') {
    state.sync={...state.sync,status:'ok',succeededAt:packet.observedAt,code:null,mode:'visit'};
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
    return {...task,key:entry.key,selected:selected.has(entry.key),readable:!!entry.task.conversation_id,resultSyncedAt:entry.resultSyncedAt,
      sourceUrl: entry.task.conversation_id ? `https://chatgpt.com/c/${entry.task.conversation_id}?automationId=${entry.task.id}&messageId=finalAgentTurnStart` : 'https://chatgpt.com/scheduled'} as TaskView;
  }).sort((a,b)=>(b.latestAvailableResult?.createdAt || b.lastRunAt || '').localeCompare(a.latestAvailableResult?.createdAt || a.lastRunAt || '') || a.taskId.localeCompare(b.taskId));
}
export function listComplete(state: TaskState, since?: string): boolean {
  const filters=state.principal && state.coverage[state.principal]?.filters;
  return !!filters && ['scheduled','paused','finished'].every(key=>filters[key]?.firstPage===true && filters[key]?.cursor===null && (!since || filters[key].observedAt>=since));
}
