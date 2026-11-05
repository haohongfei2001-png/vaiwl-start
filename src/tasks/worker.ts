import { classify } from '../../research/chatgpt-tasks/result-model.mjs';
import { trustedCollectorSender, trustedExtensionSender } from '../shared/protocol.js';
import { TaskDatabase, initialState } from './database.js';
import { applyPacket, selectedKeys, projectTasks, listComplete } from './state.js';
import { recordFailure, recoverSource, SOURCE_ERRORS } from './failures.js';
import { validatePacket } from './source.js';
import type { TaskSnapshot, TaskState } from './types.js';
export const TASK_PROTOCOL='vaiwl-tasks/1';
export const TASK_PERMISSIONS: chrome.permissions.Permissions={permissions:['scripting','alarms'],origins:['https://chatgpt.com/*']};
const ENABLED='tasks.enabled', ALARM='vaiwl-task-sync', OWNED='tasks.ownedTabs';
const SCRIPT_IDS=['vaiwl-task-main','vaiwl-task-relay'];
const db=new TaskDatabase();
let epoch=0, syncing:Promise<void>|null=null, reconciling=Promise.resolve();
let boot:Promise<void>=Promise.resolve();
let alarmAttached=false;
function attachAlarm(){if(!alarmAttached&&chrome.alarms){chrome.alarms.onAlarm.addListener(alarm=>{if(alarm.name===ALARM)startSync();});alarmAttached=true;}}
const bindings=new Map<number,{documentId:string;principal:string;token:string;epoch:number;generation:number;expiresAt:number}>();
function stopCollectors(){for(const [tabId,binding] of bindings)void chrome.tabs.sendMessage(tabId,{protocol:TASK_PROTOCOL,event:'stop'},{documentId:binding.documentId}).catch(()=>{});}
let owned: {id:number;url:string}[]=[];
const notify=()=>{void chrome.runtime.sendMessage({protocol:TASK_PROTOCOL,event:'changed'}).catch(()=>{});};
const authorized=()=>chrome.permissions.contains(TASK_PERMISSIONS);
function safeError(e:unknown) {const code=e instanceof Error?e.message:'';return [...SOURCE_ERRORS,'PERMISSION_REQUIRED','DISABLED','SOURCE_CHANGED','SOURCE_UNAVAILABLE','RATE_LIMITED','IDENTITY_UNAVAILABLE','STALE_DOCUMENT','TASK_NOT_DISCOVERED','SOURCE_TIMEOUT','PARTIAL_LIST','CACHE_WRITE_FAILED','INVALID_MESSAGE','RESULT_NOT_FOUND','FAILURE_NOT_VALUABLE'].includes(code)?code:'SYNC_UNAVAILABLE';}
async function closeOwned(tab: {id:number;url:string}) {
  if(!owned.some(t=>t.id===tab.id))return;
  try {const current=await chrome.tabs.get(tab.id);if(!current.active) await chrome.tabs.remove(tab.id);}catch{/* already closed or user adopted it */}
  owned=owned.filter(t=>t.id!==tab.id);await chrome.storage.session.set({[OWNED]:owned});
}
async function cleanup() {
  const saved=(await chrome.storage.session.get(OWNED))[OWNED];
  if(Array.isArray(saved)) owned=saved.filter(t=>Number.isInteger(t.id)&&typeof t.url==='string'&&t.url.startsWith('https://chatgpt.com/'));
  for(const tab of [...owned]) await closeOwned(tab);
}
async function reconcile() {
  const work=reconciling.catch(()=>{}).then(async()=>{
    const enabled=(await chrome.storage.local.get(ENABLED))[ENABLED]===true && await authorized();
    const registered=await chrome.scripting?.getRegisteredContentScripts({ids:SCRIPT_IDS}).catch(()=>[])||[];
    if(!enabled){if(registered.length)await chrome.scripting.unregisterContentScripts({ids:registered.map(s=>s.id)});await chrome.alarms?.clear(ALARM);return;}
    attachAlarm();
    const scripts:chrome.scripting.RegisteredContentScript[]=[
      {id:SCRIPT_IDS[0],matches:['https://chatgpt.com/*'],js:['tasks-main.js'],runAt:'document_start',world:'MAIN',persistAcrossSessions:true},
      {id:SCRIPT_IDS[1],matches:['https://chatgpt.com/*'],js:['tasks-content.js'],runAt:'document_start',world:'ISOLATED',persistAcrossSessions:true},
    ];
    const missing=scripts.filter(s=>!registered.some(r=>r.id===s.id));if(missing.length)await chrome.scripting.registerContentScripts(missing);
    const state=await db.read();
    if(state.settings.automatic){if(!await chrome.alarms.get(ALARM))await chrome.alarms.create(ALARM,{periodInMinutes:30,delayInMinutes:30});}
    else await chrome.alarms.clear(ALARM);
  });reconciling=work;return work;
}
async function sourceCommand(m:any,sender:chrome.runtime.MessageSender) {
  if(!trustedCollectorSender(sender,chrome.runtime.id)||!await authorized())throw Error('PERMISSION_REQUIRED');
  const tabId=sender.tab!.id!;
  if(m.command==='HELLO') {
    const at=epoch;
    if(m.principalKey!==null && (typeof m.principalKey!=='string'||!/^principal:[a-f0-9]{64}$/.test(m.principalKey)||!Number.isFinite(Date.parse(m.expiresAt))||Date.parse(m.expiresAt)<=Date.now()))throw Error('IDENTITY_UNAVAILABLE');
    const state=await db.update(s=>{if(at!==epoch)throw Error('STALE_DOCUMENT');if(!s.settings.enabled)throw Error('DISABLED');
      if(!m.principalKey) {
        const code=[...SOURCE_ERRORS,'SOURCE_TIMEOUT'].includes(m.failureCode)?m.failureCode:'IDENTITY_UNAVAILABLE';
        bindings.delete(tabId);
        // Transient verification/network failure does not erase the last confirmed
        // account's cache. Proven logout hides it, without deleting any records.
        if(code==='LOGIN_REQUIRED' && s.principal){s.principal=null;s.generation++;bindings.clear();}
        recordFailure(s,'identity',code,new Date().toISOString());return s;
      }
      if(s.principal!==m.principalKey){const first=s.principal===null;s.principal=m.principalKey;s.generation++;bindings.clear();s.sourceFailures={};s.sourceReads={};
        if(!first || s.sync.status!=='syncing')s.sync={status:'never',attemptedAt:null,succeededAt:null,code:null,mode:null};}
      recoverSource(s,'identity',new Date().toISOString());return s;});
    if(!m.principalKey){notify();throw Error(state.sync.code||'IDENTITY_UNAVAILABLE');}
    const binding={documentId:sender.documentId!,principal:m.principalKey,token:crypto.randomUUID(),epoch:at,generation:state.generation,expiresAt:Date.parse(m.expiresAt)};
    bindings.set(tabId,binding);notify();return {token:binding.token};
  }
  const binding=bindings.get(tabId), packet=validatePacket(m.packet);
  if(!binding||binding.token!==m.token||binding.documentId!==sender.documentId||binding.epoch!==epoch||binding.expiresAt<=Date.now())throw Error('STALE_DOCUMENT');
  const tab=await chrome.tabs.get(tabId);
  if(tab.url!==packet.pageHref||!await authorized()||binding.epoch!==epoch)throw Error('STALE_DOCUMENT');
  await db.update(s=>{if(!s.settings.enabled||s.generation!==binding.generation||binding.epoch!==epoch||s.principal!==binding.principal)throw Error('STALE_DOCUMENT');return applyPacket(s,binding.principal,packet);});
  notify();return {accepted:true};
}
async function openTemporary(url:string, since:string, done:(state:TaskState)=>boolean, at:number) {
  if(epoch!==at||!await authorized())throw Error('STALE_DOCUMENT');
  const created=await chrome.tabs.create({url,active:false});if(!created.id)throw Error('SOURCE_UNAVAILABLE');
  const item={id:created.id,url};owned.push(item);await chrome.storage.session.set({[OWNED]:owned});
  try {
    const end=Date.now()+45000;
    while(Date.now()<end){
      if(epoch!==at)throw Error('STALE_DOCUMENT');
      const state=await db.read();if(!state.settings.enabled)throw Error('DISABLED');
      // A native page can recover an initial authentication/challenge response by
      // itself. Do not close it before its ordinary requests finish. No challenge
      // is solved or bypassed here; rate limits still stop immediately.
      if(['RATE_LIMITED','LOGIN_REQUIRED'].includes(state.sync.code||''))throw Error(state.sync.code!);
      if(done(state))return;
      await new Promise(r=>setTimeout(r,350));
    }
    const last=await db.read();throw Error(last.sync.code||'SOURCE_TIMEOUT');
  } finally {await closeOwned(item);}
}
async function sync() {
  const start=new Date().toISOString(), at=epoch;
  await reconcile();
  const initial=await db.read();if(!initial.settings.enabled)throw Error('DISABLED');if(!await authorized())throw Error('PERMISSION_REQUIRED');
  if(initial.sync.retryAt && Date.parse(initial.sync.retryAt)>Date.now())throw Error('RATE_LIMITED');
  if(!initial.settings.automatic){await chrome.tabs.create({url:'https://chatgpt.com/scheduled',active:true});return;}
  await db.update(s=>{s.sourceFailures={};s.sync={...s.sync,status:'syncing',attemptedAt:start,code:null,retryAt:null,retrySource:null,mode:'temporary'};return s;});notify();
  try {
    // Wait for all three native categories, including empty ones. Non-null cursors
    // remain PARTIAL_LIST; we never invent or replay authenticated pagination.
    await openTemporary('https://chatgpt.com/scheduled',start,s=>!!s.principal&&['scheduled','paused','finished'].every(f=>(s.coverage[s.principal!]?.filters[f]?.observedAt||'')>=start),at);
    let state=await db.read();const principal=state.principal;
    const chosen=selectedKeys(state).map(k=>state.catalog[k]).filter(c=>!!c?.task.conversation_id);
    let failure:string|null=listComplete(state,start)?null:'PARTIAL_LIST';
    // At most ten explicit selections / five defaults. One sequential page at a time.
    for(const entry of chosen.slice(0,10)) {
      const begun=new Date().toISOString();
      const url=`https://chatgpt.com/c/${entry.task.conversation_id}?automationId=${entry.task.id}&messageId=finalAgentTurnStart`;
      try {await openTemporary(url,begun,s=>s.principal===principal&&(s.catalog[entry.key]?.resultSyncedAt||'')>=begun,at);}
      catch(e){failure=safeError(e);if(['RATE_LIMITED','STALE_DOCUMENT','DISABLED','PERMISSION_REQUIRED'].includes(failure))throw e;break;}
      state=await db.read();if(state.principal!==principal)throw Error('STALE_DOCUMENT');
    }
    await db.update(s=>{if(epoch!==at||s.principal!==principal||!s.settings.enabled)throw Error('STALE_DOCUMENT');failure ||= s.sync.code; s.sync={...s.sync,status:failure?'error':'ok',attemptedAt:start,succeededAt:failure?s.sync.succeededAt:new Date().toISOString(),code:failure,mode:'temporary'};return s;});
  } catch(e) {if(epoch===at)await db.update(s=>{s.sync={...s.sync,status:'error',code:safeError(e),mode:'temporary'};return s;});}
  finally{notify();}
}
function startSync() {const at=epoch;if(!syncing) syncing=sync().catch(async e=>{if(at!==epoch)return;await db.update(s=>{if(at===epoch&&s.settings.enabled)s.sync={...s.sync,status:'error',code:safeError(e)};return s;});notify();}).finally(()=>{syncing=null;});}
async function snapshot():Promise<TaskSnapshot> {
  const state=await db.read();return {settings:state.settings,principal:state.principal,tasks:projectTasks(state),sync:state.sync,completeList:listComplete(state,state.sync.attemptedAt||undefined),permission:await authorized()};
}
export async function clearTaskCache() {
  epoch++;stopCollectors();bindings.clear();
  await db.update(s=>{const clean=initialState();clean.generation=s.generation+1;return clean;});
  await chrome.storage.local.set({[ENABLED]:false});await reconcile();notify();
}
async function uiCommand(m:any,sender:chrome.runtime.MessageSender) {
  if(!trustedExtensionSender(sender,chrome.runtime.id))throw Error('UNAUTHORIZED_SENDER');
  if(m.command==='SNAPSHOT')return snapshot();
  if(m.command==='SYNC'){const s=await db.read();if(s.sync.retryAt&&Date.parse(s.sync.retryAt)>Date.now())throw Error('RATE_LIMITED');startSync();return {started:true};}
  if(m.command==='OPEN_SOURCE'){if(!(await db.read()).settings.enabled)throw Error('DISABLED');await chrome.tabs.create({url:'https://chatgpt.com/scheduled',active:true});return {opened:true};}
  if(m.command==='CONFIGURE') {
    const p=m.patch;if(!p||Object.keys(p).some(k=>!['enabled','automatic','showWidget','preview','selected'].includes(k)))throw Error('INVALID_MESSAGE');
    for(const k of ['enabled','automatic','showWidget','preview'])if(k in p&&typeof p[k]!=='boolean')throw Error('INVALID_MESSAGE');
    if(p.selected!==undefined&&(!Array.isArray(p.selected)||p.selected.length>10||p.selected.some((v:unknown)=>typeof v!=='string'||v.length>1024)))throw Error('INVALID_MESSAGE');
    if(p.enabled===true&&!await authorized())throw Error('PERMISSION_REQUIRED');
    const changesSource=['enabled','automatic','selected'].some(k=>k in p);
    if(changesSource){epoch++;if(p.enabled===false)stopCollectors();bindings.clear();}
    const updated=await db.update(s=>{if(changesSource)s.generation++;for(const k of ['enabled','automatic','showWidget','preview'] as const)if(k in p)s.settings[k]=p[k];
      if(p.selected!==undefined){if(!s.principal||p.selected.some((k:string)=>!s.catalog[k]?.scope.accountId.startsWith(s.principal!+':')))throw Error('INVALID_MESSAGE');s.settings.selections[s.principal]=[...new Set<string>(p.selected)];}
      if(changesSource&&s.sync.status==='syncing')s.sync={...s.sync,status:'error',code:s.settings.enabled?'STALE_DOCUMENT':'DISABLED'};return s;});
    await chrome.storage.local.set({[ENABLED]:updated.settings.enabled});await reconcile();notify();return snapshot();
  }
  if(m.command==='DETAIL') {
    const s=await db.read();const task=projectTasks(s,true).find(t=>t.key===m.key);if(!task)throw Error('RESULT_NOT_FOUND');return task;
  }
  if(m.command==='CLASSIFY') {
    await db.update(s=>{const c=s.catalog[m.key];if(!s.principal||!c?.scope.accountId.startsWith(s.principal+':'))throw Error('RESULT_NOT_FOUND');
      s.model=classify(s.model,{scope:c.scope,taskId:c.task.id,runId:m.runId,resultRevision:m.revision,outcome:m.outcome,classifiedAt:new Date().toISOString(),evidence:{kind:'user',reference:'start-result-review'}});return s;});notify();return snapshot();
  }
  if(m.command==='CLEAR') {
    await clearTaskCache();return snapshot();
  }
  throw Error('INVALID_MESSAGE');
}
export function initTasks() {
  chrome.runtime.onMessage.addListener((m,sender,respond)=>{
    if(m?.protocol!==TASK_PROTOCOL||m.event)return;
    const work=boot.then<unknown>(()=>['HELLO','OBSERVE'].includes(m.command)?sourceCommand(m,sender):uiCommand(m,sender));
    void work.then(data=>respond({ok:true,data})).catch(e=>respond({ok:false,code:safeError(e)}));return true;
  });
  attachAlarm();
  chrome.permissions.onRemoved.addListener(permissions=>{
    if(!permissions.origins?.includes('https://chatgpt.com/*')&&!permissions.permissions?.some(p=>['scripting','alarms'].includes(p)))return;
    if(permissions.permissions?.includes('alarms'))alarmAttached=false;
    epoch++;stopCollectors();bindings.clear();void db.update(s=>{s.generation++;s.principal=null;s.sync={...s.sync,status:'error',code:'PERMISSION_REQUIRED'};return s;}).then(notify);void reconcile();
  });
  chrome.tabs.onRemoved.addListener(id=>bindings.delete(id));
  chrome.tabs.onActivated.addListener(({tabId})=>{if(owned.some(t=>t.id===tabId)){owned=owned.filter(t=>t.id!==tabId);void chrome.storage.session.set({[OWNED]:owned});}});
  boot=cleanup().then(()=>db.update(s=>{if(s.sync.status==='syncing')s.sync={...s.sync,status:'error',code:'SYNC_INTERRUPTED'};return s;})).then(()=>reconcile());
  void boot.catch(()=>{});
  chrome.runtime.onStartup.addListener(()=>{void reconcile();});
}
