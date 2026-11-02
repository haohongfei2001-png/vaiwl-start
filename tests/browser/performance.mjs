import { chromium } from 'playwright';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { cpus, platform, release, totalmem, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

// Only this isolated test writes synthetic fixtures. The production bundle is unchanged.
const outputPath = 'artifacts/performance-validation.json';
const build = JSON.parse(await readFile('dist/build.json', 'utf8'));
const directory = await mkdtemp(join(tmpdir(), 'vaiwl-performance-'));
const context = await chromium.launchPersistentContext(directory, {
  ...(process.env.VAIWL_CHROMIUM_EXECUTABLE ? { executablePath: process.env.VAIWL_CHROMIUM_EXECUTABLE } : { channel: 'chromium' }),
  headless: true, viewport: { width: 1440, height: 1080 },
  args: ['--no-sandbox', `--disable-extensions-except=${resolve('dist')}`, `--load-extension=${resolve('dist')}`],
});
const errors = [], navigations = [], searches = [];
const percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1];
const summary = values => ({ count: values.length, minMs: Math.min(...values), p50Ms: percentile(values, 0.5), p95Ms: percentile(values, 0.95), maxMs: Math.max(...values) });
const report = {
  buildSha: build.sha, dirty: build.dirty, contract: build.contract,
  buildManifestSha256: createHash('sha256').update(await readFile('dist/build.json')).digest('hex'),
  environment: 'isolated-headless-Chrome-MV3-synthetic-IDB', sourceGate: build.sourceGate,
  machine: { platform: platform(), release: release(), cpuModel: cpus()[0]?.model, logicalCpuCount: cpus().length, memoryBytes: totalmem() },
  dataset: { conversations: 2000, projects: 20, recordsPerProject: 100, scopes: 1, titleLengthCharacters: 17, activity: 'same test day; metadata only' },
  conditions: {
    navigation: 'Twenty fresh extension page documents in one browser profile. IndexedDB already populated; browser and service worker are running. Each document initializes its own JS/DOM and reads the full real IndexedDB through the production owner. Browser/process cold start is excluded.',
    search: 'Twenty loaded-catalog input events, five each: one result, 100 project results, 2000 broad results, and no results. Production input handler runs unchanged. DOM-ready time and presentation through two requestAnimationFrame callbacks are measured separately.',
    observer: 'Test-only document_start MutationObserver timestamps html[data-start-ready=true]; navigation timing entry startTime is the origin. No font/CSS injection, CPU throttling, product code modification or production fixture hook.',
  },
  checks: [], navigationSamples: navigations, searchSamples: searches,
  limitations: ['This uses synthetic directly seeded metadata, not live ChatGPT, real account/source admission or actual user data.', 'Linux Chrome for Testing in headless mode does not establish Mac or Edge performance.', 'One process and warmed profile only; results are not browser launch or cold operating-system cache measurements.', 'Twenty samples provide a bounded engineering check, not a production population latency estimate.'],
};
let failure;
try {
  await context.route(/^https?:\/\//, route => route.abort());
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const extensionId = new URL(worker.url()).host;
  const url = `chrome-extension://${extensionId}/newtab.html`;
  const bootstrap = await context.newPage();
  await bootstrap.goto(url); await bootstrap.waitForSelector('html[data-start-ready="true"]');
  await bootstrap.evaluate(async () => {
    const scope = `scope:${'c'.repeat(64)}`, now = new Date().toISOString();
    const open = indexedDB.open('vaiwl-start', 1);
    const db = await new Promise((resolve, reject) => { open.onsuccess = () => resolve(open.result); open.onerror = () => reject(open.error); });
    const tx = db.transaction(['scopes', 'projects', 'conversations', 'settings', 'revisions'], 'readwrite');
    tx.objectStore('scopes').put({ key: scope, provider: 'chatgpt', principalKey: 'synthetic-perf-principal', contextKey: 'synthetic-perf-context', identity: 'verified', label: 'Performance synthetic library', verifiedAt: now, identityAdapterVersion: 'performance-test-only', contextWitnessId: 'synthetic-witness', state: 'ready' });
    for (let p = 1; p <= 20; p++) {
      const projectId = `g-p-${p.toString(16).padStart(32, '0')}`;
      tx.objectStore('projects').put({ key: `project:${p.toString(16).padStart(64, '0')}`, scopeKey: scope, projectId, nativeTitle: `Perf Project ${String(p).padStart(2, '0')}`, canonicalUrl: `https://chatgpt.com/g/${projectId}/project`, evidenceId: `synthetic-project-${p}`, observedAt: now, membershipCoverage: 'observed-only', stableRank: p, revision: 1 });
      for (let c = 1; c <= 100; c++) {
        const index = (p - 1) * 100 + c, conversationId = `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
        tx.objectStore('conversations').put({ key: `conversation:${index.toString(16).padStart(64, '0')}`, provider: 'chatgpt', conversationId, canonicalUrl: `https://chatgpt.com/c/${conversationId}`, nativeTitle: `Conversation ${String(index).padStart(4, '0')}`, titleBasis: 'native-label', titleObservedAt: now, availability: 'reachable', firstSeenAt: now, lastSeenAt: now, browserLastVisitAt: null, activity: { firstConfirmedOpenAt: now, lastConfirmedOpenAt: now, lastActiveDate: now.slice(0, 10), timeZone: 'UTC' }, stableRank: index, revision: 1, owner: { kind: 'scoped', scopeKey: scope }, ownerKey: scope, membership: { state: 'PROJECT', projectId, evidenceId: `synthetic-project-${p}`, confirmedAt: now }, membershipState: 'PROJECT', projectId, lastActiveAt: now });
      }
    }
    const setting = tx.objectStore('settings').get('main'); setting.onsuccess = () => tx.objectStore('settings').put({ ...setting.result, selectedScope: scope, libraryTimeZone: 'UTC', currentSegment: 0 });
    tx.objectStore('revisions').put({ key: 'main', value: 1, nextRank: 2001 });
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = () => reject(tx.error); }); db.close();
  });
  await bootstrap.close();
  await context.addInitScript(() => {
    const observer = new MutationObserver(() => {
      if (document.documentElement?.dataset.startReady === 'true') { globalThis.__vaiwlPerformanceReady = performance.now(); observer.disconnect(); }
    });
    observer.observe(document, { subtree: true, attributes: true, attributeFilter: ['data-start-ready'] });
  });
  let searchPage;
  for (let index = 0; index < 20; index++) {
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    await page.goto(url); await page.waitForFunction(() => Number.isFinite(globalThis.__vaiwlPerformanceReady));
    const sample = await page.evaluate(() => ({ readyMs: globalThis.__vaiwlPerformanceReady - (performance.getEntriesByType('navigation')[0]?.startTime ?? 0), renderedProjects: document.querySelectorAll('.project').length, coreControlsReady: !!document.getElementById('search-trigger') && !!document.getElementById('period-older') }));
    if (sample.renderedProjects !== 20 || !sample.coreControlsReady) throw Error('Performance fixture did not render the expected real production UI');
    navigations.push({ index: index + 1, ...sample });
    if (index < 19) await page.close(); else searchPage = page;
  }
  await searchPage.locator('#search-trigger').click();
  await searchPage.locator('#search-input').waitFor();
  const inputs = Array.from({ length: 5 }, (_, i) => [
    { query: `Conversation ${String(i * 317 + 1).padStart(4, '0')}`, kind: 'single-title', expectedCount: 1 },
    { query: `Perf Project ${String(i * 3 + 1).padStart(2, '0')}`, kind: 'project-100', expectedCount: 100 },
    { query: 'Conversation', kind: 'broad-2000', expectedCount: 2000 },
    { query: `absent-query-${i}`, kind: 'no-results', expectedCount: 0 },
  ]).flat();
  for (const [index, input] of inputs.entries()) {
    const sample = await searchPage.evaluate(async query => {
      const field = document.getElementById('search-input');
      const start = performance.now(); field.value = query; field.dispatchEvent(new Event('input', { bubbles: true }));
      const domReadyMs = performance.now() - start;
      const resultCount = document.querySelectorAll('#search-results .search-result').length;
      const resultContainer = document.getElementById('search-results');
      const totalMatches = Number(resultContainer.dataset.totalMatches);
      const visibleMatches = Number(resultContainer.dataset.visibleMatches);
      const hasMore = !!document.getElementById('search-more');
      // Two animation frames include a paint opportunity for the updated feedback.
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return { domReadyMs, presentedMs: performance.now() - start, resultCount, totalMatches, visibleMatches, hasMore };
    }, input.query);
    const expectedVisible = Math.min(input.expectedCount, 100);
    if (sample.resultCount !== expectedVisible || sample.visibleMatches !== expectedVisible || sample.totalMatches !== input.expectedCount || sample.hasMore !== (input.expectedCount > 100)) throw Error(`Search result mismatch for ${input.kind}: visible=${sample.resultCount}, total=${sample.totalMatches}`);
    searches.push({ index: index + 1, kind: input.kind, query: input.query, expectedCount: input.expectedCount, ...sample });
  }
  // Verify progressive disclosure preserves access to every result, outside timing samples.
  await searchPage.locator('#search-input').fill('Conversation');
  await searchPage.locator('#search-more').click();
  const afterMore = await searchPage.locator('#search-results .search-result').count();
  if (afterMore !== 200) throw Error(`Show More must reveal 200 results, got ${afterMore}`);
  while (await searchPage.locator('#search-more').count()) await searchPage.locator('#search-more').click();
  const allRows = await searchPage.locator('#search-results .search-result').count();
  const uniqueKeys = await searchPage.locator('#search-results .search-result').evaluateAll(rows => new Set(rows.map(row => row.getAttribute('data-record-key'))).size);
  if (allRows !== 2000 || uniqueKeys !== 2000) throw Error('Search pagination truncated or duplicated the complete result set');
  await searchPage.locator('#search-input').fill('Conversation 1999');
  if (await searchPage.locator('#search-results .search-result').count() !== 1 || !(await searchPage.locator('#search-results').textContent()).includes('Conversation 1999')) throw Error('Search cannot reach a record beyond the initial page');
  await searchPage.locator('#search-input').fill('Conversation');
  if (await searchPage.locator('#search-results .search-result').count() !== 100) throw Error('Changed query must reset visible result limit');
  report.checks.push({ id: 'PERF-full-search-set-reachable', status: 'PASS', observed: 'Initial 100, explicit +100, all 2000 unique rows reachable, record 1999 independently searchable, query change resets to 100.' });
  const navigation = summary(navigations.map(row => row.readyMs)), searchDOM = summary(searches.map(row => row.domReadyMs)), searchPresented = summary(searches.map(row => row.presentedMs));
  report.navigation = navigation; report.searchDOM = searchDOM; report.searchPresented = searchPresented;
  report.searchByKind = Object.fromEntries([...new Set(searches.map(row => row.kind))].map(kind => [kind, { dom: summary(searches.filter(row => row.kind === kind).map(row => row.domReadyMs)), presented: summary(searches.filter(row => row.kind === kind).map(row => row.presentedMs)) }]));
  report.checks.push({ id: 'PERF-newtab-2000-20', status: navigation.p95Ms <= 500 ? 'PASS' : 'FAIL', thresholdMs: 500, observedP95Ms: navigation.p95Ms, metric: 'navigationStart to html[data-start-ready=true]' });
  report.checks.push({ id: 'PERF-search-feedback', status: searchPresented.p95Ms <= 100 ? 'PASS' : 'FAIL', thresholdMs: 100, observedP95Ms: searchPresented.p95Ms, metric: 'input dispatch through DOM update and two animation-frame callbacks' });
  report.checks.push({ id: 'PERF-search-dom', status: searchDOM.p95Ms <= 100 ? 'PASS' : 'FAIL', thresholdMs: 100, observedP95Ms: searchDOM.p95Ms, metric: 'synchronous production input handler DOM feedback' });
  report.checks.push({ id: 'PERF-no-page-errors', status: errors.length ? 'FAIL' : 'PASS', observed: errors.length });
  report.status = report.checks.every(check => check.status === 'PASS') ? 'PASS' : 'FAIL';
} catch (error) { failure = error; report.status = 'FAIL'; report.error = error.message; }
finally {
  report.browser = await context.browser()?.version();
  report.errors = errors; report.finishedAt = new Date().toISOString();
  await mkdir('artifacts', { recursive: true }); await writeFile(outputPath, JSON.stringify(report, null, 2));
  await context.close();
}
console.log(JSON.stringify({ status: report.status, buildSha: report.buildSha, dirty: report.dirty, browser: report.browser, navigation: report.navigation, searchDOM: report.searchDOM, searchPresented: report.searchPresented, checks: report.checks, artifact: outputPath, ...(report.error ? { error: report.error } : {}) }));
if (failure || report.status !== 'PASS') process.exitCode = 1;
