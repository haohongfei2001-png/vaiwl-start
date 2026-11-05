/** Installed production runtime, disposable profile and synthetic native HTTP sources.
 * Optional grants are installed up front; this does not certify the native permission dialog. */
import { chromium } from 'playwright';
import { mkdtemp, mkdir, cp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { createServer } from 'node:https';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
const build=JSON.parse(await readFile('dist/build.json','utf8'));
const family=process.env.VAIWL_TEST_BROWSER_FAMILY||'chrome';
const checks=[],errors=[],requests=[],methods=[],sourceActivity=[];
const cid='00000000-0000-4000-8000-000000000001', tid='synthetic-task';
const originalBody='Synthetic full task report.\n\nBusiness success is not inferred from a completed message.\nhttps://example.com/result';
let body=originalBody,turn='turn-one',account='synthetic-account-a',rateLimited=false,cursor=null,delayResult=null,transientFailures=new Set(), resultFailure=null, sessionFailure=null, emptyResult=false;
let context,page,worker,server,version='',failure;
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const check=(id,pass,observed)=>{checks.push({id,status:pass?'PASS':'FAIL',observed});assert.ok(pass,id+': '+JSON.stringify(observed));};
async function until(probe,label,ms=18000){const end=Date.now()+ms;while(Date.now()<end){const v=await probe();if(v)return v;await pause(50)}throw Error('Timed out: '+label)}
const request=(command,fields={})=>page.evaluate(async({command,fields})=>{const r=await chrome.runtime.sendMessage({protocol:'vaiwl-tasks/1',command,...fields});if(!r?.ok)throw Error(r?.code);return r.data},{command,fields});
const sourceTabs=()=>worker.evaluate(()=>chrome.tabs.query({url:'https://chatgpt.com/*'}));
async function rawTasks(){return page.evaluate(async()=>{const db=await new Promise((res,rej)=>{const r=indexedDB.open('vaiwl-start-chatgpt-tasks');r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)});const s=await new Promise(res=>{const r=db.transaction('state').objectStore('state').get('current');r.onsuccess=()=>res(r.result)});db.close();return s})}
async function sync(){const since=new Date().toISOString();await request('SYNC');return until(async()=>{const s=await request('SNAPSHOT');return s.sync.attemptedAt>=since&&['ok','error'].includes(s.sync.status)?s:false},'sync result',35000)}
const task=()=>({id:tid,title:'Synthetic monitored task',team_id:null,conversation_id:cid,is_enabled:true,schedule:'RRULE:FREQ=DAILY',default_timezone:'UTC',next_run_times:[],last_run_time:'2026-11-01T09:00:00Z',prompt:'PRIVATE PROMPT EXCLUDED'});
const conversation=()=>({conversation_id:cid,current_node:emptyResult?'reasoning':'final-message',mapping:{
 'user-message':{parent:null,message:{id:'user-message',author:{role:'user'},content:{parts:['PRIVATE USER TEXT EXCLUDED']}}},
 reasoning:{parent:'user-message',message:{id:'reasoning',author:{role:'assistant'},channel:'analysis',content:{parts:['PRIVATE REASONING EXCLUDED']}}},
 'final-message':{parent:'reasoning',message:{id:'final-message',author:{role:'assistant'},channel:'final',recipient:'all',end_turn:true,status:'finished_successfully',create_time:turn==='turn-one'?1793523600:1793527200,metadata:{automation_id:tid,working_turn_id:turn,is_complete:true},content:{content_type:'text',parts:[body]}}}
}});
try{
 const harness=await mkdtemp(join(tmpdir(),'vaiwl-tasks-extension-'));await cp(resolve('dist'),harness,{recursive:true});
 for(const [name,digest] of Object.entries(build.files))assert.equal(createHash('sha256').update(await readFile(join(harness,name))).digest('hex'),digest);
 const manifest=JSON.parse(await readFile(join(harness,'manifest.json'),'utf8'));manifest.permissions.push('scripting','alarms');manifest.optional_permissions=manifest.optional_permissions.filter(x=>!['scripting','alarms'].includes(x));manifest.host_permissions=['https://chatgpt.com/*'];delete manifest.optional_host_permissions;await writeFile(join(harness,'manifest.json'),JSON.stringify(manifest));
 const tls=await mkdtemp(join(tmpdir(),'vaiwl-tasks-tls-'));
 execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(tls,'key.pem'),'-out',join(tls,'cert.pem'),'-days','1','-subj','/CN=chatgpt.com'],{stdio:'ignore'});
 const handle=async route=>{
  const url=new URL(route.request().url());requests.push(url.pathname);methods.push(route.request().method());
  if(url.origin!=='https://chatgpt.com')return route.abort();
  const json=x=>route.fulfill({contentType:'application/json',body:JSON.stringify(x)});
  if(url.pathname==='/api/auth/session'){if(sessionFailure==='logout')return json({});if(sessionFailure)return route.fulfill({status:403,headers:{'cf-mitigated':'challenge'},body:'Verification'});return json({user:{id:account},expires:'2099-01-01T00:00:00Z',accessToken:'SYNTHETIC SECRET NEVER READ OR STORED'});}
  if(url.pathname==='/backend-api/automations'){
   if(rateLimited)return route.fulfill({status:429,contentType:'application/json',body:'{}'});
   const filter=url.searchParams.get('filter');if(transientFailures.delete(filter))return route.fulfill({status:403,headers:{'cf-mitigated':'challenge'},contentType:'application/json',body:'{}'});return json({items:filter==='scheduled'?[task(),{...task(),id:'synthetic-dot',title:'Synthetic unsupported source',conversation_id:null,aeon_id:'unsupported-dot'}]:[],cursor:filter==='scheduled'?cursor:null});
  }
  if(url.pathname==='/backend-api/conversation/'+cid){if(resultFailure==='network')return route.abort();if(resultFailure)return route.fulfill({status:resultFailure==='login'?401:403,headers:resultFailure==='challenge'?{'cf-mitigated':'challenge'}:{},body:'Source unavailable'});if(delayResult)await delayResult;return json(conversation())}
  if(url.pathname==='/scheduled'||url.pathname==='/c/'+cid){
   sourceActivity.push({path:url.pathname,tabs:await sourceTabs().then(ts=>ts.map(t=>({active:t.active}))) });
   const calls=url.pathname==='/scheduled'?['scheduled','paused','finished'].map(f=>`nativeRead('/backend-api/automations?filter=${f}&limit=25')`).join(';'):`nativeRead('/backend-api/conversation/${cid}')`;
   return route.fulfill({contentType:'text/html',body:`<!doctype html><title>Synthetic native task source</title><a href="/c/${cid}?automationId=${tid}">Task output</a><script>function nativeRead(url){fetch(url).then(r=>{if(r.status===403)setTimeout(()=>fetch(url).catch(()=>{}),100)}).catch(()=>{})}${calls}</script>`});
  }
  return route.fulfill({status:404,body:'synthetic fixture not defined'});
 };
 server=createServer({key:await readFile(join(tls,'key.pem')),cert:await readFile(join(tls,'cert.pem'))},(req,res)=>{
  const route={request:()=>({url:()=>`https://chatgpt.com${req.url}`,method:()=>req.method}),abort:()=>{res.destroy()},fulfill:async({status=200,contentType='text/plain',body='',headers={}})=>{res.writeHead(status,{'Content-Type':contentType,...headers});res.end(body)}};
  void handle(route).catch(error=>{errors.push(String(error));res.writeHead(500);res.end()});
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;
 context=await chromium.launchPersistentContext(await mkdtemp(join(tmpdir(),'vaiwl-tasks-profile-')),{...(process.env.VAIWL_CHROMIUM_EXECUTABLE?{executablePath:process.env.VAIWL_CHROMIUM_EXECUTABLE}:{channel:process.env.VAIWL_BROWSER_CHANNEL||'chromium'}),headless:true,ignoreHTTPSErrors:true,viewport:{width:1440,height:1000},args:['--no-sandbox','--ignore-certificate-errors','--proxy-server=direct://',`--host-resolver-rules=MAP chatgpt.com 127.0.0.1:${port}, MAP * ~NOTFOUND, EXCLUDE localhost`,`--disable-extensions-except=${harness}`,`--load-extension=${harness}`]});
 context.on('page',p=>p.on('pageerror',e=>errors.push(String(e))));
 worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');await worker.evaluate(()=>{globalThis.taskDebug=[];chrome.runtime.onMessage.addListener((m,s)=>{if(m?.protocol==='vaiwl-tasks/1'&&['HELLO','OBSERVE'].includes(m.command))globalThis.taskDebug.push({command:m.command,kind:m.packet?.kind,filter:m.packet?.filter,code:m.packet?.code,at:m.packet?.observedAt,page:m.packet?.pageHref,doc:s.documentId});});});version=context.browser()?.version()||await worker.evaluate(()=>navigator.userAgent);
 page=await context.newPage();await page.goto('chrome://newtab/');await page.waitForSelector('html[data-start-ready="true"]');
 const beforeRequests=requests.length;await pause(100);check('disabled-by-default',!(await request('SNAPSHOT')).settings.enabled&&requests.length===beforeRequests,'No task network reads on installation.');
 await request('CONFIGURE',{patch:{enabled:true,automatic:true}});
 let snapshot=await sync();check('B-native-source-to-home',snapshot.sync.status==='ok'&&snapshot.tasks.find(t=>t.taskId===tid).latestAvailableResult?.preview.includes('Synthetic full task report'),snapshot.sync);
 await until(async()=>(await sourceTabs()).length===0,'owned pages closed');
 check('B-inactive-sequential-pages',sourceActivity.length===2&&sourceActivity.every(x=>x.tabs.length===1&&x.tabs.every(t=>!t.active)),sourceActivity);
 check('native-list-scope',snapshot.completeList&&snapshot.tasks.length===2&&snapshot.tasks.filter(t=>t.readable).length===1,'All three filters; unsupported source not claimed as readable.');
 check('scheduler-status-honest',snapshot.tasks.find(t=>t.taskId===tid).recordedStatus==='unknown'&&snapshot.tasks.find(t=>t.taskId===tid).nextRunAt===null&&snapshot.tasks.find(t=>t.taskId===tid).currentResult===null,'No invented run status or future schedule.');
 await page.waitForSelector('#tasks-home:not([hidden]) .task-featured');await page.locator('.task-featured').click();
 check('full-body-and-source',await page.locator('#task-result-body').textContent()===originalBody&&(await page.locator('#task-result-links a').first().getAttribute('href')).includes('automationId='+tid),'Exact complete final text plus original task source.');
 await mkdir('artifacts/tasks',{recursive:true});await page.screenshot({path:`artifacts/tasks/${family}-result.png`,fullPage:true});
 await page.locator('#task-classification').selectOption('new_information');await until(async()=>(await request('SNAPSHOT')).tasks.find(t=>t.taskId===tid).lastValuableResult,'mark valuable');await page.locator('#task-result-close').click();
 const stored=JSON.stringify(await rawTasks());check('minimal-persisted-content',!stored.includes('EXCLUDED')&&!stored.includes('SYNTHETIC SECRET')&&stored.includes(originalBody.slice(0,25)),'No prompt, user, reasoning, session credential or unrelated chat retained.');
 const dbs=await page.evaluate(async()=>(await indexedDB.databases()).map(x=>x.name));check('independent-database',dbs.includes('vaiwl-start-chatgpt-tasks')&&dbs.includes('vaiwl-start'),dbs);
 body='Synthetic latest output: no new information.';turn='turn-two';snapshot=await sync();
 check('important-result-preserved',snapshot.tasks.find(t=>t.taskId===tid).lastValuableResult?.preview.startsWith('Synthetic full')&&snapshot.tasks.find(t=>t.taskId===tid).latestAvailableResult?.preview===body,'Old valuable and new output remain independently readable.');
 await page.locator('.task-featured').click();await page.locator('#task-result-version').selectOption('latest');await until(async()=>await page.locator('#task-result-body').textContent()===body,'latest full body');
 await page.locator('#task-classification').selectOption('no_new_information');await until(async()=>(await request('SNAPSHOT')).tasks.find(t=>t.taskId===tid).latestAvailableResult?.classification?.outcome==='no_new_information','classify no new');await page.locator('#task-result-close').click();
 for(const theme of ['classic','spatial','workbench','folio']){await page.evaluate(theme=>chrome.storage.local.set({'native.homeTheme':theme}),theme);await until(()=>page.evaluate(t=>document.documentElement.dataset.homeTheme===t,theme),'theme');check('task-widget-theme-'+theme,await page.locator('.task-featured').isVisible(),'Shared task component stays visible in '+theme);}
 await page.setViewportSize({width:390,height:900});check('task-widget-mobile-bounds',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'No horizontal overflow with result preview.');await page.setViewportSize({width:1440,height:1000});
 await page.locator('#mode-toggle').click();await until(()=>page.evaluate(()=>document.documentElement.dataset.homeMode==='life'),'life');
 check('life-clears-task-private-dom',await page.evaluate(()=>!document.body.textContent.includes('Synthetic monitored task')&&!document.body.textContent.includes('Synthetic full task report')&&document.querySelector('#tasks-home').childNodes.length===0),'Titles, output, selections and closed-dialog contents cleared.');
 await page.locator('#mode-toggle').click();await page.waitForSelector('.task-featured');
 transientFailures=new Set(['scheduled','paused','finished']);snapshot=await sync();check('native-page-can-recover-transient-response',snapshot.sync.status==='ok'&&transientFailures.size===0,'Wait for the native page’s own successful reads; no extension-auth retry or challenge solving.');

 snapshot=await sync();check('fresh-unchanged-is-not-business-no-information',snapshot.tasks.find(t=>t.taskId===tid).readOutcome==='unchanged'&&snapshot.sync.status==='ok'&&(await page.locator('.tasks-sync').textContent()).includes('最近读取'),'Fresh source read recorded without changing business classification.');
 emptyResult=true;snapshot=await sync();check('empty-source-preserves-prior-output',snapshot.tasks.find(t=>t.taskId===tid).readOutcome==='empty'&&snapshot.tasks.find(t=>t.taskId===tid).latestAvailableResult.preview===body,'An empty completed-output list does not remove cached results.');emptyResult=false;
 // Failure classifications use native response/header signals in visit mode.
 const native=await context.newPage();await native.goto(`https://chatgpt.com/c/${cid}?automationId=${tid}`);
 await until(async()=>(await request('SNAPSHOT')).tasks.find(t=>t.taskId===tid).readOutcome==='unchanged','native visit ready');
 for(const [fixture,expected] of [['challenge','VERIFICATION_REQUIRED'],['forbidden','SOURCE_FORBIDDEN'],['login','LOGIN_REQUIRED'],['network','NETWORK_ERROR']]){
  resultFailure=fixture;await native.evaluate(path=>fetch(path).catch(()=>{}),'/backend-api/conversation/'+cid);
  await until(async()=>(await request('SNAPSHOT')).sync.code===expected,'native '+expected);
  await native.evaluate(()=>fetch('/backend-api/automations?filter=scheduled&limit=25'));await pause(150);
  snapshot=await request('SNAPSHOT');check('failure-'+fixture,snapshot.sync.code===expected&&snapshot.tasks.find(t=>t.taskId===tid).lastValuableResult?.preview.startsWith('Synthetic full'),'Unrelated list success cannot erase the failed result read; cache retained.');
  if(fixture==='challenge'){
   await page.locator('#settings-trigger').click();await page.locator('#settings-nav-workspace').click();await page.locator('#tasks-recover').waitFor({state:'visible'});
   check('verification-recovery-control',await page.locator('#tasks-sync-status').textContent().then(t=>t.includes('完成验证')),'Normal verification entry is available with an explicit reason.');
   await page.locator('#tasks-recover').click();const recovery=await until(()=>context.pages().find(p=>p.url()==='https://chatgpt.com/scheduled'),'recovery page');
   check('recovery-page-belongs-to-user',!(await worker.evaluate(()=>chrome.storage.session.get('tasks.ownedTabs')))['tasks.ownedTabs']?.length,'User-requested normal page is not automatically closed.');await recovery.close();await page.locator('[data-close="settings-dialog"]').click();
  }
  resultFailure=null;await native.evaluate(path=>fetch(path),'/backend-api/conversation/'+cid);await until(async()=>(await request('SNAPSHOT')).sync.status==='ok','native recovery');
 }
 sessionFailure='challenge';await native.evaluate(path=>fetch(path),'/backend-api/conversation/'+cid);await until(async()=>(await request('SNAPSHOT')).sync.code==='VERIFICATION_REQUIRED','identity challenge');
 check('identity-challenge-keeps-cache',(await request('SNAPSHOT')).tasks.some(t=>t.latestAvailableResult),'Unavailable identity is not mistaken for logout or cached data deletion.');
 sessionFailure='logout';await native.evaluate(path=>fetch(path),'/backend-api/conversation/'+cid);await until(async()=>(await request('SNAPSHOT')).sync.code==='LOGIN_REQUIRED'&&!(await request('SNAPSHOT')).principal,'proven logout');
 check('proven-logout-hides-but-retains',Object.keys((await rawTasks()).catalog).length>0&&(await request('SNAPSHOT')).tasks.length===0,'Proven logout hides account data while retaining its partition.');
 sessionFailure=null;await native.reload();await until(async()=>(await request('SNAPSHOT')).sync.status==='ok','same account returns');await native.close();
 // An explicitly adopted temporary tab belongs to the user after activation.
 let adoptRelease;delayResult=new Promise(r=>adoptRelease=r);const adoptedSince=new Date().toISOString();await request('SYNC');
 const adopted=await until(async()=>(await sourceTabs()).find(t=>t.url?.includes('/c/')),'pending page for user adoption');await worker.evaluate(id=>chrome.tabs.update(id,{active:true}),adopted.id);adoptRelease();delayResult=null;
 await until(async()=>{const s=await request('SNAPSHOT');return s.sync.attemptedAt>=adoptedSince&&s.sync.status==='ok'},'adopted page sync');
 check('user-adopted-tab-is-preserved',(await worker.evaluate(id=>chrome.tabs.get(id),adopted.id)).active,'Extension leaves the activated page open.');await worker.evaluate(id=>chrome.tabs.remove(id),adopted.id);
 // Delay a native response across disable. An old document must not resurrect work.
 let release;delayResult=new Promise(r=>release=r);const beforeCount=requests.filter(p=>p==='/backend-api/conversation/'+cid).length;
 await request('SYNC');await until(()=>requests.filter(p=>p==='/backend-api/conversation/'+cid).length>beforeCount,'pending native result');
 await request('CONFIGURE',{patch:{enabled:false}});body='Late output must not overwrite cache';release();delayResult=null;
 await until(async()=>(await sourceTabs()).length===0,'disabled job cleans pages');await pause(100);
 snapshot=await request('SNAPSHOT');check('disable-fences-late-write',snapshot.tasks.find(t=>t.taskId===tid).latestAvailableResult.preview==='Synthetic latest output: no new information.'&&!snapshot.settings.enabled,'Cancelled work cannot overwrite cache or reenable sync.');
 await page.reload();await page.waitForSelector('.task-featured');check('cache-survives-reload',await page.locator('.task-featured').textContent().then(t=>t.includes('Synthetic full'))&&(await sourceTabs()).length===0,'Disabled cached output is retained and labelled.');
 // Visit-only collection, with no alarm and no owned/closed user page.
 await request('CONFIGURE',{patch:{enabled:true,automatic:false}});await request('SYNC');
 const manual=await until(()=>context.pages().find(p=>p.url()==='https://chatgpt.com/scheduled'),'manual source');await manual.locator('a').click();
 await until(async()=>(await request('SNAPSHOT')).tasks.find(t=>t.taskId===tid).latestAvailableResult.preview===body,'visit output');
 snapshot=await request('SNAPSHOT');check('C-visit-only',snapshot.sync.mode==='visit'&&!(await worker.evaluate(()=>chrome.alarms.get('vaiwl-task-sync')))&&!manual.isClosed(),'Visit captures actual fixture response; does not close user page.');await manual.close();
 await request('CONFIGURE',{patch:{automatic:true}});cursor='native-next-page';snapshot=await sync();check('pagination-never-claimed-complete',snapshot.sync.code==='PARTIAL_LIST'&&!snapshot.completeList,'Non-null native cursor remains partial, existing rows retained.');cursor=null;
 rateLimited=true;snapshot=await sync();check('rate-limit-stops-keeps-cache',snapshot.sync.code==='RATE_LIMITED'&&snapshot.tasks.find(t=>t.taskId===tid).lastValuableResult?.preview.startsWith('Synthetic full'),'No retry loop, cached important output survives.');rateLimited=false;
 const attempts=requests.length;await assert.rejects(request('SYNC'),/RATE_LIMITED/);await pause(150);check('rate-limit-cooldown-no-repeat',requests.length===attempts,'Persisted cooldown rejects immediate repeats without creating a page.');
 // A new principal sees no cached title/output from the previous account.
 const helloBefore=await worker.evaluate(()=>globalThis.taskDebug.filter(x=>x.command==='HELLO').length);const manualB=await context.newPage();await manualB.goto('https://chatgpt.com/');
 await until(async()=>await worker.evaluate(n=>globalThis.taskDebug.filter(x=>x.command==='HELLO').length>n,helloBefore),'document principal pinned');
 account='synthetic-account-b';await manualB.evaluate(()=>fetch('/backend-api/automations?filter=scheduled&limit=25')); 
 await until(async()=>(await request('SNAPSHOT')).tasks.length===0,'account isolation');
 check('account-switch-hides-previous-cache',(await request('SNAPSHOT')).tasks.length===0&&!(await page.locator('#tasks-home').textContent()).includes('Synthetic')&&!(await page.locator('#task-result-body').textContent()),'Old cache stays partitioned without cross-account display.');await manualB.close();
 await request('CLEAR');check('task-clear-is-independent',Object.keys((await rawTasks()).catalog).length===0&&!(await request('SNAPSHOT')).settings.enabled,'Only task database reset; source tasks never mutated.');
 check('read-only-native-requests',methods.length>0&&methods.every(m=>m==='GET'),'Only passive native GET fixtures and metadata-only session GET used; no task mutation route exists.');
 check('no-runtime-errors',errors.length===0,errors);
 await mkdir('artifacts/tasks',{recursive:true});await page.screenshot({path:`artifacts/tasks/${family}-complete.png`,fullPage:true});
}catch(e){if(page)console.log(JSON.stringify({requests,sourceActivity,errors,debug:await worker.evaluate(()=>globalThis.taskDebug),sync:(await rawTasks())?.sync}));failure=String(e?.stack||e);checks.push({id:'harness-completion',status:'FAIL',observed:failure});console.error(failure)}
finally{if(context)await context.close();if(server)await new Promise(r=>server.close(r));await mkdir('artifacts',{recursive:true});const report={status:failure?'FAIL':'PASS',buildSha:build.sha,dirty:build.dirty,browser:family,browserVersion:version,checks,errors,limitations:['Synthetic HTTP sources and disposable profile; live account evidence is separate.','Optional permissions pregranted in harness manifest; production runtime files unchanged.']};await writeFile(`artifacts/${family==='edge'?'edge-':''}task-integration-validation.json`,JSON.stringify(report,null,2));console.log(`${report.status}: ${checks.filter(c=>c.status==='PASS').length}/${checks.length} task checks (${family})`)}
if(failure)process.exitCode=1;
