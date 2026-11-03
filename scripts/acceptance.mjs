import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const build = JSON.parse(await readFile('dist/build.json', 'utf8'));
const currentSha=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const currentDirty=execFileSync('git',['status','--porcelain','--untracked-files=normal'],{encoding:'utf8'}).trim().length>0;
if(build.sha!==currentSha||build.dirty!==currentDirty)throw Error('Stale build fingerprint; rebuild before aggregating acceptance.');
const specification = await readFile('docs/free-v1/06-ACCEPTANCE.md', 'utf8');
const U='unit-validation', B='browser-validation', I='import-recovery-validation', P='privacy-boundaries-validation', N='source-recovery-validation', F='storage-faults-validation', V='ui-validation', R='review-validation';
const X='native-experience-validation', G='native-upgrade-validation';
const LP='native-project-grouping-validation';
const PS='project-startup-validation', LB='life-bookmarks-validation';
const evidence={};
for(const name of [U,B,I,P,N,F,V,R,X,G,LP,PS,LB,'privacy-audit','performance-validation']){
  try{const result=JSON.parse(await readFile('artifacts/'+name+'.json','utf8'));if(result.buildSha===build.sha&&result.dirty===build.dirty)evidence[name]=result;}catch{/* Other-build or missing evidence never passes. */}
}
// Each full claim names actual predicates. File-level success alone is insufficient.
// Unit IDs are actual test names, matched by stable prefixes. Visual review is explicit.
const full={
 P01:{[LP]:['LOCAL-P-empty-card-without-workspace','LOCAL-P-members-and-title-separation'],[U]:['native local Project survives repeated visits']},
 P02:{[LP]:['LOCAL-P-rename-keeps-identity','LOCAL-P-reload-stable-project','LOCAL-P-slug-is-not-identity','LOCAL-P-observation-after-restart-no-duplicate']},
 P03:{[LP]:['LOCAL-P-incremental-same-title-different-IDs','LOCAL-P-same-name-distinct-IDs']},
 P04:{[LP]:['LOCAL-P-principal-boundary-isolation','LOCAL-P-unknown-document-stability','LOCAL-P-unknown-documents-do-not-merge','LOCAL-P-same-ID-cross-Profile-isolation'],[U]:['concurrent first observations from different principals']},
 P05:{[LP]:['LOCAL-P-incremental-same-title-different-IDs','LOCAL-P-reorder-is-idempotent','LOCAL-P-missing-partial-empty-no-removal']},
 P06:{[LP]:['LOCAL-P-expired-document-rejected','LOCAL-P-stale-SPA-event-rejected','LOCAL-P-same-document-old-surface-rejected','LOCAL-P-same-document-fresh-surface-resumes'],[U]:['same-document principal change rejects the retained old surface']},
 P07:{[LP]:['LOCAL-P-legacy-data-preserved','LOCAL-P-older-member-stays-in-project','LOCAL-P-project-name-search'],[U]:['local grouping reuses history identity']},
 P08:{[LP]:['LOCAL-P-explicit-Project-URL','LOCAL-P-sidebar-explicit-ID-only','LOCAL-P-semantic-adapter-different-hierarchy','LOCAL-P-generic-GPT-is-not-Project']},
 P09:{[LP]:['LOCAL-P-logout-does-not-reuse-principal','LOCAL-P-capture-stop-preserves-catalog','LOCAL-P-real-permission-revocation','LOCAL-P-v1-nondestructive-storage'],[U]:['local Project writes are atomic on quota failure']},
 P10:{[LP]:['LOCAL-P-certification-boundary','LOCAL-P-metadata-only-and-activity-preserved','LOCAL-P-production-bytes','LOCAL-P-no-page-errors']},
 X01:{[X]:['N-default-browser-title','N-default-browser-favicon','N-independent-custom-title','N-independent-product-icon','N-brand-identity-unchanged','N-restore-default']},
 X02:{[X]:['N-upload-raster-reencoded','N-upload-reject-evil.svg','N-upload-reject-fake.png','N-upload-reject-too-big.png','N-restart-persistence','N-extension-reload-persistence']},
 X03:{[X]:['N-always-bar-hidden','N-user-hidden-bar','N-no-permission-help','N-denial-does-not-block-workspace','N-real-optional-revocation','N-revocation-keeps-legacy-and-workspace']},
 X04:{[X]:['N-empty-native-bookmark-bar','N-native-create-and-order','N-native-folder-hierarchy','N-native-rename-url','N-native-move-order','N-native-move-folder','N-native-delete-event','N-read-never-mutates-tree']},
 X05:{[X]:['N-migration-cancel-no-write','N-explicit-deduplicated-migration','N-legacy-all-preserved','N-migration-idempotent']},
 X06:{[X]:['N-one-unified-pending-area','N-no-visible-source-groups','N-no-duplicate-conversation','N-undated-remains-reachable','N-unified-30-day-pages','N-display-does-not-write-activity'],[U]:['latest valid display time','invalid and same-day future timestamps','project follows newest member','candidate keys separate observation','conflicted or revoked candidate evidence']},
 X07:{[G]:['UP-baseline-real-v1-12-populated-stores','UP-same-path-same-id','UP-all-12-stores-byte-equivalent','UP-visibility-preserves-resolution-and-tombstone','UP-legacy-shortcut-reachable','UP-restart-preserves-v1']},
 L02:{[U]:['contract correction: 564 synthetic history','confirmed local opening replaces'],[V]:['UI-local-564-history-date-windows','UI-local-history-reload-no-passive-activity']},
 L04:{[U]:['Local-first repeated Start opens'],[N]:['SOURCE-B-same-day-reopen-one-day']},
 L05:{[U]:['Local-first completion without a gesture','M0-D reload, history traversal'],[N]:['SOURCE-B-passive-loading-no-activity','SOURCE-B-refresh-cannot-reuse-gesture']},
 L09:{[U]:['Local-first Project candidate groups','candidate keys separate observation','candidate metadata cannot take precedence'],[V]:['UI-local-project-candidate-distinct']},
 L10:{[U]:['a verified membership update moves','confirmed local opening replaces'],[N]:['SOURCE-B-Start-click-bound-document']},
 L11:{[U]:['history windows retain local-calendar boundaries','history ordering uses visit time'],[V]:['UI-local-pending-30-day-navigation','UI-local-full-history-search','UI-empty-adjacent-segment','UI-pinning-preserves-order'],['performance-validation']:['PERF-newtab-2000-20','PERF-search-feedback']},
 L12:{[U]:['Local-first capture disabled at the final transaction','Local-first completion without a gesture'],[P]:['PRIVACY-B-no-false-authority-or-activity']},
 S10:{[R]:['REVIEW-source-status-separation']},
 T01:{[U]:['T01 inherited calendar vectors']},
 T02:{[U]:['T02/T03/T04/T06 projects occupy one segment'],[V]:['UI-old-stays-in-parent','UI-empty-segment-to-known-and-back']},
 T04:{[U]:['T02/T03/T04/T06 projects occupy one segment'],[V]:['UI-undated-independent-entry','UI-undated-search-open-remains-undated']},
 T05:{[V]:['UI-no-top-arrow','UI-empty-adjacent-segment','UI-empty-segment-to-known-and-back']},
 T06:{[U]:['T06 ten equal-millisecond records']},
 T07:{[U]:['T07 a gesture starting after refresh scheduling'],[V]:['UI-pointer-revision-safe-point','UI-ime-revision-safe-point'],[R]:['REVIEW-gesture-stability']},
 T08:{[V]:['UI-history-segment-tab-update-midnight']},
 O16:{[U]:['O15/O16 crossing midnight','O12/O14 invalid session']},
 D01:{[U]:['D01/D02 real import algorithm','D02 minimum saturated time slice'],[B]:['B-real-history-API-harness']},
 D02:{[U]:['D01/D02 real import algorithm','D02 minimum saturated time slice','D02 import candidate batch'],[I]:['IMPORT-B-first-batch-persisted','IMPORT-B-ui-close-worker-terminated','IMPORT-B-worker-session-retained','IMPORT-B-checkpoint-resumed-completely','IMPORT-B-deduplicated-source-safe']},
 D03:{[U]:['D01/D02 real import algorithm','D03 length-delimited identities','D03/D06/D12 catalog persists','S07/O13/D07 one of 500 candidates']},
 D04:{[U]:['D04 URL policy rejects','D04/D05 importer filters'],[B]:['B-real-history-API-harness']},
 D05:{[U]:['D04/D05 importer filters','D05 a sync-only alias'],[B]:['B-history-does-not-forge-account-or-activity','B-empty-history-title-placeholder']},
 D06:{[B]:['B-browser-restart-durable-directory','B-browser-restart-shortcut-order-collapse']},
 D10:{[U]:['D10 injected mid-transaction quota','D10 aborting the initial v1','D10 concurrent and repeated'],[F]:['D10-B-initial-upgrade-abort-recovery','D10-B-concurrent-and-repeated-v1-open','D10-B-quota-rollback-retry-and-replay']},
 D11:{[B]:['B-offline-catalog'],[P]:['PRIVACY-B-cached-directory-capture-enabled','PRIVACY-B-D11-cache-before-slow-identity']},
 D12:{[U]:['D12 IPC rejects unknown fields','D12 unknown payload fields'],[P]:['PRIVACY-B-topframe-positive-control','PRIVACY-B-D12-title-plain-text','PRIVACY-B-D12-ui-fields-and-authority-rejected','PRIVACY-B-D12-collector-fields-rejected','PRIVACY-B-D12-real-subframe-rejected','PRIVACY-B-no-false-authority-or-activity']},
 U01:{[V]:['UI-six-project-cards'],[R]:['REVIEW-frozen-home-layout']},
 U02:{[V]:['UI-initial-five','UI-add-twelve','UI-project-more-complete','UI-old-stays-in-parent'],[R]:['REVIEW-project-list-hierarchy']},
 U03:{[V]:['UI-filter-project-exact-membership','UI-filter-none-exact-membership','UI-filter-unknown-exact-membership','UI-projectless-scope-home','UI-filters-view-only']},
 U04:{[V]:['UI-cross-period-search','UI-search-arrows','UI-search-keyboard-open','UI-search-scope-isolation','UI-search-escape-restores-position','UI-search-final-record-reachable'],[R]:['REVIEW-search-keyboard-flow']},
 U05:{[V]:['UI-slash-editing-modifier-guards','UI-browser-shortcuts','UI-native-page-scroll']},
 U07:{[V]:['UI-pinning-preserves-order','UI-keyboard-order-controls','UI-native-drag-order','UI-native-drag-order-reload','UI-collapsed-pins-only'],[B]:['B-browser-restart-shortcut-order-collapse'],[R]:['REVIEW-website-order-controls']},
 U08:{[U]:['D04 URL policy rejects'],[V]:['UI-reject-script-shortcut','UI-reject-data-shortcut','UI-reject-credential-shortcut','UI-website-native-open-no-activity']},
};
const sourceDependent=new Set(['S07','O02','O04','O06','O07','O08','O10','O11','O12','O13','O14','O15','O17','T03','D07']);
const deviceDependent=new Set(['D08','D09','U06','U09','U10','U11']);
const gaps={
 P11:'Real Mac local Project organization passed on 6bc0b29 (see the Chrome RC report). That inherited source evidence is distinct from this same-build synthetic matrix and from full account/workspace certification.',
 S07:'U proves 500-to-499 per-record resolution; production B cannot admit a resolved scope until the live source gate is proven.',
 O04:'Synthetic-click rejection passes; complete negative navigation must be repeated with a proven positive arrival adapter.',
 O08:'Scripted history.back/go qualifier counterexamples remain pending with the supported activity adapter.',
 O09:'Address-bar adapter is disabled. This optional gate is not activated; no address-bar activity is claimed.',
 O10:'Route discovery works; no independent authority for external-link/bookmark activity is claimed.',
 O12:'Restart replaces browserSessionId and expires old intents; actual target-tabId reuse with a working arrival adapter remains pending.',
 T04:'U proves undated projection; the complete explicit undated search-and-open browser journey is not separately recorded.',
 T07:'U covers deferred rendering, including gesture-after-scheduling. Native pointer/IME timing and focus/anchor restoration still require the complete B+V journey.',
 T08:'Combined other-tab update and midnight transition while browsing a historical segment is not yet completely recorded.',
 D08:'Actual native optional-permission revoke/deny interaction remains; pre-granted test harnesses cannot prove it.',
 D09:'Browser history deletion preserves the directory; real ChatGPT logout and the full device flow remain unverified.',
 U06:'Six viewport widths pass. Native 200% zoom, menu/arrow occlusion and full Chrome/Edge layout checks remain.',
 U09:'Original installation permissions and UNKNOWN import pass; actual refusal of the native permission prompt remains.',
 U10:'Actual Mac Chrome and Edge with native vertical tabs are unavailable in the isolated Linux runner.',
 U11:'Fallback action is implemented; another override extension or managed enterprise policy needs the actual device scenario.',
};
const related={
 L01:{[U]:['contract correction: 564 synthetic history'],[V]:['UI-local-564-history-date-windows']},
 L03:{[U]:['Local-first Start freezes one document'],[N]:['SOURCE-B-Start-click-bound-document']},
 L06:{[U]:['Local-first repeated Start opens'],[B]:['B-browser-restart-durable-directory'],[N]:['SOURCE-B-close-keeps-local-record']},
 L07:{[U]:['local history projection and search exclude','S07/O13/D07 one of 500 candidates'],[V]:['UI-search-scope-isolation']},
 L08:{[U]:['Local-first Project observation preserves'],[N]:['SOURCE-B-local-project-keeps-UNKNOWN'],[V]:['UI-local-project-candidate-distinct']},
 S03:{[N]:['SOURCE-B-project-SPA-delayed-hydration']},
 S08:{[N]:['SOURCE-B-fixed-metadata-requests-only','SOURCE-B-local-activity-without-native-authority']},
 O01:{[N]:['SOURCE-B-Start-click-bound-document']},
 S07:{[U]:['S07/O13/D07 one of 500 candidates']},
 O04:{[B]:['B-synthetic-click-no-intent']},
 O12:{[U]:['O12/O14 invalid session'],[B]:['B-browser-restart-durable-directory','B-restart-no-old-intent-consumption']},
 T04:{[U]:['T02/T03/T04/T06 projects occupy one segment']},
 T07:{[U]:['T07 a gesture starting after refresh scheduling']},
 D09:{[B]:['B-history-clearing-keeps-catalog']},
 U06:{[V]:['UI-width-320','UI-width-400','UI-width-720','UI-width-1000','UI-width-1440','UI-width-1920']},
 U09:{[V]:['UI-empty-real-extension','UI-no-auto-permission'],[B]:['B-install-production-manifest','B-real-history-API-harness']},
};
function predicate(name,id){
 const report=evidence[name];
 const check=report?.checks?.find(c=>typeof c==='object'&&(name===U?c.id.startsWith(id):c.id===id));
 return {artifact:name+'.json',checkId:check?.id||id,status:report?.status==='PASS'&&check?.status==='PASS'?'PASS':check?.status==='FAIL'?'FAIL':'NOT_RUN'};
}
const records=[];
for(const line of specification.split('\n')){
 const cells=line.split('|').map(s=>s.trim());if(!/^[SOTDULXP]\d{2}$/.test(cells[1]||''))continue;
 const [id,action,requirement,layer]=cells.slice(1,5);
 const predicates=Object.entries(full[id]||related[id]||{}).flatMap(([name,ids])=>ids.map(check=>predicate(name,check)));
 const blocked=layer.includes('L')||sourceDependent.has(id)||deviceDependent.has(id);
 const complete=Boolean(full[id])&&predicates.length>0&&predicates.every(c=>c.status==='PASS');
 const status=predicates.some(c=>c.status==='FAIL')?'FAIL':blocked?'BLOCKED':complete?'PASS':'NOT_RUN';
 const missing=status==='PASS'?[]:[gaps[id]||(blocked?'Requires proven live source authority or actual Mac Chrome/Edge acceptance.':'Complete same-build evidence, including any required explicit visual review, is not available.')];
 records.push({id,status,buildSha:build.sha,browserVersion:evidence[B]?.browserVersion||evidence[V]?.browser||null,
  environment:`Isolated ${process.platform} Chromium and synthetic catalog. Declared history/host/storage harnesses are test-only; original production installation is checked separately.`,
  steps:action,observed:status==='PASS'?'Every declared predicate passed at the required test layer for this build.':missing.join(' '),
  artifactRefs:[...new Set(predicates.filter(c=>c.status!=='NOT_RUN').map(c=>c.artifact))],requirement,layer,predicates,missingConditions:missing,
  limitations:['Row PASS never implies Free V1 acceptance or real Mac/Edge compatibility.',...(id==='D10'?['Current v1 initial-schema recovery and same-version reopen; quota is injected into a real browser transaction, not physical disk exhaustion or a nonexistent legacy migration.']:[])]});
}
for(let n=1;n<=4;n++)records.push({id:'JOURNEY-'+n,status:'BLOCKED',buildSha:build.sha,browserVersion:null,environment:'Real Mac Chrome and Edge',steps:'Continuous journey '+n+' with local-first amendment',observed:'Actual device journey and authenticated native context/PROJECT/NONE remain unverified. This does not block tested local history and Start navigation activity.',artifactRefs:['M0_SOURCE_GATE.md'],limitations:['Synthetic browser tests do not replace this journey.']});
const engineeringGates=[U,'privacy-audit',B,I,P,N,F,V,X,G,LP,PS,LB,'performance-validation'].map(name=>({id:name,status:evidence[name]?.status||'NOT_RUN',artifact:name+'.json'}));
const evidenceFailures=Object.entries(evidence).filter(([,r])=>r.status==='FAIL'||r.checks?.some(c=>typeof c==='object'&&c.status==='FAIL')).map(([name])=>name+'.json');
const status=records.some(r=>r.status==='FAIL')||evidenceFailures.length?'FAIL':engineeringGates.every(g=>g.status==='PASS')?'LOCAL_WORKSPACE_READY':'IMPLEMENTATION_READY_FOR_CI';
await writeFile('artifacts/acceptance-matrix.json',JSON.stringify({status,sourceGate:build.sourceGate,amendment:build.amendment,nativeAttribution:'UNVERIFIED',nativeProjectLocalGrouping:evidence[LP]?.status||'NOT_RUN',accountWorkspaceCertification:'UNVERIFIED',fullProjectSync:'NOT_IMPLEMENTED',buildSha:build.sha,dirty:build.dirty,engineeringGates,evidenceFailures,records},null,2));
console.log(JSON.stringify({status,buildSha:build.sha,records:records.length,statuses:records.reduce((n,r)=>({...n,[r.status]:(n[r.status]||0)+1}),{}),engineeringGates}));
