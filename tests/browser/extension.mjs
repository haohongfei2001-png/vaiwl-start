import { chromium } from 'playwright';
import { mkdtemp, mkdir, cp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const output = resolve('artifacts'); await mkdir(output, { recursive: true });
const fingerprint = JSON.parse(await readFile('dist/build.json', 'utf8'));
const checks = [];
const check = (id, condition, observed) => { assert.ok(condition, id + ': ' + observed); checks.push({ id, status: 'PASS', observed }); };
const launch = (profile, extension) => chromium.launchPersistentContext(profile, {
  ...(process.env.VAIWL_CHROMIUM_EXECUTABLE ? { executablePath: process.env.VAIWL_CHROMIUM_EXECUTABLE } : { channel: 'chromium' }),
  headless: true, viewport: { width: 1280, height: 900 },
  args: ['--no-sandbox', `--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});
async function ready(context) {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host;
  const page = await context.newPage();
  await page.goto(`chrome-extension://${id}/newtab.html`);
  await page.waitForSelector('html[data-start-ready="true"]');
  return { worker, page, id };
}
async function command(page, name, payload = {}) {
  return page.evaluate(async ({ name, payload }) => {
    const send = (command, payload, expectedRevision) => chrome.runtime.sendMessage({ protocol: 'vaiwl-start-internal/1', operationId: crypto.randomUUID(), expectedRevision, command, payload });
    const current = await send('SNAPSHOT', {}, 0);
    if (!current.ok) throw Error(current.code);
    const result = await send(name, payload, current.data.revision);
    if (!result.ok) throw Error(result.code);
    return result.data;
  }, { name, payload });
}
async function stores(page, names) {
  return page.evaluate(async names => {
    const db = await new Promise((resolve, reject) => { const r = indexedDB.open('vaiwl-start'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    try { return await Promise.all(names.map(name => new Promise((resolve, reject) => { const r = db.transaction(name).objectStore(name).getAll(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); }))); }
    finally { db.close(); }
  }, names);
}
let context;
try {
  const productionProfile = await mkdtemp(join(tmpdir(), 'vaiwl-production-'));
  context = await launch(productionProfile, resolve('dist'));
  let { worker, page } = await ready(context);
  const browserVersion = context.browser()?.version() || await worker.evaluate(() => navigator.userAgent);
  const initial = await worker.evaluate(() => chrome.permissions.getAll());
  check('B-install-production-manifest', initial.permissions.includes('storage') && !initial.permissions.includes('history') && initial.origins.length === 0, 'Unchanged production package needs no history or ChatGPT access at installation.');
  const unknown = await page.evaluate(() => chrome.runtime.sendMessage({ protocol: 'vaiwl-start-internal/1', operationId: 'fake-authority', expectedRevision: 0, command: 'OBSERVATION', payload: { verified: true, scope: 'fake' } }));
  check('B-no-IPC-source-authority', unknown.ok === false && unknown.code === 'INVALID_MESSAGE', 'Packaged UI cannot submit an invented source admission command.');
  check('B-empty-source-gate', (await command(page, 'SNAPSHOT')).capabilities.sourceGate === 'SOURCE_GATE_BLOCKED', 'Unverified source status remains explicit in the actual worker.');
  await context.close(); context = null;

  // Isolated API harness: JS bytes are unchanged; only history is pre-declared to
  // exercise the real browser history API without automating Chrome's native prompt.
  // This is NOT evidence that the production optional permission prompt was accepted.
  const harness = await mkdtemp(join(tmpdir(), 'vaiwl-history-harness-'));
  await cp(resolve('dist'), harness, { recursive: true });
  const manifest = JSON.parse(await readFile(join(harness, 'manifest.json'), 'utf8'));
  manifest.permissions.push('history'); manifest.optional_permissions = manifest.optional_permissions.filter(p => p !== 'history');
  await writeFile(join(harness, 'manifest.json'), JSON.stringify(manifest));
  const profile = await mkdtemp(join(tmpdir(), 'vaiwl-history-profile-'));
  context = await launch(profile, harness);
  await context.route(/^https?:\/\//, route => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Synthetic navigation target</title><h1>Controlled target; no source proof.</h1>' }));
  ({ worker, page } = await ready(context));
  const urls = [1, 2, 3].map(i => `https://chatgpt.com/c/00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
  await worker.evaluate(async urls => { for (const url of [...urls, 'https://example.invalid/?chatgpt.com', 'https://chatgpt.com/share/synthetic']) await chrome.history.addUrl({ url }); }, urls);
  // Wait for the real onVisited discovery to settle, then clear only extension data.
  for (let i = 0; i < 20; i++) { if ((await command(page, 'SNAPSHOT')).conversations.length >= 3) break; await page.waitForTimeout(50); }
  await command(page, 'CLEAR_LOCAL');
  await page.reload(); await page.waitForSelector('html[data-start-ready="true"]');
  await page.getByRole('button', { name: '导入浏览历史', exact: true }).click();
  await page.locator('#confirm-import').click();
  for (let i = 0; i < 100; i++) { const snapshot = await command(page, 'SNAPSHOT'); if (snapshot.importJobs.some(j => j.state === 'complete')) break; await page.waitForTimeout(50); }
  const imported = await command(page, 'SNAPSHOT');
  check('B-real-history-API-harness', imported.importJobs.at(-1)?.state === 'complete' && imported.conversations.length === 3, 'Actual chrome.history search/getVisits imported three synthetic private-conversation URLs and excluded unrelated/share records.');
  check('B-history-does-not-forge-account-or-activity', imported.conversations.every(c => c.owner.kind === 'unassigned' && c.membership.state === 'UNKNOWN' && c.activity === null), 'Real history entries remain staging, UNKNOWN and without OpenDay.');
  await page.locator('#import-dialog [data-close]').first().click();
  await page.locator('a[data-record-key]').first().waitFor();
  const initialIntents = (await stores(page, ['openIntents']))[0].length;
  await page.locator('a[data-record-key]').first().evaluate(link => link.click());
  check('B-synthetic-click-no-intent', (await stores(page, ['openIntents']))[0].length === initialIntents, 'Untrusted element.click does not dispatch the broker.');
  const newTabPromise = context.waitForEvent('page');
  await page.locator('a[data-record-key]').first().click({ button: 'middle' });
  const destination = await newTabPromise;
  await destination.waitForURL(/^https:\/\/chatgpt.com\/c\//);
  const [intents, days] = await stores(page, ['openIntents', 'openDays']);
  check('B-middle-click-two-phase', intents.length === initialIntents + 1 && intents.at(-1).state === 'navigation-dispatched' && destination.url().startsWith('https://chatgpt.com/c/'), 'A trusted middle click persisted one intent and opened an exact normal browser tab.');
  check('B-route-alone-no-activity', days.length === 0, 'The controlled target URL is deliberately insufficient for live arrival and creates zero OpenDay.');
  const sessionBefore = await worker.evaluate(async () => (await chrome.storage.session.get('browserSession')).browserSession.id);
  const debuggerSession = await context.newCDPSession(page);
  const targets = await debuggerSession.send('Target.getTargets');
  const target = targets.targetInfos.find(target => target.type === 'service_worker' && target.url === worker.url());
  if (!target) throw Error('Service worker target missing');
  await debuggerSession.send('Target.closeTarget', { targetId: target.targetId });
  await command(page, 'SNAPSHOT');
  const resumedWorker = context.serviceWorkers().find(w => w.url() === worker.url()) || worker;
  const sessionAfter = await resumedWorker.evaluate(async () => (await chrome.storage.session.get('browserSession')).browserSession.id);
  check('B-worker-restart', sessionAfter === sessionBefore && (await command(page, 'SNAPSHOT')).conversations.length === 3, 'Killing the MV3 worker preserves the browser session and durable catalog.');
  await context.close(); context = null;
  context = await launch(profile, harness);
  ({ worker, page } = await ready(context));
  const sessionRestarted = await worker.evaluate(async () => (await chrome.storage.session.get('browserSession')).browserSession.id);
  const reopened = await command(page, 'SNAPSHOT');
  check('B-browser-restart-durable-directory', reopened.conversations.length === 3 && sessionRestarted !== sessionBefore, 'A complete browser restart keeps the directory but replaces browserSessionId.');
  const [oldIntents, finalDays] = await stores(page, ['openIntents', 'openDays']);
  check('B-restart-no-old-intent-consumption', oldIntents.every(i => ['expired', 'rejected', 'committed'].includes(i.state)) && finalDays.length === 0, 'Old pending intents expire and restart creates no activity.');
  const recordKey = reopened.conversations[0].key;
  await command(page, 'RECORD_REMOVE', { recordKey });
  const job = await command(page, 'IMPORT_START', { range: 'all', includeSynced: false });
  for (let i = 0; i < 10; i++) { const result = await command(page, 'IMPORT_STEP', { jobId: job.jobId }); if (result.job.state !== 'running') break; }
  check('B-tombstone-real-history-reimport', (await command(page, 'SNAPSHOT')).conversations.length === 2, 'Reimporting actual browser history does not revive a removed local entry.');
  await command(page, 'RECORD_RESTORE', { recordKey });
  check('B-explicit-restore', (await command(page, 'SNAPSHOT')).conversations.length === 3, 'Explicit restore recovers the removed local entry.');
  const result = { status: 'PASS', buildSha: fingerprint.sha, dirty: fingerprint.dirty, browserVersion, environment: 'isolated Linux browser; synthetic records; production install plus explicit history-permission harness', checks,
    limitations: ['No real account, ChatGPT source gate, Mac Chrome, Edge or native permission-prompt acceptance.', 'History harness adds history to required permissions only for API testing; production manifest remains storage-only.'] };
  await writeFile(join(output, 'browser-validation.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ status: result.status, checks: checks.length, browserVersion, buildSha: result.buildSha }));
} catch (error) {
  await writeFile(join(output, 'browser-validation.json'), JSON.stringify({ status: 'FAIL', buildSha: fingerprint.sha, dirty: fingerprint.dirty, checks, error: String(error) }, null, 2));
  throw error;
} finally { if (context) await context.close(); }
