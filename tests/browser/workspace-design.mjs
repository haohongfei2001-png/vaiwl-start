/**
 * Production homepage design acceptance in disposable installed-extension profiles.
 * Every conversation, Project and native bookmark in this suite is SYNTHETIC.
 * Screenshots are browser renders, not mockups or evidence of a personal profile.
 * Optional VAIWL_WORKSPACE_BASELINE_DIST supplies a separately built before version.
 */
import { chromium } from 'playwright';
import { mkdtemp, mkdir, cp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { layoutFixtures, seedLayoutCatalog } from './layout-fixture.mjs';

const themes = ['classic', 'spatial', 'workbench', 'folio'];
const widths = [1280, 1440, 1648, 1720, 1920];
const family = process.env.VAIWL_TEST_BROWSER_FAMILY || 'chrome';
const output = resolve('artifacts', 'workspace-design', family);
const reportPath = resolve('artifacts', `${family === 'edge' ? 'edge-' : ''}workspace-design-validation.json`);
const build = JSON.parse(await readFile('dist/build.json', 'utf8'));
const anchorIso = new Date().toISOString();
const fixtureHash = createHash('sha256').update(JSON.stringify({ anchorIso, layoutFixtures })).digest('hex');
const checks = [], screenshots = [], measurements = [], errors = [];
let context, page, worker, extensionUrl, browserVersion, failure, baselineBuild, activeVersion = 'after';
await mkdir(output, { recursive: true });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(probe, label) {
  const end = Date.now() + 15000;
  while (Date.now() < end) { const result = await probe(); if (result) return result; await pause(40); }
  throw Error(`Timed out: ${label}`);
}
const check = (id, pass, observed) => {
  checks.push({ id, status: pass ? 'PASS' : 'FAIL', observed });
  assert.ok(pass, `${id}: ${JSON.stringify(observed)}`);
};
async function ready() {
  await page.waitForSelector('html[data-start-ready="true"][data-native-ready="true"]');
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function capture(label, fullPage = false, version = 'after') {
  await page.mouse.move(0, 0);
  await page.evaluate(() => { document.activeElement?.blur(); scrollTo(0, 0); });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const file = `${version}-${label}.png`;
  await page.screenshot({ path: join(output, file), fullPage, animations: 'disabled' });
  screenshots.push({ file: join('workspace-design', family, file), label, version, fullPage,
    viewport: page.viewportSize(), fixtureHash, source: 'installed extension browser screenshot', synthetic: true,
    buildSha: version === 'before' ? baselineBuild.sha : build.sha,
    dirty: version === 'before' ? baselineBuild.dirty : build.dirty });
}
async function launch(dist) {
  const harness = await mkdtemp(join(tmpdir(), 'vaiwl-workspace-design-extension-'));
  await cp(dist, harness, { recursive: true });
  const receipt = JSON.parse(await readFile(join(harness, 'build.json'), 'utf8'));
  for (const [name, digest] of Object.entries(receipt.files)) {
    assert.equal(createHash('sha256').update(await readFile(join(harness, name))).digest('hex'), digest, `Production hash: ${name}`);
  }
  // Only the optional bookmark permission is pregranted in the test manifest.
  // JS, HTML and CSS remain byte-identical to the production build receipt.
  const manifest = JSON.parse(await readFile(join(harness, 'manifest.json'), 'utf8'));
  if (!manifest.permissions.includes('bookmarks')) manifest.permissions.push('bookmarks');
  manifest.optional_permissions = manifest.optional_permissions.filter(value => value !== 'bookmarks');
  await writeFile(join(harness, 'manifest.json'), JSON.stringify(manifest));
  const profile = await mkdtemp(join(tmpdir(), 'vaiwl-workspace-design-profile-'));
  context = await chromium.launchPersistentContext(profile, {
    ...(process.env.VAIWL_CHROMIUM_EXECUTABLE ? { executablePath: process.env.VAIWL_CHROMIUM_EXECUTABLE } : { channel: process.env.VAIWL_BROWSER_CHANNEL || 'chromium' }),
    headless: process.env.VAIWL_HEADLESS !== 'false', viewport: { width: 1440, height: 1000 }, timezoneId: 'UTC',
    args: ['--no-sandbox', `--disable-extensions-except=${harness}`, `--load-extension=${harness}`],
  });
  context.on('page', target => target.on('pageerror', error => errors.push(String(error))));
  await context.route(/^https?:\/\//, route => route.abort());
  worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  browserVersion = context.browser()?.version() || await worker.evaluate(() => navigator.userAgent);
  extensionUrl = `chrome-extension://${new URL(worker.url()).host}/newtab.html`;
  page = await context.newPage(); await page.goto(extensionUrl); await ready();
  await worker.evaluate(async () => {
    const roots = (await chrome.bookmarks.getTree())[0].children;
    const bar = roots.find(node => node.folderType === 'bookmarks-bar') || roots.find(node => node.id === '1');
    const folder = await chrome.bookmarks.create({ parentId: bar.id, title: '设计参考' });
    await chrome.bookmarks.create({ parentId: folder.id, title: '原始书签名称', url: 'https://example.invalid/design-reference' });
    for (let index = 0; index < 24; index++) await chrome.bookmarks.create({ parentId: bar.id,
      title: ['文献资料', '开发文档', '阅读清单', '工作手册'][index % 4] + (index >= 4 ? ` ${index + 1}` : ''),
      url: `https://example.invalid/synthetic-bookmark-${index}` });
    await chrome.storage.local.set({ 'native.bookmarks': 'newtab', 'native.homeMode': 'workspace', 'native.projectLayout': 'adaptive', 'native.homePeriodDays': 30, 'native.recentPinnedKeys': [] });
  });
  return receipt;
}
async function seed(state) {
  await seedLayoutCatalog(page, state, anchorIso);
  // A new tab has no outgoing page's retained disclosure/period session state.
  await page.close();
  page = await context.newPage(); await page.goto(extensionUrl); await ready();
  await page.locator('.bookmark-shelf[data-ready="true"]').waitFor();
}
async function settings() {
  await page.locator('#settings-trigger').click();
  await page.locator('#settings-nav-newtab').click();
}
async function chooseTheme(value) {
  await settings(); await page.locator(`[data-home-theme-choice="${value}"]`).click();
  await until(() => page.evaluate(async selected => document.documentElement.dataset.homeTheme === selected &&
    ((await chrome.storage.local.get('native.homeTheme'))['native.homeTheme'] ?? 'classic') === selected, value), `stored theme ${value}`);
  await page.keyboard.press('Escape'); await ready();
}
async function chooseLayout(value) {
  await settings(); await page.locator(`[data-project-layout-choice="${value}"]`).click();
  await until(() => page.evaluate(async selected => document.documentElement.dataset.projectLayout === selected &&
    (await chrome.storage.local.get('native.projectLayout'))['native.projectLayout'] === selected, value), `stored layout ${value}`);
  await page.keyboard.press('Escape'); await ready();
}
async function raw() {
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => { const request = indexedDB.open('vaiwl-start'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const catalog = {};
    for (const name of [...db.objectStoreNames].sort()) catalog[name] = await new Promise((resolve, reject) => { const request = db.transaction(name).objectStore(name).getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    db.close(); return JSON.stringify(catalog);
  });
}
async function geometry() {
  return page.evaluate(() => {
    const rect = el => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom }; };
    const columns = el => el ? getComputedStyle(el).gridTemplateColumns.split(' ').filter(Boolean).length : 0;
    const grid = document.querySelector('.spatial-project-grid');
    const cards = [...document.querySelectorAll('.spatial-project-grid > .project')].map(el => ({ key: el.dataset.project, rows: el.querySelectorAll('.conversation-open').length, ...rect(el) }));
    const dates = [...document.querySelectorAll('.spatial-date-band')].map(el => {
      const list = el.querySelector('.spatial-date-list');
      return { date: el.dataset.date, kind: el.dataset.recentKind, columns: columns(list), ...rect(el), list: rect(list), rows: [...(list?.children || [])].map(row => ({ key: row.querySelector('[data-record-key]')?.dataset.recordKey, ...rect(row) })) };
    });
    return { viewport: innerWidth, documentWidth: document.documentElement.scrollWidth, main: rect(document.querySelector('.workspace')),
      topbar: rect(document.querySelector('.topbar')), brandVisible: !!document.querySelector('.topbar .brand')?.getClientRects().length,
      projects: rect(document.querySelector('.spatial-projects')), recent: rect(document.querySelector('.recent-section')),
      grid: rect(grid), gridMode: grid?.dataset.projectLayout, columns: columns(grid), cards, dates, layout: document.documentElement.dataset.projectLayout,
      mode: document.documentElement.dataset.homeMode, theme: document.documentElement.dataset.homeTheme };
  });
}
async function settled(width) {
  return until(async () => {
    const g = await geometry();
    if (g.viewport !== width || g.documentWidth > width + 1) return false;
    if (g.cards.length && (g.gridMode !== g.layout || g.columns !== 4 || g.cards.some(card => card.w <= 0 || card.right > width + 1))) return false;
    return g;
  }, `settled layout at ${width}`);
}
function assertDesign(label, g, single) {
  check(`${label}-width-and-gutters`, Math.abs(g.main.w - Math.min(1360, g.viewport - 96)) <= 1 &&
    Math.abs(g.main.x - (g.viewport - g.main.w) / 2) <= 1 && g.documentWidth <= g.viewport + 1, g.main);
  check(`${label}-quiet-header`, !g.brandVisible && g.topbar.h === 60 && Math.abs(g.topbar.x - g.main.x) <= 1 && Math.abs(g.topbar.w - g.main.w) <= 1, g.topbar);
  check(`${label}-one-reading-axis`, !!g.projects && !!g.recent && g.recent.y >= g.projects.bottom &&
    Math.abs(g.recent.x - g.projects.x) <= 1 && Math.abs(g.recent.w - g.projects.w) <= 1, { projects: g.projects, recent: g.recent });
  check(`${label}-ordered-full-width-date-groups`, g.dates.every((date, index) => date.columns === 4 && Math.abs(date.w - g.main.w) <= 1 &&
    (!index || date.y >= g.dates[index - 1].bottom - 1)), g.dates);
  check(`${label}-no-empty-pinned-section`, !g.dates.some(date => date.kind === 'pinned'), g.dates.map(date => ({ date: date.date, kind: date.kind })));
  if (single) check(`${label}-single-recent-readable-span`, g.dates.length === 1 && g.dates[0].rows.length === 1 &&
    g.dates[0].rows[0].w > g.dates[0].list.w / 3 && g.dates[0].rows[0].w <= g.dates[0].list.w / 2 + 1, g.dates);
  const reading = g.cards.slice().sort((a, b) => Math.abs(a.y - b.y) < 1 ? a.x - b.x : a.y - b.y).map(card => card.key);
  check(`${label}-stable-visual-and-keyboard-order`, JSON.stringify(reading) === JSON.stringify(g.cards.map(card => card.key)), reading);
}

try {
  if (process.env.VAIWL_WORKSPACE_BASELINE_DIST) {
    activeVersion = 'before';
    baselineBuild = await launch(resolve(process.env.VAIWL_WORKSPACE_BASELINE_DIST));
    assert.equal(baselineBuild.dirty, false, 'The preserved design baseline must have a clean source fingerprint.');
    for (const state of ['single-recent', 'dense']) {
      await seed(state); await page.setViewportSize({ width: 1440, height: 1000 });
      for (const theme of themes) { await chooseTheme(theme); await capture(`${theme}-${state}-1440`, false, 'before'); }
    }
    await context.close(); context = null;
  }
  activeVersion = 'after';
  await launch(resolve('dist'));
  const bookmarksBefore = await worker.evaluate(() => chrome.bookmarks.getTree());
  for (const state of ['single-recent', 'dense']) {
    await seed(state); const catalogBefore = await raw();
    for (const theme of themes) {
      await chooseTheme(theme);
      for (const width of widths) {
        await page.setViewportSize({ width, height: 1000 }); await ready();
        const g = await settled(width); const label = `${theme}-${state}-${width}`;
        measurements.push({ label, fixture: state, synthetic: true, ...g });
        await capture(label); assertDesign(label, g, state === 'single-recent');
      }
      await page.setViewportSize({ width: 1440, height: 1000 });
      if (state === 'dense') await capture(`${theme}-dense-1440-full`, true);
      await chooseLayout('equal');
      await until(async () => (await geometry()).cards.every(card => Math.abs(card.h - 256) <= 1), 'full equal cards');
      const equal = await geometry();
      check(`${theme}-${state}-equal-full-height`, equal.cards.every(card => Math.abs(card.h - 256) <= 1), equal.cards);
      await capture(`${theme}-${state}-equal-1440`);
      await chooseLayout('adaptive'); await ready();
      const adaptive = await settled(1440);
      check(`${theme}-${state}-adaptive-content-heights`, new Set(adaptive.cards.map(card => card.h)).size > 1, adaptive.cards);
      if (state === 'dense') check(`${theme}-adaptive-fills-space`, adaptive.cards.some((card, index) => index >= 4 && card.y < Math.max(...adaptive.cards.slice(0, 4).map(item => item.bottom)) - 1), adaptive.cards);
      await page.locator('#recent-manage-pins').click();
      const pin = page.locator('#pins-list input[data-recent-pin]').first(); const key = await pin.getAttribute('data-recent-pin');
      await pin.check();
      await until(() => page.evaluate(async value => (await chrome.storage.local.get('native.recentPinnedKeys'))['native.recentPinnedKeys']?.includes(value), key), 'saved pin');
      await page.keyboard.press('Escape'); await page.locator('[data-recent-kind="pinned"]').waitFor();
      const pinState = await page.locator('.recent-section [data-record-key]').evaluateAll((nodes, key) => ({ instances: nodes.filter(node => node.dataset.recordKey === key).length,
        firstKind: document.querySelector('.recent-section .spatial-date-band')?.dataset.recentKind }), key);
      check(`${theme}-${state}-pin-first-deduplicated`, pinState.instances === 1 && pinState.firstKind === 'pinned', pinState);
      await capture(`${theme}-${state}-pinned-1440`);
      await page.locator('#recent-manage-pins').click(); await page.locator(`[data-recent-pin="${key}"]`).uncheck();
      await page.keyboard.press('Escape'); await until(async () => await page.locator('[data-recent-kind="pinned"]').count() === 0, 'no empty pin group');
    }
    check(`${state}-presentation-preserves-catalog`, await raw() === catalogBefore, 'All source facts, memberships, timestamps and activity stores are byte-equivalent.');
  }
  await seed('single-recent'); const catalogBefore = await raw();
  for (const theme of themes) {
    await chooseTheme(theme); await page.setViewportSize({ width: 1440, height: 1000 });
    const originalBookmarkIds = await page.locator('.native-bookmark-list > [data-bookmark-id]').evaluateAll(nodes => nodes.map(node => node.dataset.bookmarkId));
    await page.locator('#bookmark-toggle').click();
    await until(() => page.locator('#bookmark-toggle').getAttribute('aria-expanded').then(value => value === 'true'), 'expanded bookmark shelf');
    check(`${theme}-bookmarks-expand-with-native-order`, JSON.stringify(await page.locator('.native-bookmark-list > [data-bookmark-id]').evaluateAll(nodes => nodes.map(node => node.dataset.bookmarkId))) === JSON.stringify(originalBookmarkIds), originalBookmarkIds);
    await capture(`${theme}-bookmarks-expanded-1440`);
    await page.locator('#bookmark-toggle').click();
    await page.locator('.native-bookmark-list > [data-bookmark-id]').first().click();
    await page.locator('#bookmark-folder-panel').waitFor();
    check(`${theme}-native-folder-name`, (await page.locator('#bookmark-folder-list').innerText()).includes('原始书签名称'), await page.locator('#bookmark-folder-list').innerText());
    await page.locator('#bookmark-folder-close').click();
    await page.locator('#search-trigger').click(); await page.locator('#search-input').fill('长标题可访问性');
    await page.locator('#search-results .search-result').first().waitFor();
    check(`${theme}-search-preserves-native-titles`, (await page.locator('#search-results').innerText()).includes('长标题可访问性'), await page.locator('#search-results .search-result').count());
    await capture(`${theme}-search-1440`); await page.keyboard.press('Escape');
    check(`${theme}-new-chat-canonical-url`, await page.locator('#theme-new-chat').getAttribute('href') === 'https://chatgpt.com/', 'Global new chat retains the native ChatGPT destination.');
    await page.locator('#mode-toggle').click();
    await until(() => page.evaluate(() => document.documentElement.dataset.homeMode === 'life' && document.querySelector('#workspace-content').children.length === 0), 'one-click life mode');
    check(`${theme}-life-work-privacy`, await page.locator('#life-search-input').isVisible() && await page.locator('#tasks-home').isHidden() &&
      await page.locator('#pins-list').evaluate(el => el.children.length === 0), 'Life search is available; private work and pins are cleared.');
    await capture(`${theme}-life-1440`);
    await page.locator('#mode-toggle').click(); await ready();
    await until(() => page.locator('.project').count().then(count => count === 4), 'work restored');
  }
  check('interactions-preserve-catalog', await raw() === catalogBefore, 'Search, bookmark browsing and mode switches do not rewrite catalog facts.');
  check('native-bookmarks-unchanged', JSON.stringify(await worker.evaluate(() => chrome.bookmarks.getTree())) === JSON.stringify(bookmarksBefore), 'Read, disclosure and folder navigation preserve the native tree.');
  await seed('empty');
  for (const theme of themes) {
    await chooseTheme(theme);
    check(`${theme}-empty-has-no-invented-work`, await page.locator('.project,.conversation-row,.spatial-date-band').count() === 0 && await page.locator('#search-trigger').isVisible(), 'Empty catalog retains useful global controls with no invented records.');
    await capture(`${theme}-empty-1440`);
  }
  check('no-runtime-errors', errors.length === 0, errors);
} catch (error) {
  failure = String(error?.stack || error); checks.push({ id: 'workspace-design-completion', status: 'FAIL', observed: failure });
  if (page && !page.isClosed()) try { await capture('failure', true, activeVersion); } catch {}
} finally {
  if (context) await context.close();
  const report = { status: failure ? 'FAIL' : 'PASS', browser: family, browserVersion, buildSha: build.sha, dirty: build.dirty, build,
    baselineBuild: baselineBuild || null, synthetic: true, fixtureHash, anchorIso, requiredWidths: widths, themes, checks, screenshots, measurements, errors,
    limitations: ['Synthetic metadata only; this is not certification of a personal ChatGPT profile or user screenshot.',
      'Content viewport screenshots exclude native browser chrome, fullscreen notices and vertical tab UI.',
      'Optional bookmarks permission is pregranted only in the disposable harness manifest; production JS/HTML/CSS are hash-verified.',
      'Synthetic bookmarks use the native favicon path; personal cached favicons and live Project new-chat capabilities are not certified.',
      ...(baselineBuild ? [] : ['A before build was not supplied; no before screenshots are claimed.'])] };
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(`${report.status}: ${checks.filter(check => check.status === 'PASS').length}/${checks.length} workspace design checks; ${screenshots.length} screenshots; ${reportPath}`);
}
if (failure) { console.error(failure); process.exitCode = 1; }
