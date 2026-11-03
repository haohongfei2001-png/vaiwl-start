/** Real chrome.history events against byte-identical production JavaScript.
 * Disposable Profiles and a separate synthetic-history feeder, never user data. */
import { chromium } from 'playwright';
import { mkdtemp, mkdir, cp, readFile, writeFile, readdir, symlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const source = resolve(process.env.VAIWL_HISTORY_DIST || 'dist');
const output = resolve(process.env.VAIWL_HISTORY_OUTPUT || 'artifacts');
await mkdir(output, { recursive: true });
const build = JSON.parse(await readFile(join(source, 'build.json'), 'utf8'));
const production = JSON.parse(await readFile(join(source, 'manifest.json'), 'utf8'));
const root = await mkdtemp(join(tmpdir(), 'vaiwl-automatic-history-'));
const runtime = join(root, 'extension'), feederPath = join(root, 'feeder'), profile = join(root, 'profile');
const origin = 'https://chatgpt.com', connection = { permissions: ['scripting', 'webNavigation'], origins: [origin + '/*'] };
const url = n => origin + '/c/96000000-0000-4000-8000-' + String(n).padStart(12, '0');
const checks = [], errors = [], requests = [];
const limitations = [
  'All history entries are synthetic and all browser Profiles are disposable. No private Profile, account, conversation body or real ChatGPT source is accessed.',
  'The target installs byte-identical production JavaScript. Only a temporary manifest changes optional-permission grant timing; this is not native permission-consent acceptance.',
  'A separate minimal feeder extension calls the real chrome.history.addUrl API and observes the real onVisited event, including after the target loses history permission. No target worker listener or history API is mocked.',
  'Negative browser checks observe an explicit bounded quiet interval after the real browser event. Deterministic in-flight cancellation/stop-resume interleavings are separate unit tests.',
  'This isolated Chromium result is not a user Mac in-place installation, current Workspace certification or complete native Project synchronization.',
];
let context, worker, feeder, page, extensionId, browserVersion = null;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const check = (id, condition, observed) => {
  checks.push({ id, status: condition ? 'PASS' : 'FAIL', observed });
  assert.ok(condition, id + ': ' + observed);
  console.log(id + ': PASS');
};
async function until(probe, label, timeout = 10000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const value = await probe(); if (value) return value; await pause(40); }
  throw Error(label);
}
async function command(command, payload = {}) {
  return page.evaluate(async ({ command, payload }) => {
    const send = (command, payload, expectedRevision) => chrome.runtime.sendMessage({ protocol: 'vaiwl-start-internal/1', operationId: crypto.randomUUID(), expectedRevision, command, payload });
    const current = await send('SNAPSHOT', {}, 0); if (!current.ok) throw Error(current.code);
    const result = await send(command, payload, current.data.revision); if (!result.ok) throw Error(result.code); return result.data;
  }, { command, payload });
}
async function userData() {
  return page.evaluate(async () => {
    const names = ['conversations', 'openDays', 'tombstones', 'projects', 'scopes', 'witnesses', 'settings'];
    const db = await new Promise((resolve, reject) => { const request = indexedDB.open('vaiwl-start'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    try {
      const tx = db.transaction(names, 'readonly'), result = {};
      for (const name of names) { const request = tx.objectStore(name).getAll(); request.onsuccess = () => { result[name] = name === 'settings' ? request.result.filter(row => row.key.startsWith('localProject:')) : request.result; }; }
      await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = () => reject(tx.error); });
      return result;
    } finally { db.close(); }
  });
}
async function manifest({ historyRequired, connectionRequired }) {
  const required = [...(historyRequired ? ['history'] : []), ...(connectionRequired ? connection.permissions : [])];
  await writeFile(join(runtime, 'manifest.json'), JSON.stringify({ ...production,
    permissions: [...production.permissions, ...required],
    optional_permissions: production.optional_permissions.filter(permission => !required.includes(permission)),
    host_permissions: connectionRequired ? connection.origins : [],
    optional_host_permissions: connectionRequired ? [] : connection.origins,
  }));
}
async function launch(currentProfile, useFeeder = true) {
  const extensions = [runtime, ...(useFeeder ? [feederPath] : [])].join(',');
  context = await chromium.launchPersistentContext(currentProfile, {
    ...(process.env.VAIWL_CHROMIUM_EXECUTABLE ? { executablePath: process.env.VAIWL_CHROMIUM_EXECUTABLE } : { channel: 'chromium' }),
    headless: true, viewport: { width: 1280, height: 900 },
    args: ['--no-sandbox', '--disable-extensions-except=' + extensions, '--load-extension=' + extensions],
  });
  context.on('page', candidate => candidate.on('pageerror', error => errors.push(error.message)));
  await context.route(/^https?:\/\//, async route => { requests.push(route.request().url()); await route.abort(); });
  worker = await until(async () => context.serviceWorkers().find(candidate => new URL(candidate.url()).pathname === '/service-worker.js'), 'Production worker was not installed');
  if (useFeeder) feeder = await until(async () => context.serviceWorkers().find(candidate => new URL(candidate.url()).pathname === '/feeder.js'), 'Synthetic history feeder was not installed');
  extensionId = new URL(worker.url()).host;
  browserVersion = context.browser()?.version() || await worker.evaluate(() => navigator.userAgent);
  page = await context.newPage(); await page.goto('chrome-extension://' + extensionId + '/newtab.html');
  await page.waitForSelector('html[data-start-ready="true"]');
}
async function close() { if (context) { await context.close(); context = null; } }
async function capture(enabled) {
  await page.locator('#settings-trigger').click();
  await page.locator('#capture-enabled').setChecked(enabled);
  await until(async () => (await command('SNAPSHOT')).settings.captureEnabled === enabled, 'Production capture setting did not settle');
  await page.locator('#settings-dialog [data-close]').first().click();
}
async function add(n) {
  const expected = url(n);
  const event = await feeder.evaluate(async url => new Promise((resolve, reject) => {
    const timer = setTimeout(() => { chrome.history.onVisited.removeListener(onVisited); reject(Error('Real history event was not emitted')); }, 8000);
    const onVisited = item => { if (item.url === url) { clearTimeout(timer); chrome.history.onVisited.removeListener(onVisited); resolve({ url: item.url, lastVisitTime: item.lastVisitTime }); } };
    chrome.history.onVisited.addListener(onVisited);
    chrome.history.addUrl({ url }).catch(error => { clearTimeout(timer); chrome.history.onVisited.removeListener(onVisited); reject(error); });
  }), expected);
  assert.equal(event.url, expected); assert.ok(Number.isFinite(event.lastVisitTime));
  return event;
}
async function present(n) {
  return until(async () => (await command('SNAPSHOT')).conversations.find(record => record.canonicalUrl === url(n)), 'Real history event did not automatically enter the catalog: ' + n);
}
async function unchanged(id, before, observed) {
  const end = Date.now() + 1200;
  do {
    const after = await userData();
    if (JSON.stringify(after) !== JSON.stringify(before)) return check(id, false, observed + ' Saved catalog data changed after the event: ' + JSON.stringify({ recordsBefore: before.conversations.length, recordsAfter: after.conversations.length }));
    await pause(60);
  } while (Date.now() < end);
  check(id, true, observed);
}
async function importAll() {
  const previous = new Set((await command('SNAPSHOT')).importJobs.map(job => job.id));
  // The enabled positive control has already left first-use. Use the persistent
  // settings entry, which opens the same production import dialog for existing catalogs.
  await page.locator('#settings-trigger').click();
  await page.locator('#settings-import').click();
  await page.locator('#import-range').selectOption('all');
  await page.locator('#confirm-import').click();
  const completed = await until(async () => (await command('SNAPSHOT')).importJobs.find(job => !previous.has(job.id) && job.state === 'complete'), 'Explicit UI import did not complete');
  await page.locator('#import-dialog [data-close]').first().click();
  return completed;
}

async function verifyBaselineRegression() {
  // A caller explicitly supplying a runtime is the same test's isolated child,
  // not another regression orchestrator. Its ordinary assertions stay intact.
  if (process.env.VAIWL_HISTORY_DIST) return;
  const baselineSha = '5ad87bab060d321754cc65d073ac8736ea35b47e';
  const baselineSource = join(root, 'baseline-source'), baselineOutput = join(root, 'baseline-evidence');
  let added = false, receipt = null, status = null;
  try {
    try { execFileSync('git', ['cat-file', '-e', baselineSha + '^{commit}'], { stdio: 'pipe' }); }
    catch { execFileSync('git', ['fetch', '--depth=1', 'origin', baselineSha], { stdio: 'pipe' }); }
    execFileSync('git', ['worktree', 'add', '--detach', baselineSource, baselineSha], { stdio: 'pipe' }); added = true;
    // The baseline ignores node_modules/ as a directory. A symlink at that exact
    // path is an untracked file, making the honest build fingerprint dirty.
    // Keep a real ignored directory and share only its dependency entries.
    const dependencies = resolve('node_modules'), baselineDependencies = join(baselineSource, 'node_modules');
    await mkdir(baselineDependencies);
    for (const entry of await readdir(dependencies)) await symlink(join(dependencies, entry), join(baselineDependencies, entry));
    const baselineStatus = execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], { cwd: baselineSource, encoding: 'utf8' }).trim();
    assert.equal(baselineStatus, '', 'Baseline dependency setup must leave a clean worktree before building: ' + baselineStatus);
    execFileSync(process.execPath, ['scripts/build.mjs'], { cwd: baselineSource, stdio: 'pipe' });
    const baselineBuild = JSON.parse(await readFile(join(baselineSource, 'dist', 'build.json'), 'utf8'));
    assert.equal(baselineBuild.sha, baselineSha); assert.equal(baselineBuild.dirty, false, 'Baseline build must retain its truthful clean fingerprint');
    const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { cwd: process.cwd(),
      env: { ...process.env, VAIWL_HISTORY_DIST: join(baselineSource, 'dist'), VAIWL_HISTORY_OUTPUT: baselineOutput },
      encoding: 'utf8', timeout: 90000, maxBuffer: 2 * 1024 * 1024 });
    status = result.status;
    try { receipt = JSON.parse(await readFile(join(baselineOutput, 'automatic-history-validation.json'), 'utf8')); } catch { /* A missing receipt is never an expected failure. */ }
    const failures = receipt?.checks?.filter(item => item.status === 'FAIL') || [];
    const reproduced = status !== null && status !== 0 && receipt?.status === 'FAIL' && receipt.buildSha === baselineSha && receipt.dirty === false && !!receipt.browserVersion
      && receipt.checks.some(item => item.id === 'AUTO-HISTORY-production-install' && item.status === 'PASS')
      && receipt.checks.some(item => item.id === 'AUTO-HISTORY-enabled-positive-control' && item.status === 'PASS')
      && failures.length === 1 && failures[0].id === 'AUTO-HISTORY-paused-blocks-new-and-existing';
    await writeFile(join(output, 'automatic-history-baseline-validation.json'), JSON.stringify({ status: reproduced ? 'PASS' : 'FAIL',
      buildSha: build.sha, dirty: build.dirty, baselineSha,
      baselinePreparation: { dependencyLayout: 'real ignored node_modules directory with symlinked entries', gitStatusBeforeBuild: baselineStatus },
      conclusion: reproduced ? 'EXPECTED_P1_FAILURE_CONFIRMED' : 'BASELINE_REPRODUCTION_FAILED', exitStatus: status, result: receipt,
      ...(reproduced ? {} : { error: String(result.error || result.stderr || 'Baseline did not reach the expected pause regression').slice(-4000) }),
      limitations: ['The expected failure must occur at the same real-history pause assertion after successful production install and automatic enabled admission; setup errors/timeouts do not count.'] }, null, 2));
    check('AUTO-HISTORY-baseline-regression-confirmed', reproduced,
      'The same installed-browser test on clean 5ad87bab passes its enabled positive control and fails specifically because paused real history events still write. No unrelated failure is accepted as evidence.');
  } finally {
    if (added) execFileSync('git', ['worktree', 'remove', '--force', baselineSource], { stdio: 'pipe' });
  }
}

try {
  await verifyBaselineRegression();
  assert.deepEqual(production.permissions, ['storage', 'favicon', 'search']);
  assert.deepEqual(production.optional_permissions, ['history', 'scripting', 'webNavigation', 'bookmarks']);
  assert.deepEqual(production.optional_host_permissions, [origin + '/*']);
  await cp(source, runtime, { recursive: true });
  for (const [name, digest] of Object.entries(build.files)) assert.equal(createHash('sha256').update(await readFile(join(runtime, name))).digest('hex'), digest, 'Exact production runtime bytes: ' + name);
  await launch(join(root, 'production-profile'), false);
  const actual = await worker.evaluate(() => chrome.permissions.getAll());
  check('AUTO-HISTORY-production-install', !actual.permissions.includes('history') && !actual.permissions.includes('scripting') && !actual.permissions.includes('webNavigation') && actual.origins.length === 0 && !(await command('SNAPSHOT')).settings.captureEnabled,
    'Unmodified production manifest and every runtime hash match build.json; actual first install has no history/connection permission and capture is disabled.');
  await close();
  await mkdir(feederPath, { recursive: true });
  await writeFile(join(feederPath, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'Synthetic history feeder for VAIWL test', version: '1.0', permissions: ['history'], background: { service_worker: 'feeder.js' } }));
  await writeFile(join(feederPath, 'feeder.js'), 'chrome.history.onVisited.addListener(() => {});\n');
  await manifest({ historyRequired: true, connectionRequired: true });
  for (const [name, digest] of Object.entries(build.files)) if (name !== 'manifest.json') assert.equal(createHash('sha256').update(await readFile(join(runtime, name))).digest('hex'), digest);
  await launch(profile);
  await capture(true);
  const enabled = await command('SNAPSHOT');
  assert.ok(enabled.capabilities.history && enabled.capabilities.chatgpt && enabled.settings.captureEnabled);
  await add(1); const first = await present(1);
  check('AUTO-HISTORY-enabled-positive-control', first.owner.kind === 'unassigned' && first.membership.state === 'UNKNOWN' && first.activity === null && first.browserLastVisitAt !== null,
    'Real feeder chrome.history.addUrl emits onVisited; the installed production worker automatically persists one history record only after enabled collection and all existing permissions.');

  await capture(false); const paused = await userData();
  await add(1); await add(2);
  await unchanged('AUTO-HISTORY-paused-blocks-new-and-existing', paused,
    'With the persisted pause setting, real new and repeated history events create no row and modify no saved title/date, Project, tombstone or OpenDay.');
  const manual = await importAll(), afterImport = await command('SNAPSHOT');
  check('AUTO-HISTORY-explicit-import-while-paused', manual.state === 'complete' && afterImport.settings.captureEnabled === false && afterImport.conversations.length === 2 && afterImport.conversations.some(record => record.canonicalUrl === url(2)) && afterImport.conversations.every(record => record.activity === null),
    'The explicitly requested existing IMPORT_START/IMPORT_STEP path imports real browser history while automatic capture remains disabled; no activity is manufactured.');

  const saved = await userData(); const oldId = extensionId;
  await close(); await manifest({ historyRequired: false, connectionRequired: false }); await launch(profile);
  assert.equal(extensionId, oldId);
  const restarted = await command('SNAPSHOT');
  check('AUTO-HISTORY-paused-restart-retains-state', restarted.settings.captureEnabled === false && restarted.capabilities.history && restarted.capabilities.chatgpt && JSON.stringify(await userData()) === JSON.stringify(saved),
    'Full browser restart at the same extension path/ID retains paused state and all saved data; temporary optional grant timing does not turn capture back on.');
  await add(3); await unchanged('AUTO-HISTORY-paused-restart-no-replay', saved, 'A genuine post-restart history event remains blocked without toggling or test synchronization commands.');
  await capture(true); await add(4); await present(4);
  check('AUTO-HISTORY-explicit-resume', !(await command('SNAPSHOT')).conversations.some(record => record.canonicalUrl === url(3)), 'Explicit resume accepts the next real event and does not retroactively replay the event ignored while paused.');

  const beforeDisconnect = await userData();
  const removedConnection = await page.evaluate(() => chrome.permissions.remove({ origins: ['https://chatgpt.com/*'] }));
  await until(async () => !(await command('SNAPSHOT')).capabilities.chatgpt, 'Actual connection permission was not revoked');
  const disconnected = await command('SNAPSHOT');
  assert.ok(removedConnection && disconnected.capabilities.history && disconnected.settings.captureEnabled);
  await add(4); await add(5);
  await unchanged('AUTO-HISTORY-disconnected-with-history-grant', beforeDisconnect,
    'Actual Chrome host-permission removal leaves history permission and the saved enabled preference intact, but genuine new/repeated history events cannot write through that independent listener.');

  await close(); await manifest({ historyRequired: false, connectionRequired: true }); await launch(profile);
  const regranted = await command('SNAPSHOT');
  assert.ok(regranted.capabilities.chatgpt && regranted.capabilities.history && regranted.settings.captureEnabled);
  await add(6); await present(6);
  check('AUTO-HISTORY-connection-return-positive-control', !regranted.conversations.some(record => record.canonicalUrl === url(5)),
    'After a fixture-only connection regrant and full restart, a new actual history event is admitted without altering the stored enabled preference or replaying the disconnected event.');
  const beforeHistoryRevoke = await userData();
  const removedHistory = await page.evaluate(() => chrome.permissions.remove({ permissions: ['history'] }));
  await until(async () => !(await command('SNAPSHOT')).capabilities.history, 'Actual history permission was not revoked');
  const noHistory = await command('SNAPSHOT');
  assert.ok(removedHistory && noHistory.capabilities.chatgpt && noHistory.settings.captureEnabled);
  await add(6); await add(7);
  await unchanged('AUTO-HISTORY-history-permission-revoked', beforeHistoryRevoke,
    'Actual target history permission is revoked while ChatGPT connection and capture remain enabled. The separately authorized feeder still emits real browser events, but target data does not change.');
  await close(); await launch(profile);
  const revokedRestart = await command('SNAPSHOT');
  check('AUTO-HISTORY-revocation-restart-retained', !revokedRestart.capabilities.history && revokedRestart.capabilities.chatgpt && revokedRestart.settings.captureEnabled && JSON.stringify(await userData()) === JSON.stringify(beforeHistoryRevoke),
    'A full browser restart preserves the actual revoked history grant, the independent saved capture preference and all existing data.');
  await add(8); await unchanged('AUTO-HISTORY-revocation-restart-no-write', beforeHistoryRevoke, 'Real history events after restart cannot silently reactivate history collection.');
  check('AUTO-HISTORY-no-private-source-or-page-errors', requests.length === 0 && errors.length === 0,
    'History tests opened no ChatGPT/private page and made no HTTP source request; the target UI had no page error.');
  await writeFile(join(output, 'automatic-history-validation.json'), JSON.stringify({ status: 'PASS', buildSha: build.sha, dirty: build.dirty, browserVersion,
    environment: 'disposable installed Chromium extensions; exact production runtime; real chrome.history events and real optional permission removals', checks, errors, limitations }, null, 2));
  console.log(JSON.stringify({ status: 'PASS', checks: checks.length, buildSha: build.sha, browserVersion }));
} catch (error) {
  await writeFile(join(output, 'automatic-history-validation.json'), JSON.stringify({ status: 'FAIL', buildSha: build.sha, dirty: build.dirty, browserVersion, checks, errors, error: String(error.stack || error), limitations }, null, 2));
  throw error;
} finally { await close(); }
