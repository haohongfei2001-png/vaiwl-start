/** Installed production UI/domain/worker; every catalog, account and HTTPS page is synthetic. */
import { chromium } from 'playwright';
import { mkdtemp, mkdir, cp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { build as bundle } from 'esbuild';
import assert from 'node:assert/strict';

const build = JSON.parse(await readFile('dist/build.json', 'utf8'));
const family = process.env.VAIWL_TEST_BROWSER_FAMILY || 'chrome';
const output = resolve('artifacts', 'home-workspace', family);
await mkdir(output, { recursive: true });
const checks = [], errors = [];
const limitations = [
  'Actual extension installation and production JavaScript; isolated temporary browser Profile, synthetic catalog and intercepted synthetic HTTPS pages only.',
  'The temporary test manifest pre-grants the existing optional ChatGPT connection permissions. Native permission prompt acceptance and a user Mac upgrade are not claimed.',
  'Screenshots show the extension content viewport, not the browser-owned footer or tab strip. Native Chrome footer hiding and Edge tab-strip favicon remain separate platform acceptance.',
  'Catalog seeds exercise twelve-store persistence and UI projection without granting identity authority to ordinary content. No user data or signed-in account is read.',
];
const check = (id, pass, observed) => { assert.ok(pass, `${id}: ${observed}`); checks.push({ id, status: 'PASS', observed }); };
let context, page, worker, browserVersion;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(probe, label, timeout = 10000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const value = await probe(); if (value) return value; await pause(35); }
  throw Error(label);
}
async function command(target, command, payload = {}) {
  return target.evaluate(async ({ command, payload }) => {
    const send = (name, values, revision) => chrome.runtime.sendMessage({ protocol: 'vaiwl-start-internal/1', operationId: crypto.randomUUID(), command: name, payload: values, expectedRevision: revision });
    const snapshot = await send('SNAPSHOT', {}, 0); if (!snapshot.ok) throw Error(snapshot.code);
    const result = await send(command, payload, snapshot.data.revision); if (!result.ok) throw Error(result.code); return result.data;
  }, { command, payload });
}
async function raw(target) {
  return target.evaluate(async () => {
    const db = await new Promise((resolve, reject) => { const r = indexedDB.open('vaiwl-start'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const names = [...db.objectStoreNames], values = {};
    try { await Promise.all(names.map(name => new Promise((resolve, reject) => { const r = db.transaction(name).objectStore(name).getAll(); r.onsuccess = () => { values[name] = r.result; resolve(); }; r.onerror = () => reject(r.error); }))); return { version: db.version, names, values }; }
    finally { db.close(); }
  });
}
async function ready() { await page.waitForSelector('html[data-start-ready="true"]'); }
async function search(query) { await page.locator('#search-trigger').click(); await page.locator('#search-input').fill(query); }
async function closeSearch() { await page.keyboard.press('Escape'); }
async function screenshot(name) { await page.screenshot({ path: join(output, `${name}.png`), fullPage: true }); }
let recordKeys = {};
const key = name => recordKeys[name] || `staging:home-${name}`;
const pkey = name => `local-project:home-${name}`;
async function compareBaselineProjection(target, scopes) {
  const baseline = '17695aeba0b8205c6cbcad7463e89419135d2d7d';
  try { execFileSync('git', ['cat-file', '-e', `${baseline}^{commit}`], { stdio: 'pipe' }); }
  catch { execFileSync('git', ['fetch', '--depth=1', 'origin', baseline], { stdio: 'pipe' }); }
  const directory = await mkdtemp(join(tmpdir(), 'vaiwl-home-comparison-'));
  for (const name of ['projection.ts', 'time.ts']) await writeFile(join(directory, name), execFileSync('git', ['show', `${baseline}:src/domain/${name}`]));
  await bundle({ entryPoints: [join(directory, 'projection.ts')], outfile: join(directory, 'before.mjs'), bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' });
  await bundle({ entryPoints: [resolve('src/domain/projection.ts')], outfile: join(directory, 'after.mjs'), bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' });
  const oldProjection = (await import(pathToFileURL(join(directory, 'before.mjs')).href)).projectCatalog;
  const newProjection = (await import(pathToFileURL(join(directory, 'after.mjs')).href)).projectCatalog;
  const comparisons = [];
  for (const scope of scopes) {
    const snapshot = await command(target, 'SNAPSHOT', { selectedScope: scope });
    const now = new Date().toISOString(), T = Math.floor(Date.parse(now) / 86400000);
    const inventory = project => {
      const groups = new Map();
      for (let k = 0; k <= 3; k++) {
        const projection = project(snapshot, { H: 30, T, Z: 'UTC', k, selectedScope: scope, now });
        for (const card of [...projection.projects, ...projection.localProjects, ...projection.candidateProjects, ...projection.undatedProjects, ...projection.undatedLocalProjects, ...projection.undatedCandidateProjects]) {
          const key = card.project?.key || `candidate:${card.candidate.key}`, members = groups.get(key) || new Set();
          for (const row of [...card.recent, ...card.older, ...card.undated]) members.add(row.key); groups.set(key, members);
        }
      }
      return [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([key, members]) => ({ key, members: [...members].sort() }));
    };
    const before = inventory(oldProjection), after = inventory(newProjection);
    assert.deepEqual(after, before, `Project member conservation against ${baseline} failed for ${scope}`);
    comparisons.push({ scope, before, after });
  }
  return { baseline, candidate: build.sha, source: 'actual installed isolated IndexedDB catalog; synthetic fixtures, not user records', segments: [0, 1, 2, 3], comparisons };
}

try {
  const harness = await mkdtemp(join(tmpdir(), 'vaiwl-home-runtime-')); await cp(resolve('dist'), harness, { recursive: true });
  const manifest = JSON.parse(await readFile(join(harness, 'manifest.json'), 'utf8'));
  manifest.permissions.push('scripting', 'webNavigation'); manifest.optional_permissions = manifest.optional_permissions.filter(value => !['scripting', 'webNavigation'].includes(value));
  manifest.host_permissions = ['https://chatgpt.com/*']; manifest.optional_host_permissions = [];
  await writeFile(join(harness, 'manifest.json'), JSON.stringify(manifest));
  for (const name of ['newtab.js', 'service-worker.js', 'content.js']) assert.equal(createHash('sha256').update(await readFile(join(harness, name))).digest('hex'), build.files[name]);
  check('HOME-production-bundles', true, 'Installed three production bundles match the current build hashes; no production parser, projection or storage hook is substituted.');
  const profile = await mkdtemp(join(tmpdir(), 'vaiwl-home-profile-'));
  const executablePath = process.env.VAIWL_CHROMIUM_EXECUTABLE;
  context = await chromium.launchPersistentContext(profile, {
    ...(executablePath ? { executablePath } : { channel: process.env.VAIWL_BROWSER_CHANNEL || 'chromium' }), headless: true, viewport: { width: 1440, height: 1000 },
    args: ['--no-sandbox', `--disable-extensions-except=${harness}`, `--load-extension=${harness}`],
  });
  context.on('page', target => target.on('pageerror', error => errors.push(String(error))));
  await context.route(/^https?:\/\//, route => {
    const url = route.request().url();
    if (url === 'https://chatgpt.com/api/auth/session') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ user: { id: 'home-test-principal' }, expires: new Date(Date.now() + 3600000).toISOString() }) });
    if (url.startsWith('https://chatgpt.com/')) return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>ChatGPT</title><main>Synthetic navigation target</main>' });
    return route.abort();
  });
  worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  browserVersion = context.browser()?.version() || await worker.evaluate(() => navigator.userAgent);
  const extensionUrl = `chrome-extension://${new URL(worker.url()).host}/newtab.html`;
  page = await context.newPage(); await page.goto(extensionUrl); await ready();
  check('HOME-first-use-import', await page.locator('#first-import').isVisible() && await page.locator('#first-connect').isVisible(), 'An empty installation retains explicit first-use import and connection actions.');
  await command(page, 'PERMISSIONS_SYNC', { enableCapture: true });

  const seeded = await page.evaluate(async () => {
    const db = await new Promise(resolve => { const r = indexedDB.open('vaiwl-start'); r.onsuccess = () => resolve(r.result); });
    const settings = await new Promise(resolve => { const r = db.transaction('settings').objectStore('settings').get('main'); r.onsuccess = () => resolve(r.result); });
    const profile = settings.localProfileKey, now = Date.now() - 300000, recent = new Date(now - 2 * 86400000).toISOString(), historical = new Date(now - 40 * 86400000).toISOString(), old = new Date(now - 75 * 86400000).toISOString(), at = new Date(now).toISOString();
    // Use production's length-delimited identity format so real navigation can
    // rediscover the seeded link without an artificial duplicate-key fixture.
    const candidateKeys = await Promise.all(Array.from({ length: 100 }, async (_, index) => {
      const id = `93000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
      const parts = ['candidate', profile, 'chatgpt', id].map(value => new TextEncoder().encode(value));
      const bytes = new Uint8Array(parts.reduce((size, part) => size + 4 + part.length, 0)); const view = new DataView(bytes.buffer); let offset = 0;
      for (const part of parts) { view.setUint32(offset, part.length); offset += 4; bytes.set(part, offset); offset += part.length; }
      return `candidate:${[...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('')}`;
    }));
    const tx = db.transaction(['settings', 'conversations', 'projects', 'scopes', 'revisions', 'openDays', 'tombstones'], 'readwrite');
    const finished = new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = () => reject(tx.error); });
    const scopes = ['scope:home-a', 'scope:home-b'];
    for (const scope of scopes) tx.objectStore('scopes').put({ key: scope, provider: 'chatgpt', principalKey: scope, contextKey: scope, identity: 'verified', label: scope, verifiedAt: at, identityAdapterVersion: 'synthetic-test', contextWitnessId: 'synthetic-home', state: 'ready' });
    const local = (name, id, title, boundary = 'home-principal-a', localProfileKey = profile) => ({ key: `local-project:home-${name}`, localProfileKey, boundaryKey: boundary, identityBasis: 'principal', projectId: `g-p-${String(id).padStart(32, '0')}`, nativeTitle: title, canonicalUrl: `https://chatgpt.com/g/g-p-${String(id).padStart(32, '0')}/project`, firstObservedAt: at, observedAt: at, relationBasis: 'linked-native-panel', source: { href: `https://chatgpt.com/g/g-p-${String(id).padStart(32, '0')}/project`, documentKey: 'synthetic-home-document', routeEpoch: 1 }, trust: 'native-relation-observed', membershipCoverage: 'observed-only', stableRank: id, revision: 40 });
    const projects = [local('active', 101, '粒子物理研究'), local('history', 102, '历史项目'), local('undated', 103, '未完的构想'), local('empty', 104, '空项目'), local('same-a', 105, '同名项目'), local('same-b', 105, '同名项目', 'home-principal-b'), local('foreign-profile', 106, 'Foreign Profile secret', 'foreign', 'another-profile')];
    for (const project of projects) tx.objectStore('settings').put({ key: `localProject:${project.key}`, value: project });
    let index = 0; const rows = [], keys = {};
    const add = (name, nativeTitle, visitAt = null, projectName = null, scope = null) => {
      const n = ++index, conversationId = `93000000-0000-4000-8000-${String(n).padStart(12, '0')}`, project = projects.find(p => p.key === `local-project:home-${projectName}`);
      const owner = scope ? { kind: 'scoped', scopeKey: scope } : { kind: 'unassigned', localProfileKey: profile, accountKey: null };
      const membership = scope ? { state: 'PROJECT', projectId: 'g-p-00000000000000000000000000000201', evidenceId: 'home-witness', confirmedAt: at } : { state: 'UNKNOWN', projectId: null, reason: 'scope-unverified' };
      keys[name] = scope ? `conversation:home-${name}` : candidateKeys[n - 1];
      const row = { key: keys[name], provider: 'chatgpt', conversationId, canonicalUrl: `https://chatgpt.com/c/${conversationId}`, nativeTitle, titleBasis: 'native-label', titleObservedAt: at, availability: 'reachable', firstSeenAt: at, lastSeenAt: at, browserLastVisitAt: visitAt, activity: null, stableRank: n, revision: 40, owner, ownerKey: scope || (project ? `local:${project.boundaryKey}` : `unassigned:${profile}`), membership, membershipState: membership.state,
        ...(project ? { localProject: { projectKey: project.key, boundaryKey: project.boundaryKey, identityBasis: 'principal', relationBasis: 'linked-native-panel', observedAt: at, state: 'observed' } } : {}), ...(scope ? { projectId: membership.projectId } : {}) };
      rows.push(row); tx.objectStore('conversations').put(row); return row;
    };
    for (let n = 1; n <= 18; n++) add(`active-${n}`, `研究讨论 ${n}`, recent, 'active');
    add('active-unknown-a', '尚未访问的成员 A', null, 'active'); add('active-unknown-b', '尚未访问的成员 B', null, 'active'); add('active-old', '更早的计算', old, 'active');
    add('history-timed', '四十天前的讨论', historical, 'history'); add('history-unknown', '历史项目的未访问成员', null, 'history'); add('history-old', '历史项目的旧成员', old, 'history');
    add('undated-a', '构想 A', null, 'undated'); add('undated-b', '构想 B', null, 'undated');
    add('same-a', '账号 A 的成员', recent, 'same-a'); add('same-b', '账号 B 的成员', recent, 'same-b');
    add('recent', '独立的浏览记录', recent); add('recent-old', '独立的历史记录', historical); add('search-only', '只在全历史搜索的会话');
    const conflict = add('conflict', '冲突关系仍可搜索'); conflict.localProject = { projectKey: projects[0].key, boundaryKey: projects[0].boundaryKey, identityBasis: 'principal', relationBasis: 'linked-native-panel', observedAt: at, state: 'conflicting', conflictingProjectKeys: [projects[0].key, projects[1].key] }; tx.objectStore('conversations').put(conflict);
    add('formal', '正式项目的成员', recent, null, scopes[0]); add('foreign-scope', 'Foreign scope secret', recent, null, scopes[1]);
    for (const scope of scopes) tx.objectStore('projects').put({ key: `project:${scope}`, scopeKey: scope, projectId: 'g-p-00000000000000000000000000000201', nativeTitle: '正式项目', canonicalUrl: 'https://chatgpt.com/g/g-p-00000000000000000000000000000201/project', evidenceId: 'home-witness', observedAt: at, membershipCoverage: 'observed-only', stableRank: 1, revision: 40 });
    const removed = add('removed', '已移除成员', recent, 'active'); tx.objectStore('tombstones').put({ key: removed.key, removedAt: at, reason: 'user-removed', record: removed });
    tx.objectStore('openDays').put({ recordKey: keys['active-1'], timeZone: 'UTC', localDate: recent.slice(0, 10), firstOpenedAt: recent, lastOpenedAt: recent, activityUnit: 1, firstIntentId: 'historical-fixture', lastIntentId: 'historical-fixture' });
    tx.objectStore('settings').put({ ...settings, selectedScope: 'unassigned', libraryTimeZone: 'UTC' }); tx.objectStore('revisions').put({ key: 'main', value: 40, nextRank: 1000 });
    await finished; db.close(); sessionStorage.clear(); return { projects, rows, keys, scopes, at, recent, historical, old };
  });
  recordKeys = seeded.keys;
  const before = await raw(page);
  await page.reload(); await ready();
  const active = page.locator(`[data-project="${pkey('active')}"]`);
  await active.waitFor();
  check('HOME-five-plus-twelve', await active.locator('.conversation-open:visible').count() === 5, 'Normal project rows begin at five.');
  await screenshot('workspace-default');
  await active.locator('[data-more]').click();
  check('HOME-more-adds-twelve', await active.locator('.conversation-open:visible').count() === 17, 'First show-more increases five to seventeen.');
  await active.locator('[data-more]').click();
  await active.locator('[data-older]').click();
  check('HOME-active-all-members', await active.locator('.conversation-open:visible').count() === 21 && await active.locator(`[data-record-key="${key('active-unknown-a')}"]`).isVisible() && await active.locator(`[data-record-key="${key('active-unknown-b')}"]`).isVisible() && await active.locator(`[data-record-key="${key('active-old')}"]`).isVisible(), 'Eighteen timed rows, two entirely undated members and one older member remain inside the same project; removed member is excluded.');
  check('HOME-undated-unaffiliated-search-only', await page.locator(`#workspace-content [data-record-key="${key('search-only')}"]`).count() === 0 && await page.locator(`#workspace-content [data-record-key="${key('conflict')}"]`).count() === 0, 'Undated unaffiliated and conflicted records remain out of home lists.');
  check('HOME-recent-history', await page.locator(`.recent-section [data-record-key="${key('recent')}"]`).isVisible(), 'An UNKNOWN record with browser history is in 最近 without changing formal membership.');
  check('HOME-same-title-identity-isolation', await page.getByRole('heading', { name: '同名项目', exact: true }).count() === 2 && await page.locator(`[data-project="${pkey('same-a')}"] [data-record-key="${key('same-a')}"]`).isVisible() && await page.locator(`[data-project="${pkey('same-b')}"] [data-record-key="${key('same-b')}"]`).isVisible() && !await page.getByText('Foreign Profile secret', { exact: true }).count() && !await page.getByText('Foreign scope secret', { exact: true }).count(), 'Equal names and native Project IDs remain separate across identity boundaries; other Profile/account records are absent.');
  const homeText = await page.locator('#workspace-content').innerText();
  check('HOME-no-technical-categories', !/原生项目|本地已观察|本地候选|待确认|待归属|尚无可用日期|来源等级|会话已保存在本机/.test(homeText) && (await page.locator('[data-filter]').allTextContents()).join('/') === '全部/项目/最近', 'Only 全部 / 项目 / 最近 and normal project content remain visible.');
  check('HOME-no-banner-or-duplicate-settings', await page.locator('#workspace-content .import-note,#import-more,#source-banner,#local-banner,#bookmark-settings').count() === 0 && await page.getByRole('button', { name: '显示设置', exact: true }).count() === 0 && await page.locator('#settings-trigger').count() === 1, 'No former status banner, bookmark settings shortcut or duplicate gear is rendered.');
  check('HOME-global-earlier-collapsed', await page.locator('#earlier-projects-toggle').isVisible() && await page.locator('#earlier-projects-toggle').getAttribute('aria-expanded') === 'false', 'Undated/empty known projects have one compact collapsed global 更早 entry.');
  await page.locator('#earlier-projects-toggle').click();
  const undated = page.locator(`[data-project="${pkey('undated')}"]`), empty = page.locator(`[data-project="${pkey('empty')}"]`);
  await undated.locator('[data-older]').click();
  check('HOME-all-undated-project-preserved', await undated.locator('.conversation-open:visible').count() === 2 && await empty.getByRole('link', { name: '打开项目', exact: true }).isVisible() && await empty.locator('[data-record-key]').count() === 0, 'A fully undated project retains both members; the empty known project has a direct native link and no invented conversation.');
  const localStructure = await active.evaluate(node => [node.className, ...[...node.querySelectorAll(':scope > header, :scope > .project-body')].map(part => part.className)]);
  await screenshot('workspace-current');

  await page.locator('#period-older').click();
  const history = page.locator(`[data-project="${pkey('history')}"]`); await history.waitFor(); await history.locator('[data-older]').click();
  check('HOME-historical-project-complete', await history.locator('.conversation-open:visible').count() === 3 && await history.locator(`[data-record-key="${key('history-unknown')}"]`).isVisible() && await page.locator(`[data-project="${pkey('active')}"]`).count() === 0, 'The forty-day-old project appears once in its historical segment with its undated and older members.');
  check('HOME-history-recent-and-global-once', await page.locator(`.recent-section [data-record-key="${key('recent-old')}"]`).isVisible() && await page.locator('#earlier-projects-toggle').count() === 0, 'Historical unaffiliated history appears in that segment’s 最近; undated project entry is not duplicated across segments.');
  await screenshot('workspace-history');
  await page.locator('#period-older').click();
  check('HOME-empty-segment-not-skipped', await page.getByText('这一段没有记录', { exact: true }).isVisible() && await page.locator(`[data-project="${pkey('history')}"]`).count() === 0, 'The next thirty-day interval remains navigable and empty instead of splitting old project members out.');
  await page.locator('#period-newer').click(); await page.locator('#period-newer').click();
  await search('只在全历史搜索的会话');
  check('HOME-undated-searchable', await page.locator(`#search-results [data-record-key="${key('search-only')}"]`).count() === 1, 'The stored undated link remains searchable over all history.'); await closeSearch();
  await search('空项目');
  check('HOME-empty-project-search', await page.locator('#search-results .search-result').count() === 1 && (await page.locator('#search-results .search-result').getAttribute('href')).endsWith('/project'), 'The empty native project itself is searchable and opens its exact native URL.'); await closeSearch();
  await search('冲突关系仍可搜索');
  check('HOME-conflict-search-preserved', await page.locator(`#search-results [data-record-key="${key('conflict')}"]`).count() === 1, 'Conflicting membership never arbitrarily assigns the record and never destroys search reachability.'); await closeSearch();
  const afterProjection = await raw(page);
  check('HOME-twelve-stores-read-only-projection', before.version === 1 && before.names.length === 12 && JSON.stringify(before) === JSON.stringify(afterProjection), 'All twelve stores, records, OpenDays, tombstones, revisions and settings are byte-equivalent after filtering, disclosure, search and thirty-day navigation.');
  const projectionComparison = await compareBaselineProjection(page, ['unassigned', ...seeded.scopes]);
  check('HOME-old-new-project-member-conservation', true, 'The actual installed database snapshot was projected by both fixed baseline 17695ae and the candidate over every fixture interval, including empty intervals and all three owners; every project/member key set is identical.');
  await writeFile(join(output, 'projection-baseline-comparison.json'), JSON.stringify(projectionComparison, null, 2));

  await page.locator('#scope-selector').selectOption(seeded.scopes[0]); await page.locator('[data-project="project:scope:home-a"]').waitFor();
  const formalStructure = await page.locator('[data-project="project:scope:home-a"]').evaluate(node => [node.className, ...[...node.querySelectorAll(':scope > header, :scope > .project-body')].map(part => part.className)]);
  check('HOME-one-project-visual-component', JSON.stringify(formalStructure) === JSON.stringify(localStructure) && !/原生项目|本地已观察|待确认|来源等级/.test(await page.locator('#workspace-content').innerText()), 'Formally scoped and directly observed native projects use the same DOM component and visual classes.');
  await page.locator('#scope-selector').selectOption('unassigned');

  await page.locator('#settings-trigger').click();
  const settingsText = await page.locator('#settings-dialog').innerText();
  check('HOME-footer-settings-only', /隐藏新标签页页脚/.test(settingsText) && /自定义 Chrome/.test(settingsText) && /外观/.test(settingsText) && await page.locator('#settings-import').isVisible(), 'Settings explain the supported Chrome footer hide operation and preserve browser appearance access and history import.');
  await screenshot('settings-footer'); await page.locator('#settings-dialog').getByRole('button', { name: '关闭设置', exact: true }).click();

  // Use the actual Start click and browser navigation completion to promote an undated link.
  await search('只在全历史搜索的会话');
  await page.locator(`#search-results [data-record-key="${key('search-only')}"]`).click();
  await page.waitForURL(/^https:\/\/chatgpt\.com\/c\//);
  const returnPage = await context.newPage(); await returnPage.goto(extensionUrl); page = returnPage; await ready();
  await until(async () => (await command(page, 'SNAPSHOT')).conversations.find(row => row.key === key('search-only'))?.activity?.lastConfirmedOpenAt, 'Actual search-open navigation did not commit an opening time');
  await page.reload(); await ready();
  check('HOME-search-open-enters-recent', await page.locator(`.recent-section [data-record-key="${key('search-only')}"]`).isVisible(), 'Opening the undated search result through the production gesture/navigation broker adds a real Start opening and places it in 最近.');
  const opened = await raw(page);
  check('HOME-open-preserves-record-and-day', opened.values.conversations.length === before.values.conversations.length && opened.values.conversations.filter(row => row.key === key('search-only')).length === 1 && opened.values.openDays.filter(row => row.recordKey === key('search-only')).length === 1 && JSON.stringify(opened.values.tombstones) === JSON.stringify(before.values.tombstones), 'A deliberate open updates the same record, adds one OpenDay and keeps tombstones unchanged.');

  // Publish a real worker revision from another Start while pointer/IME/drag gates hold.
  const publisher = await context.newPage(); await publisher.goto(extensionUrl); await publisher.waitForSelector('html[data-start-ready="true"]');
  await page.bringToFront();
  await page.evaluate(() => { window.__homeRevisions = []; chrome.runtime.onMessage.addListener(message => { if (message.event === 'revision') window.__homeRevisions.push(message.revision); }); });
  for (const [startEvent, endEvent, label] of [['pointerdown', 'pointerup', 'pointer'], ['compositionstart', 'compositionend', 'composition'], ['dragstart', 'dragend', 'drag']]) {
    const marker = `独立的浏览记录 · ${label}`;
    await page.evaluate(({ startEvent }) => { document.dispatchEvent(startEvent.startsWith('pointer') ? new PointerEvent(startEvent, { pointerId: 71, bubbles: true }) : new Event(startEvent, { bubbles: true })); }, { startEvent });
    await publisher.evaluate(async ({ key, marker }) => {
      const db = await new Promise(resolve => { const r = indexedDB.open('vaiwl-start'); r.onsuccess = () => resolve(r.result); }); const tx = db.transaction(['conversations', 'revisions'], 'readwrite');
      const row = tx.objectStore('conversations').get(key), revision = tx.objectStore('revisions').get('main'); row.onsuccess = () => tx.objectStore('conversations').put({ ...row.result, nativeTitle: marker }); revision.onsuccess = () => tx.objectStore('revisions').put({ ...revision.result, value: revision.result.value + 1 });
      await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = () => reject(tx.error); }); db.close();
    }, { key: key('recent'), marker });
    const change = await command(publisher, 'SETTINGS_UPDATE', { patch: { shortcutSectionCollapsed: false } });
    await page.waitForFunction(revision => window.__homeRevisions.includes(revision), change.revision); await pause(100);
    check(`HOME-${label}-holds-background-render`, !await page.getByText(marker, { exact: true }).count(), `A real other-tab revision does not repaint while the ${label} gate is held (synthetic DOM start/end events).`);
    await page.evaluate(({ endEvent }) => { document.dispatchEvent(endEvent.startsWith('pointer') ? new PointerEvent(endEvent, { pointerId: 71, bubbles: true }) : new Event(endEvent, { bubbles: true })); }, { endEvent });
    await page.getByText(marker, { exact: true }).waitFor();
    check(`HOME-${label}-flushes-after-end`, true, 'The queued revision applies after the corresponding interaction ends.');
  }
  await publisher.close();
  const current = await command(page, 'SNAPSHOT');
  const retainedProjectRows = current.conversations.filter(row => row.localProject?.state === 'observed' && !current.tombstones.some(item => item.key === row.key));
  check('HOME-complete-member-key-inventory', retainedProjectRows.length === seeded.rows.filter(row => row.localProject?.state === 'observed' && row.key !== key('removed')).length && retainedProjectRows.every(row => seeded.rows.some(old => old.key === row.key && old.conversationId === row.conversationId)), 'Every originally known non-tombstoned project member retains the same entity key and native conversation ID after the full interaction flow.');

  // Exercise collector -> guarded repository -> pure inference -> production UI,
  // rather than installing a fabricated inferred date in a database fixture.
  const orderProjectId = 'g-p-00000000000000000000000000000301';
  const orderIds = [1, 2, 3].map(n => `94000000-0000-4000-8000-${String(n).padStart(12, '0')}`);
  const orderRows = orderIds.map((id, i) => `<li aria-setsize="3" aria-posinset="${i + 1}"><a href="/c/${id}"><div><div>排序成员 ${i + 1}</div></div></a>${i ? `<time aria-label="Last activity" datetime="${new Date(Date.now() - (i === 1 ? 2 : 5) * 86400000).toISOString()}"></time>` : ''}</li>`).join('');
  const orderMarkup = `<main data-app-shell-main-surface><div data-app-shell-main-content-layout><div role="main"><h1><button><span>推断时间项目</span></button></h1><div role="tablist"><button role="tab" aria-selected="true" id="home-tab" aria-controls="home-panel">Chats</button></div><div role="tabpanel" id="home-panel" aria-labelledby="home-tab"><section><ol aria-label="Last activity, newest first" aria-sort="descending">${orderRows}</ol></section></div></div></div></main>`;
  const native = await context.newPage(); await native.goto(`https://chatgpt.com/g/${orderProjectId}/project`);
  await native.evaluate(markup => { document.body.innerHTML = markup; }, orderMarkup);
  const observed = await until(async () => { const snap = await command(page, 'SNAPSHOT'); return snap.conversations.some(row => row.conversationId === orderIds[0] && row.localProject?.state === 'observed') && snap.timeOrders?.some(order => order.recordKeys.length === 3 && !order.invalidated) ? snap : null; }, 'Explicit chronological native fixture did not reach the real collector/storage path');
  const inferred = observed.conversations.find(row => row.conversationId === orderIds[0]);
  await page.bringToFront(); await page.reload(); await ready();
  const chronologicalCard = page.locator(`[data-project="${inferred.localProject.projectKey}"]`);
  check('HOME-real-relative-time-pipeline', await chronologicalCard.locator(`.project-body > .conversation-list [data-record-key="${inferred.key}"]`).isVisible() && inferred.browserLastVisitAt === null && inferred.activity === null && !inferred.displayTimeFacts?.length, 'A genuinely undated member, above verified native activity anchors at two/five days, enters the normal project list through the real collector and interval projection, without a fabricated exact date or activity.');
  await screenshot('workspace-relative-time');
  await native.locator('#home-panel').evaluate(node => node.insertAdjacentHTML('afterbegin', '<button aria-label="Pinned">Pinned</button>'));
  await until(async () => { const snap = await command(page, 'SNAPSHOT'); return !snap.timeOrders?.some(order => order.recordKeys.includes(inferred.key) && !order.invalidated); }, 'Pinning evidence did not invalidate the saved ordering snapshot');
  await page.reload(); await ready();
  const invalidatedCard = page.locator(`[data-project="${inferred.localProject.projectKey}"]`);
  await invalidatedCard.locator('[data-older]').click();
  const invalidated = (await command(page, 'SNAPSHOT')).conversations.find(row => row.key === inferred.key);
  check('HOME-pinned-invalidates-relative-placement', await invalidatedCard.locator(`.old-list [data-record-key="${inferred.key}"]`).isVisible() && invalidated.activity === null && invalidated.browserLastVisitAt === null && !invalidated.displayTimeFacts?.length, 'Pinning interference revokes relative placement; the unchanged member remains in its project’s 更早 with no forged date or OpenDay.');
  await native.locator('#home-panel > button').evaluate(node => node.remove());
  await until(async () => (await command(page, 'SNAPSHOT')).timeOrders?.some(order => order.recordKeys.includes(inferred.key)), 'Removing interference did not restore supported chronological evidence');
  check('HOME-relative-source-recovers', true, 'A later valid complete list can restore chronological evidence without an approval queue.');
  await native.locator('#home-panel li').first().evaluate(node => node.setAttribute('aria-setsize', '4'));
  await until(async () => !(await command(page, 'SNAPSHOT')).timeOrders?.some(order => order.recordKeys.includes(inferred.key)), 'Partial coverage did not invalidate the saved ordering snapshot');
  const partial = await command(page, 'SNAPSHOT');
  check('HOME-partial-invalidates-not-membership', partial.conversations.filter(row => row.localProject?.projectKey === inferred.localProject.projectKey).length === 3, 'A partial/virtualized list count removes time ordering evidence while retaining all three known project members.');
  const preciseTime = new Date(Date.now() - 86400000).toISOString();
  await native.locator('#home-panel li').first().evaluate((node, at) => node.insertAdjacentHTML('beforeend', `<time aria-label="Last activity" datetime="${at}"></time>`), preciseTime);
  await until(async () => (await command(page, 'SNAPSHOT')).conversations.find(row => row.key === inferred.key)?.displayTimeFacts?.some(fact => fact.at === preciseTime), 'Later explicit native activity time did not reach the existing record');
  await page.reload(); await ready();
  const corrected = (await command(page, 'SNAPSHOT')).conversations.filter(row => row.key === inferred.key);
  check('HOME-stronger-time-corrects-once', corrected.length === 1 && corrected[0].activity === null && corrected[0].browserLastVisitAt === null && await page.locator(`[data-project="${inferred.localProject.projectKey}"] .project-body > .conversation-list [data-record-key="${inferred.key}"]`).isVisible(), 'A later explicit native activity timestamp moves the same member into the normal list once, even while order coverage remains partial; no browser visit or Start event is invented.');
  await native.close();
  check('HOME-no-runtime-errors', errors.length === 0, JSON.stringify(errors));
  await writeFile(join(output, 'catalog-comparison.json'), JSON.stringify({ buildSha: build.sha, beforeKeys: seeded.rows.map(row => row.key), afterKeys: current.conversations.map(row => row.key), projectMemberKeys: retainedProjectRows.map(row => row.key), storeNames: before.names, source: 'synthetic twelve-store fixture; no private data' }, null, 2));
  await writeFile(resolve('artifacts', `${family === 'edge' ? 'edge-' : ''}home-workspace-validation.json`), JSON.stringify({ status: 'PASS', buildSha: build.sha, dirty: build.dirty, browserVersion, checks, errors, limitations }, null, 2));
  console.log(JSON.stringify({ status: 'PASS', checks: checks.length, buildSha: build.sha, browserVersion }));
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: join(output, 'failure.png'), fullPage: true }).catch(() => {});
  await writeFile(resolve('artifacts', `${family === 'edge' ? 'edge-' : ''}home-workspace-validation.json`), JSON.stringify({ status: 'FAIL', buildSha: build.sha, dirty: build.dirty, browserVersion, checks, errors, error: String(error.stack || error), limitations }, null, 2));
  throw error;
} finally { if (context) await context.close(); }
