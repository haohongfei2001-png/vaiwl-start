/** Installed runtime, repeated native-page sync, isolated HTTPS source fixtures.
 * This is real browser execution with synthetic HTTP responses, not a live account.
 * No production task, browser Profile, credential or source plan is modified. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:https';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { seedLayoutCatalog } from './layout-fixture.mjs';

const family = process.env.VAIWL_TEST_BROWSER_FAMILY || 'chrome';
const output = resolve('artifacts', 'task-sync-quality', family);
const build = JSON.parse(await readFile('dist/build.json', 'utf8'));
const scratch = await mkdtemp(join(tmpdir(), 'vaiwl-sync-quality-'));
const harness = join(scratch, 'extension');
const cid = '00000000-0000-4000-8000-000000000001', tid = 'quality-sync-task';
const createdBase = Date.now();
const initialBody = '隔离浏览器中的合成成果：研究团队发布了新的对照实验，可以继续核对计算方法。';
const checks = [], errors = [], requests = [], cycles = [], activation = [], inputSamples = [];
let context, page, worker, server, cdp, failure, nativeFailure = null, held = null, releaseHeld;
let body = initialBody, run = 0, seenResult = 0;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const check = (id, pass, observed) => { checks.push({ id, status: pass ? 'PASS' : 'FAIL', observed }); assert.ok(pass, id + ': ' + JSON.stringify(observed)); };
const until = async (probe, name, timeout = 25000) => { const end = Date.now() + timeout;
  while (Date.now() < end) { const value = await probe(); if (value) return value; await pause(40); } throw Error('Timed out: ' + name); };
const request = (command, fields = {}, target = page) => target.evaluate(async ({ command, fields }) => {
  const reply = await chrome.runtime.sendMessage({ protocol: 'vaiwl-tasks/1', command, ...fields });
  if (!reply?.ok) throw Error(reply?.code || 'EMPTY_RESPONSE'); return reply.data;
}, { command, fields });
const sourceTabs = () => page.evaluate(() => chrome.tabs.query({ url: 'https://chatgpt.com/*' }));
const cycleReleased = () => page.evaluate(async () => {
  const [local, session] = await Promise.all([chrome.storage.local.get('tasks.schedule.v1'), chrome.storage.session.get('tasks.ownedTabs')]);
  return !local['tasks.schedule.v1']?.lease && !session['tasks.ownedTabs']?.length;
});
const sourceCount = path => requests.filter(request => request.path === path).length;
const sourceTask = () => ({ id: tid, title: '研究动态追踪', team_id: null, conversation_id: cid, is_enabled: true,
  schedule: 'RRULE:FREQ=DAILY', default_timezone: 'UTC', next_run_times: [], last_run_time: new Date(createdBase - 3600000 + run * 1000).toISOString() });
const sourceResult = () => ({ conversation_id: cid, current_node: 'final-message', mapping: {
  'final-message': { parent: null, message: { id: 'final-' + run, author: { role: 'assistant' }, channel: 'final', recipient: 'all', end_turn: true,
    status: 'finished_successfully', create_time: Math.floor(createdBase / 1000) - 3600 + run,
    metadata: { automation_id: tid, working_turn_id: 'turn-' + run, is_complete: true }, content: { content_type: 'text', parts: [body] } } },
} });
const finishSync = since => until(async () => { const snapshot = await request('SNAPSHOT');
  return snapshot.sync.attemptedAt >= since && ['ok', 'error'].includes(snapshot.sync.status) ? snapshot : false;
}, 'sync completion', 55000);
async function sync(label, parallel = 1) {
  await until(cycleReleased, 'previous cycle resources released');
  const start = performance.now(), offset = requests.length;
  let calls = 0;
  const since = await until(async () => {
    const since = new Date().toISOString();
    const replies = await Promise.all(Array.from({ length: parallel }, () => request('SYNC'))); calls += parallel;
    if (replies.some(reply => reply.started === false)) throw Error('Unexpected sync cooldown: ' + JSON.stringify(replies));
    return replies.some(reply => reply.started && !reply.coalesced) ? since : false;
  }, 'fresh sync round accepted');
  const snapshot = await finishSync(since);
  await until(async () => !(await sourceTabs()).length, 'temporary pages released');
  await until(cycleReleased, 'completed cycle resources released');
  cycles.push({ label, durationMs: performance.now() - start, calls, sourceRequests: requests.slice(offset), status: snapshot.sync.status, code: snapshot.sync.code });
  return snapshot;
}
const foregroundMetrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(metric => [metric.name, metric.value]));

try {
  await mkdir(output, { recursive: true }); await cp(resolve('dist'), harness, { recursive: true });
  for (const [file, digest] of Object.entries(build.files)) assert.equal(createHash('sha256').update(await readFile(join(harness, file))).digest('hex'), digest);
  const manifest = JSON.parse(await readFile(join(harness, 'manifest.json'), 'utf8'));
  manifest.permissions.push('scripting', 'alarms'); manifest.optional_permissions = manifest.optional_permissions.filter(p => !['scripting', 'alarms'].includes(p));
  manifest.host_permissions = ['https://chatgpt.com/*']; delete manifest.optional_host_permissions;
  await writeFile(join(harness, 'manifest.json'), JSON.stringify(manifest));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(scratch, 'key.pem'), '-out', join(scratch, 'cert.pem'), '-days', '1', '-subj', '/CN=chatgpt.com'], { stdio: 'ignore' });
  server = createServer({ key: await readFile(join(scratch, 'key.pem')), cert: await readFile(join(scratch, 'cert.pem')) }, async (req, res) => {
    const url = new URL('https://chatgpt.com' + req.url);
    const entry = { path: url.pathname, query: url.search, method: req.method, startedAt: new Date().toISOString(), responseBytes: 0 };
    requests.push(entry);
    const send = (status, payload, type = 'application/json', headers = {}) => { const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
      entry.status = status; entry.responseBytes = Buffer.byteLength(text); entry.completedAt = new Date().toISOString();
      if (!res.destroyed) { res.writeHead(status, { 'content-type': type, ...headers }); res.end(text); } };
    try {
      if (url.pathname === '/api/auth/session') return send(200, { user: { id: 'synthetic-quality-sync-account' }, expires: '2099-01-01T00:00:00Z' });
      if (url.pathname === '/backend-api/automations') {
        if (nativeFailure === 'rate') return send(429, {}, 'application/json', { 'retry-after': '120' });
        if (nativeFailure === 'schema') return send(200, { unexpected: [] });
        return send(200, { items: url.searchParams.get('filter') === 'scheduled' ? [sourceTask()] : [], cursor: null });
      }
      if (url.pathname === '/backend-api/conversation/' + cid) {
        seenResult++;
        if (nativeFailure === 'network') { entry.status = 'network-error'; res.destroy(); return; }
        if (held) await held;
        return send(200, sourceResult());
      }
      if (url.pathname === '/scheduled' || url.pathname === '/c/' + cid) {
        const calls = url.pathname === '/scheduled' ? ['scheduled', 'paused', 'finished'].map(filter => `fetch('/backend-api/automations?filter=${filter}&limit=25').catch(()=>{})`).join(';') : `fetch('/backend-api/conversation/${cid}').catch(()=>{})`;
        return send(200, '<!doctype html><title>Synthetic native source</title><script>' + calls + '</script>', 'text/html');
      }
      return send(404, 'Synthetic fixture has no such source', 'text/plain');
    } catch (error) { errors.push(String(error)); send(500, 'Fixture error', 'text/plain'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  context = await chromium.launchPersistentContext(join(scratch, 'profile'), {
    ...(process.env.VAIWL_CHROMIUM_EXECUTABLE ? { executablePath: process.env.VAIWL_CHROMIUM_EXECUTABLE } : { channel: process.env.VAIWL_BROWSER_CHANNEL || 'chromium' }),
    headless: true, ignoreHTTPSErrors: true, locale: 'zh-CN', timezoneId: 'UTC', viewport: { width: 1470, height: 900 },
    args: ['--no-sandbox', '--ignore-certificate-errors', '--proxy-server=direct://', `--host-resolver-rules=MAP chatgpt.com 127.0.0.1:${port}, MAP * ~NOTFOUND, EXCLUDE localhost`, '--disable-extensions-except=' + harness, '--load-extension=' + harness],
  });
  worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  page = await context.newPage(); page.on('pageerror', error => errors.push(String(error)));
  await page.goto(new URL('newtab.html', worker.url()).href); await page.waitForSelector('html[data-start-ready="true"]');
  await seedLayoutCatalog(page, 'typical', new Date().toISOString()); await page.reload();
  await page.waitForSelector('.spatial-project-grid .project');
  cdp = await context.newCDPSession(page); await cdp.send('Performance.enable', { timeDomain: 'threadTicks' });
  const firstStart = performance.now(), firstOffset = requests.length, enabledSince = new Date().toISOString();
  await request('CONFIGURE', { patch: { enabled: true, automatic: true } });
  // The real home also sends HOME_OPEN after enablement. Its due check joins the
  // same first read; forcing a fresh manual round would count an extra requested read.
  await request('HOME_OPEN');
  const initial = await finishSync(enabledSince);
  await until(async () => !(await sourceTabs()).length && await cycleReleased(), 'first cycle resources released');
  cycles.push({ label: 'first-source-read', trigger: 'HOME_OPEN', durationMs: performance.now() - firstStart, calls: 1,
    sourceRequests: requests.slice(firstOffset), status: initial.sync.status, code: initial.sync.code });
  check('real-installed-source-read', initial.sync.status === 'ok' && initial.tasks[0].latestAvailableResult.preview === initialBody, initial.sync);
  await page.locator('.task-featured').waitFor();
  await page.evaluate(() => { window.__syncActivated = []; chrome.tabs.onActivated.addListener(info => window.__syncActivated.push(info.tabId)); });
  await page.bringToFront();

  // Hold an ordinary native result HTTP response. The UI still has its previous
  // verified cache, so any wait, focus steal or layout shift is directly observed.
  held = new Promise(resolve => { releaseHeld = resolve; });
  const resultBefore = seenResult, requestsBefore = requests.length, since = new Date().toISOString(), started = performance.now();
  run++;
  await page.locator('#search-trigger').click(); await page.locator('#search-input').focus();
  const focusedTab = await page.evaluate(async () => (await chrome.tabs.getCurrent()).id);
  const geometryBefore = await page.locator('.spatial-project-grid').boundingBox();
  const cpuBefore = await foregroundMetrics();
  await Promise.all(Array.from({ length: 8 }, () => request('SYNC')));
  await until(() => seenResult > resultBefore, 'held native result');
  await page.evaluate(() => { window.__syncInputs = []; document.querySelector('#search-input').addEventListener('input', event => {
    const start = event.timeStamp; requestAnimationFrame(() => requestAnimationFrame(() => window.__syncInputs.push({ trusted: event.isTrusted, durationMs: performance.now() - start }))); }); });
  await page.locator('#search-input').pressSequentially('research', { delay: 20 });
  await until(() => page.evaluate(() => window.__syncInputs.length === 8), 'measured trusted input');
  inputSamples.push(...await page.evaluate(() => window.__syncInputs));
  check('sync-preserves-input-and-browser-focus', await page.locator('#search-input').inputValue() === 'research' && await page.evaluate(async id =>
    document.activeElement === document.querySelector('#search-input') && (await chrome.tabs.query({ active: true, currentWindow: true })).some(tab => tab.id === id), focusedTab), inputSamples);
  check('sync-keeps-cached-result-visible', (await page.locator('.task-featured').innerText()) === initialBody, true);
  check('sync-keeps-workspace-position', JSON.stringify(geometryBefore) === JSON.stringify(await page.locator('.spatial-project-grid').boundingBox()), geometryBefore);
  const scheduledReads = requests.slice(requestsBefore).filter(request => request.path === '/scheduled').length;
  check('eight-refreshes-merge-one-native-round', scheduledReads === 1 && seenResult === resultBefore + 1 && (await sourceTabs()).length === 1, { scheduledReads, resultReads: seenResult - resultBefore, pages: await sourceTabs() });
  await page.keyboard.press('Escape');
  await page.locator('.task-featured').click(); await page.locator('#task-result-dialog[open]').waitFor();
  body = '新的合成成果已经返回，阅读中的旧正文应保持原位。';
  releaseHeld(); held = null;
  const completed = await finishSync(since); await until(async () => !(await sourceTabs()).length, 'combined pages released');
  const cpuAfter = await foregroundMetrics();
  cycles.push({ label: 'eight-concurrent-manual-refreshes', durationMs: performance.now() - started, calls: 8, sourceRequests: requests.slice(requestsBefore),
    foregroundScriptCpuMs: (cpuAfter.ScriptDuration - cpuBefore.ScriptDuration) * 1000, foregroundTaskCpuMs: (cpuAfter.TaskDuration - cpuBefore.TaskDuration) * 1000,
    heapBefore: cpuBefore.JSHeapUsedSize, heapAfter: cpuAfter.JSHeapUsedSize, status: completed.sync.status });
  check('new-result-does-not-replace-open-reading', await page.locator('#task-result-body').innerText() === initialBody && completed.tasks[0].latestAvailableResult.preview === body, true);
  await page.locator('#task-result-close').click(); await page.locator('.task-featured').click();
  check('reopening-reads-new-result', await page.locator('#task-result-body').innerText() === body, true);
  await page.locator('#task-result-close').click();

  for (let repeat = 0; repeat < 5; repeat++) {
    const result = await sync('continuous-read-' + (repeat + 1));
    check('continuous-sync-' + (repeat + 1), result.sync.status === 'ok' && result.tasks[0].latestAvailableResult.preview === body && !(await sourceTabs()).length, result.sync);
  }
  activation.push(...await page.evaluate(() => window.__syncActivated));
  check('temporary-pages-never-activated', activation.every(id => id === focusedTab), activation);

  nativeFailure = 'network';
  const failed = await sync('network-interruption');
  check('network-failure-retains-result', failed.sync.code === 'NETWORK_ERROR' && failed.tasks[0].latestAvailableResult.preview === body, failed.sync);
  const attempts = requests.length;
  const retries = await Promise.allSettled(Array.from({ length: 8 }, () => request('SYNC')));
  await pause(150);
  check('failure-backoff-stops-immediate-repeat-pages', requests.length === attempts, retries.map(r => r.status));
  const target = (await cdp.send('Target.getTargets')).targetInfos.find(target => target.type === 'service_worker' && target.url === worker.url());
  assert.ok(target); await cdp.send('Target.closeTarget', { targetId: target.targetId });
  await request('SNAPSHOT'); await request('SYNC').catch(() => {}); await pause(150);
  check('failure-backoff-survives-worker-restart', requests.length === attempts, true);
  nativeFailure = null;
  const normal = await context.newPage(); await normal.goto(`https://chatgpt.com/c/${cid}?automationId=${tid}`);
  const recovered = await until(async () => { const snapshot = await request('SNAPSHOT'); return snapshot.sync.status === 'ok' ? snapshot : false; }, 'normal-page recovery');
  check('normal-source-visit-recovers-failure', recovered.tasks[0].latestAvailableResult.preview === body, recovered.sync);
  await normal.close();
  check('all-source-requests-read-only', requests.every(request => request.method === 'GET'), requests.length);
  check('no-runtime-errors', errors.length === 0, errors);
} catch (error) {
  failure = String(error?.stack || error); console.error(failure);
  if (page && !page.isClosed()) await page.screenshot({ path: join(output, 'failure.png') }).catch(() => {});
} finally {
  releaseHeld?.();
  if (context) await context.close();
  if (server) await new Promise(resolve => { server.closeAllConnections(); server.close(resolve); });
  await mkdir(output, { recursive: true });
  await writeFile(join(output, 'receipt.json'), JSON.stringify({ status: failure ? 'FAIL' : 'PASS', family, buildSha: build.sha, dirty: build.dirty,
    cpuTimeDomain: 'threadTicks', checks, errors, failure, cycles, inputSamples, requests, activation,
    limitations: ['Synthetic native HTTP fixture in a fresh installed Linux browser; not live ChatGPT or the user\'s Profile.',
      'Durations include real browser work but fixture network timing, including one deliberately held response.',
      'Foreground CPU/JS heap measures input impact, not whole-browser or Service Worker CPU.',
      'Repeated cycles are a bounded stress check, not a multi-day stability certification.'],
  }, null, 2));
  await rm(scratch, { recursive: true, force: true });
}
if (failure) process.exitCode = 1;
