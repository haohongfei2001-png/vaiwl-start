import { chromium } from 'playwright';
import { mkdtemp, mkdir, cp, symlink, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
const baseline='6dfed27ac7fb6650f637c2fad9a1971aceb8847b',build=JSON.parse(await readFile('dist/build.json','utf8'));
const root=await mkdtemp(join(tmpdir(),'vaiwl-native-upgrade-')),source=join(root,'source'),runtime=join(root,'extension'),profile=join(root,'profile');
const checks=[];let context,status='FAIL';
const check=(id,observed)=>checks.push({id,status:'PASS',observed});
const launch=()=>chromium.launchPersistentContext(profile,{...(process.env.VAIWL_CHROMIUM_EXECUTABLE?{executablePath:process.env.VAIWL_CHROMIUM_EXECUTABLE}:{channel:'chromium'}),headless:true,args:['--no-sandbox',`--disable-extensions-except=${runtime}`,`--load-extension=${runtime}`]});
async function ready(){const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');const id=new URL(worker.url()).host,page=await context.newPage();await page.goto(`chrome-extension://${id}/newtab.html`);await page.waitForSelector('html[data-start-ready="true"]');return {page,id};}
async function snapshot(page){return page.evaluate(async()=>{
 const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('vaiwl-start');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)}),stores=[...db.objectStoreNames],values={};
 const tx=db.transaction(stores);await Promise.all(stores.map(name=>new Promise((resolve,reject)=>{const r=tx.objectStore(name).getAll();r.onsuccess=()=>{values[name]=r.result;resolve()};r.onerror=()=>reject(r.error)})));const result={name:db.name,version:db.version,stores,values};db.close();return result;
});}
try{
 try{execFileSync('git',['cat-file','-e',`${baseline}^{commit}`],{stdio:'pipe'})}catch{execFileSync('git',['fetch','--depth=1','origin',baseline],{stdio:'pipe'})}
 execFileSync('git',['worktree','add','--detach',source,baseline],{stdio:'pipe'});await symlink(resolve('node_modules'),join(source,'node_modules'),'dir');
 execFileSync(process.execPath,['scripts/build.mjs'],{cwd:source,stdio:'pipe'});await cp(join(source,'dist'),runtime,{recursive:true});
 context=await launch();let{page,id}=await ready();const oldId=id;
 await page.evaluate(async()=>{
  const db=await new Promise(resolve=>{const r=indexedDB.open('vaiwl-start');r.onsuccess=()=>resolve(r.result)}),names=[...db.objectStoreNames],tx=db.transaction(names,'readwrite');
  const settings=tx.objectStore('settings').get('main'),at=new Date(Date.now()-60000).toISOString();
  settings.onsuccess=()=>{
   const profile=settings.result.localProfileKey,scope='scope:upgrade-a',pid='g-p-1234567890abcdef1234567890abcdef';
   const record=(key,i,scoped=false)=>({key,provider:'chatgpt',conversationId:`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`,canonicalUrl:`https://chatgpt.com/c/00000000-0000-4000-8000-${String(i).padStart(12,'0')}`,nativeTitle:`Upgrade ${key}`,titleBasis:'browser-history',titleObservedAt:at,availability:'unverified',firstSeenAt:at,lastSeenAt:at,browserLastVisitAt:scoped?null:at,activity:scoped?{firstConfirmedOpenAt:at,lastConfirmedOpenAt:at,lastActiveDate:at.slice(0,10),timeZone:'UTC'}:null,stableRank:i,revision:20,owner:scoped?{kind:'scoped',scopeKey:scope}:{kind:'unassigned',localProfileKey:profile,accountKey:null},ownerKey:scoped?scope:profile,membership:scoped?{state:'PROJECT',projectId:pid,evidenceId:'upgrade-witness',confirmedAt:at}:{state:'UNKNOWN',projectId:null,reason:'scope-unverified'},membershipState:scoped?'PROJECT':'UNKNOWN',...(scoped?{projectId:pid,lastActiveAt:at}:{})});
   tx.objectStore('scopes').put({key:scope,provider:'chatgpt',principalKey:'synthetic',contextKey:'synthetic',identity:'verified',label:'Synthetic scope',verifiedAt:at,identityAdapterVersion:'test',contextWitnessId:'upgrade-witness',state:'ready'});
   for(const [key,i,scoped] of [['staging:upgrade-history',1,false],['staging:upgrade-linked',2,false],['conversation:upgrade-project',3,true]])tx.objectStore('conversations').put(record(key,i,scoped));
   tx.objectStore('projects').put({key:'project:upgrade',scopeKey:scope,projectId:pid,nativeTitle:'Upgrade project',canonicalUrl:`https://chatgpt.com/g/${pid}/project`,evidenceId:'upgrade-witness',observedAt:at,membershipCoverage:'observed-only',stableRank:0,revision:20});
   tx.objectStore('witnesses').put({id:'upgrade-witness',kind:'native-project-member-region',adapterId:'synthetic',adapterVersion:'test',scopeKey:scope,documentId:'synthetic-document',routeEpoch:1,scopeEpoch:1,observedAt:at,sourceRevision:1,sourceDomain:'synthetic',fields:['membership'],revoked:false});
   tx.objectStore('candidateLinks').put({candidateRecordKey:'staging:upgrade-linked',scopedRecordKey:'conversation:upgrade-project',evidenceId:'upgrade-witness',confirmedAt:at});
   tx.objectStore('openDays').put({recordKey:'conversation:upgrade-project',timeZone:'UTC',localDate:at.slice(0,10),firstOpenedAt:at,lastOpenedAt:at,confirmationBasis:'synthetic-committed-fixture'});
   tx.objectStore('openIntents').put({id:'upgrade-committed-intent',state:'committed',browserSessionId:'old-synthetic-session',targetRecordKey:'conversation:upgrade-project',committedRecordKey:'conversation:upgrade-project',expiresAt:at});
   tx.objectStore('shortcuts').put({id:'upgrade-shortcut',label:'Preserve legacy',url:'https://example.com/legacy',icon:{kind:'builtin',value:'globe'},order:0,pinned:true,createdAt:at,updatedAt:at});
   tx.objectStore('tombstones').put({key:'staging:upgrade-removed',removedAt:at,reason:'user-removed',record:record('staging:upgrade-removed',4)});
   tx.objectStore('importJobs').put({id:'upgrade-completed-import',state:'complete',range:'all',includeSynced:false,accepted:1,discovered:1,processed:1,createdAt:at,updatedAt:at});
   tx.objectStore('revisions').put({key:'main',value:20,nextRank:100});
  };
  await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error)});db.close();
 });
 const before=await snapshot(page);assert.equal(before.stores.length,12);assert.ok(Object.values(before.values).every(rows=>rows.length>0));check('UP-baseline-real-v1-12-populated-stores','The actual approved 6dfed27 build created the v1 database; all 12 stores contain synthetic preservation fixtures.');
 await context.close();context=null;await cp(resolve('dist'),runtime,{recursive:true});
 context=await launch();({page,id}=await ready());await page.waitForSelector('html[data-native-ready="true"]');assert.equal(id,oldId);check('UP-same-path-same-id','Replaced runtime files at the same extension path without uninstalling. Runtime extension ID is unchanged.');
 const after=await snapshot(page);assert.deepEqual(after,before);check('UP-all-12-stores-byte-equivalent','Store names, database version, every record, keys, tombstones, links, witnesses, OpenDays, imports, settings and revision remain JSON-identical.');
 assert.equal(await page.locator('[data-record-key="staging:upgrade-history"]').count(),1);assert.equal(await page.locator('[data-record-key="staging:upgrade-linked"]').count(),0);assert.equal(await page.locator('[data-record-key="staging:upgrade-removed"]').count(),0);check('UP-visibility-preserves-resolution-and-tombstone','Live link remains reachable; resolved staging duplicate and removed conversation are not resurrected.');
 await page.locator('#settings-trigger').click();await page.locator('#legacy-sites').click();assert.ok(await page.getByRole('link',{name:'打开 Preserve legacy',exact:true}).isVisible());check('UP-legacy-shortcut-reachable','The old stored website remains reachable without bookmark permission.');
 await context.close();context=null;context=await launch();({page}=await ready());assert.deepEqual(await snapshot(page),before);check('UP-restart-preserves-v1','A further full browser restart preserves all 12 stores.');status='PASS';
}catch(error){checks.push({id:'UP-failure',status:'FAIL',observed:String(error.stack||error)});throw error;}
finally{if(context)await context.close();try{execFileSync('git',['worktree','remove','--force',source],{stdio:'pipe'})}catch{}await mkdir('artifacts',{recursive:true});await writeFile('artifacts/native-upgrade-validation.json',JSON.stringify({status,baseline,buildSha:build.sha,dirty:build.dirty,checks,limitations:['Actual old/new extension builds and a real isolated Chromium profile; fixtures are synthetic, not user data.','No uninstall, user-profile change or production installation is performed.']},null,2));console.log(JSON.stringify({status,checks:checks.length,buildSha:build.sha}));}
