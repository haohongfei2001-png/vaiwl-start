import { chromium } from 'playwright';
import { mkdtemp, mkdir, cp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const output = resolve('artifacts'); await mkdir(output, { recursive: true });
const fingerprint = JSON.parse(await readFile('dist/build.json', 'utf8'));
const checks = [], limitations = [
  'A temporary test manifest pre-grants scripting, webNavigation and the exact ChatGPT host; production JavaScript bytes are unchanged. Native permission-prompt acceptance is not tested.',
  'All HTTPS documents and both known session endpoints are intercepted synthetic fixtures. No real ChatGPT account, user browser, current workspace, positive NONE or loaded-conversation source is used.',
  'This is installed Linux Chromium integration evidence, not Mac Chrome, Edge, live source certification or complete Free V1 acceptance.',
  'The structural picker selects one synthetic Project title using trusted pointer/keyboard input; it does not establish live ChatGPT semantics. Genuine BFCache restore is not exercised. Identity route refresh, Project hydration, Start opening/completion and same-day deduplication use actual browser events.',
];
const check = (id, condition, observed) => { assert.ok(condition, `${id}: ${observed}`); checks.push({ id, status: 'PASS', observed }); };
const ORIGIN = 'https://chatgpt.com', SESSION = `${ORIGIN}/api/auth/session`, ACCOUNTS = `${ORIGIN}/backend-api/accounts/check/v4-2023-04-27`;
const PID = 'g-p-71000000000000000000000000000001';
const PROJECT = `${ORIGIN}/g/${PID}/project`;
const CID = [1, 2, 3, 4].map(n => `72000000-0000-4000-8000-${String(n).padStart(12, '0')}`);
const [SEED, C, SECOND, UNRELATED] = CID.map(id => `${ORIGIN}/c/${id}`);
const TITLE = 'Synthetic Project P', MEMBER_ONE = 'Synthetic member C', MEMBER_TWO = 'Synthetic member second';
const PREVIEW = 'FORBIDDEN_SYNTHETIC_PREVIEW_CONTENT', TOKEN = 'SYNTHETIC_SESSION_TOKEN_MUST_NOT_ESCAPE', EMAIL = 'synthetic-private@example.invalid';
const CHECK_PROTOCOL = 'vaiwl-start-source-check/1';
const projectMarkup = `<main data-app-shell-main-surface><div data-app-shell-main-content-layout><div role="main">
  <h1><button><span>${TITLE}</span></button></h1><div>
  <div role="tablist"><button id="fixture-tab" role="tab" aria-selected="true" aria-controls="fixture-panel">Synthetic conversations</button></div>
  <div role="tabpanel" id="fixture-panel" aria-labelledby="fixture-tab"><section><ol>
  <li><a href="/g/${PID}/c/${CID[1]}"><div><div>${MEMBER_ONE}</div><div>${PREVIEW}</div></div></a></li>
  <li><a href="/g/${PID}/c/${CID[2]}"><div><div>${MEMBER_TWO}</div><div>${PREVIEW}</div></div></a></li>
  </ol></section></div></div></div></div></main>
  <aside><a href="${UNRELATED}">${MEMBER_ONE}</a></aside>`;
const seedHtml = `<!doctype html><meta charset="utf-8"><title>Synthetic route fixture</title><button id="to-project">Open synthetic Project</button><div id="metadata"></div>
  <script>document.getElementById('to-project').onclick=()=>{history.pushState({},'',${JSON.stringify(PROJECT)}); setTimeout(()=>{document.getElementById('metadata').innerHTML=${JSON.stringify(projectMarkup)};document.documentElement.dataset.hydrated='true'},450)};</script>`;
const chatHtml = '<!doctype html><meta charset="utf-8"><title>Synthetic conversation shell</title><p>No supported loaded-object source exists in this fixture.</p>';
let context, browserVersion = null, persona = 'a', sessionRequests = 0;
const metadataRequests = [];
const localProjectFor = (snapshot, record) => snapshot.localProjects?.find(project => project.key === record?.localProject?.projectKey);

async function uiCommand(page, command, payload = {}) {
  return page.evaluate(async ({ command, payload }) => {
    const send = (command, payload, expectedRevision) => chrome.runtime.sendMessage({ protocol: 'vaiwl-start-internal/1', operationId: crypto.randomUUID(), expectedRevision, command, payload });
    const current = await send('SNAPSHOT', {}, 0); if (!current.ok) throw Error(current.code);
    const result = await send(command, payload, current.data.revision); if (!result.ok) throw Error(result.code); return result.data;
  }, { command, payload });
}
async function checkCommand(page, command, payload = {}) {
  return page.evaluate(({ protocol, command, payload }) => chrome.runtime.sendMessage({ protocol, command, payload }), { protocol: CHECK_PROTOCOL, command, payload });
}
async function stores(page, names) {
  return page.evaluate(async names => {
    const db = await new Promise((resolve, reject) => { const r = indexedDB.open('vaiwl-start'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    try { return await Promise.all(names.map(name => new Promise((resolve, reject) => { const r = db.transaction(name).objectStore(name).getAll(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); }))); }
    finally { db.close(); }
  }, names);
}
async function waitUntil(probe, reason, timeout = 10000) {
  const expires = Date.now() + timeout;
  while (Date.now() < expires) { const value = await probe(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 40)); }
  throw Error(reason);
}
async function capture(checker, step, tabId) {
  // Reload only the dedicated extension page to refresh its tab inventory.
  await checker.reload(); await checker.waitForFunction(() => !document.getElementById('capture').disabled);
  await checker.locator('#step').selectOption(step); await checker.locator('#pick').uncheck();
  await checker.locator('#target').selectOption(String(tabId)); await checker.locator('#capture').click();
  return waitUntil(async () => {
    const status = await checkCommand(checker, 'STATUS'); if (!status.ok) throw Error(status.code);
    const entry = status.data.report?.entries.find(e => e.step === step);
    return entry && entry.state !== 'running' ? entry : false;
  }, `Diagnostic step did not finish: ${step}`, 15000);
}

try {
  const harness = await mkdtemp(join(tmpdir(), 'vaiwl-source-recovery-harness-'));
  await cp(resolve('dist'), harness, { recursive: true });
  const manifest = JSON.parse(await readFile(join(harness, 'manifest.json'), 'utf8'));
  manifest.permissions.push('scripting', 'webNavigation');
  manifest.optional_permissions = manifest.optional_permissions.filter(p => !['scripting', 'webNavigation'].includes(p));
  manifest.host_permissions = [`${ORIGIN}/*`]; manifest.optional_host_permissions = [];
  await writeFile(join(harness, 'manifest.json'), JSON.stringify(manifest));
  for (const name of ['service-worker.js', 'content.js', 'newtab.js', 'source-check.js']) {
    assert.equal(createHash('sha256').update(await readFile(join(harness, name))).digest('hex'), fingerprint.files[name]);
  }
  check('SOURCE-B-identical-production-js', true, 'All four installed production bundles match build.json hashes; only optional permission grant timing is changed by the test manifest.');
  const profile = await mkdtemp(join(tmpdir(), 'vaiwl-source-recovery-profile-'));
  context = await chromium.launchPersistentContext(profile, {
    ...(process.env.VAIWL_CHROMIUM_EXECUTABLE ? { executablePath: process.env.VAIWL_CHROMIUM_EXECUTABLE } : { channel: 'chromium' }),
    headless: true, viewport: { width: 1280, height: 900 },
    args: ['--no-sandbox', `--disable-extensions-except=${harness}`, `--load-extension=${harness}`],
  });
  await context.route(/^https?:\/\//, async route => {
    const url = route.request().url();
    if (['fetch', 'xhr'].includes(route.request().resourceType())) metadataRequests.push(url);
    if (url === SESSION) {
      sessionRequests++;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: { id: `synthetic-principal-${persona}`, email: EMAIL }, expires: new Date(Date.now() + 3600000).toISOString(), accessToken: TOKEN }) }); return;
    }
    if (url === ACCOUNTS) {
      const id = `synthetic-context-${persona}`;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ accounts: { [id]: { account: { account_id: id, structure: 'personal', is_deactivated: false }, can_access_with_session: true } } }) }); return;
    }
    if ([SEED, PROJECT, C, SECOND, UNRELATED].includes(url)) {
      await route.fulfill({ status: 200, contentType: 'text/html', body: url === SEED ? seedHtml : url === PROJECT ? '<!doctype html><meta charset="utf-8">' + projectMarkup : chatHtml }); return;
    }
    await route.abort();
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  browserVersion = context.browser()?.version() || await worker.evaluate(() => navigator.userAgent);
  const extensionId = new URL(worker.url()).host;
  const start = await context.newPage(); await start.goto(`chrome-extension://${extensionId}/newtab.html`);
  await start.waitForSelector('html[data-start-ready="true"]'); await uiCommand(start, 'PERMISSIONS_SYNC', { enableCapture: true });
  const native = await context.newPage(); await native.goto(SEED);
  await waitUntil(async () => sessionRequests > 0 && (await uiCommand(start, 'SNAPSHOT')).capabilities.sourceStatus?.code === 'current-context-unproven', 'Initial session candidate not observed');
  const tab = await worker.evaluate(async url => (await chrome.tabs.query({ url }))[0], SEED);
  assert.ok(Number.isInteger(tab?.id));
  const initialDocument = await worker.evaluate(async tabId => (await chrome.webNavigation.getFrame({ tabId, frameId: 0 })).documentId, tab.id);
  const checker = await context.newPage(); await checker.goto(`chrome-extension://${extensionId}/source-check.html`);
  await checker.waitForFunction(() => !document.getElementById('begin').disabled);
  await checker.locator('#begin').click();
  await waitUntil(async () => (await checkCommand(checker, 'STATUS')).data?.report, 'Trusted Begin did not create run');
  const baseline = await capture(checker, 'A-baseline', tab.id);
  check('SOURCE-B-trusted-check-page-capture', baseline.state === 'captured' && baseline.sample.identity.principalPresent && baseline.sample.identity.currentContext === 'unproven' && baseline.sample.structure.state === 'not-requested', 'The actual source-check page began a bounded run and captured pseudonymized candidate identity without enabling a source or invoking the picker.');
  const beforeRoute = sessionRequests; persona = 'b';
  await native.locator('#to-project').click(); await native.waitForURL(PROJECT); await native.waitForSelector('html[data-hydrated="true"]');
  const projectCatalog = await waitUntil(async () => {
    const value = await uiCommand(start, 'SNAPSHOT');
    return value.conversations.some(c => c.canonicalUrl === C && c.nativeTitle === MEMBER_ONE) && value.conversations.some(c => c.canonicalUrl === SECOND && c.nativeTitle === MEMBER_TWO) ? value : false;
  }, 'Project SPA/hydration candidates were not collected');
  const projectDocument = await worker.evaluate(async tabId => (await chrome.webNavigation.getFrame({ tabId, frameId: 0 })).documentId, tab.id);
  check('SOURCE-B-project-SPA-delayed-hydration', initialDocument === projectDocument && projectCatalog.conversations.filter(c => [C, SECOND].includes(c.canonicalUrl)).length === 2 && !projectCatalog.conversations.some(c => c.canonicalUrl === UNRELATED), 'A real same-document pushState into the exact Project route collected two fixed-parser title leaves after 450 ms hydration; adjacent same-name history link was excluded.');
  const localMembers = projectCatalog.conversations.filter(c => [C, SECOND].includes(c.canonicalUrl));
  check('SOURCE-B-local-project-keeps-UNKNOWN', localMembers.every(c => c.owner.kind === 'unassigned' && c.membership.state === 'UNKNOWN' && localProjectFor(projectCatalog, c)?.projectId === PID && localProjectFor(projectCatalog, c)?.nativeTitle === TITLE && localProjectFor(projectCatalog, c)?.trust === 'native-relation-observed') && localMembers[0].localProject.projectKey === localMembers[1].localProject.projectKey && projectCatalog.projects.length === 0 && projectCatalog.scopes.length === 0, 'One observed native panel creates a persistent locally observed Project with stable conversation records. It does not create a certified Project or account scope, infer NONE, or import the adjacent history link.');
  check('SOURCE-B-route-identity-rechecked', sessionRequests > beforeRoute, 'The same-document Project transition triggered a fresh request to the known session reader before any diagnostic recapture; a previous status was not reused as current identity.');
  const project = await capture(checker, 'B-project', tab.id);
  check('SOURCE-B-project-probe-shares-parser', project.state === 'captured' && project.sample.project.code === 'project-candidate-only' && project.sample.project.memberCount === 2 && Object.values(project.sample.project.assertions).every(Boolean), 'The dedicated probe and production observer use the same strict parser, preserving all six structural assertions while remaining candidate-only.');
  const switched = await capture(checker, 'A-switch', tab.id);
  check('SOURCE-B-per-run-identity-change-not-scope', switched.state === 'captured' && switched.sample.identity.principalAlias !== baseline.sample.identity.principalAlias && switched.sample.identity.currentContext === 'unproven', 'Two synthetic session principals produce distinct aliases within the one bounded run; neither roster becomes a verified current workspace.');

  // Exercise the shipped picker once, through its real trusted input path. The
  // B-conflict slot is only a budget slot here, not a claimed second Project proof.
  await checker.reload(); await checker.waitForFunction(() => !document.getElementById('capture').disabled);
  await checker.locator('#step').selectOption('B-conflict'); await checker.locator('#pick').check();
  await checker.locator('#target').selectOption(String(tab.id)); await checker.locator('#capture').click();
  const picker = native.locator('[data-vaiwl-owned="source-check"]'); await picker.waitFor({ state: 'visible', timeout: 10000 });
  await native.bringToFront(); await native.locator('h1 > button').hover(); await native.keyboard.press('Alt+Shift+M');
  const picked = await waitUntil(async () => {
    const status = await checkCommand(checker, 'STATUS'); if (!status.ok) throw Error(status.code);
    const entry = status.data.report?.entries.find(e => e.step === 'B-conflict');
    return entry && entry.state !== 'running' ? entry : false;
  }, 'Trusted structural picker did not complete');
  check('SOURCE-B-trusted-structure-picker', picked.state === 'captured' && picked.sample.structure.state === 'observed' && picked.sample.structure.code === 'structure-observed' && picked.sample.structure.authority === false && picked.sample.structure.boundary === 'project' && await picker.count() === 0, 'An actual Capture click, trusted pointer hover on the synthetic Project title and Alt+Shift+M yielded bounded observed structure with authority=false; the temporary panel and selection session were removed. No live metadata semantics or second-Project comparison is claimed.');
  const beforeStart = await uiCommand(start, 'SNAPSHOT');
  check('SOURCE-B-passive-loading-no-activity', (await stores(start, ['openDays']))[0].length === 0 && beforeStart.conversations.every(c => c.activity === null), 'Ordinary browser navigation to a conversation, background collector requests, Project SPA navigation and source probes create no OpenDay without a Start user gesture.');

  const key = projectCatalog.conversations.find(c => c.canonicalUrl === C).key;
  await start.bringToFront(); await start.locator('#search-trigger').click(); await start.locator('#search-input').fill(C);
  const startLink = start.locator(`#search-results a[data-record-key="${key}"]`); await startLink.waitFor();
  const beforeIntents = (await stores(start, ['openIntents']))[0].length;
  const newPage = context.waitForEvent('page'); await startLink.click({ button: 'middle' });
  const destination = await newPage; await destination.waitForURL(C);
  const issued = await waitUntil(async () => (await stores(start, ['openIntents']))[0].find(i => i.targetRecordKey === key && i.targetDocumentId !== null && i.state === 'committed'), 'Start completed navigation did not commit local activity');
  const freshTab = await worker.evaluate(async url => (await chrome.tabs.query({ url }))[0], C);
  const firstOpen = await capture(checker, 'D-start', freshTab.id);
  const openedCatalog = await uiCommand(start, 'SNAPSHOT');
  const openedRecord = openedCatalog.conversations.find(c => c.key === key);
  const daysAfterClick = (await stores(start, ['openDays']))[0];
  check('SOURCE-B-Start-click-bound-document', (await stores(start, ['openIntents']))[0].length === beforeIntents + 1 && issued.binding.targetDocumentId === issued.targetDocumentId && issued.confirmationBasis === 'browser-navigation' && issued.committedRecordKey === key && openedRecord.owner.kind === 'unassigned' && openedRecord.membership.state === 'UNKNOWN' && openedRecord.activity?.lastConfirmedOpenAt === issued.issuedAt && daysAfterClick.length === 1 && daysAfterClick[0].recordKey === key && firstOpen.state === 'captured' && firstOpen.openChain.state === 'no-matching-intent' && !firstOpen.openChain.hasIntent, 'A trusted middle click and the exact browser navigation completion atomically consumed one intent into one local OpenDay. The stable record remains unassigned/UNKNOWN; no conversation body or loaded-object source was required. The consumed intent cannot be reused.');
  await destination.reload();
  const afterRefresh = await capture(checker, 'D-refresh', freshTab.id);
  const refreshedRecord = (await uiCommand(start, 'SNAPSHOT')).conversations.find(c => c.key === key);
  check('SOURCE-B-refresh-cannot-reuse-gesture', afterRefresh.state === 'captured' && afterRefresh.openChain.state === 'no-matching-intent' && !afterRefresh.openChain.hasIntent && (await stores(start, ['openIntents']))[0].find(i => i.id === issued.id)?.state === 'committed' && JSON.stringify((await stores(start, ['openDays']))[0]) === JSON.stringify(daysAfterClick) && JSON.stringify(refreshedRecord.activity) === JSON.stringify(openedRecord.activity), 'A real browser reload replaces the target document without adding an OpenDay, updating activity time or recycling the consumed gesture.');

  await start.bringToFront();
  const secondPageEvent = context.waitForEvent('page'); await startLink.click({ button: 'middle' });
  const secondDestination = await secondPageEvent; await secondDestination.waitForURL(C);
  const repeated = await waitUntil(async () => (await stores(start, ['openIntents']))[0].find(i => i.id !== issued.id && i.targetRecordKey === key && i.state === 'committed'), 'Second Start opening did not commit');
  const daysAfterSecond = (await stores(start, ['openDays']))[0];
  check('SOURCE-B-same-day-reopen-one-day', repeated.issuedLocalDate === issued.issuedLocalDate && repeated.confirmationBasis === 'browser-navigation' && daysAfterSecond.length === 1 && daysAfterSecond[0].activityUnit === 1 && daysAfterSecond[0].firstIntentId === issued.id && daysAfterSecond[0].lastIntentId === repeated.id && daysAfterSecond[0].firstOpenedAt === issued.issuedAt && daysAfterSecond[0].lastOpenedAt === repeated.issuedAt, 'A second trusted Start click produces a new consumed intent and updates the same record/day row; it does not increment active-day count or create a duplicate conversation.');
  await secondDestination.close();
  const afterClose = (await uiCommand(start, 'SNAPSHOT')).conversations.find(c => c.key === key);
  check('SOURCE-B-close-keeps-local-record', localProjectFor(await uiCommand(start, 'SNAPSHOT'), afterClose)?.projectId === PID && afterClose.activity?.lastConfirmedOpenAt === repeated.issuedAt && (await stores(start, ['openDays']))[0].length === 1, 'Closing a target tab preserves the stable local catalog entry, local observed Project metadata and committed activity.');

  const malformed = await checkCommand(checker, 'CAPTURE', { step: 'C-none', tabId: freshTab.id, pickStructure: false, verified: true });
  const reused = await checkCommand(checker, 'CAPTURE', { step: 'B-project', tabId: tab.id, pickStructure: false });
  const wrongPage = await checkCommand(start, 'EXPORT');
  const [fromContent] = await worker.evaluate(async ({ tabId, protocol }) => chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, world: 'ISOLATED', func: protocol => chrome.runtime.sendMessage({ protocol, command: 'EXPORT', payload: {} }), args: [protocol] }), { tabId: freshTab.id, protocol: CHECK_PROTOCOL });
  check('SOURCE-B-diagnostic-boundaries-and-one-shot-budget', malformed.ok === false && malformed.code === 'INVALID_MESSAGE' && reused.ok === false && reused.code === 'PROBE_BUDGET_USED' && wrongPage.ok === false && wrongPage.code === 'UNAUTHORIZED_SENDER' && fromContent.result.ok === false && fromContent.result.code === 'UNAUTHORIZED_SENDER', 'Unknown fields, reused steps, a normal newtab sender and a real isolated content sender are all rejected by production protocol boundaries.');

  const downloadEvent = checker.waitForEvent('download'); await checker.locator('#export').click();
  const download = await downloadEvent, downloadPath = await download.path();
  assert.ok(downloadPath); const reportText = await readFile(downloadPath, 'utf8'), report = JSON.parse(reportText);
  const privateRun = await worker.evaluate(async () => (await chrome.storage.session.get('sourceCheckRun')).sourceCheckRun);
  const forbidden = [privateRun.saltHex, TOKEN, EMAIL, PREVIEW, TITLE, MEMBER_ONE, MEMBER_TWO, PID, ...CID, ORIGIN, 'synthetic-principal-a', 'synthetic-principal-b', 'synthetic-context-a', 'synthetic-context-b', '"saltHex"', '"tabId"', '"documentId"', '"accessToken"'];
  check('SOURCE-B-export-redaction', report.format === CHECK_PROTOCOL && report.buildSha === fingerprint.sha && forbidden.every(value => value && !reportText.includes(value)), 'The actual UI download contains only bounded assertions, per-run aliases, fixed codes and correlation IDs; no salt, raw IDs/URLs/titles, session token, email or message preview escapes.');
  const final = await uiCommand(start, 'SNAPSHOT');
  const [days, projects, scopes] = await stores(start, ['openDays', 'projects', 'scopes']);
  const persistent = JSON.stringify(await stores(start, ['conversations', 'projects', 'scopes', 'witnesses', 'openDays', 'openIntents']));
  check('SOURCE-B-local-activity-without-native-authority', days.length === 1 && days[0].recordKey === key && projects.length === 0 && scopes.length === 0 && final.conversations.every(c => c.owner.kind === 'unassigned' && c.membership.state === 'UNKNOWN' && (c.key === key ? c.activity !== null : c.activity === null)) && final.conversations.filter(c => [C, SECOND].includes(c.canonicalUrl)).every(c => localProjectFor(final, c)?.projectId === PID) && report.authority === false && !persistent.includes(TOKEN) && !persistent.includes(EMAIL) && !persistent.includes(PREVIEW), 'Only the explicitly opened record has one local OpenDay. Local observed Project members retain certified membership UNKNOWN and no certified Project, NONE or account scope is manufactured. Tokens, email and message previews remain absent from persistent business stores.');
  check('SOURCE-B-fixed-metadata-requests-only', metadataRequests.length > 0 && metadataRequests.every(url => url === SESSION || url === ACCOUNTS), 'All observed metadata fetch/XHR requests used the existing two fixed session-only URLs; no conversation detail or new endpoint was requested.');
  await checker.locator('#end').click();
  await waitUntil(async () => (await checkCommand(checker, 'STATUS')).data?.report?.ended, 'Explicit End did not terminate bounded run');
  check('SOURCE-B-end-clears-run-secret', await worker.evaluate(async () => (await chrome.storage.session.get('sourceCheckRun')).sourceCheckRun.saltHex === ''), 'Ending the run clears its per-run aliasing salt while retaining only the exportable bounded result.');
  await writeFile(join(output, 'source-recovery-validation.json'), JSON.stringify({ status: 'PASS', buildSha: fingerprint.sha, dirty: fingerprint.dirty, browserVersion, environment: 'installed unchanged MV3 production JS; isolated Linux Chromium; exact-host pregrant harness; synthetic HTTPS and session responses', checks, limitations }, null, 2));
  console.log(JSON.stringify({ status: 'PASS', checks: checks.length, buildSha: fingerprint.sha, browserVersion }));
} catch (error) {
  await writeFile(join(output, 'source-recovery-validation.json'), JSON.stringify({ status: 'FAIL', buildSha: fingerprint.sha, dirty: fingerprint.dirty, browserVersion, checks, error: String(error), limitations }, null, 2));
  throw error;
} finally { if (context) await context.close(); }
