import { waitForAsync } from './wait-async.mjs';
import { chromium } from 'playwright';
import { mkdtemp, mkdir, cp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
const expectedFamily=process.env.VAIWL_TEST_BROWSER_FAMILY || 'chrome';
const reportName=expectedFamily === 'edge' ? 'edge-native-validation' : 'native-experience-validation';
const build = JSON.parse(await readFile('dist/build.json','utf8'));
const checks = [], errors = [];
const check = (id, value, observed) => { assert.ok(value, `${id}: ${observed}`); checks.push({id,status:'PASS',observed}); };
const launch = (profile,extension) => chromium.launchPersistentContext(profile,{ ...(process.env.VAIWL_CHROMIUM_EXECUTABLE ? {executablePath:process.env.VAIWL_CHROMIUM_EXECUTABLE} : {channel:'chromium'}), headless:true,viewport:{width:1440,height:1000},args:['--no-sandbox',`--disable-extensions-except=${extension}`,`--load-extension=${extension}`] });
async function ready(context) {
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker',{timeout:15000});
  const id=new URL(worker.url()).host,page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`chrome-extension://${id}/newtab.html`);await page.waitForSelector('html[data-start-ready="true"][data-native-ready="true"]');return {worker,id,page};
}
async function command(page,name,payload={}) {return page.evaluate(async({name,payload})=>{
 const send=(command,payload,expectedRevision)=>chrome.runtime.sendMessage({protocol:'vaiwl-start-internal/1',operationId:crypto.randomUUID(),expectedRevision,command,payload});
 const current=await send('SNAPSHOT',{},0);if(!current.ok)throw Error(current.code);const reply=await send(name,payload,current.data.revision);if(!reply.ok)throw Error(reply.code);return reply.data;
},{name,payload});}
async function pref(page,value) {await page.locator('#bookmark-preference').selectOption(value);await page.waitForFunction(value=>document.querySelector('#bookmark-preference').value===value,value);await waitForAsync(page, async value=>(await chrome.storage.local.get('native.bookmarks'))['native.bookmarks']===value,value);}
async function raw(page) {return page.evaluate(async()=>{
 const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('vaiwl-start');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
 const names=[...db.objectStoreNames],tx=db.transaction(names),result={};await Promise.all(names.map(name=>new Promise((resolve,reject)=>{const r=tx.objectStore(name).getAll();r.onsuccess=()=>{result[name]=r.result;resolve()};r.onerror=()=>reject(r.error)})));db.close();return result;
});}
let context,status='FAIL',version='';
try {
 const productionProfile=await mkdtemp(join(tmpdir(),'vaiwl-native-production-'));
 context=await launch(productionProfile,resolve('dist'));let {worker,page,id}=await ready(context);version=await worker.evaluate(()=>navigator.userAgent);
 const grants=await worker.evaluate(()=>chrome.permissions.getAll());
 check('N-install-minimal-permissions',!grants.permissions.includes('bookmarks')&&!grants.permissions.includes('history'),'Unmodified production manifest installs with no bookmarks/history grants.');
 check('N-default-browser-title',/^(New Tab|New tab|新标签页|新建标签页|新分頁|新增索引標籤)$/.test(await page.title()),await page.title());
 check('N-default-browser-favicon',(await page.locator('#tab-favicon').getAttribute('href')).endsWith(`tab-${expectedFamily}.svg`),'Local approximate Chrome style, not browser-internal resource.');
 check('N-default-choice-settings-only',await page.locator('#bookmarks-home').isHidden()&&await page.locator('#bookmark-choose,#bookmark-home-connect').count()===0&&await page.locator('.native-bookmark').count()===0,'An unconfigured homepage has no bookmark prompt or second settings entry; display preference remains available through the gear.');
 await page.locator('#settings-trigger').click();check('N-choice-controls-reachable',await page.locator('#bookmark-preference').isVisible()&&await page.locator('#bookmark-connect').isVisible(),'The single settings dialog retains both the one-time preference and real permission action.');await pref(page,'always');check('N-always-bar-hidden',await page.locator('#bookmarks-home').isHidden(),'Always visible native bar suppresses Start duplicate.');
 await pref(page,'hidden');check('N-user-hidden-bar',await page.locator('#bookmarks-home').isHidden(),'User-hidden bar is respected.');
 await pref(page,'newtab');check('N-no-permission-settings-only',await page.locator('#bookmark-home-connect').count()===0&&await page.locator('#bookmarks-home').isHidden()&&await page.locator('#bookmark-connect').isVisible(),'Unapproved bookmarks stay off the homepage; the settings permission action remains reachable.');
 // Deliberate prompt-result injection tests the UI refusal branch only. It does NOT prove a native permission dialog.
 await page.evaluate(()=>{chrome.permissions.request=async value=>{window.__requested=value;return false}});
 await page.locator('#bookmark-connect').click();await page.waitForFunction(()=>document.querySelector('#native-status').textContent.includes('未获得'));
 check('N-denial-does-not-block-workspace',await page.locator('#workspace-content').textContent()!==''&&(await page.evaluate(()=>window.__requested.permissions.join()))==='bookmarks','Injected refusal calls only bookmarks; no history escalation or catalog loss.');
 await page.locator('#tab-title').fill('Home');await page.locator('#tab-title-form button').click();await page.waitForFunction(()=>document.title==='Home');
 check('N-independent-custom-title',await page.title()==='Home'&&(await page.locator('#tab-favicon').getAttribute('href')).endsWith(`tab-${expectedFamily}.svg`),'Name change leaves icon unchanged.');
 await page.locator('#tab-icon').selectOption('product');await page.waitForFunction(()=>document.querySelector('#tab-favicon').href.endsWith('tab-product.svg'));
 check('N-independent-product-icon',await page.title()==='Home','Product tab glyph changes neither title nor extension/page identity.');
 check('N-brand-identity-unchanged',(await worker.evaluate(()=>chrome.runtime.getManifest().name))==='VAIWL Start'&&(await page.locator('.topbar .brand').textContent()).includes('VAIWL'),'Manifest name and internal brand remain unchanged.');
 const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=48;c.height=32;const x=c.getContext('2d');x.fillStyle='#735b88';x.fillRect(0,0,48,32);return c.toDataURL('image/png').split(',')[1]});
 await page.locator('#tab-icon-upload').setInputFiles({name:'icon.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
 await page.waitForFunction(()=>document.querySelector('#tab-favicon').href.startsWith('data:image/png;base64,'));
 const uploaded=await page.locator('#tab-favicon').getAttribute('href');
 check('N-upload-raster-reencoded',uploaded!==`data:image/png;base64,${png}`&&uploaded.length<100000,'Canvas re-encodes 128px PNG and strips original file metadata.');
 for(const [name,mimeType,buffer] of [ ['evil.svg','image/svg+xml',Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>')], ['fake.png','image/png',Buffer.from('<svg onload="alert(1)"/>')], ['too-big.png','image/png',Buffer.alloc(1048577)] ]) {
  await page.evaluate(()=>document.querySelector('#native-status').textContent='');
  await page.locator('#tab-icon-upload').setInputFiles({name,mimeType,buffer});await page.waitForFunction(()=>document.querySelector('#tab-icon-upload').value==='' && (document.querySelector('#native-status').textContent.includes('仅支持')||document.querySelector('#native-status').textContent.includes('1 MB')));
  check(`N-upload-reject-${name}`,(await page.locator('#tab-favicon').getAttribute('href'))===uploaded,'Unsafe input rejected while previous valid icon remains.');
 }
 await page.reload();await page.waitForSelector('html[data-native-ready="true"]');
 check('N-reload-persistence',await page.title()==='Home'&&(await page.locator('#tab-favicon').getAttribute('href'))===uploaded,'Reload retains both independent settings.');
 await context.close();context=await launch(productionProfile,resolve('dist'));({worker,page,id}=await ready(context));
 check('N-restart-persistence',await page.title()==='Home'&&(await page.locator('#tab-favicon').getAttribute('href'))===uploaded,'Full isolated browser restart retains settings.');
 if(expectedFamily==='chrome') {
  const beforeReloadOrigin=await worker.evaluate(()=>performance.timeOrigin);
  // Exercise the native developer Reload control used for unpacked upgrades.
  // This privileged UI instrumentation exists only in the isolated test profile.
  const manager=await context.newPage();await manager.goto('chrome://extensions');
  await manager.locator('extensions-item').first().waitFor();await manager.locator('#devMode').click();
  await manager.evaluate(()=>{window.__reloadEvents=[];chrome.developerPrivate.onItemStateChanged.addListener(event=>window.__reloadEvents.push({event:event.event_type,id:event.item_id,state:event.extensionInfo?.state}));});
  await manager.locator('#dev-reload-button').click();
  await manager.waitForFunction(id=>window.__reloadEvents.some(event=>event.event==='LOADED'&&event.id===id&&event.state==='ENABLED'),id,{timeout:15000});
  page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`chrome-extension://${id}/newtab.html`);
  await page.waitForSelector('html[data-start-ready="true"][data-native-ready="true"]');
  worker=context.serviceWorkers().find(candidate=>new URL(candidate.url()).host===id)||worker;
  const afterReloadOrigin=await worker.evaluate(()=>performance.timeOrigin);
  check('N-extension-reload-persistence',afterReloadOrigin>beforeReloadOrigin&&await page.title()==='Home'&&(await page.locator('#tab-favicon').getAttribute('href'))===uploaded,'Native chrome://extensions Reload emits LOADED, starts a fresh worker global and retains title/icon settings.');
  await manager.close();
 }
 await page.locator('#settings-trigger').click();await page.locator('#tab-identity-reset').click();await page.waitForFunction(()=>document.title!=='Home');
 check('N-restore-default',(await page.locator('#tab-favicon').getAttribute('href')).endsWith(`tab-${expectedFamily}.svg`),'One action restores default title and icon without changing bookmark preference.');
 await context.close();context=null;

 // Real bookmark APIs with a pregranted, isolated manifest. Production JS is unchanged.
 const harness=await mkdtemp(join(tmpdir(),'vaiwl-native-harness-')),profile=await mkdtemp(join(tmpdir(),'vaiwl-native-profile-'));
 await cp(resolve('dist'),harness,{recursive:true});const original=JSON.parse(await readFile(join(harness,'manifest.json'),'utf8'));
 const manifest=structuredClone(original);manifest.permissions.push('bookmarks');manifest.optional_permissions=manifest.optional_permissions.filter(x=>x!=='bookmarks');await writeFile(join(harness,'manifest.json'),JSON.stringify(manifest));
 context=await launch(profile,harness);({worker,page,id}=await ready(context));await context.route(/^https?:\/\//,route=>route.abort());
 await page.locator('#settings-trigger').click();await pref(page,'newtab');await page.locator('#settings-dialog [data-close]').first().click();
 const originalTree=await worker.evaluate(()=>chrome.bookmarks.getTree());
 const bar=await worker.evaluate(async()=>{const roots=(await chrome.bookmarks.getTree())[0].children;return (roots.find(n=>n.folderType==='bookmarks-bar')||roots.find(n=>n.id==='1')).id});
 check('N-no-duplicate-bookmark-settings',await page.locator('#bookmarks-home #bookmark-choose,#bookmarks-home #bookmark-home-connect').count()===0&&!/显示设置|选择显示方式/.test(await page.locator('#bookmarks-home').textContent()),'The configured shelf has only its native bookmark content and disclosure controls.');
 check('N-empty-native-bookmark-bar',await page.locator('#native-bookmark-content').textContent().then(t=>t.includes('书签栏为空')),'Actual new browser profile starts with an empty native bar.');
 const ids=await worker.evaluate(async bar=>{
  const first=await chrome.bookmarks.create({parentId:bar,title:'First bookmark',url:'https://first.example/'});
  const folder=await chrome.bookmarks.create({parentId:bar,title:'Research folder'});
  const nested=await chrome.bookmarks.create({parentId:folder.id,title:'Nested bookmark',url:'https://nested.example/'});
  const last=await chrome.bookmarks.create({parentId:bar,title:'Last bookmark',url:'https://last.example/'});return {first:first.id,folder:folder.id,nested:nested.id,last:last.id};
 },bar);
 await page.locator(`[data-bookmark-id="${ids.last}"]`).waitFor();
 check('N-native-create-and-order',JSON.stringify(await page.locator('.native-bookmark-list > [data-bookmark-id]').evaluateAll(nodes=>nodes.map(n=>n.dataset.bookmarkId)))===JSON.stringify([ids.first,ids.folder,ids.last]),'Real onCreated events preserve native sibling order.');
 await page.locator(`.native-bookmark-list > [data-bookmark-id="${ids.folder}"]`).click();
 check('N-native-folder-hierarchy',(await page.locator('#bookmark-folder-list').getAttribute('data-parent-id'))===ids.folder&&await page.locator(`#bookmark-folder-list > [data-bookmark-id="${ids.nested}"]`).isVisible(),'Opening the native folder shows its ordered child layer, not a flattened root list.');
 await worker.evaluate(async id=>chrome.bookmarks.update(id,{title:'Renamed bookmark',url:'https://renamed.example/'}),ids.first);
 await page.waitForFunction(id=>document.querySelector(`[data-bookmark-id="${id}"]`)?.textContent.includes('Renamed'),ids.first);
 check('N-native-rename-url',(await page.locator(`[data-bookmark-id="${ids.first}"]`).getAttribute('href'))==='https://renamed.example/','Actual onChanged updates both label and URL.');
 await worker.evaluate(async({id,parentId})=>chrome.bookmarks.move(id,{parentId,index:0}),{id:ids.last,parentId:bar});
 await page.waitForFunction(id=>document.querySelector('.native-bookmark-list > [data-bookmark-id]')?.dataset.bookmarkId===id,ids.last);
 check('N-native-move-order',true,'Real native move reorders the Start bar.');
 await worker.evaluate(async({id,parentId})=>chrome.bookmarks.move(id,{parentId,index:0}),{id:ids.last,parentId:ids.folder});
 await page.waitForFunction(({f,l})=>document.querySelector('#bookmark-folder-list')?.dataset.parentId===f&&!!document.querySelector(`#bookmark-folder-list > [data-bookmark-id="${l}"]`),{f:ids.folder,l:ids.last});
 check('N-native-move-folder',true,'Moving a bookmark into a native folder updates its parent, not a local copy.');
 await worker.evaluate(id=>chrome.bookmarks.remove(id),ids.nested);await page.waitForFunction(id=>!document.querySelector(`[data-bookmark-id="${id}"]`),ids.nested);
 check('N-native-delete-event',true,'A browser-side deletion removes only its displayed entry.');
 await page.locator('#bookmark-folder-close').click();
 // Collapsing now keeps one complete measured row. Populate enough real native
 // entries to exercise overflow; two short entries would correctly hide the control.
 await worker.evaluate(async bar=>{for(let n=0;n<30;n++)await chrome.bookmarks.create({parentId:bar,title:`Native overflow bookmark ${n}`,url:`https://overflow.example/${n}`});},bar);
 await page.waitForFunction(()=>document.querySelectorAll('.native-bookmark-list > [data-bookmark-id]').length===32);
 const treeBeforeUI=await worker.evaluate(()=>chrome.bookmarks.getTree());
 await page.locator('#bookmark-toggle').click();await page.waitForFunction(()=>document.querySelector('#bookmark-toggle').getAttribute('aria-expanded')==='true');
 assert.equal(await page.locator('.native-bookmark-list > [data-bookmark-id]:visible').count(),32);
 await page.locator('#bookmark-toggle').click();await page.waitForFunction(()=>document.querySelector('#bookmark-toggle').getAttribute('aria-expanded')==='false');
 await page.reload();await page.waitForSelector('html[data-native-ready="true"]');
 await page.waitForFunction(()=>document.querySelector('#native-bookmark-content')?.dataset.ready==='true');
 const collapsed=await page.locator('.native-bookmark-list').evaluate(list=>{const nodes=[...list.querySelectorAll(':scope > [data-bookmark-id]')],visible=nodes.filter(n=>!n.hidden);return{visible:visible.length,all:nodes.length,oneRow:visible.every(n=>Math.abs(n.getBoundingClientRect().top-visible[0].getBoundingClientRect().top)<1),hiddenInert:nodes.filter(n=>n.hidden).every(n=>n.inert)}});
 check('N-bookmark-collapse-persists',await page.locator('#native-bookmark-content').isVisible()&&collapsed.visible>0&&collapsed.visible<collapsed.all&&collapsed.oneRow&&collapsed.hiddenInert,'Reload defaults to a complete measured bookmark row; overflow remains hidden and unfocusable until expanded.');
 assert.deepEqual(await worker.evaluate(()=>chrome.bookmarks.getTree()),treeBeforeUI);check('N-read-never-mutates-tree',true,'Reading, folder navigation, expanding, collapsing and reloading do not write bookmarks.');
 await page.locator('#bookmark-toggle').click();
 await command(page,'SHORTCUT_UPSERT',{shortcut:{label:'Already exists',url:'https://renamed.example/'}});
 await command(page,'SHORTCUT_UPSERT',{shortcut:{label:'Legacy new',url:'https://legacy.example/'}});
 await command(page,'SHORTCUT_UPSERT',{shortcut:{label:'Legacy duplicate',url:'https://legacy.example/'}});
 const legacyBefore=(await command(page,'SNAPSHOT')).shortcuts;
 await page.locator('#settings-trigger').click();await page.locator('#settings-legacy-link').click();await page.locator('#bookmark-migrate').waitFor({state:'visible'});
 await page.locator('#bookmark-destination').selectOption(ids.folder);
 page.once('dialog',dialog=>dialog.dismiss());await page.locator('#bookmark-migrate').click();
 assert.deepEqual(await worker.evaluate(()=>chrome.bookmarks.getTree()),treeBeforeUI);check('N-migration-cancel-no-write',true,'Cancelling explicit migration does not alter the native tree.');
 page.once('dialog',dialog=>dialog.accept());await page.locator('#bookmark-migrate').click();await page.waitForFunction(()=>document.querySelector('#native-status').textContent.includes('已加入 1 项'));
 const migrated=await worker.evaluate(()=>chrome.bookmarks.search({url:'https://legacy.example/'}));
 check('N-explicit-deduplicated-migration',migrated.length===1&&migrated[0].parentId===ids.folder,'Duplicate legacy URLs and existing native URLs are skipped; the new bookmark is created in the explicitly selected native subfolder.');
 assert.deepEqual((await command(page,'SNAPSHOT')).shortcuts,legacyBefore);check('N-legacy-all-preserved',true,'Every old shortcut and field remains after migration.');
 page.once('dialog',dialog=>dialog.accept());await page.locator('#bookmark-migrate').click();await page.waitForFunction(()=>document.querySelector('#native-status').textContent.includes('已加入 0 项'));
 check('N-migration-idempotent',(await worker.evaluate(()=>chrome.bookmarks.search({url:'https://legacy.example/'}))).length===1,'Retry cannot duplicate already migrated items.');
 await page.locator('#settings-dialog [data-close]').first().click();
 await page.evaluate(async()=>{
  const db=await new Promise(resolve=>{const r=indexedDB.open('vaiwl-start');r.onsuccess=()=>resolve(r.result)});
  const tx=db.transaction(['settings','conversations','revisions'],'readwrite'),settings=tx.objectStore('settings').get('main'),now=new Date(Date.now()-1000).toISOString();
  settings.onsuccess=()=>{
   const profile=settings.result.localProfileKey;
   for(const [index,kind] of ['history','active','both','old','undated'].entries()) {
    const at=kind==='old'?new Date(Date.parse(now)-70*86400000).toISOString():now;
    const key=`staging:native-${kind}`,conversationId=`00000000-0000-4000-8000-${String(index+1).padStart(12,'0')}`;
    const activity=['active','both'].includes(kind)?{firstConfirmedOpenAt:now,lastConfirmedOpenAt:now,lastActiveDate:now.slice(0,10),timeZone:'UTC'}:null;
    tx.objectStore('conversations').put({key,conversationId,provider:'chatgpt',canonicalUrl:`https://chatgpt.com/c/${conversationId}`,nativeTitle:`Unified ${kind}`,titleBasis:'browser-history',titleObservedAt:now,availability:'unverified',firstSeenAt:now,lastSeenAt:now,browserLastVisitAt:['active','undated'].includes(kind)?null:at,activity,stableRank:index,revision:1,owner:{kind:'unassigned',localProfileKey:profile,accountKey:null},ownerKey:profile,membership:{state:'UNKNOWN',projectId:null,reason:'scope-unverified'},membershipState:'UNKNOWN'});
   }
  };
  const r=tx.objectStore('revisions').get('main');r.onsuccess=()=>tx.objectStore('revisions').put({...r.result,value:r.result.value+1});
  await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error)});db.close();
 });
 const dataBefore=await raw(page);await page.reload();await page.waitForSelector('html[data-start-ready="true"]');
 check('N-one-unified-recent-area',await page.locator('.recent-section').count()===1&&await page.locator('.recent-section .date-window').count()===1,'History-only, active-only and both-source records share one date window.');
 check('N-no-visible-source-groups',!(await page.locator('#workspace-content').textContent()).match(/主动打开／归属待确认|历史浏览／归属待确认/)&&await page.locator('[data-date-basis]').count()===0,'No legacy source hierarchy or source tabs are rendered.');
 check('N-no-duplicate-conversation',await page.locator('[data-record-key="staging:native-both"]').count()===1&&await page.locator('.recent-section [data-record-key]').count()===3,'A mixed-source conversation occupies exactly one stable entity.');
 check('N-undated-home-hidden',await page.locator('#workspace-content [data-record-key="staging:native-undated"]').count()===0,'Without any project or time evidence, the saved link does not create a homepage section.');
 await page.locator('#search-trigger').click();await page.locator('#search-input').fill('Unified undated');
 check('N-undated-search-reachable',await page.locator('#search-results [data-record-key="staging:native-undated"]').isVisible(),'The same saved undated link remains searchable and openable.');
 await page.keyboard.press('Escape');
 await page.locator('#period-older').click();await page.locator('#period-older').click();
 check('N-unified-30-day-pages',await page.locator('[data-record-key="staging:native-old"]').isVisible()&&await page.locator('[data-record-key="staging:native-both"]').count()===0,'Older history follows the same 30-day navigation.');
 const dataAfter=await raw(page);assert.deepEqual(dataAfter.openDays,dataBefore.openDays);assert.deepEqual(dataAfter.conversations,dataBefore.conversations);
 check('N-display-does-not-write-activity',true,'Projection, navigation and reload leave records and OpenDays unchanged.');
 await page.locator('[data-filter="none"]').click();await page.locator('#workspace-home').click();await page.waitForFunction(()=>document.querySelector('#period-newer').disabled&&document.querySelector('[data-filter="all"]').getAttribute('aria-selected')==='true');check('N-home-restores-latest-and-all',await page.locator('[data-record-key="staging:native-both"]').isVisible()&&await page.evaluate(()=>document.activeElement?.getAttribute('data-filter')==='all'),'One home action restores the latest period, all content and keyboard focus.');await page.screenshot({path:`artifacts/${expectedFamily==='edge'?'edge-':''}native-workspace.png`,fullPage:true});
 await page.locator('#settings-trigger').click();await page.screenshot({path:`artifacts/${expectedFamily==='edge'?'edge-':''}native-settings.png`,fullPage:true});
 await context.close();context=null;
 // Upgrade same path from pregranted harness to actual optional manifest. Grant history
 // comes only from this artificial fixture; then exercise the real optional remove API.
 await writeFile(join(harness,'manifest.json'),JSON.stringify(original));
 context=await launch(profile,harness);({worker,page,id}=await ready(context));
 await page.locator('#settings-trigger').click();
 if(!await worker.evaluate(()=>chrome.permissions.contains({permissions:['bookmarks']}))) {await page.locator('#bookmark-connect').click();await page.waitForFunction(()=>document.querySelector('#bookmark-connect').textContent.includes('撤销'));}
 await page.locator('#bookmark-connect').click();await page.waitForFunction(()=>document.querySelector('#bookmark-permission-label').textContent==='未授权'&&document.querySelector('#bookmark-connect').textContent==='允许访问');
 check('N-real-optional-revocation',!await worker.evaluate(()=>chrome.permissions.contains({permissions:['bookmarks']}))&&await page.locator('.native-bookmark').count()===0,'Real permissions.remove revokes previously pregranted permission and clears in-memory links.');
 assert.deepEqual((await command(page,'SNAPSHOT')).shortcuts,legacyBefore);check('N-revocation-keeps-legacy-and-workspace',(await command(page,'SNAPSHOT')).conversations.length===5,'Revoking bookmarks preserves saved shortcuts and conversations.');
 check('N-no-page-errors',errors.length===0,JSON.stringify(errors));
 status='PASS';
} catch(error) {checks.push({id:'N-unhandled-failure',status:'FAIL',observed:String(error.stack||error)});throw error;}
finally {if(context)await context.close();await mkdir('artifacts',{recursive:true});await writeFile(`artifacts/${reportName}.json`,JSON.stringify({status,buildSha:build.sha,dirty:build.dirty,environment:version,checks,limitations:['Synthetic catalog and isolated profiles only; never reads the user browser profile.','Native consent-dialog acceptance/denial is not claimed. Refusal is injected; bookmark CRUD/revocation use real extension APIs.','Default favicons approximate browser style rather than internal assets.',...(expectedFamily==='edge'?['Native Edge extension-manager Reload was not exercised; full isolated browser restart was.']:[])]},null,2));console.log(JSON.stringify({status,checks:checks.length,buildSha:build.sha}));}
