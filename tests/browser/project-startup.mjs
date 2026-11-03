/** Production extension lifecycle in disposable Chromium Profiles. Native data is synthetic. */
import { chromium } from 'playwright';
import { mkdtemp, mkdir, cp, readFile, writeFile, symlink } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const build = JSON.parse(await readFile('dist/build.json', 'utf8'));
const root = await mkdtemp(join(tmpdir(), 'vaiwl-project-startup-'));
const runtime = join(root, 'extension'), profile = join(root, 'profile');
const baseline = '6bc0b29b848edcf7e6b5293c24fd5d957f0b3515';
const origin = 'https://chatgpt.com', sessionURL = origin + '/api/auth/session';
const pid = n => 'g-p-9300000000000000000000000000' + String(n).padStart(4, '0');
const cid = n => '94000000-0000-4000-8000-' + String(n).padStart(12, '0');
const projectURL = n => origin + '/g/' + pid(n) + '/project';
const member = n => '<li><a href="/c/' + cid(n) + '"><div><div>Member ' + n + '</div><div data-preview>PRIVATE_PREVIEW_SENTINEL</div></div></a></li>';
const panel = (n, members = [n]) => '<main><h1><span>Project ' + n + '</span></h1><div role="tablist"><button role="tab" aria-selected="true" id="chats" aria-controls="members">Chats</button></div><div role="tabpanel" id="members" aria-labelledby="chats"><ol>' + members.map(member).join('') + '</ol></div></main>';
const documentHTML = content => '<!doctype html><meta charset="utf-8"><title>ChatGPT</title><div id="metadata">' + content + '</div>';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const checks = [], errors = [], requests = [];
let context, worker, start, native, extensionId, status = 'FAIL', browserVersion, oldSource;
let sessionDelay = 0, sessionFailures = 0, emptyDocument = false;
const pass = (id, observed) => { checks.push({ id, status: 'PASS', observed }); console.log(id + ': PASS'); };
async function until(probe, label, timeout = 12000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const value = await probe(); if (value) return value; await pause(40); }
  throw Error(label);
}
async function command(command, payload = {}, page = start) {
  return page.evaluate(async ({ command, payload }) => {
    const send = (command, payload, expectedRevision) => chrome.runtime.sendMessage({ protocol: 'vaiwl-start-internal/1', operationId: crypto.randomUUID(), command, payload, expectedRevision });
    const before = await send('SNAPSHOT', {}, 0); if (!before.ok) throw Error(before.code);
    const result = await send(command, payload, before.data.revision); if (!result.ok) throw Error(result.code); return result.data;
  }, { command, payload });
}
async function seen(n, members = [n]) {
  return until(async () => {
    const snapshot = await command('SNAPSHOT');
    const projects = (snapshot.localProjects || []).filter(p => p.projectId === pid(n));
    if (projects.length !== 1) return null;
    const rows = snapshot.conversations.filter(r => r.localProject?.projectKey === projects[0].key);
    return members.every(m => rows.some(r => r.conversationId === cid(m))) ? { snapshot, project: projects[0], rows } : null;
  }, 'Project ' + n + ' was not automatically observed with members ' + members.join(','));
}
async function startPage() {
  const page = await context.newPage(); await page.goto('chrome-extension://' + extensionId + '/newtab.html');
  await page.waitForSelector('html[data-start-ready="true"]'); return page;
}
async function prepareRuntime(source) {
  await cp(source, runtime, { recursive: true });
  const manifest = JSON.parse(await readFile(join(runtime, 'manifest.json'), 'utf8'));
  // Only consent timing is a fixture. Every executable production byte remains unchanged.
  // Native optional-permission consent cannot be accepted in headless Chrome.
  manifest.permissions.push('scripting', 'webNavigation');
  manifest.optional_permissions = manifest.optional_permissions.filter(p => !['scripting', 'webNavigation'].includes(p));
  manifest.host_permissions = [origin + '/*']; manifest.optional_host_permissions = [];
  await writeFile(join(runtime, 'manifest.json'), JSON.stringify(manifest));
}
async function launch() {
  context = await chromium.launchPersistentContext(profile, {
    ...(process.env.VAIWL_CHROMIUM_EXECUTABLE ? { executablePath: process.env.VAIWL_CHROMIUM_EXECUTABLE } : { channel: 'chromium' }),
    headless: true, viewport: { width: 1280, height: 900 }, args: ['--no-sandbox', '--disable-extensions-except=' + runtime, '--load-extension=' + runtime],
  });
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  await context.route(/^https?:\/\//, async route => {
    const url = route.request().url();
    if (['fetch', 'xhr'].includes(route.request().resourceType())) requests.push(url);
    if (url === sessionURL) {
      if (sessionDelay) await pause(sessionDelay);
      if (sessionFailures > 0) { sessionFailures--; return route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }); }
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ user: { id: 'startup-synthetic-principal' }, expires: new Date(Date.now() + 3600000).toISOString() }) });
    }
    if (url.startsWith(origin + '/')) {
      const n = Array.from({ length: 30 }, (_, i) => i + 1).find(n => url === projectURL(n));
      return route.fulfill({ contentType: 'text/html', body: documentHTML(n && !emptyDocument ? panel(n) : '') });
    }
    return route.abort();
  });
  worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  extensionId = new URL(worker.url()).host; browserVersion = context.browser()?.version() || await worker.evaluate(() => navigator.userAgent);
  start = await startPage(); // Deliberately no PERMISSIONS_SYNC on startup, reload or restart.
}
async function capture(enabled) {
  await start.locator('#settings-trigger').click();
  await start.locator('#capture-enabled').setChecked(enabled);
  await until(async () => (await command('SNAPSHOT')).settings.captureEnabled === enabled, 'Capture setting did not settle');
  await start.locator('#settings-dialog [data-close]').first().click();
}
async function reloadExtension() {
  const oldOrigin = await worker.evaluate(() => performance.timeOrigin);
  const manager = await context.newPage(); await manager.goto('chrome://extensions');
  await manager.locator('extensions-item').first().waitFor();
  if (!await manager.locator('#devMode').evaluate(node => node.checked)) await manager.locator('#devMode').click();
  await manager.evaluate(() => { window.__events = []; chrome.developerPrivate.onItemStateChanged.addListener(e => window.__events.push({ id: e.item_id, type: e.event_type, state: e.extensionInfo?.state })); });
  await manager.locator('#dev-reload-button').click();
  await manager.waitForFunction(id => window.__events.some(e => e.id === id && e.type === 'LOADED' && e.state === 'ENABLED'), extensionId);
  start = await startPage();
  worker = await until(async () => {
    for (const candidate of context.serviceWorkers()) {
      try { if (new URL(candidate.url()).host === extensionId && await candidate.evaluate(() => performance.timeOrigin) > oldOrigin) return candidate; } catch {}
    }
  }, 'Reload did not start a fresh worker');
  await manager.close();
}
async function fill(n, members = [n]) { await native.locator('#metadata').evaluate((node, html) => { node.innerHTML = html; }, panel(n, members)); }

try {
  await prepareRuntime(resolve('dist'));
  for (const name of ['content.js', 'service-worker.js', 'newtab.js']) assert.equal(createHash('sha256').update(await readFile(join(runtime, name))).digest('hex'), build.files[name]);
  pass('START-production-bytes', 'Installed content, worker and Start bundles exactly match build.json; only optional consent timing is pregranted in the isolated manifest.');
  await launch();
  native = await context.newPage(); await native.goto(projectURL(1));
  await pause(300); assert.equal((await command('SNAPSHOT')).localProjects.length, 0);
  await capture(true); await seen(1);
  pass('START-first-enable-existing-document', 'The first enabled collection setting activates an already open valid Project without reloading its document.');
  await native.goto(projectURL(2)); const beforeReload = await seen(2);
  pass('START-enabled-normal-navigation', 'An enabled installation automatically collects a normally opened valid Project without a capture toggle or synchronization test command.');
  const documentBefore = await native.evaluate(() => performance.timeOrigin);
  await reloadExtension(); await fill(2, [2, 102]);
  const afterReload = await seen(2, [2, 102]);
  assert.equal(await native.evaluate(() => performance.timeOrigin), documentBefore);
  assert.equal(afterReload.project.key, beforeReload.project.key);
  pass('START-reload-already-open-project', 'Actual extensions-manager Reload starts a fresh worker; the existing native document automatically resumes incremental observation without navigation or a capture toggle.');
  await native.goto(projectURL(3)); await seen(3);
  pass('START-reload-new-project', 'A new native Project document after extension Reload is collected without re-enabling capture.');

  const workerBefore = await worker.evaluate(async () => ({ origin: performance.timeOrigin, session: (await chrome.storage.session.get('browserSession')).browserSession.id }));
  const control = await context.newPage(), debuggerSession = await context.newCDPSession(control);
  const targets = await debuggerSession.send('Target.getTargets');
  const target = targets.targetInfos.find(t => t.type === 'service_worker' && t.url === worker.url()); assert.ok(target);
  assert.equal((await debuggerSession.send('Target.closeTarget', { targetId: target.targetId })).success, true);
  await debuggerSession.detach(); await native.goto(projectURL(4)); await seen(4);
  worker = context.serviceWorkers().find(w => new URL(w.url()).host === extensionId) || worker;
  const workerAfter = await worker.evaluate(async () => ({ origin: performance.timeOrigin, session: (await chrome.storage.session.get('browserSession')).browserSession.id }));
  assert.ok(workerAfter.origin > workerBefore.origin); assert.equal(workerAfter.session, workerBefore.session); await control.close();
  pass('START-worker-termination-recovery', 'A real isolated worker target is terminated; normal Project navigation wakes a fresh worker and automatically collects in the same browser session. Forced termination is not claimed as natural idle timing.');

  sessionDelay = 350; emptyDocument = true;
  await native.goto(projectURL(5)); await pause(800); await fill(5); await seen(5); sessionDelay = 0; emptyDocument = false;
  pass('START-late-identity-and-panel', 'A delayed principal response and panel rendered after initial identity acquisition are automatically observed.');
  await native.goto(origin + '/c/' + cid(600));
  await native.evaluate(url => history.pushState({}, '', url), projectURL(6)); await fill(6); await seen(6);
  pass('START-SPA-conversation-to-project', 'The actual history-state event binds an ordinary conversation-to-Project transition without replacing the document.');

  await capture(false); await native.goto(projectURL(7)); await pause(800);
  assert.ok(!(await command('SNAPSHOT')).localProjects.some(p => p.projectId === pid(7)));
  await capture(true); await seen(7);
  pass('START-stop-and-resume', 'Disabled collection does not accept a new Project; explicitly resuming reactivates the already-open document.');
  sessionFailures = 1; await native.goto(projectURL(8)); await seen(8);
  const eight = (await command('SNAPSHOT')).localProjects.filter(p => p.projectId === pid(8));
  assert.equal(eight.length, 1); assert.equal(eight[0].identityBasis, 'principal');
  pass('START-first-transient-identity-recovery', 'One initial session transport failure recovers on the same valid page without an extra Project card, old-principal reuse or capture toggle.');

  const beforeRestart = await command('SNAPSHOT'); await context.close(); context = null; await launch();
  assert.equal((await command('SNAPSHOT')).settings.captureEnabled, true);
  assert.equal((await command('SNAPSHOT')).localProjects.length, beforeRestart.localProjects.length);
  native = await context.newPage(); await native.goto(projectURL(9)); await seen(9);
  pass('START-full-browser-restart', 'A full isolated browser process restart retains enabled collection and saved Projects; a new Project is collected automatically without permission synchronization from the test.');

  await context.close(); context = null;
  oldSource = join(root, 'baseline-source');
  try { execFileSync('git', ['cat-file', '-e', baseline + '^{commit}'], { stdio: 'pipe' }); } catch { execFileSync('git', ['fetch', '--depth=1', 'origin', baseline], { stdio: 'pipe' }); }
  execFileSync('git', ['worktree', 'add', '--detach', oldSource, baseline], { stdio: 'pipe' });
  await symlink(resolve('node_modules'), join(oldSource, 'node_modules'), 'dir');
  execFileSync(process.execPath, ['scripts/build.mjs'], { cwd: oldSource, stdio: 'pipe' });
  await prepareRuntime(join(oldSource, 'dist')); await launch();
  // This new isolated lifecycle restores the approved old build, with its own initial explicit enable.
  await capture(false); await capture(true);
  native = await context.newPage(); await native.goto(projectURL(10)); const old = await seen(10);
  const oldId = extensionId, oldKey = old.project.key;
  await prepareRuntime(resolve('dist')); await reloadExtension(); assert.equal(extensionId, oldId);
  await fill(10, [10, 110]); const upgraded = await seen(10, [10, 110]);
  assert.equal(upgraded.project.key, oldKey);
  for (const previous of beforeRestart.conversations) {
    const retained = upgraded.snapshot.conversations.find(r => r.key === previous.key); assert.ok(retained);
    for (const field of ['nativeTitle', 'firstSeenAt', 'stableRank', 'activity', 'browserLastVisitAt', 'membership']) assert.deepEqual(retained[field], previous[field]);
  }
  pass('START-in-place-upgrade-retains-local-relations', 'The actual approved 6bc0b29 runtime is replaced at the same isolated path and ID; enabled observation resumes in the existing Project document, preserves its local key and adds the late member without toggling.');
  await start.locator('#settings-trigger').click(); await start.locator('#settings-dialog [data-close]').first().click();
  await start.locator('[data-local-project="' + oldKey + '"]').waitFor();
  pass('START-written-project-reaches-UI', 'The automatically written Project reaches the unmodified Start projection; storage acceptance and visible rendering are checked separately.');
  assert.ok(requests.every(url => url === sessionURL), 'Only the existing bounded session metadata source is requested');
  assert.deepEqual(errors, []);
  pass('START-no-new-source-or-page-errors', 'No accounts roster, conversation API or third-party source is requested; no production page error was recorded.');
  status = 'PASS';
} catch (error) {
  checks.push({ id: 'START-failure', status: 'FAIL', observed: String(error.stack || error) });
  throw error;
} finally {
  if (context) await context.close();
  if (oldSource) { try { execFileSync('git', ['worktree', 'remove', '--force', oldSource], { stdio: 'pipe' }); } catch {} }
  await mkdir('artifacts', { recursive: true });
  await writeFile('artifacts/project-startup-validation.json', JSON.stringify({ status, buildSha: build.sha, dirty: build.dirty, baseline, browserVersion, checks, errors,
    limitations: ['Disposable actual installed production extension; all ChatGPT metadata and identities are synthetic HTTPS fixtures, not renewed real-source certification.', 'Optional permission consent is pregranted only in the temporary manifest. Native first-consent acceptance is not claimed; the production UI first-enable path is exercised.', 'Worker shutdown is forced in the isolated browser, not an assertion about exact natural idle duration.', 'No real user Profile, history, bookmark, IndexedDB, Project or login is modified.'] }, null, 2));
  console.log(JSON.stringify({ status, checks: checks.length, buildSha: build.sha }));
}
