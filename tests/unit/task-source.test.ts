import test from 'node:test';
import assert from 'node:assert/strict';
import { indexedDB } from 'fake-indexeddb';
import { extractPacket, taskResults, normalizeTask, validatePacket, sourceKind } from '../../src/tasks/source.js';
import { initialState, TaskDatabase } from '../../src/tasks/database.js';
import { applyPacket, projectTasks, listComplete, selectedKeys } from '../../src/tasks/state.js';
import { responseFailure } from '../../src/tasks/failures.js';
import { classify } from '../../research/chatgpt-tasks/result-model.mjs';
import type { SourcePacket } from '../../src/tasks/types.js';
const cid='00000000-0000-4000-8000-000000000001',tid='synthetic-task',principal='principal:'+'a'.repeat(64);
const href=`https://chatgpt.com/c/${cid}?automationId=${tid}`;
const at='2026-11-01T10:00:00.000Z';
const task=()=>({id:tid,title:'Synthetic result task',team_id:null,conversation_id:cid,is_enabled:true,schedule:'RRULE:FREQ=DAILY',default_timezone:'UTC',next_run_times:[],last_run_time:'2026-11-01T09:00:00Z'});
const message=(overrides:any={})=>({id:'synthetic-message',author:{role:'assistant'},channel:'final',recipient:'all',end_turn:true,status:'finished_successfully',create_time:1793523600,content:{content_type:'text',parts:['Synthetic final output.']},metadata:{automation_id:tid,working_turn_id:'synthetic-turn',is_complete:true},...overrides});
const convo=(m=message())=>({conversation_id:cid,current_node:m.id,mapping:{[m.id]:{message:m,parent:null}}});
function listed(){const s=initialState();s.principal=principal;return applyPacket(s,principal,{kind:'list',firstPage:true,filter:'scheduled',cursor:null,tasks:[normalizeTask(task())],observedAt:at,pageHref:'https://chatgpt.com/scheduled'});}
const results=(m=message(),time='2026-11-01T10:01:00.000Z')=>extractPacket(`https://chatgpt.com/backend-api/conversation/${cid}`,href,time,convo(m))!;
test('native next_run_times are used, empty or missing schedules stay unknown',()=>{assert.equal(normalizeTask(task()).next_run_time,null);assert.equal(normalizeTask({...task(),next_run_times:['2026-11-03T01:00:00Z','2026-11-02T01:00:00Z']}).next_run_time,'2026-11-02T01:00:00.000Z');});
test('only task-tagged final complete output can cross the bridge',()=>{
 for(const change of [{author:{role:'user'}},{author:{role:'tool'}},{channel:'analysis'},{channel:'commentary'},{end_turn:false},{recipient:'tool'},{status:'in_progress'},{metadata:{automation_id:'other',is_complete:true}},{metadata:{automation_id:tid,is_complete:false}},{metadata:{automation_id:tid,is_complete:true,is_visually_hidden_from_conversation:true}}])assert.equal(taskResults(convo(message(change)),tid,cid).length,0);
 assert.equal(taskResults(convo(),tid,cid)[0].body,'Synthetic final output.');
});
test('unrelated conversations and ordinary chat pages are not intercepted',()=>{assert.equal(sourceKind(`https://chatgpt.com/backend-api/conversation/${cid}`,`https://chatgpt.com/c/${cid}`),null);assert.equal(sourceKind('https://other.test/backend-api/automations?filter=scheduled',href),null);assert.throws(()=>taskResults({...convo(),conversation_id:'different'},tid,cid),/SOURCE_CHANGED/);});
test('only the active branch is collected, not alternate generated answers',()=>{const c:any=convo();c.mapping['alternate']={message:message({id:'alternate'}),parent:null};assert.equal(taskResults(c,tid,cid).length,1);assert.equal(taskResults(c,tid,cid)[0].messageId,'synthetic-message');});
test('sensitive non-task fields are removed before IPC',()=>{const packet=extractPacket('https://chatgpt.com/backend-api/automations?filter=scheduled&limit=25','https://chatgpt.com/scheduled',at,{items:[{...task(),prompt:'PRIVATE PROMPT',accessToken:'DO NOT COPY',email:'private@example.test'}],cursor:null});assert.ok(!JSON.stringify(packet).includes('PRIVATE'));assert.ok(!JSON.stringify(packet).includes('DO NOT COPY'));assert.ok(!JSON.stringify(packet).includes('email'));});
test('bridge rejects forged route association, overlarge body and unsupported shapes',()=>{const p=results() as any;assert.throws(()=>validatePacket({...p,pageHref:'https://chatgpt.com/c/'+cid+'?automationId=other'}));assert.throws(()=>validatePacket({...p,results:[{...p.results[0],body:'x'.repeat(1_000_001)}]}));assert.throws(()=>validatePacket({...p,taskId:123}));});
test('stable native task/turn/message association reuses the inherited model without fake run status',()=>{let s=applyPacket(listed(),principal,results());s=applyPacket(s,principal,results(message(),'2026-11-01T10:02:00.000Z'));const t=projectTasks(s,true)[0];assert.equal(t.latestAvailableResult?.bodyText,'Synthetic final output.');assert.equal(t.latestAvailableResult?.runId,'turn:synthetic-turn');assert.equal(t.recordedStatus,'unknown');assert.equal(t.currentResult,null);assert.equal(Object.values(s.model.scopes)[0].sync.sourceChannel,'chatgpt-native-page');assert.equal(Object.values(Object.values(s.model.scopes)[0].tasks)[0] instanceof Object,true);assert.equal((Object.values(Object.values(s.model.scopes)[0].tasks)[0] as any).runs['["chatgpt","browser-profile","'+principal+':personal","synthetic-task","turn:synthetic-turn"]'].results.length,1);});
test('list coverage is explicit; cursor or a missing category never claims completeness',()=>{const s=listed();assert.equal(listComplete(s),false);for(const filter of ['paused','finished'] as const)applyPacket(s,principal,{kind:'list',firstPage:true,filter,cursor:null,tasks:[],observedAt:at,pageHref:'https://chatgpt.com/scheduled'});assert.equal(listComplete(s),true);s.coverage[principal].filters.paused.cursor='more';assert.equal(listComplete(s),false);});
test('a failed sync and missing rows preserve real cached output',()=>{let s=applyPacket(listed(),principal,results());s=applyPacket(s,principal,{kind:'error',code:'SOURCE_UNAVAILABLE',pageHref:href,observedAt:at});assert.equal(projectTasks(s,true)[0].latestAvailableResult?.bodyText,'Synthetic final output.');s=applyPacket(s,principal,{kind:'list',firstPage:true,filter:'scheduled',cursor:null,tasks:[],pageHref:'https://chatgpt.com/scheduled',observedAt:'2026-11-01T11:00:00Z'});assert.equal(projectTasks(s).length,1);});
test('account switches show no old title/body and reject late old observations',()=>{const s=applyPacket(listed(),principal,results());s.principal='principal:'+'b'.repeat(64);assert.deepEqual(projectTasks(s,true),[]);assert.throws(()=>applyPacket(s,principal,results()),/STALE_DOCUMENT/);s.principal=principal;assert.equal(projectTasks(s).length,1);});
test('important result marking survives a newer unknown result',()=>{let s=applyPacket(listed(),principal,results());const c=Object.values(s.catalog)[0];s.model=classify(s.model,{scope:c.scope,taskId:tid,runId:'turn:synthetic-turn',resultRevision:1,outcome:'new_information',classifiedAt:'2026-11-01T10:02:00Z',evidence:{kind:'user',reference:'synthetic review'}});const m=message({id:'new-message',create_time:1793527200,metadata:{automation_id:tid,working_turn_id:'new-turn',is_complete:true},content:{content_type:'text',parts:['New unclassified result']}});s=applyPacket(s,principal,results(m,'2026-11-01T12:00:00Z'));const t=projectTasks(s,true)[0];assert.equal(t.lastValuableResult?.bodyText,'Synthetic final output.');assert.equal(t.latestAvailableResult?.bodyText,'New unclassified result');});
test('selection is account-local and an empty explicit selection stays empty',()=>{const s=listed();assert.equal(selectedKeys(s).length,1);s.settings.selections[principal]=[];assert.deepEqual(selectedKeys(s),[]);});
test('independent IndexedDB survives reopen and atomic update failure without touching catalog database',async()=>{Object.defineProperty(globalThis,'indexedDB',{value:indexedDB,configurable:true});const db=new TaskDatabase();await db.update(()=>applyPacket(listed(),principal,results()));assert.equal(projectTasks(await new TaskDatabase().read(),true)[0].latestAvailableResult?.bodyText,'Synthetic final output.');await assert.rejects(db.update(s=>{s.catalog={};throw Error('injected');}),/injected/);assert.equal(projectTasks(await db.read()).length,1);assert.deepEqual((await indexedDB.databases()).map(x=>x.name),['vaiwl-start-chatgpt-tasks']);});

test('terminal later page never masquerades as complete first-page coverage',()=>{const s=listed();for(const filter of ['paused','finished'])applyPacket(s,principal,{kind:'list',firstPage:true,filter,cursor:null,tasks:[],observedAt:at,pageHref:'https://chatgpt.com/scheduled'} as SourcePacket);const p=extractPacket('https://chatgpt.com/backend-api/automations?filter=scheduled&limit=25&cursor=next','https://chatgpt.com/scheduled','2026-11-01T12:00:00.000Z',{items:[],cursor:null})!;applyPacket(s,principal,p);assert.equal(listComplete(s),false);});

test('ambiguous team association fails closed instead of selecting the first matching task',()=>{const s=listed();applyPacket(s,principal,{kind:'list',firstPage:true,filter:'scheduled',cursor:null,tasks:[normalizeTask({...task(),team_id:'another-team'})],observedAt:'2026-11-01T10:00:30.000Z',pageHref:'https://chatgpt.com/scheduled'});assert.throws(()=>applyPacket(s,principal,results()),/TASK_NOT_DISCOVERED/);});


test('explicit HTTP failure signals separate verification, login, rate limit and unclassified 403',()=>{
 const response=(status:number,headers:Record<string,string>={})=>({status,headers:new Headers(headers)});
 assert.equal(responseFailure(response(403,{'cf-mitigated':'challenge'})),'VERIFICATION_REQUIRED');
 assert.equal(responseFailure(response(403)),'SOURCE_FORBIDDEN');assert.equal(responseFailure(response(401)),'LOGIN_REQUIRED');
 assert.equal(responseFailure(response(429)),'RATE_LIMITED');assert.equal(responseFailure(response(502)),'SOURCE_UNAVAILABLE');assert.equal(responseFailure(response(200)),null);
});
test('fresh unchanged, newly revised and empty reads preserve inherited result semantics',()=>{
 const s=applyPacket(listed(),principal,results());assert.equal(projectTasks(s)[0].readOutcome,'updated');
 applyPacket(s,principal,results(message(),'2026-11-01T10:02:00Z'));assert.equal(projectTasks(s)[0].readOutcome,'unchanged');
 assert.equal(projectTasks(s)[0].latestAvailableResult?.classification,null);
 applyPacket(s,principal,results(message({content:{content_type:'text',parts:['Revised final']}}),'2026-11-01T10:03:00Z'));assert.equal(projectTasks(s)[0].readOutcome,'updated');
 const empty=results(message(),'2026-11-01T10:04:00Z') as Extract<SourcePacket,{kind:'results'}>;empty.results=[];applyPacket(s,principal,empty);
 assert.equal(projectTasks(s)[0].readOutcome,'empty');assert.equal(projectTasks(s,true)[0].latestAvailableResult?.bodyText,'Revised final');
});
test('list-only reads never certify fresh output and unrelated success cannot erase a result failure',()=>{
 const s=listed();assert.equal(s.sync.succeededAt,null);
 applyPacket(s,principal,results());const success=s.sync.succeededAt;
 const failure={kind:'error',code:'VERIFICATION_REQUIRED',target:'results:'+cid+':'+tid,pageHref:href,observedAt:'2026-11-01T10:02:00Z'} as const;
 applyPacket(s,principal,failure);
 applyPacket(s,principal,{kind:'list',firstPage:true,filter:'scheduled',cursor:null,tasks:[normalizeTask(task())],pageHref:'https://chatgpt.com/scheduled',observedAt:'2026-11-01T10:03:00Z'});
 assert.equal(s.sync.code,'VERIFICATION_REQUIRED');assert.equal(s.sync.succeededAt,success);
 applyPacket(s,principal,results(message(),'2026-11-01T10:04:00Z'));assert.equal(s.sync.code,null);assert.equal(s.sync.status,'ok');
});
test('failure bridge binds result errors to the actual task route',()=>{
 const p={kind:'error',code:'NETWORK_ERROR',target:'results:'+cid+':'+tid,pageHref:href,observedAt:at};assert.equal(validatePacket(p).kind,'error');
 for(const target of ['results:'+cid+':other',null,123,'identity'])assert.throws(()=>validatePacket({...p,target}),/SOURCE_CHANGED/);
});
test('rate-limit cooldown persists across unrelated successful reads',()=>{
 const s=listed();applyPacket(s,principal,{kind:'error',code:'RATE_LIMITED',target:'list:scheduled',pageHref:href,observedAt:at});
 applyPacket(s,principal,results());assert.equal(s.sync.retryAt,'2026-11-01T10:30:00.000Z');assert.equal(s.sync.code,'RATE_LIMITED');
 applyPacket(s,principal,{kind:'error',code:'NETWORK_ERROR',target:'list:scheduled',pageHref:href,observedAt:'2026-11-01T10:03:00Z'});
 applyPacket(s,principal,results(message(),'2026-11-01T10:04:00Z'));assert.equal(s.sync.retryAt,'2026-11-01T10:30:00.000Z');
});

test('late failure cannot turn a newer successful source read into stale cache',()=>{
 const s=applyPacket(listed(),principal,results(message(),'2026-11-01T10:04:00Z'));
 applyPacket(s,principal,{kind:'error',code:'NETWORK_ERROR',target:'results:'+cid+':'+tid,pageHref:href,observedAt:'2026-11-01T10:03:00Z'});
 assert.equal(s.sync.status,'ok');assert.equal(s.sync.code,null);
});
