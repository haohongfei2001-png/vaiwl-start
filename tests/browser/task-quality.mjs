/**
 * Task quality benchmark: real installed-extension rendering and trusted input,
 * in a disposable browser profile. All catalogue/task/body data are synthetic.
 *
 * VAIWL_QUALITY_RUNTIME selects a clean built baseline; the default is dist/.
 * A CI runner executes the same harness, browser and fixture against both builds.
 * Measured time is never injected into the application or replaced with a budget.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { cpus, platform, release, tmpdir, totalmem } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { classify, createStore, ingest } from '../../research/chatgpt-tasks/result-model.mjs';
import { seedLayoutCatalog } from './layout-fixture.mjs';

const family = process.env.VAIWL_TEST_BROWSER_FAMILY || 'chrome';
const label = process.env.VAIWL_QUALITY_LABEL || 'candidate';
const runtime = resolve(process.env.VAIWL_QUALITY_RUNTIME || 'dist');
const output = resolve('artifacts', 'task-quality', family, label);
const build = JSON.parse(await readFile(join(runtime, 'build.json'), 'utf8'));
const checks = [], errors = [], samples = {}, screenshots = [], metrics = {}, network = [];
const scratch = await mkdtemp(join(tmpdir(), 'vaiwl-task-quality-'));
const harness = join(scratch, 'extension'), profile = join(scratch, 'profile');
const wide = { width: 1470, height: 900 };
const names = ['行业动态简报', '每周论文追踪', '项目进度摘要', '产品反馈观察', '市场晨报', '周会纪要', '研究进展', '招聘动态', '阅读计划', '发布记录'];
const paragraph = '本周有两条值得跟进的进展：研究团队公布了完整对照实验，新的复现数据已随论文发布。下一步可以先核对误差定义，再检查实验设置与已有结果的差异。';
const anchor = Date.now();
const at = offset => new Date(anchor + offset).toISOString();
const baseline = label === 'baseline';
let context, page, worker, cdp, failure;

const record = (id, passed, observed) => {
  checks.push({ id, status: passed ? 'PASS' : 'FAIL', observed });
  // The old build is a control, not the acceptance gate for the new product.
  if (!baseline) assert.ok(passed, `${id}: ${JSON.stringify(observed)}`);
};
const round = x => typeof x === 'number' ? Math.round(x * 100) / 100 : x;
const stats = values => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return { n: 0 };
  const percentile = p => sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)];
  return { n: sorted.length, min: round(sorted[0]), p50: round(percentile(.5)), p95: round(percentile(.95)), max: round(sorted.at(-1)) };
};
const until = async (probe, description, ms = 15000) => {
  const end = Date.now() + ms;
  do { const result = await probe(); if (result) return result; await new Promise(r => setTimeout(r, 25)); } while (Date.now() < end);
  throw Error('Timed out: ' + description);
};
const request = (command, fields = {}) => page.evaluate(async ({ command, fields }) => {
  const result = await chrome.runtime.sendMessage({ protocol: 'vaiwl-tasks/1', command, ...fields });
  if (!result?.ok) throw Error(result?.code || 'EMPTY_RESPONSE');
  return result.data;
}, { command, fields });

function taskFixture(count, { results = true, failed = false, stale = false, automatic = false } = {}) {
  const principal = 'synthetic-quality', scope = { provider: 'chatgpt', profileId: 'browser-profile', accountId: principal + ':personal' };
  const catalog = {}, keys = [], syncedAt = at(stale ? -8 * 86400000 : -60000);
  const staleOffset = stale ? -8 * 86400000 : 0;
  let model = createStore();
  for (let i = 0; i < count; i++) {
    const id = 'synthetic-quality-' + i, key = JSON.stringify([principal, null, id]);
    const task = { id, title: names[i % names.length] + (i < names.length ? '' : ' · 专题'), is_enabled: i % 7 !== 6,
      default_timezone: 'UTC', schedule: 'RRULE:FREQ=DAILY', last_run_time: at(staleOffset - 3600000 - i * 120000), next_run_time: null,
      team_id: null, conversation_id: '00000000-0000-4000-8000-' + String(i + 1).padStart(12, '0') };
    keys.push(key);
    catalog[key] = { key, scope, task, observedAt: syncedAt, resultSyncedAt: results ? syncedAt : null, readOutcome: results ? 'unchanged' : undefined };
    if (!results) model = ingest(model, { scope, observedAt: syncedAt, tasks: [task] });
    else for (let revision = 0; revision < 6; revision++) {
      const createdAt = at(staleOffset - 3600000 - i * 120000 - (5 - revision) * 86400000);
      const body = i === 0 && revision === 5 ? '本次复查没有新的内容。' : paragraph + '\n\n' +
        ['## 本次发现', paragraph, '## 值得跟进', paragraph, '来源：https://example.com/research'].join('\n\n').repeat(5);
      const runId = 'quality-run-' + revision;
      model = ingest(model, { scope, observedAt: syncedAt, tasks: [{ ...task, run_details: { latest_result:
        { run_id: runId, created_at: createdAt, content_text: body, chat_ref: { type: 'chatgpt', id: task.conversation_id } } } }] });
      if (i === 0 && revision === 4) model = classify(model, { scope, taskId: id, runId, resultRevision: 1,
        outcome: 'new_information', classifiedAt: syncedAt, evidence: { kind: 'user', reference: 'synthetic-quality-choice' } });
      if (i === 0 && revision === 5) model = classify(model, { scope, taskId: id, runId, resultRevision: 1,
        outcome: 'no_new_information', classifiedAt: syncedAt, evidence: { kind: 'user', reference: 'synthetic-quality-choice' } });
    }
  }
  const filters = Object.fromEntries(['scheduled', 'finished', 'paused'].map(key => [key, { cursor: null, firstPage: true, observedAt: syncedAt }]));
  return { version: 1, generation: 0, principal, catalog, model, sourceEvidence: {}, coverage: { [principal]: { filters, at: syncedAt } },
    settings: { enabled: true, automatic, showWidget: true, preview: true, selections: { [principal]: keys.slice(0, 10) } },
    sync: { status: failed ? 'error' : 'ok', code: failed ? 'NETWORK_ERROR' : null, mode: 'visit', attemptedAt: syncedAt, succeededAt: syncedAt } };
}

async function installProbe(target) {
  await target.addInitScript(() => {
    const timings = { started: performance.now(), mainReady: null, workspacePaint: null, taskPaint: null, shifts: [], longTasks: [] };
    window.__taskQuality = timings;
    try { new PerformanceObserver(list => { for (const e of list.getEntries()) if (!e.hadRecentInput) timings.shifts.push({ value: e.value, at: e.startTime }); }).observe({ type: 'layout-shift', buffered: true }); } catch {}
    try { new PerformanceObserver(list => { for (const e of list.getEntries()) timings.longTasks.push({ duration: e.duration, at: e.startTime }); }).observe({ type: 'longtask', buffered: true }); } catch {}
    const painted = new Set();
    const observe = () => {
      if (timings.mainReady === null && document.documentElement?.dataset.startReady === 'true') timings.mainReady = performance.now();
      for (const [key, selector] of [['workspacePaint', '.spatial-project-grid .project'], ['taskPaint', '.task-featured']]) {
        const node = document.querySelector(selector);
        if (!painted.has(key) && node?.getBoundingClientRect().width && node.textContent.trim()) {
          painted.add(key); requestAnimationFrame(() => requestAnimationFrame(() => { timings[key] = performance.now(); }));
        }
      }
    };
    const observer = new MutationObserver(observe);
    observer.observe(document, { childList: true, subtree: true, attributes: true, characterData: true });
    addEventListener('DOMContentLoaded', observe, { once: true });
    // The measurement observer is removed after both content areas appear. It is
    // identical for baseline and candidate and never changes the rendered state.
    const finish = () => { if (timings.workspacePaint !== null && timings.taskPaint !== null) observer.disconnect(); else setTimeout(finish, 25); };
    setTimeout(finish, 25);
  });
}

async function launch() {
  context = await chromium.launchPersistentContext(profile, {
    ...(process.env.VAIWL_CHROMIUM_EXECUTABLE ? { executablePath: process.env.VAIWL_CHROMIUM_EXECUTABLE } : { channel: process.env.VAIWL_BROWSER_CHANNEL || 'chromium' }),
    headless: true, locale: 'zh-CN', timezoneId: 'UTC', viewport: wide,
    args: ['--no-sandbox', '--host-resolver-rules=MAP * ~NOTFOUND', '--disable-extensions-except=' + harness, '--load-extension=' + harness],
  });
  // Network is deliberately unavailable for cache measurements. Requests are
  // counted independently; a failure never turns a slow test into a synthetic pass.
  context.on('request', req => { if (/^https?:/.test(req.url())) network.push({ url: new URL(req.url()).origin + new URL(req.url()).pathname, at: Date.now() }); });
  worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  page = await context.newPage();
  page.on('pageerror', error => errors.push(String(error)));
  await installProbe(page);
  cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  await page.goto(new URL('newtab.html', worker.url()).href);
  await page.waitForSelector('html[data-start-ready="true"]');
}

async function seed(state) {
  await page.evaluate(async state => {
    const db = await new Promise((resolve, reject) => { const r = indexedDB.open('vaiwl-start-chatgpt-tasks', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('state'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const tx = db.transaction('state', 'readwrite');
    // Clear only this disposable task store so a new summary projection cannot
    // accidentally measure a previous fixture. Production schema/migration loads it.
    tx.objectStore('state').clear(); tx.objectStore('state').put(state, 'current');
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = () => reject(tx.error); }); db.close();
    await chrome.storage.local.set({ 'tasks.enabled': state.settings.enabled });
  }, state);
  await page.reload();
  await page.waitForSelector('html[data-start-ready="true"]');
  if (Object.keys(state.catalog).length) await page.locator('.task-toggle').waitFor();
}

async function stable() { await page.evaluate(async () => { await document.fonts.ready; await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); }); }
async function capture(name) {
  await stable(); await page.screenshot({ path: join(output, name + '.png'), animations: 'disabled' }); screenshots.push(name + '.png');
}
async function theme(value) {
  await page.evaluate(v => chrome.storage.local.set({ 'native.homeTheme': v }), value);
  await page.waitForFunction(v => document.documentElement.dataset.homeTheme === v, value); await stable();
}
const geometry = () => page.evaluate(() => Object.fromEntries(['#tasks-home', '#bookmarks-home', '.spatial-project-grid', '.recent-section', '#search-trigger', '#mode-toggle', '#settings-trigger'].map(selector => {
  const rect = document.querySelector(selector)?.getBoundingClientRect();
  return [selector, rect && rect.width ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null];
})));
const browserMetrics = async () => {
  const result = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(metric => [metric.name, metric.value]));
  const dom = await cdp.send('Memory.getDOMCounters');
  return { timestamp: result.Timestamp, taskDurationMs: result.TaskDuration * 1000, scriptDurationMs: result.ScriptDuration * 1000,
    layoutDurationMs: result.LayoutDuration * 1000, recalcStyleMs: result.RecalcStyleDuration * 1000,
    heapUsedBytes: result.JSHeapUsedSize, heapTotalBytes: result.JSHeapTotalSize, documents: dom.documents, nodes: dom.nodes, listeners: dom.jsEventListeners };
};

async function loadSamples(name, count, { expectTask = true } = {}) {
  const rows = [], beforeNetwork = network.length;
  for (let i = 0; i < count; i++) {
    const cpuBefore = await browserMetrics();
    await page.reload();
    await page.waitForSelector('html[data-start-ready="true"]');
    await page.waitForFunction(expectTask => window.__taskQuality?.workspacePaint !== null && (!expectTask || window.__taskQuality?.taskPaint !== null), expectTask);
    const timing = await page.evaluate(() => ({ ...window.__taskQuality, cls: window.__taskQuality.shifts.reduce((sum, item) => sum + item.value, 0) }));
    const browser = await browserMetrics();
    const cpuDelta = key => browser[key] >= cpuBefore[key] ? browser[key] - cpuBefore[key] : browser[key];
    rows.push({ ...timing, browser, cpuBefore, scriptCpuMs: cpuDelta('scriptDurationMs'), rendererCpuMs: cpuDelta('taskDurationMs'),
      layoutCpuMs: cpuDelta('layoutDurationMs'), styleCpuMs: cpuDelta('recalcStyleMs') });
  }
  samples[name] = { raw: rows, mainReadyMs: stats(rows.map(row => row.mainReady)), workspacePaintMs: stats(rows.map(row => row.workspacePaint)),
    taskPaintMs: stats(rows.map(row => row.taskPaint)), scriptCpuMs: stats(rows.map(row => row.scriptCpuMs)),
    rendererCpuMs: stats(rows.map(row => row.rendererCpuMs)), heapUsedBytes: stats(rows.map(row => row.browser.heapUsedBytes)),
    cls: stats(rows.map(row => row.cls)), networkRequests: network.length - beforeNetwork };
  console.log(JSON.stringify({ label, family, scenario: name, ...Object.fromEntries(Object.entries(samples[name]).filter(([key]) => key !== 'raw')) }));
}

async function trustedInteraction(locator, expectedOpen) {
  await page.evaluate(expectedOpen => {
    window.__qualityInteraction = new Promise(resolve => {
      const eventType = expectedOpen ? 'click' : 'keydown';
      const handler = event => {
        if (eventType === 'keydown' && event.key !== 'Escape') return;
        document.removeEventListener(eventType, handler, true);
        const start = event.timeStamp;
        requestAnimationFrame(() => requestAnimationFrame(() => resolve({ trusted: event.isTrusted,
          durationMs: performance.now() - start, open: !!document.querySelector('#task-panel')?.matches(':popover-open') })));
      };
      document.addEventListener(eventType, handler, true);
    });
  }, expectedOpen);
  if (expectedOpen) await locator.click(); else await page.keyboard.press('Escape');
  const result = await page.evaluate(() => window.__qualityInteraction);
  assert.equal(result.trusted, true); assert.equal(result.open, expectedOpen); return result.durationMs;
}

try {
  await mkdir(output, { recursive: true }); await cp(runtime, harness, { recursive: true });
  for (const [name, digest] of Object.entries(build.files)) assert.equal(createHash('sha256').update(await readFile(join(harness, name))).digest('hex'), digest, name);
  const manifest = JSON.parse(await readFile(join(harness, 'manifest.json'), 'utf8'));
  const grants = ['bookmarks', 'scripting', 'alarms'];
  manifest.permissions.push(...grants); manifest.optional_permissions = manifest.optional_permissions.filter(p => !grants.includes(p));
  manifest.host_permissions = manifest.optional_host_permissions; delete manifest.optional_host_permissions;
  await writeFile(join(harness, 'manifest.json'), JSON.stringify(manifest));
  await launch();
  metrics.browserVersion = context.browser()?.version() || await worker.evaluate(() => navigator.userAgent);
  metrics.firstEmptyLoad = await page.evaluate(() => ({ mainReadyMs: window.__taskQuality.mainReady, navigation: performance.getEntriesByType('navigation')[0].toJSON() }));
  await seedLayoutCatalog(page, 'typical', at(0));
  await worker.evaluate(async () => {
    const roots = (await chrome.bookmarks.getTree())[0].children;
    const bar = roots.find(node => node.folderType === 'bookmarks-bar') || roots.find(node => node.id === '1');
    for (const title of ['文献资料', '设计参考', '开发文档', '工作手册']) await chrome.bookmarks.create({ parentId: bar.id, title });
    await chrome.storage.local.set({ 'native.bookmarks': 'newtab', 'native.homeTheme': 'spatial' });
  });
  await seed(taskFixture(10));
  await loadSamples('warmup', 3);
  await loadSamples('cached-ten-tasks', 24);
  record('cache-load-does-not-request-network', samples['cached-ten-tasks'].networkRequests === 0, samples['cached-ten-tasks'].networkRequests);
  const before = await geometry();
  const open = [], close = [];
  for (let i = 0; i < 24; i++) {
    open.push(await trustedInteraction(page.locator('.task-toggle'), true));
    close.push(await trustedInteraction(page.locator('.task-toggle'), false));
  }
  metrics.interaction = { openMs: stats(open), closeMs: stats(close), rawOpenMs: open, rawCloseMs: close };
  record('interaction-does-not-move-home-content', JSON.stringify(await geometry()) === JSON.stringify(before), { before, after: await geometry() });
  metrics.budgets = { warmWorkspaceTargetMs: 300, warmWorkspaceMet: samples['cached-ten-tasks'].workspacePaintMs.p95 <= 300,
    panelInteractionTargetMs: 100, panelInteractionMet: metrics.interaction.openMs.p95 <= 100 && metrics.interaction.closeMs.p95 <= 100 };
  // Budgets are reported with their actual miss, never a correctness-test shortcut.

  for (const variant of ['classic', 'spatial', 'workbench', 'folio']) {
    await theme(variant); await page.setViewportSize(wide); await capture(variant + '-1470-home');
    const closed = await geometry(); await page.locator('.task-toggle').click(); await page.locator('#task-panel').waitFor();
    await capture(variant + '-1470-panel');
    const opened = await geometry();
    record(variant + '-panel-does-not-shift-projects', closed['.spatial-project-grid'].y === opened['.spatial-project-grid'].y, { closed, opened });
    await page.keyboard.press('Escape');
    for (const width of [1920, 1280, 1024, 760, 640, 390, 320]) {
      await page.setViewportSize({ width, height: 900 }); await stable();
      await page.locator('.task-toggle').click(); await page.locator('#task-panel').waitFor();
      const fitting = await page.evaluate(() => { const r = document.querySelector('#task-panel').getBoundingClientRect(); return {
        viewport: innerWidth, page: document.documentElement.scrollWidth, x: r.x, right: r.right, bottom: r.bottom, height: innerHeight }; });
      record(variant + '-' + width + '-bounds', fitting.page <= fitting.viewport + 1 && fitting.x >= 0 && fitting.right <= fitting.viewport + 1 && fitting.bottom <= fitting.height, fitting);
      if (variant === 'spatial' && [1280, 390].includes(width)) await capture(variant + '-' + width + '-panel');
      await page.keyboard.press('Escape');
    }
  }
  await page.setViewportSize(wide); await theme('spatial');
  for (const zoom of [1.25, 1.5, 2]) {
    await page.evaluate(async zoom => chrome.tabs.setZoom((await chrome.tabs.getCurrent()).id, zoom), zoom);
    await stable(); await page.locator('.task-toggle').click(); await page.locator('#task-panel').waitFor();
    record('real-browser-zoom-' + zoom, await page.evaluate(() => { const r = document.querySelector('#task-panel').getBoundingClientRect();
      return document.documentElement.scrollWidth <= innerWidth + 1 && r.x >= 0 && r.right <= innerWidth + 1; }), await page.evaluate(() => ({ width: innerWidth, dpr: devicePixelRatio })));
    await page.keyboard.press('Escape');
  }
  await page.evaluate(async () => chrome.tabs.setZoom((await chrome.tabs.getCurrent()).id, 1));

  await page.locator('.task-featured').click(); await page.locator('#task-result-dialog[open]').waitFor();
  record('full-important-output-readable', (await page.locator('#task-result-body').innerText()).startsWith(paragraph), 'Synthetic retained text is read from the installed extension.');
  record('full-output-has-original-source', !!(await page.locator('#task-result-links a').first().getAttribute('href'))?.includes('automationId='), 'Original task URL retained.');
  await capture('full-output'); await page.locator('#task-result-close').click();
  record('full-output-restores-focus', await page.locator('.task-featured').evaluate(node => node === document.activeElement), true);

  await cdp.send('HeapProfiler.collectGarbage'); metrics.lifecycleBefore = await browserMetrics();
  for (let i = 0; i < 40; i++) {
    await page.locator('.task-toggle').click(); await page.locator('#task-panel').waitFor();
    await page.keyboard.press('Escape');
    // Life mode disposes task DOM/listeners. Re-entering reconstructs the component.
    await page.locator('#mode-toggle').click(); await page.waitForFunction(() => document.documentElement.dataset.homeMode === 'life');
    await page.locator('#mode-toggle').click(); await page.locator('.task-toggle').waitFor();
  }
  await cdp.send('HeapProfiler.collectGarbage'); metrics.lifecycleAfter = await browserMetrics();
  record('component-disposal-listeners-bounded', metrics.lifecycleAfter.listeners - metrics.lifecycleBefore.listeners <= 12, { before: metrics.lifecycleBefore, after: metrics.lifecycleAfter, cycles: 40 });
  record('no-owned-pages-from-cache-or-interactions', !(await worker.evaluate(() => chrome.tabs.query({ url: 'https://chatgpt.com/*' }))).length, true);

  await seed(taskFixture(1)); await loadSamples('cached-one-task', 12); await capture('single-task');
  await seed(taskFixture(30)); await loadSamples('cached-thirty-tasks', 12);
  await context.setOffline(true); await loadSamples('offline-cached', 12);
  record('offline-shows-literal-cache', (await page.locator('.task-featured').innerText()).startsWith(paragraph), true);
  await context.setOffline(false);
  await seed(taskFixture(10, { failed: true })); await loadSamples('sync-failed-cached', 12);
  await page.locator('.task-toggle').click(); await capture('failed-cache-panel'); await page.keyboard.press('Escape');
  await seed(taskFixture(10, { failed: true, stale: true })); await page.locator('.task-toggle').click(); await capture('stale-cache-panel'); await page.keyboard.press('Escape');
  await seed(taskFixture(1, { results: false })); await capture('no-result-home'); await page.locator('.task-toggle').click(); await capture('no-result-panel'); await page.keyboard.press('Escape');
  await seed(taskFixture(0)); await capture('no-tasks-home');
  if (await page.locator('.task-toggle').isVisible()) { await page.locator('.task-toggle').click(); await capture('no-tasks-panel'); await page.keyboard.press('Escape'); }

  await seed(taskFixture(10));
  const cachedBody = await page.locator('.task-featured').innerText();
  const workerUrl = worker.url();
  const workerTarget = (await cdp.send('Target.getTargets')).targetInfos.find(target => target.type === 'service_worker' && target.url === workerUrl);
  assert.ok(workerTarget); await cdp.send('Target.closeTarget', { targetId: workerTarget.targetId });
  await request('SNAPSHOT');
  await page.reload(); await page.locator('.task-featured').waitFor();
  record('worker-restart-keeps-cache', await page.locator('.task-featured').innerText() === cachedBody, true);
  await context.close(); context = null;
  await launch(); await page.locator('.task-featured').waitFor();
  record('browser-restart-keeps-cache', await page.locator('.task-featured').innerText() === cachedBody, true);
  await request('CONFIGURE', { patch: { automatic: true } });
  const concurrentStart = network.length;
  const pages = await Promise.all(Array.from({ length: 8 }, async () => {
    const next = await context.newPage(); await next.goto(new URL('newtab.html', worker.url()).href); await next.locator('.task-featured').waitFor(); return next;
  }));
  record('eight-newtabs-show-cache-without-source-requests', network.length === concurrentStart, { tabs: pages.length, networkRequests: network.length - concurrentStart });
  await Promise.all(pages.map(p => p.close()));
  record('no-page-errors', errors.length === 0, errors);
} catch (error) {
  failure = String(error?.stack || error);
  console.error(failure);
  if (page && !page.isClosed()) await page.screenshot({ path: join(output, 'failure.png') }).catch(() => {});
} finally {
  await mkdir(output, { recursive: true });
  await writeFile(join(output, 'receipt.json'), JSON.stringify({ status: failure ? 'FAIL' : 'PASS', label, family,
    buildSha: build.sha, dirty: build.dirty, recordedAt: new Date().toISOString(), environment: { platform: platform(), release: release(), cpu: cpus()[0]?.model,
      logicalCpus: cpus().length, memoryBytes: totalmem(), headless: true, optionalPermissionsPregranted: true, fixture: 'synthetic, disposable Profile' },
    metrics, samples, checks, screenshots, errors, network, failure,
    limitations: ['Real Linux browser and installed runtime; not the user\'s Mac/Profile or a live ChatGPT service.',
      'Screenshots contain synthetic task and workspace data. Optional permissions are pregranted in the isolated manifest.',
      'Two animation frames approximate visibly committed content; headless CI is not a physical display latency measurement.',
      'CPU is renderer TaskDuration/ScriptDuration; heap is renderer JS heap, not whole-browser RSS.',
      'Budget misses are reported without replacing them with thresholds or failing unrelated correctness checks.',
      'Forty construction/disposal cycles test bounded resources, not multi-day endurance.'],
  }, null, 2));
  if (context) await context.close();
  await rm(scratch, { recursive: true, force: true });
}
if (failure) process.exitCode = 1;
