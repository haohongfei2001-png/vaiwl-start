import { classify } from '../../research/chatgpt-tasks/result-model.mjs';
import { trustedCollectorSender, trustedExtensionSender } from '../shared/protocol.js';
import { TaskDatabase, initialState } from './database.js';
import { applyPacket, selectedKeys, projectTasks, projectTaskResult, listComplete } from './state.js';
import { recordFailure, recoverSource, SOURCE_ERRORS } from './failures.js';
import { TASK_ADAPTER_VERSION, validatePacket } from './source.js';
import { TASK_SCHEDULE_KEY, readSchedule, successfulSchedule, failedSchedule, syncIsDue, type TaskSchedule } from './scheduling.js';
import { nativeRecoveryPage, temporaryPageTarget } from './temporary-page.js';
import type { TaskSnapshot, TaskControlState } from './types.js';
export const TASK_PROTOCOL='vaiwl-tasks/1';
export const TASK_PERMISSIONS: chrome.permissions.Permissions={permissions:['scripting','alarms'],origins:['https://chatgpt.com/*']};
const ENABLED='tasks.enabled', ALARM='vaiwl-task-sync', OWNED='tasks.ownedTabs';
const SCRIPT_IDS=['vaiwl-task-main','vaiwl-task-relay'];
const db=new TaskDatabase();
let epoch=0, syncing:Promise<void>|null=null, reconciling=Promise.resolve();
let boot:Promise<void>=Promise.resolve();
let runtimeReady:Promise<void>=Promise.resolve();
let alarmAttached=false;
function attachAlarm(){if(!alarmAttached&&chrome.alarms){chrome.alarms.onAlarm.addListener(alarm=>{if(alarm.name===ALARM)startSync();});alarmAttached=true;}}
let scheduling:Promise<unknown>=Promise.resolve();
async function schedule(){
  const saved=(await chrome.storage.local.get(TASK_SCHEDULE_KEY))[TASK_SCHEDULE_KEY], now=Date.now();
  const timing=readSchedule(saved,TASK_ADAPTER_VERSION,now);
  if(saved)return timing;
  // Upgrade migration respects an already-fresh cache instead of opening a source page.
  const state=await db.readControl(), succeeded=Date.parse(state.sync.succeededAt||'');
  if(state.sync.status!=='error'&&Number.isFinite(succeeded))return successfulSchedule(timing,state,succeeded);
  if(state.sync.status==='error'&&state.sync.code){
    const attempted=Date.parse(state.sync.attemptedAt||'');
    const failed=failedSchedule(timing,state.sync.code,Number.isFinite(attempted)?attempted:now);
    const retry=Date.parse(state.sync.retryAt||'');if(Number.isFinite(retry))failed.dueAt=Math.max(failed.dueAt,retry);
    return failed;
  }
  return timing;
}
function updateSchedule(change:(current:TaskSchedule)=>TaskSchedule):Promise<TaskSchedule>{
  const work=scheduling.catch(()=>{}).then(async()=>{const next=change(await schedule());await chrome.storage.local.set({[TASK_SCHEDULE_KEY]:next});return next;});
  scheduling=work;return work;
}
const wakeups=new Set<()=>void>();
function wake(){for(const callback of [...wakeups])callback();}
function waitForSource(){return new Promise<void>(resolve=>{const done=()=>{clearTimeout(timer);wakeups.delete(done);resolve();};const timer=setTimeout(done,1000);wakeups.add(done);});}
const bindings=new Map<number,{documentId:string;principal:string;token:string;epoch:number;generation:number;expiresAt:number}>();
function stopCollectors(){for(const [tabId,binding] of bindings)void chrome.tabs.sendMessage(tabId,{protocol:TASK_PROTOCOL,event:'stop'},{documentId:binding.documentId}).catch(()=>{});}
let owned: {id:number;url:string}[]=[];
const notify=(privacyChanged:unknown=false)=>{void chrome.runtime.sendMessage({protocol:TASK_PROTOCOL,event:'changed',privacyChanged:privacyChanged===true}).catch(()=>{});};
const authorized=()=>chrome.permissions.contains(TASK_PERMISSIONS);
function safeError(e:unknown) {const code=e instanceof Error?e.message:'';return [...SOURCE_ERRORS,'PERMISSION_REQUIRED','DISABLED','SOURCE_CHANGED','SOURCE_UNAVAILABLE','RATE_LIMITED','IDENTITY_UNAVAILABLE','STALE_DOCUMENT','TASK_NOT_DISCOVERED','SOURCE_TIMEOUT','PARTIAL_LIST','CACHE_WRITE_FAILED','INVALID_MESSAGE','RESULT_NOT_FOUND','FAILURE_NOT_VALUABLE','SYNC_INTERRUPTED','SOURCE_TAKEN_OVER'].includes(code)?code:'SYNC_UNAVAILABLE';}
async function closeOwned(tab: {id:number;url:string}) {
  if(!owned.some(t=>t.id===tab.id))return;
  try {const current=await chrome.tabs.get(tab.id);if(owned.includes(tab)&&!current.active&&temporaryPageTarget(current)===tab.url) await chrome.tabs.remove(tab.id);}catch{/* already closed or user adopted it */}
  owned=owned.filter(t=>t.id!==tab.id);await chrome.storage.session.set({[OWNED]:owned});
}
async function cleanup() {
  const saved=(await chrome.storage.session.get(OWNED))[OWNED];
  if(Array.isArray(saved)) owned=saved.filter(t=>Number.isInteger(t.id)&&typeof t.url==='string'&&(t.url.startsWith('https://chatgpt.com/')||nativeRecoveryPage(t.url)));
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
    const state=await db.readControl(), timing=await schedule();
    if(state.settings.automatic&&!timing.paused&&!['LOGIN_REQUIRED','PERMISSION_REQUIRED','DISABLED'].includes(timing.failureCode||'')){
      // Chrome may discard alarms on restart. The persisted due time is authoritative.
      const when=Math.max(Date.now()+30_000,timing.lease?.until||timing.dueAt);
      const existing=await chrome.alarms.get(ALARM);
      if(!existing||existing.periodInMinutes||Math.abs(existing.scheduledTime-when)>1000)await chrome.alarms.create(ALARM,{when});
    }
    else await chrome.alarms.clear(ALARM);
  });reconciling=work;return work;
}
async function sourceCommand(m:any,sender:chrome.runtime.MessageSender) {
  if(!trustedCollectorSender(sender,chrome.runtime.id)||!await authorized())throw Error('PERMISSION_REQUIRED');
  const tabId=sender.tab!.id!;
  if(m.command==='HELLO') {
    const at=epoch;
    let identityChanged=false;
    if(m.principalKey!==null && (typeof m.principalKey!=='string'||!/^principal:[a-f0-9]{64}$/.test(m.principalKey)||!Number.isFinite(Date.parse(m.expiresAt))||Date.parse(m.expiresAt)<=Date.now()))throw Error('IDENTITY_UNAVAILABLE');
    const state=await db.update(s=>{if(at!==epoch)throw Error('STALE_DOCUMENT');if(!s.settings.enabled)throw Error('DISABLED');
      if(!m.principalKey) {
        const code=[...SOURCE_ERRORS,'SOURCE_TIMEOUT'].includes(m.failureCode)?m.failureCode:'IDENTITY_UNAVAILABLE';
        bindings.delete(tabId);
        // Transient verification/network failure does not erase the last confirmed
        // account's cache. Proven logout hides it, without deleting any records.
        if(code==='LOGIN_REQUIRED' && s.principal){s.principal=null;s.generation++;bindings.clear();identityChanged=true;}
        recordFailure(s,'identity',code,new Date().toISOString());return s;
      }
      if(s.principal!==m.principalKey){const first=s.principal===null;s.principal=m.principalKey;s.generation++;bindings.clear();s.sourceFailures={};s.sourceReads={};identityChanged=true;
        if(!first || s.sync.status!=='syncing')s.sync={status:'never',attemptedAt:null,succeededAt:null,code:null,mode:null};}
      recoverSource(s,'identity',new Date().toISOString());return s;});
    wake();
    if(!m.principalKey){
      if(!syncing){const timing=await updateSchedule(previous=>failedSchedule(previous,state.sync.code||'IDENTITY_UNAVAILABLE',Date.now()));await exposeRetry(timing);await reconcile();}
      notify(identityChanged);throw Error(state.sync.code||'IDENTITY_UNAVAILABLE');
    }
    if(!syncing){
      let resumed=false;
      const timing=await updateSchedule(previous=>{
        // A successful ordinary identity read can recover an identity challenge.
        // Remaining list/result failures still require that exact source to recover.
        if(!state.sync.code&&previous.failureCode){resumed=true;return {...previous,dueAt:Date.now(),failures:0,paused:false,failureCode:null,failedAt:null,lease:null};}
        return previous;
      });
      if(resumed){await exposeRetry(timing);await reconcile();}
    }
    const binding={documentId:sender.documentId!,principal:m.principalKey,token:crypto.randomUUID(),epoch:at,generation:state.generation,expiresAt:Date.parse(m.expiresAt)};
    bindings.set(tabId,binding);notify(identityChanged);return {token:binding.token};
  }
  const binding=bindings.get(tabId), packet=validatePacket(m.packet);
  if(!binding||binding.token!==m.token||binding.documentId!==sender.documentId||binding.epoch!==epoch||binding.expiresAt<=Date.now())throw Error('STALE_DOCUMENT');
  const tab=await chrome.tabs.get(tabId);
  if(tab.url!==packet.pageHref||!await authorized()||binding.epoch!==epoch)throw Error('STALE_DOCUMENT');
  const state=await db.update(s=>{if(!s.settings.enabled||s.generation!==binding.generation||binding.epoch!==epoch||s.principal!==binding.principal)throw Error('STALE_DOCUMENT');return applyPacket(s,binding.principal,packet);});
  wake();
  if(!syncing){
    const failedAt=Object.values(state.sourceFailures||{}).filter(f=>f.code===state.sync.code).map(f=>Date.parse(f.observedAt)).filter(Number.isFinite).sort((a,b)=>b-a)[0];
    // An unrelated successful page neither erases nor counts the same old failure again.
    const timing=await updateSchedule(previous=>state.sync.code?failedSchedule(previous,state.sync.code,failedAt||Date.now()):successfulSchedule(previous,state,Date.now()));
    await exposeRetry(timing);await reconcile();
  }
  notify();return {accepted:true};
}
async function exposeRetry(timing:TaskSchedule){await db.update(s=>{s.sync.retryAt=timing.failureCode&&!timing.paused?new Date(timing.dueAt).toISOString():null;if(!timing.failureCode)s.sync.retrySource=null;return s;});}
interface TemporaryCycle {item?:{id:number;url:string};pages:number;resultReads:number}
async function openTemporary(url:string, since:string, done:(state:TaskControlState)=>boolean, at:number, cycle:TemporaryCycle, expectedPrincipal?:string|null) {
  if(epoch!==at||!await authorized())throw Error('STALE_DOCUMENT');
  if(cycle.item){
    const item=cycle.item,current=await chrome.tabs.get(item.id).catch(()=>null);
    if(!current||!owned.includes(item)||current.active||temporaryPageTarget(current)!==item.url)throw Error('SOURCE_TAKEN_OVER');
    item.url=url;await chrome.storage.session.set({[OWNED]:owned});
    // Recheck after the async storage operation: an activation immediately releases ownership.
    if(!owned.includes(item))throw Error('SOURCE_TAKEN_OVER');
    await chrome.tabs.update(item.id,{url});
  }else{
    const created=await chrome.tabs.create({url,active:false});if(!created.id)throw Error('SOURCE_UNAVAILABLE');
    cycle.item={id:created.id,url};owned.push(cycle.item);await chrome.storage.session.set({[OWNED]:owned});
  }
  cycle.pages++;
    const end=Date.now()+45000;
    let observedFailureCode='', observedFailureSince=0;
    while(Date.now()<end){
      if(epoch!==at)throw Error('STALE_DOCUMENT');
      const state=await db.readControl();if(!state.settings.enabled)throw Error('DISABLED');
      if(expectedPrincipal&&state.principal!==expectedPrincipal)throw Error('STALE_DOCUMENT');
      // Activation hands the tab to the user. Its current response may finish,
      // but a later result page can never navigate or close that adopted tab.
      if(done(state))return;
      if(!owned.includes(cycle.item)){
        const current=await chrome.tabs.get(cycle.item.id).catch(()=>null);
        if(!current||temporaryPageTarget(current)!==url)throw Error('SOURCE_TAKEN_OVER');
      }
      const redirected=nativeRecoveryPage(cycle.item.url);if(redirected)throw Error(redirected);
      const latest=Object.values(state.sourceFailures||{}).filter(f=>f.observedAt>=since).sort((a,b)=>b.observedAt.localeCompare(a.observedAt))[0];
      if(latest){
        if(['RATE_LIMITED','LOGIN_REQUIRED'].includes(latest.code))throw Error(latest.code);
        if(observedFailureCode!==latest.code){observedFailureCode=latest.code;observedFailureSince=Date.now();}
        // Give the native page its ordinary short retry; never solve verification.
        if(Date.now()-observedFailureSince>=1500)throw Error(latest.code);
      }else {observedFailureCode='';observedFailureSince=0;}
      await waitForSource();
    }
    const last=await db.readControl();throw Error(last.sync.code||'SOURCE_TIMEOUT');
}
async function sync(manual=false) {
  await runtimeReady;
  const start=new Date().toISOString(), at=epoch;
  await reconcile();
  const initial=await db.readControl();if(!initial.settings.enabled)throw Error('DISABLED');if(!await authorized())throw Error('PERMISSION_REQUIRED');
  const prior=await schedule();if(!syncIsDue(prior,Date.now(),manual))return;
  if(!initial.settings.automatic){await chrome.tabs.create({url:'https://chatgpt.com/scheduled',active:true});return;}
  const leaseId=crypto.randomUUID(), cycle:TemporaryCycle={pages:0,resultReads:0};
  await updateSchedule(previous=>({...previous,lastAttemptAt:Date.now(),lease:{id:leaseId,until:Date.now()+10*60_000}}));
  await db.update(s=>{s.sync={...s.sync,status:'syncing',attemptedAt:start,code:null,retryAt:null,retrySource:null,mode:'temporary'};return s;});notify();
  let failure:string|null=null;
  try {
    // Wait for all three native categories, including empty ones. Non-null cursors
    // remain PARTIAL_LIST; we never invent or replay authenticated pagination.
    await openTemporary('https://chatgpt.com/scheduled',start,s=>!!s.principal&&['scheduled','paused','finished'].every(f=>(s.coverage[s.principal!]?.filters[f]?.observedAt||'')>=start),at,cycle);
    let state=await db.readControl();const principal=state.principal;
    const complete=listComplete(state,start);
    const chosen=selectedKeys(state).map(k=>state.catalog[k]).filter(c=>!!c?.task.conversation_id&&(!complete||c.observedAt>=start));
    failure=complete?null:'PARTIAL_LIST';
    // At most ten explicit selections / five defaults. One sequential page at a time.
    for(const entry of chosen.slice(0,10)) {
      const begun=new Date().toISOString();
      const url=`https://chatgpt.com/c/${entry.task.conversation_id}?automationId=${entry.task.id}&messageId=finalAgentTurnStart`;
      try {await openTemporary(url,begun,s=>s.principal===principal&&(s.catalog[entry.key]?.resultSyncedAt||'')>=begun,at,cycle,principal);cycle.resultReads++;}
      catch(e){failure=safeError(e);if(['RATE_LIMITED','STALE_DOCUMENT','DISABLED','PERMISSION_REQUIRED','SOURCE_TAKEN_OVER'].includes(failure))throw e;break;}
      state=await db.readControl();if(state.principal!==principal)throw Error('STALE_DOCUMENT');
    }
    await db.update(s=>{if(epoch!==at||s.principal!==principal||!s.settings.enabled)throw Error('STALE_DOCUMENT');failure ||= s.sync.code; s.sync={...s.sync,status:failure?'error':'ok',attemptedAt:start,succeededAt:failure?s.sync.succeededAt:new Date().toISOString(),code:failure,mode:'temporary'};return s;});
  } catch(e) {failure=safeError(e);if(epoch===at)await db.update(s=>{s.sync={...s.sync,status:'error',code:failure,mode:'temporary'};return s;});}
  finally{
    if(cycle.item)await closeOwned(cycle.item);
    const current=await db.readControl();
    const timing=await updateSchedule(previous=>{
      if(previous.lease?.id!==leaseId)return previous;
      const next=epoch===at?(failure?failedSchedule(previous,failure,Date.now()):successfulSchedule(previous,current,Date.now())):{...previous,lease:null,dueAt:Date.now()+30_000};
      return {...next,lastCycle:{durationMs:Date.now()-Date.parse(start),pages:cycle.pages,resultReads:cycle.resultReads,code:failure}};
    });
    if(epoch===at)await exposeRetry(timing);
    await reconcile();notify();
  }
}
function startSync(manual=false) {const at=epoch;if(!syncing) syncing=sync(manual).catch(async e=>{if(at!==epoch)return;await db.update(s=>{if(at===epoch&&s.settings.enabled)s.sync={...s.sync,status:'error',code:safeError(e)};return s;});notify();}).finally(()=>{syncing=null;});}
async function snapshot():Promise<TaskSnapshot> {
  return {...await db.readSnapshot(),permission:await authorized()};
}
export async function clearTaskCache(preserveSettings=false) {
  epoch++;stopCollectors();bindings.clear();
  const cleared=await db.update(s=>{const clean=initialState();clean.generation=s.generation+1;if(preserveSettings)clean.settings=s.settings;return clean;});
  await updateSchedule(()=>({...readSchedule(null,TASK_ADAPTER_VERSION,Date.now()),dueAt:Date.now()+30*60_000}));
  await chrome.storage.local.set({[ENABLED]:cleared.settings.enabled});wake();await reconcile();notify(true);
}
async function uiCommand(m:any,sender:chrome.runtime.MessageSender) {
  if(!trustedExtensionSender(sender,chrome.runtime.id))throw Error('UNAUTHORIZED_SENDER');
  if(m.command==='SNAPSHOT')return snapshot();
  if(m.command==='SYNC'){
    if(syncing)return {started:true,coalesced:true};
    const timing=await schedule();if(!syncIsDue(timing,Date.now(),true)){
      if(timing.failureCode==='RATE_LIMITED')throw Error('RATE_LIMITED');
      return {started:false,retryAt:timing.paused?null:new Date(timing.dueAt).toISOString(),code:timing.failureCode};
    }
    startSync(true);return {started:true};
  }
  if(m.command==='HOME_OPEN'){
    const s=await db.readControl();
    if(!syncing&&s.settings.enabled&&s.settings.automatic&&syncIsDue(await schedule(),Date.now()))startSync();
    return {accepted:true};
  }
  if(m.command==='OPEN_SOURCE'){if(!(await db.readControl()).settings.enabled)throw Error('DISABLED');await chrome.tabs.create({url:'https://chatgpt.com/scheduled',active:true});return {opened:true};}
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
    if(p.enabled===true)await updateSchedule(previous=>['DISABLED','PERMISSION_REQUIRED'].includes(previous.failureCode||'')?{...previous,failureCode:null,failedAt:null,failures:0,paused:false,dueAt:Date.now(),lease:null}:previous);
    await chrome.storage.local.set({[ENABLED]:updated.settings.enabled});wake();await reconcile();notify(p.enabled===false);return snapshot();
  }
  if(m.command==='DETAIL') {
    const s=await db.read();const task=projectTasks(s,true).find(t=>t.key===m.key);if(!task)throw Error('RESULT_NOT_FOUND');
    if(m.runId!==undefined||m.revision!==undefined){
      if(typeof m.runId!=='string'||!Number.isInteger(m.revision)||m.revision<1)throw Error('INVALID_MESSAGE');
      const result=projectTaskResult(s,m.key,m.runId,m.revision);if(!result)throw Error('RESULT_NOT_FOUND');task.requestedResult=result;
    }
    return task;
  }
  if(m.command==='CLASSIFY') {
    await db.update(s=>{const c=s.catalog[m.key];if(!s.principal||!c?.scope.accountId.startsWith(s.principal+':'))throw Error('RESULT_NOT_FOUND');
      s.model=classify(s.model,{scope:c.scope,taskId:c.task.id,runId:m.runId,resultRevision:m.revision,outcome:m.outcome,classifiedAt:new Date().toISOString(),evidence:{kind:'user',reference:'start-result-review'}});return s;});notify();return snapshot();
  }
  if(m.command==='CLEAR') {
    await clearTaskCache();return snapshot();
  }
  if(m.command==='CLEAR_CACHE') {
    await clearTaskCache(true);return snapshot();
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
    epoch++;stopCollectors();bindings.clear();wake();void db.update(s=>{s.generation++;s.principal=null;s.sync={...s.sync,status:'error',code:'PERMISSION_REQUIRED'};return s;}).then(()=>notify(true));void reconcile();
  });
  const release=(id:number)=>{if(owned.some(t=>t.id===id)){owned=owned.filter(t=>t.id!==id);void chrome.storage.session.set({[OWNED]:owned});wake();}};
  chrome.tabs.onRemoved.addListener(id=>{bindings.delete(id);release(id);});
  chrome.tabs.onActivated.addListener(({tabId})=>release(tabId));
  chrome.tabs.onUpdated?.addListener((id,change)=>{
    const item=owned.find(t=>t.id===id);if(!item||!change.url||change.url===item.url)return;
    if(nativeRecoveryPage(change.url)){item.url=change.url;void chrome.storage.session.set({[OWNED]:owned});wake();}
    else release(id);
  });
  let interrupted=false;
  // Homepage snapshots wait only for this local authoritative projection rebuild.
  boot=db.update(s=>{interrupted=s.sync.status==='syncing';if(interrupted)s.sync={...s.sync,status:'error',code:'SYNC_INTERRUPTED'};return s;},{rebuildProjection:true}).then(()=>{});
  runtimeReady=boot.then(async()=>{
    await cleanup();
    const previous=await schedule();
    if(interrupted||previous.lease){const timing=await updateSchedule(current=>failedSchedule(current,'SYNC_INTERRUPTED',Date.now()));await exposeRetry(timing);}
    await reconcile();
  });
  void runtimeReady.catch(()=>{});
  chrome.runtime.onStartup.addListener(()=>{void runtimeReady.then(()=>reconcile());});
}
