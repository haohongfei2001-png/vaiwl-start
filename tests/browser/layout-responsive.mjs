/**
 * Layout acceptance in an installed production extension, using disposable Profiles
 * and explicitly synthetic native bookmark/catalog fixtures. Screenshots are real
 * rendered extension viewports; no DOM/CSS image mock and no private user data.
 */
import { chromium } from 'playwright';
import { mkdtemp, mkdir, cp, readFile, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { layoutFixtures as fixtures, seedLayoutCatalog } from './layout-fixture.mjs';

const baselineSha = '1c2aee3cd344889a8b5313a23c19c0489ca0ef5d';
const family = process.env.VAIWL_TEST_BROWSER_FAMILY || 'chrome';
const channel = process.env.VAIWL_BROWSER_CHANNEL || 'chromium';
const candidateBuild = JSON.parse(await readFile('dist/build.json', 'utf8'));
const root = await mkdtemp(join(tmpdir(), 'vaiwl-responsive-'));
const out = resolve('artifacts', 'layout-responsive', family);
await mkdir(out, { recursive: true });
const checks = [], screenshots = [], measurements = [], errors = [], limitations = [];
const anchorIso = new Date(Date.now() - 300000).toISOString();

const fixtureHash = createHash('sha256').update(JSON.stringify({ anchorIso, fixtures })).digest('hex');
const viewports = [
  { name: 'fullscreen-2048', width: 2048, height: 1152, columns: 4 },
  { name: 'desktop-1920', width: 1920, height: 1080, columns: 4 },
  // This is an available CONTENT viewport, not a fabricated browser sidebar.
  { name: 'sidebar-budget-1720', width: 1720, height: 1056, columns: 4 },
  { name: 'desktop-1440', width: 1440, height: 900, columns: 4 },
  { name: 'desktop-1280', width: 1280, height: 800, columns: 4 },
  { name: 'desktop-1024', width: 1024, height: 768, columns: 3 },
  { name: 'split-800', width: 800, height: 900, columns: 2 },
  { name: 'narrow-540', width: 540, height: 800, columns: 1 },
  { name: 'narrow-390', width: 390, height: 844, columns: 1 },
  { name: 'minimum-320', width: 320, height: 740, columns: 1 },
];
const note = (id, status, observed) => checks.push({ id, status, observed });
const check = (id, pass, observed) => note(id, pass ? 'PASS' : 'FAIL', observed);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let context, worker, page, browserVersion = '', baselineRoot;

async function ready(target) {
  await target.waitForSelector('html[data-start-ready="true"][data-native-ready="true"]', { timeout: 15000 });
  await target.evaluate(() => document.fonts.ready);
  await target.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function raw(target) {
  return target.evaluate(async () => {
    const db = await new Promise((resolve, reject) => { const r = indexedDB.open('vaiwl-start'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const values = {};
    for (const name of [...db.objectStoreNames].sort()) values[name] = await new Promise((resolve, reject) => { const r = db.transaction(name).objectStore(name).getAll(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    db.close(); return values;
  });
}
async function seed(target, state) {
  const receipt = await seedLayoutCatalog(target, state, anchorIso);
  await target.reload(); await ready(target); return receipt;
}

async function layout(target) {
  return target.evaluate(() => {
    const rect = el => { if (!el) return null; const b = el.getBoundingClientRect(); return Object.fromEntries(['x', 'y', 'left', 'right', 'top', 'bottom', 'width', 'height'].map(k => [k, Math.round(b[k] * 100) / 100])); };
    const shown = el => el && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
    const all = selector => [...document.querySelectorAll(selector)].filter(shown);
    const grid = selector => {
      const el = document.querySelector(selector); if (!shown(el)) return null;
      return { ...rect(el), tracks: getComputedStyle(el).gridTemplateColumns.split(' ').filter(Boolean).map(parseFloat), columnGap: parseFloat(getComputedStyle(el).columnGap), rowGap: parseFloat(getComputedStyle(el).rowGap) };
    };
    const cards = all('.project').map(el => ({ key: el.dataset.project, ...rect(el), rows: [...el.querySelectorAll('.conversation-open')].filter(shown).length }));
    const dates = all('.date-window').map(el => ({ date: el.dataset.date, ...rect(el) }));
    const hitErrors = all('#home,#search-trigger,#mode-toggle,#settings-trigger,.project-head .icon-button,.record-menu,#history-rail button').flatMap(el => {
      const r = el.getBoundingClientRect(); if (r.bottom <= 0 || r.top >= innerHeight) return [];
      const x = (r.left + r.right) / 2, y = Math.min(innerHeight - 1, (r.top + r.bottom) / 2), hit = document.elementFromPoint(x, y);
      return hit && (hit === el || el.contains(hit)) ? [] : [{ label: el.getAttribute('aria-label') || el.id, ...rect(el), hit: hit?.className || hit?.tagName }];
    });
    const titleWidths = all('.conversation-title').map(el => ({ width: el.getBoundingClientRect().width, fontSize: parseFloat(getComputedStyle(el).fontSize), title: el.closest('a')?.title, text: el.textContent, accessible: el.closest('a')?.getAttribute('aria-label') }));
    const main = document.querySelector('.workspace'), topbar = document.querySelector('.topbar'), rail = document.querySelector('#history-rail');
    const topStyle = getComputedStyle(topbar);
    const visibleBookmarks = all('#bookmark-root-list > [data-bookmark-id]');
    return {
      cssViewport: { width: innerWidth, height: innerHeight, clientWidth: document.documentElement.clientWidth, clientHeight: document.documentElement.clientHeight },
      devicePixelRatio, visualViewport: window.visualViewport ? { width: visualViewport.width, height: visualViewport.height, scale: visualViewport.scale } : null,
      documentWidth: document.documentElement.scrollWidth, main: rect(main), topbar: rect(topbar), topbarContent: { left: topbar.getBoundingClientRect().left + parseFloat(topStyle.paddingLeft), right: topbar.getBoundingClientRect().right - parseFloat(topStyle.paddingRight) },
      brand: rect(document.querySelector('#home')), search: rect(document.querySelector('#search-trigger')), settings: rect(document.querySelector('#settings-trigger')), heading: rect(document.querySelector('.board-heading')),
      projectGrid: grid('#workspace-content > section[aria-label="项目"] > .project-grid'), dateGrid: grid('.date-grid'), cards, dates, rail: shown(rail) ? rect(rail) : null,
      bookmarks: shown(document.querySelector('#bookmarks-home')) ? { root: rect(document.querySelector('#bookmarks-home')), shelf: rect(document.querySelector('.bookmark-shelf')), visible: visibleBookmarks.map(el => ({ id: el.dataset.bookmarkId, ...rect(el) })), expanded: document.querySelector('#bookmark-toggle')?.getAttribute('aria-expanded') } : null,
      titleWidths, hitErrors,
      visibleRowsInFirstScreen: all('.conversation-open').filter(el => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }).length,
      scrollY, homeMode: document.documentElement.dataset.homeMode,
    };
  });
}
async function capture(label, version, target = page, fullPage = false) {
  const name = `${version}-${label}.png`, path = join(out, name);
  await target.screenshot({ path, fullPage, animations: 'disabled' });
  const state = await layout(target);
  let zoom;
  try { zoom = await target.evaluate(async () => { const tab = await chrome.tabs.getCurrent(); return chrome.tabs.getZoom(tab.id); }); } catch { zoom = null; }
  measurements.push({ label, version, fixtureHash, browserZoom: zoom, ...state });
  screenshots.push({ file: name, label, version, fullPage, fixtureHash, cssViewport: state.cssViewport, devicePixelRatio: state.devicePixelRatio, browserZoom: zoom, source: 'installed extension content viewport; synthetic catalog' });
  return state;
}
function assertGeometry(label, state, expectedColumns) {
  const columns = state.projectGrid?.tracks.length || state.dateGrid?.tracks.length;
  check(`LAYOUT-${label}-columns`, columns === expectedColumns, { columns, expectedColumns, main: state.main.width, viewport: state.cssViewport });
  check(`LAYOUT-${label}-horizontal-overflow`, state.documentWidth <= state.cssViewport.width + 1, { document: state.documentWidth, viewport: state.cssViewport.width });
  check(`LAYOUT-${label}-shared-grid`, !state.projectGrid || !state.dateGrid || state.projectGrid.tracks.length === state.dateGrid.tracks.length && Math.abs(state.projectGrid.width - state.dateGrid.width) < 1 && state.projectGrid.tracks.every((v, i) => Math.abs(v - state.dateGrid.tracks[i]) < 1), 'Projects and dates share the same available horizontal grid.');
  check(`LAYOUT-${label}-toolbar-alignment`, Math.abs(state.brand.left - state.main.left) <= 2 && Math.abs(state.settings.right - state.main.right) <= 2, { brand: state.brand.left, settings: state.settings.right, main: [state.main.left, state.main.right] });
  check(`LAYOUT-${label}-title-access`, state.titleWidths.every(t => t.fontSize >= 13 && t.width >= 120 && t.title === t.text && t.accessible?.includes(t.text)), { minWidth: Math.min(...state.titleWidths.map(t => t.width)), minFont: Math.min(...state.titleWidths.map(t => t.fontSize)) });
  check(`LAYOUT-${label}-controls-unobscured`, state.hitErrors.length === 0, state.hitErrors);
  if (state.rail) check(`LAYOUT-${label}-rail-reserved`, state.rail.left >= state.main.right + 7 || state.rail.top >= Math.max(state.main.bottom, state.heading?.bottom || 0), { main: state.main, rail: state.rail });
  if (state.bookmarks?.expanded === 'false') check(`LAYOUT-${label}-bookmarks-single-row`, state.bookmarks.visible.every(x => Math.abs(x.top - state.bookmarks.visible[0].top) < 1), { visible: state.bookmarks.visible.length });
}
async function prepareBaseline() {
  if (process.env.VAIWL_LAYOUT_BASELINE_DIST) return resolve(process.env.VAIWL_LAYOUT_BASELINE_DIST);
  try { execFileSync('git', ['cat-file', '-e', `${baselineSha}^{commit}`], { stdio: 'pipe' }); }
  catch { execFileSync('git', ['fetch', '--depth=1', 'origin', baselineSha], { stdio: 'pipe', timeout: 60000 }); }
  baselineRoot = join(root, 'baseline-source');
  execFileSync('git', ['worktree', 'add', '--detach', baselineRoot, baselineSha], { stdio: 'pipe' });
  await symlink(resolve('node_modules'), join(baselineRoot, 'node_modules'), 'dir');
  execFileSync(process.execPath, ['scripts/build.mjs'], { cwd: baselineRoot, stdio: 'pipe', timeout: 60000 });
  return join(baselineRoot, 'dist');
}
async function launch(version, dist, { hasTouch = false } = {}) {
  const extension = join(root, `${version}-extension`), profile = join(root, `${version}-profile`);
  await cp(dist, extension, { recursive: true });
  const build = JSON.parse(await readFile(join(extension, 'build.json'), 'utf8'));
  for (const [name, digest] of Object.entries(build.files)) assert.equal(createHash('sha256').update(await readFile(join(extension, name))).digest('hex'), digest, `${version}/${name} build hash`);
  // The test grants only the optional bookmark capability so fixture setup never
  // needs to interact with a user's permission prompt. Every runtime/CSS byte stays exact.
  const manifest = JSON.parse(await readFile(join(extension, 'manifest.json'), 'utf8'));
  manifest.permissions.push('bookmarks'); manifest.optional_permissions = manifest.optional_permissions.filter(x => x !== 'bookmarks');
  await writeFile(join(extension, 'manifest.json'), JSON.stringify(manifest));
  context = await chromium.launchPersistentContext(profile, {
    ...(process.env.VAIWL_CHROMIUM_EXECUTABLE ? { executablePath: process.env.VAIWL_CHROMIUM_EXECUTABLE } : { channel }),
    headless: process.env.VAIWL_HEADLESS !== 'false', viewport: { width: 1440, height: 900 }, timezoneId: 'UTC', hasTouch,
    args: ['--no-sandbox', '--no-first-run', `--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  context.on('page', p => p.on('pageerror', error => errors.push({ version, message: String(error) })));
  await context.route(/^https?:\/\//, route => route.request().url().startsWith('https://chatgpt.com/')
    ? route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Synthetic ChatGPT destination</title><main>Synthetic link target</main>' }) : route.abort());
  worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 15000 });
  browserVersion = await worker.evaluate(() => navigator.userAgent);
  assert.equal(/Edg\//.test(browserVersion), family === 'edge', `Requested ${family}; browser=${browserVersion}`);
  const url = `chrome-extension://${new URL(worker.url()).host}/newtab.html`;
  page = await context.newPage(); await page.goto(url); await ready(page);
  await page.evaluate(() => chrome.storage.local.set({ 'native.bookmarks': 'newtab' }));
  const bookmarks = await worker.evaluate(async () => {
    const roots = (await chrome.bookmarks.getTree())[0].children;
    const bar = (roots.find(n => n.folderType === 'bookmarks-bar') || roots.find(n => n.id === '1')).id;
    const titles = ['ChatGPT', 'GitHub', 'Figma', 'MDN Web Docs', 'Google Scholar', 'Linear', 'Craft', 'Claude', '参考资料', '工作记录', '界面设计', '阅读清单'];
    const ids = [];
    const folder = await chrome.bookmarks.create({ parentId: bar, title: '阅读与资料' }); ids.push(folder.id);
    await chrome.bookmarks.create({ parentId: folder.id, title: '设计资料与论文', url: 'https://example.invalid/reading' });
    for (const [i, title] of titles.entries()) ids.push((await chrome.bookmarks.create({ parentId: bar, title, url: `https://example.invalid/bookmark-${i}` })).id);
    return { ids, folder: folder.id };
  });
  await page.reload(); await ready(page);
  await page.waitForSelector('.bookmark-shelf[data-ready="true"]');
  check(`LAYOUT-${version}-runtime-identity`, build.sha === (version === 'before' ? baselineSha : candidateBuild.sha), { sha: build.sha, dirty: build.dirty, fileHashesVerified: Object.keys(build.files).length });
  return { build, url, bookmarks };
}
async function interactions(info) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await seed(page, 'dense');
  const before = await raw(page), project = page.locator('[data-project="local-project:layout-0"]');
  const railBefore = await page.locator('#history-rail').boundingBox();
  await page.evaluate(() => scrollTo(0, 500));
  const railAfter = await page.locator('#history-rail').boundingBox();
  check('LAYOUT-rail-fixed-on-scroll', Math.abs(railBefore.y - railAfter.y) <= 1 && Math.abs(railBefore.x - railAfter.x) <= 1, { before: railBefore, after: railAfter, scrollY: await page.evaluate(() => scrollY) });
  await page.evaluate(() => scrollTo(0, 0));
  check('LAYOUT-default-five', await project.locator('.conversation-open:visible').count() === 5, 'Five project previews remain visible by default.');
  await project.locator('[data-more]').click();
  check('LAYOUT-more-plus-twelve', await project.locator('.conversation-open:visible').count() === 17, 'Show more adds twelve, preserving the existing contract.');
  await project.locator('[data-older]').click();
  check('LAYOUT-earlier-preserves-members', await project.getByRole('link', { name: '在 ChatGPT 中打开：更早的计算记录', exact: true }).isVisible() && await project.getByRole('link', { name: '在 ChatGPT 中打开：暂未访问的项目成员', exact: true }).isVisible(), 'Old and undated project members remain in the same project.');
  const last = project.locator('.conversation-open:visible').last(); await last.focus();
  const lastKey = await last.getAttribute('data-focus-key');
  await page.setViewportSize({ width: 540, height: 800 });
  check('LAYOUT-resize-preserves-focus', await page.evaluate(key => document.activeElement?.getAttribute('data-focus-key') === key, lastKey), 'Responsive layout does not reconstruct the focused record.');
  await page.keyboard.press('Tab');
  check('LAYOUT-keyboard-menu-visible', await page.locator(':focus').evaluate(el => el.matches('.record-menu') && Number(getComputedStyle(el).opacity) > 0), 'Record actions become visible in the actual keyboard focus path.');
  await page.keyboard.press('Enter');
  await page.locator('#record-dialog').waitFor({ state: 'visible' });
  check('LAYOUT-full-title-detail', (await page.locator('#record-dialog').innerText()).includes('暂未访问的项目成员'), 'The existing detail surface keeps the complete title accessible.');
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => scrollTo(0, 0));
  await page.locator('[data-filter="none"]').click();
  check('LAYOUT-recent-filter', await page.locator('.project:visible').count() === 0 && await page.locator('.date-window:visible').count() > 0, 'The existing 最近 filter remains functional.');
  const date = page.locator('.date-window').first();
  check('LAYOUT-recent-default-five', await date.locator('.conversation-open:visible').count() === 5, 'Date windows also begin with five records.');
  await date.locator('[data-more]').click();
  check('LAYOUT-recent-plus-twelve', await date.locator('.conversation-open:visible').count() === 17, 'Date show more adds twelve.');
  await page.locator('[data-filter="all"]').click();
  await page.locator('#period-older').click();
  check('LAYOUT-period-navigation', await page.getByRole('link', { name: '在 ChatGPT 中打开：上一个 30 天区间中的讨论', exact: true }).isVisible(), 'History navigation still opens the preceding thirty-day interval.');
  await page.locator('#period-older').click();
  check('LAYOUT-empty-interval', await page.getByText('这一段没有记录', { exact: true }).isVisible(), 'An empty thirty-day interval is not skipped.');
  await capture('empty-interval', 'after');
  await page.locator('#period-newer').click(); await page.locator('#period-newer').click();
  await page.locator('#search-trigger').click();
  await page.locator('#search-input').fill('上一个 30 天区间中的讨论');
  await page.locator('#search-results [data-record-key]').waitFor();
  check('LAYOUT-all-history-search', await page.locator('#search-results [data-record-key]').count() === 1, 'Search reaches the historical record outside the current interval.');
  await page.keyboard.press('Escape');
  check('LAYOUT-search-focus-return', await page.locator('#search-trigger').evaluate(el => el === document.activeElement), 'Closing search returns focus to its trigger.');
  const folder = page.locator(`#bookmark-root-list [data-bookmark-id="${info.bookmarks.folder}"]`);
  await folder.click(); await page.locator('#bookmark-folder-panel').waitFor({ state: 'visible' });
  check('LAYOUT-bookmark-folder', await page.getByRole('link', { name: '设计资料与论文', exact: true }).isVisible(), 'Native bookmark folder structure remains available.');
  await page.locator('#bookmark-folder-close').click();
  await page.locator('#bookmark-toggle').click();
  await page.waitForFunction(() => document.querySelector('#bookmark-toggle').getAttribute('aria-expanded') === 'true');
  const bookmarkState = await layout(page);
  check('LAYOUT-bookmarks-expand-flow', bookmarkState.heading.top >= bookmarkState.bookmarks.shelf.bottom - 1, 'Expanded bookmarks remain in normal flow and do not cover the workspace.');
  check('LAYOUT-bookmarks-order', JSON.stringify(await page.locator('#bookmark-root-list > [data-bookmark-id]').evaluateAll(nodes => nodes.map(n => n.dataset.bookmarkId))) === JSON.stringify(info.bookmarks.ids), 'Original native bookmark order is unchanged.');
  await capture('bookmarks-expanded', 'after');
  await page.locator('#bookmark-toggle').click();
  await page.locator('#mode-toggle').click();
  await page.waitForSelector('html[data-home-mode="life"]');
  check('LAYOUT-life-compatible', await page.locator('#life-content').isVisible() && !await page.locator('#workspace-content').isVisible() && !await page.locator('#history-rail').isVisible(), 'Life mode keeps its separate search surface and hides work material.');
  await capture('life', 'after');
  await page.setViewportSize({ width: 390, height: 844 });
  const lifeNarrow = await capture('life-narrow', 'after');
  check('LAYOUT-life-narrow-overflow', lifeNarrow.documentWidth <= lifeNarrow.cssViewport.width + 1 && lifeNarrow.hitErrors.length === 0, lifeNarrow.hitErrors);
  await page.locator('#mode-toggle').click(); await ready(page);
  const after = await raw(page);
  check('LAYOUT-display-keeps-twelve-stores', Object.keys(before).length === 12 && JSON.stringify(before) === JSON.stringify(after), 'All twelve IndexedDB stores, tombstones, raw records and activity are unchanged by display/filter/search/disclosure/mode actions.');
  await page.setViewportSize({ width: 1440, height: 900 });
  // Deliberate native destination navigation is tested after persistence comparison.
  const href = await page.locator('.conversation-open').first().getAttribute('href');
  await page.locator('.conversation-open').first().click();
  await page.waitForURL(href);
  check('LAYOUT-direct-chatgpt-open', page.url() === href && /^https:\/\/chatgpt\.com\/c\//.test(href), 'A real click still navigates to the original ChatGPT conversation URL.');
  await page.goto(info.url); await ready(page);
}
async function zoomTests(info) {
  await seed(page, 'typical'); await page.setViewportSize({ width: 1440, height: 900 });
  for (const factor of [1.25, 1.5]) {
    try {
      const actual = await page.evaluate(async factor => { const tab = await chrome.tabs.getCurrent(); await chrome.tabs.setZoom(tab.id, factor); return chrome.tabs.getZoom(tab.id); }, factor);
      await pause(100);
      const state = await capture(`browser-zoom-${Math.round(factor * 100)}`, 'after');
      check(`LAYOUT-real-zoom-${factor}`, Math.abs(actual - factor) < .01, { requested: factor, actual, method: 'chrome.tabs.setZoom on direct installed extension page', cssViewport: state.cssViewport, devicePixelRatio: state.devicePixelRatio });
      check(`LAYOUT-real-zoom-${factor}-readable`, state.documentWidth <= state.cssViewport.width + 1 && state.hitErrors.length === 0 && state.titleWidths.every(t => t.fontSize >= 13 && t.width >= 120), state);
    } catch (error) { note(`LAYOUT-real-zoom-${factor}`, 'BLOCKED', String(error)); }
    finally { await page.evaluate(async () => { const tab = await chrome.tabs.getCurrent(); await chrome.tabs.setZoom(tab.id, 1); }).catch(() => {}); }
  }
  const pending = context.waitForEvent('page', { timeout: 15000 });
  await worker.evaluate(() => chrome.tabs.create({ active: true }));
  const native = await pending; await ready(native);
  await native.setViewportSize({ width: 1440, height: 900 });
  const nativeMeta = await native.evaluate(async () => { const tab = await chrome.tabs.getCurrent(); return { url: tab.url, document: location.href, tabId: tab.id, zoom: await chrome.tabs.getZoom(tab.id) }; });
  await capture('native-new-tab', 'after', native);
  check('LAYOUT-native-newtab-installed', await native.locator('.project').count() === 4, nativeMeta);
  try {
    await native.evaluate(async () => { const tab = await chrome.tabs.getCurrent(); await chrome.tabs.setZoom(tab.id, 1.5); });
    const actual = await native.evaluate(async () => { const tab = await chrome.tabs.getCurrent(); return chrome.tabs.getZoom(tab.id); });
    note('LAYOUT-native-newtab-zoom', actual > 1 ? 'PASS' : 'BLOCKED', { actual, nativeMeta });
    if (actual > 1) await capture('native-browser-zoom-150', 'after', native);
  } catch (error) { note('LAYOUT-native-newtab-zoom', 'BLOCKED', `Native NTP API rejects genuine zoom; direct-extension zoom is reported separately. ${String(error)}`); }
  await native.close();
  limitations.push('Native Edge vertical tab-strip UI is not controlled by this headless content test. sidebar-budget-1720 is a measured available-content-width case, not proof of a displayed native vertical sidebar.');
}

let status = 'FAIL';
try {
  const beforeDist = await prepareBaseline();
  for (const [version, dist] of [['before', beforeDist], ['after', resolve('dist')]]) {
    const info = await launch(version, dist);
    await seed(page, 'typical');
    for (const viewport of viewports) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height }); await page.evaluate(() => scrollTo(0, 0)); await ready(page);
      const state = await capture(viewport.name, version);
      if (version === 'after') assertGeometry(viewport.name, state, viewport.columns);
    }
    for (const name of ['sparse', 'dense', 'recent-only']) {
      await page.setViewportSize({ width: 1720, height: 1056 }); await seed(page, name);
      const state = await capture(name, version);
      if (name === 'dense') await capture('dense-full', version, page, true);
      if (version === 'after' && name === 'sparse') {
        check('LAYOUT-sparse-preserves-empty-track', state.projectGrid.tracks.length === 4 && state.cards.length === 3 && state.cards.every(c => c.width >= 260 && c.width <= 300), { grid: state.projectGrid, cards: state.cards });
        check('LAYOUT-natural-card-heights', new Set(state.cards.map(c => c.height)).size > 1, state.cards.map(c => c.height));
      }
      if (version === 'after' && name === 'dense') {
        const rows = state.cards.reduce((result, card) => { (result[card.top] ??= []).push(card); return result; }, {});
        check('LAYOUT-stable-rows-no-masonry', Object.values(rows).every(row => row.length === 4) && Object.keys(rows).length === 3, Object.values(rows).map(row => row.map(c => c.top)));
        check('LAYOUT-dense-date-completeness', state.dates.length === fixtures.dense.dayRows.length, { visibleDateWindows: state.dates.length, expected: fixtures.dense.dayRows.length });
      }
      if (version === 'after' && name === 'recent-only') check('LAYOUT-no-projects', state.cards.length === 0 && state.dates.length === 8 && state.dateGrid.tracks.length === 4, 'Recent-only home uses the same grid without an empty project placeholder.');
    }
    if (version === 'after') { await interactions(info); await zoomTests(info); }
    await context.close(); context = null;
  }
  await launch('touch', resolve('dist'), { hasTouch: true });
  await seed(page, 'typical'); await page.setViewportSize({ width: 320, height: 740 }); await ready(page);
  const coarse = await capture('coarse-320', 'after');
  check('LAYOUT-touch-coarse-active', await page.evaluate(() => matchMedia('(pointer:coarse)').matches), 'A real hasTouch browser context activates coarse-pointer CSS.');
  assertGeometry('coarse-320', coarse, 1);
  await context.close(); context = null;
  check('LAYOUT-no-page-errors', errors.length === 0, errors);
  status = checks.some(c => c.status === 'FAIL') ? 'FAIL' : 'PASS';
} catch (error) {
  errors.push({ fatal: String(error), stack: error.stack }); note('LAYOUT-completion', 'FAIL', String(error));
  if (page) await page.screenshot({ path: join(out, 'failure.png'), fullPage: true }).catch(() => {});
} finally {
  if (context) await context.close().catch(() => {});
  if (baselineRoot) execFileSync('git', ['worktree', 'remove', '--force', baselineRoot], { stdio: 'pipe' });
  const report = { status, family, browserVersion, candidate: candidateBuild.sha, candidateDirty: candidateBuild.dirty, baseline: baselineSha, fixtureHash, anchorIso, fixtures, checks, screenshots, measurements, errors,
    limitations: [...limitations, 'All screenshot sizes are content viewports, not monitor dimensions. devicePixelRatio and chrome.tabs.getZoom are recorded separately.', 'Bookmarked fixture sites use the real Chromium _favicon mechanism; uncached synthetic hosts show the normal browser fallback.', 'Test-only manifest pre-grants existing optional bookmarks; no production permission expansion and no personal Profile.', 'Screenshots do not claim user Mac installation, browser-owned footer, original user screenshot pixels, or original private catalog.'] };
  await writeFile(join(out, 'validation.json'), JSON.stringify(report, null, 2));
  await writeFile(resolve('artifacts', `${family === 'edge' ? 'edge-' : ''}layout-responsive-validation.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status, family, candidate: candidateBuild.sha, baseline: baselineSha, checks: checks.reduce((a, c) => ({ ...a, [c.status]: (a[c.status] || 0) + 1 }), {}), screenshots: screenshots.length, errors, output: out }, null, 2));
}
if (status !== 'PASS') process.exitCode = 1;
