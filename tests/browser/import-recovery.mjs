import { chromium } from 'playwright';
import { mkdtemp, mkdir, cp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const output = resolve('artifacts');
await mkdir(output, { recursive: true });
const fingerprint = JSON.parse(await readFile('dist/build.json', 'utf8'));
const checks = [];
const check = (id, condition, observed) => {
  assert.ok(condition, `${id}: ${observed}`);
  checks.push({ id, status: 'PASS', observed });
};
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const COUNT = 257;
const urls = Array.from({ length: COUNT }, (_, index) => `https://chatgpt.com/c/70000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`);
let context, browserVersion = null;

async function command(page, command, payload = {}) {
  return page.evaluate(async ({ command, payload }) => {
    const send = (name, data, revision) => chrome.runtime.sendMessage({ protocol: 'vaiwl-start-internal/1', operationId: crypto.randomUUID(), expectedRevision: revision, command: name, payload: data });
    const current = await send('SNAPSHOT', {}, 0);
    if (!current.ok) throw Error(current.code);
    const result = await send(command, payload, current.data.revision);
    if (!result.ok) throw Error(result.code);
    return result.data;
  }, { command, payload });
}
async function databaseRows(page, stores) {
  return page.evaluate(async stores => {
    const request = indexedDB.open('vaiwl-start');
    const db = await new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    try {
      const tx = db.transaction(stores, 'readonly');
      const rows = {};
      for (const store of stores) { const request = tx.objectStore(store).getAll(); request.onsuccess = () => { rows[store] = request.result; }; }
      await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = () => reject(tx.error); });
      return rows;
    } finally { db.close(); }
  }, stores);
}

try {
  // Identical production JavaScript. Only this temporary copy pre-grants history,
  // as native permission prompt automation is outside this test's evidence.
  const harness = await mkdtemp(join(tmpdir(), 'vaiwl-import-recovery-harness-'));
  await cp(resolve('dist'), harness, { recursive: true });
  const manifest = JSON.parse(await readFile(join(harness, 'manifest.json'), 'utf8'));
  manifest.permissions.push('history');
  manifest.optional_permissions = manifest.optional_permissions.filter(permission => permission !== 'history');
  await writeFile(join(harness, 'manifest.json'), JSON.stringify(manifest));
  for (const name of ['service-worker.js', 'content.js', 'newtab.js']) {
    assert.equal(hash(await readFile(join(harness, name))), fingerprint.files[name], `unchanged production bytes: ${name}`);
  }
  check('IMPORT-B-identical-production-js', true, 'Only the temporary manifest makes history required; all three JavaScript bundles match the production build hashes.');
  const profile = await mkdtemp(join(tmpdir(), 'vaiwl-import-recovery-profile-'));
  context = await chromium.launchPersistentContext(profile, {
    ...(process.env.VAIWL_CHROMIUM_EXECUTABLE ? { executablePath: process.env.VAIWL_CHROMIUM_EXECUTABLE } : { channel: 'chromium' }),
    headless: true, viewport: { width: 1280, height: 900 },
    args: ['--no-sandbox', `--disable-extensions-except=${harness}`, `--load-extension=${harness}`],
  });
  await context.route(/^https?:\/\//, route => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Synthetic test only</title>' }));
  const control = context.pages()[0] || await context.newPage();
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  browserVersion = context.browser()?.version() || await worker.evaluate(() => navigator.userAgent);
  const extensionId = new URL(worker.url()).host;
  let page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/newtab.html`);
  await page.waitForSelector('html[data-start-ready="true"]');
  const granted = await worker.evaluate(() => chrome.permissions.getAll());
  check('IMPORT-B-no-chatgpt-source-authority', granted.permissions.includes('history') && !granted.permissions.includes('scripting') && !granted.permissions.includes('webNavigation') && granted.origins.length === 0, 'The isolated harness has history only; no account, ChatGPT observation or source authority is enabled.');
  await worker.evaluate(async urls => { for (const url of urls) await chrome.history.addUrl({ url }); }, urls);
  // onVisited is genuine production discovery. Wait for it to finish, then clear
  // only extension data so the following records must come from the import job.
  await page.waitForFunction(async count => {
    const response = await chrome.runtime.sendMessage({ protocol: 'vaiwl-start-internal/1', operationId: crypto.randomUUID(), expectedRevision: 0, command: 'SNAPSHOT', payload: {} });
    return response.ok && response.data.conversations.length === count;
  }, COUNT, { timeout: 30000 });
  await command(page, 'CLEAR_LOCAL');
  check('IMPORT-B-clean-catalog-real-history', (await command(page, 'SNAPSHOT')).conversations.length === 0, '257 synthetic real browser history entries remain, while the independent extension catalog starts empty.');
  const started = await command(page, 'IMPORT_START', { range: 'all', includeSynced: false });
  const first = await command(page, 'IMPORT_STEP', { jobId: started.jobId });
  const partial = await databaseRows(page, ['conversations', 'importJobs', 'openDays']);
  const checkpoint = partial.importJobs.find(job => job.id === started.jobId);
  check('IMPORT-B-first-batch-persisted', first.job.state === 'running' && partial.conversations.length === 200 && checkpoint?.acceptedCandidates === 200 && checkpoint.pendingCandidates.length === COUNT - 200 && checkpoint.pendingIntervals.length > 0 && partial.openDays.length === 0,
    'Exactly one IMPORT_STEP atomically persists 200 records, the same running job, 57 pending candidates and the remaining interval; no activity is created.');
  const workerBefore = await worker.evaluate(async () => ({ session: (await chrome.storage.session.get('browserSession')).browserSession.id, timeOrigin: performance.timeOrigin }));
  await page.close();
  const cdp = await context.newCDPSession(control);
  const beforeTargets = await cdp.send('Target.getTargets');
  const target = beforeTargets.targetInfos.find(target => target.type === 'service_worker' && target.url === worker.url());
  assert.ok(target, 'The import worker must exist before forced termination.');
  const result = await cdp.send('Target.closeTarget', { targetId: target.targetId });
  check('IMPORT-B-ui-close-worker-terminated', result.success === true && !context.pages().some(page => page.url() === `chrome-extension://${extensionId}/newtab.html`), 'The only Start UI document is closed and its service worker target is explicitly terminated after the durable partial batch.');
  page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/newtab.html`);
  await page.waitForSelector('html[data-start-ready="true"]');
  // The unmodified production UI notices the persisted running job and resumes it.
  await page.waitForFunction(async jobId => {
    const response = await chrome.runtime.sendMessage({ protocol: 'vaiwl-start-internal/1', operationId: crypto.randomUUID(), expectedRevision: 0, command: 'SNAPSHOT', payload: {} });
    return response.ok && response.data.importJobs.find(job => job.id === jobId)?.state === 'complete';
  }, started.jobId, { timeout: 30000 });
  const snapshot = await command(page, 'SNAPSHOT');
  const final = await databaseRows(page, ['conversations', 'importJobs', 'openDays', 'openIntents']);
  const job = final.importJobs.find(job => job.id === started.jobId);
  // Chromium/Playwright may retain the same Worker wrapper across a stopped
  // service-worker version. A fresh global timeOrigin proves execution restart;
  // do not assume a second Playwright serviceworker event will be emitted.
  const resumedWorker = context.serviceWorkers().find(candidate => candidate.url() === worker.url()) || worker;
  const workerAfter = await resumedWorker.evaluate(async () => ({ session: (await chrome.storage.session.get('browserSession')).browserSession.id, timeOrigin: performance.timeOrigin }));
  check('IMPORT-B-worker-session-retained', workerAfter.session === workerBefore.session && Number.isFinite(workerAfter.timeOrigin) && workerAfter.timeOrigin > workerBefore.timeOrigin, 'A fresh worker global resumes within the same browser session; the UI and worker were not kept alive to finish the import.');
  check('IMPORT-B-checkpoint-resumed-completely', final.importJobs.length === 1 && job?.state === 'complete' && job.acceptedCandidates === COUNT && job.processedUniqueUrls === COUNT && job.pendingCandidates.length === 0 && job.pendingIntervals.length === 0 && snapshot.conversations.length === COUNT,
    'The same persisted job completes all 257 candidates after reopening, with no pending intervals or batches.');
  check('IMPORT-B-deduplicated-source-safe', new Set(final.conversations.map(record => record.conversationId)).size === COUNT && final.conversations.length === COUNT && final.conversations.every(record => record.owner.kind === 'unassigned' && record.membership.state === 'UNKNOWN' && record.activity === null) && final.openDays.length === 0 && final.openIntents.length === 0,
    'All 257 identities occur once, remain unassigned/UNKNOWN, and create neither an intent nor an OpenDay.');
  const receipt = { status: 'PASS', buildSha: fingerprint.sha, dirty: fingerprint.dirty, browserVersion, environment: 'isolated Linux Chromium MV3; real chrome.history API; synthetic records only; explicit required-history test manifest', checks,
    limitations: ['This test changes only a temporary manifest to pre-grant history; it is not native optional-permission prompt acceptance.', 'Same-millisecond saturation is covered by unit tests, not claimed by this browser recovery experiment.', 'No real ChatGPT account/source, Mac Chrome, Edge, or human active-open proof is exercised.'] };
  await writeFile(join(output, 'import-recovery-validation.json'), JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify({ status: 'PASS', checks: checks.length, buildSha: fingerprint.sha, browserVersion, records: COUNT }));
} catch (error) {
  await writeFile(join(output, 'import-recovery-validation.json'), JSON.stringify({ status: 'FAIL', buildSha: fingerprint.sha, dirty: fingerprint.dirty, browserVersion, checks, error: String(error), limitations: ['Synthetic isolated browser recovery only; no live source or native prompt claim.'] }, null, 2));
  throw error;
} finally { if (context) await context.close(); }
