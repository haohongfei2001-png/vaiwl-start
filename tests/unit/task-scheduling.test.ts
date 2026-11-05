import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState } from '../../src/tasks/database.js';
import { readSchedule, successfulSchedule, failedSchedule, nextHealthySync, syncIsDue } from '../../src/tasks/scheduling.js';
import type { TaskState } from '../../src/tasks/types.js';
import { temporaryPageTarget, nativeRecoveryPage } from '../../src/tasks/temporary-page.js';

const now=Date.parse('2026-11-05T12:00:00.000Z'), minute=60_000, adapter='native/2';
const fresh=()=>readSchedule(null,adapter,now);
function state(enabled=true,next:string|null=null):TaskState {
  const s=initialState();s.principal='principal:a';
  s.catalog.task={key:'task',scope:{provider:'chatgpt',profileId:'profile',accountId:'principal:a:personal'},observedAt:new Date(now).toISOString(),resultSyncedAt:null,
    task:{id:'task',title:'Daily task',is_enabled:enabled,schedule:null,default_timezone:'UTC',last_run_time:null,next_run_time:next,conversation_id:'conversation',team_id:null}};
  return s;
}
test('healthy cache schedules one check in thirty minutes; repeated homepage openings are not due',()=>{
  const schedule=successfulSchedule(fresh(),state(),now);
  assert.equal(schedule.dueAt,now+30*minute);
  for(let i=0;i<100;i++)assert.equal(syncIsDue(schedule,now+i*100),false);
  assert.equal(syncIsDue(schedule,now+30*minute),true);
  assert.equal(syncIsDue(schedule,now+1,true),true,'explicit refresh still rereads successful source');
});
test('empty and paused accounts need only a two hour discovery check',()=>{
  assert.equal(nextHealthySync(initialState(),now),now+120*minute);
  assert.equal(nextHealthySync(state(false),now),now+120*minute);
});
test('upcoming task advances next read to two minutes after plan, with a five minute minimum',()=>{
  assert.equal(nextHealthySync(state(true,new Date(now+10*minute).toISOString()),now),now+12*minute);
  assert.equal(nextHealthySync(state(true,new Date(now+minute).toISOString()),now),now+5*minute);
  assert.equal(nextHealthySync(state(true,new Date(now-minute).toISOString()),now),now+30*minute);
});
test('an active task belonging to another account never accelerates the current account schedule',()=>{
  const s=state();s.principal='principal:b';assert.equal(nextHealthySync(s,now),now+120*minute);
});
test('network failures persist across serialization and suppress immediate manual or automatic requests',()=>{
  const failed=failedSchedule(fresh(),'NETWORK_ERROR',now);
  const reopened=readSchedule(JSON.parse(JSON.stringify(failed)),adapter,now+minute);
  assert.equal(reopened.dueAt,now+5*minute);
  assert.equal(syncIsDue(reopened,now+minute),false);
  assert.equal(syncIsDue(reopened,now+minute,true),false);
  assert.equal(syncIsDue(reopened,now+5*minute,true),true);
});
test('network retry grows to a bounded hour; duplicate page failures do not multiply the exponent',()=>{
  let schedule=failedSchedule(fresh(),'NETWORK_ERROR',now);
  schedule=failedSchedule(schedule,'NETWORK_ERROR',now+100);
  assert.equal(schedule.failures,1);assert.equal(schedule.dueAt,now+5*minute);
  schedule=failedSchedule(schedule,'NETWORK_ERROR',now+5*minute);
  assert.equal(schedule.failures,2);assert.equal(schedule.dueAt,now+15*minute);
  for(let i=0;i<20;i++){const at=schedule.dueAt;schedule=failedSchedule(schedule,'NETWORK_ERROR',at);assert.ok(schedule.dueAt-at<=60*minute);}
});
test('rate limiting and verification use separate bounded recovery schedules',()=>{
  const rate=failedSchedule(fresh(),'RATE_LIMITED',now);assert.equal(rate.dueAt,now+30*minute);
  const verification=failedSchedule(fresh(),'VERIFICATION_REQUIRED',now);assert.equal(verification.dueAt,now+30*minute);
  const repeated=failedSchedule(verification,'VERIFICATION_REQUIRED',verification.dueAt);assert.equal(repeated.dueAt-verification.dueAt,120*minute);
  assert.equal(syncIsDue(rate,now+minute,true),false);
});
test('login loss pauses automatic retries until ordinary authenticated source recovery',()=>{
  const loggedOut=failedSchedule(fresh(),'LOGIN_REQUIRED',now);
  assert.equal(syncIsDue(loggedOut,now+7*24*60*minute,true),false);
  const recovered=successfulSchedule(loggedOut,state(),now+minute);
  assert.equal(recovered.failureCode,null);assert.equal(recovered.failures,0);assert.equal(syncIsDue(recovered,now+minute,true),true);
});
test('adapter changes reset a source schema circuit without discarding any cached model',()=>{
  const failed=failedSchedule(fresh(),'SOURCE_CHANGED',now);assert.equal(failed.dueAt,now+120*minute);
  assert.equal(syncIsDue(readSchedule(failed,adapter,now+minute),now+minute,true),false);
  const upgraded=readSchedule(failed,'native/3',now+minute);assert.equal(upgraded.failureCode,null);assert.equal(syncIsDue(upgraded,now+minute),true);
});
test('a durable in-flight lease prevents a second round until it is cleared or expired',()=>{
  const schedule={...fresh(),lease:{id:'owned-cycle',until:now+10*minute}};
  const reopened=readSchedule(JSON.parse(JSON.stringify(schedule)),adapter,now+minute);
  assert.equal(syncIsDue(reopened,now+minute,true),false);
  assert.equal(syncIsDue(reopened,now+10*minute,true),true);
  const interrupted=failedSchedule(reopened,'SYNC_INTERRUPTED',now+minute);
  assert.equal(interrupted.lease,null);assert.equal(syncIsDue(interrupted,now+2*minute),false);
});
test('a successful native result clears failure history and recomputes the next due time',()=>{
  const failed=failedSchedule(fresh(),'SOURCE_FORBIDDEN',now);
  const recovered=successfulSchedule(failed,state(),now+minute);
  assert.equal(recovered.failureCode,null);assert.equal(recovered.failedAt,null);assert.equal(recovered.lastSuccessAt,now+minute);
  assert.equal(recovered.dueAt,now+31*minute);
});
test('partial discovery delays automatic checks but still allows explicit native page refresh',()=>{
  const partial=failedSchedule(fresh(),'PARTIAL_LIST',now);
  assert.equal(partial.dueAt,now+30*minute);assert.equal(syncIsDue(partial,now+1),false);assert.equal(syncIsDue(partial,now+1,true),true);
});
test('temporary tab cleanup compares pending target during navigation and recognizes only provider recovery pages',()=>{
  assert.equal(temporaryPageTarget({url:'https://chatgpt.com/scheduled',pendingUrl:'https://chatgpt.com/c/result'}),'https://chatgpt.com/c/result');
  assert.equal(temporaryPageTarget({url:'https://chatgpt.com/scheduled'}),'https://chatgpt.com/scheduled');
  assert.equal(nativeRecoveryPage('https://chatgpt.com/auth/login?next=/scheduled'),'LOGIN_REQUIRED');
  assert.equal(nativeRecoveryPage('https://auth.openai.com/log-in'),'LOGIN_REQUIRED');
  assert.equal(nativeRecoveryPage('https://chatgpt.com/cdn-cgi/challenge-platform/page'),'VERIFICATION_REQUIRED');
  for(const href of ['https://example.com/login','https://chatgpt.com/c/other','https://chatgpt.com/authentic','http://chatgpt.com/login'])assert.equal(nativeRecoveryPage(href),null);
});
test('three consecutive challenge or adapter failures pause all scheduled retries, including after restart',()=>{
  for(const code of ['VERIFICATION_REQUIRED','SOURCE_CHANGED','SOURCE_FORBIDDEN']){
    let schedule=fresh();
    for(let i=0;i<3;i++)schedule=failedSchedule(schedule,code,schedule.dueAt);
    const reopened=readSchedule(JSON.parse(JSON.stringify(schedule)),adapter,schedule.dueAt+24*60*minute);
    assert.equal(reopened.paused,true,code);
    assert.equal(syncIsDue(reopened,schedule.dueAt+24*60*minute),false,code);
    assert.equal(syncIsDue(reopened,schedule.dueAt+24*60*minute,true),false,code);
    assert.equal(successfulSchedule(reopened,state(),schedule.dueAt).paused,false,code);
    assert.equal(readSchedule(reopened,'native/next',schedule.dueAt).paused,false,code);
  }
});
test('repeated rate limits remain recoverable after bounded cooldown, while login is paused without a retry promise',()=>{
  let schedule=fresh();for(let i=0;i<5;i++)schedule=failedSchedule(schedule,'RATE_LIMITED',schedule.dueAt);
  assert.equal(schedule.paused,false);assert.equal(syncIsDue(schedule,schedule.dueAt),true);
  assert.equal(failedSchedule(fresh(),'LOGIN_REQUIRED',now).paused,true);
});
