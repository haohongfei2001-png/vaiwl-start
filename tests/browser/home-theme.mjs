/**
 * Installed production extension acceptance for all four homepage themes.
 * All catalog records and browser profiles are synthetic and disposable.
 * Runtime bundles are copied byte-for-byte from the hashed production build.
 */
import { chromium } from 'playwright';
import { mkdtemp, mkdir, cp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { layoutFixtures, seedLayoutCatalog } from './layout-fixture.mjs';

const family = process.env.VAIWL_TEST_BROWSER_FAMILY || 'chrome';
const output = resolve('artifacts', 'home-theme', family);
const reportPath = resolve('artifacts', `${family === 'edge' ? 'edge-' : ''}home-theme-validation.json`);
const build = JSON.parse(await readFile('dist/build.json', 'utf8'));
const checks = [], screenshots = [], measurements = [], errors = [];
let context, page, worker, browserVersion = '', failure;
await mkdir(output, { recursive: true });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const check = (id, pass, observed) => {
  checks.push({ id, status: pass ? 'PASS' : 'FAIL', observed });
  assert.ok(pass, `${id}: ${JSON.stringify(observed)}`);
};
async function until(probe, label, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const value = await probe(); if (value) return value; await pause(40); }
  throw new Error(`Timed out: ${label}`);
}
async function ready(target) {
  await target.waitForSelector('html[data-start-ready="true"][data-native-ready="true"]', { timeout: 15000 });
  await target.evaluate(() => document.fonts.ready);
  await target.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function theme(target, value) {
  await until(() => target.evaluate(v => document.documentElement.dataset.homeTheme === v, value), `theme ${value}`);
}
async function settings(target) {
  if (!(await target.locator('#settings-dialog').evaluate(el => el.open))) await target.locator('#settings-trigger').click();
  await target.locator('#settings-nav-newtab').click();
}
async function choose(target, value) {
  await settings(target);
  await target.locator(`[data-home-theme-choice="${value}"]`).click();
  await theme(target, value);
  await until(() => target.evaluate(async v => (await chrome.storage.local.get('native.homeTheme'))['native.homeTheme'] === v, value), `stored theme ${value}`);
}
async function closeSettings(target) {
  if (await target.locator('#settings-dialog').evaluate(el => el.open)) await target.keyboard.press('Escape');
}
async function raw(target) {
  return target.evaluate(async () => {
    const db = await new Promise((resolve, reject) => { const r = indexedDB.open('vaiwl-start'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const values = {};
    for (const name of [...db.objectStoreNames].sort()) values[name] = await new Promise((resolve, reject) => { const r = db.transaction(name).objectStore(name).getAll(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    db.close(); return values;
  });
}
async function capture(label, target = page) {
  const name = `${label}.png`;
  await target.screenshot({ path: join(output, name), fullPage: true, animations: 'disabled' });
  screenshots.push({ file: join('home-theme', family, name), label, source: 'installed extension; synthetic catalog' });
}
async function projectSummary(target) {
  return target.locator('#workspace-content .project[data-project]').evaluateAll(nodes => nodes.map(el => ({
    key: el.dataset.project,
    title: el.querySelector('h3')?.textContent?.trim(),
    href: el.querySelector('h3 a')?.href,
  })).sort((a, b) => a.key.localeCompare(b.key)));
}
async function visibleLinks(target) {
  return target.locator('#workspace-content a.conversation-open[data-record-key]').evaluateAll(nodes => nodes.map(el => ({ key: el.dataset.recordKey, href: el.href, title: el.querySelector('.conversation-title')?.textContent?.trim() })));
}
async function modernGeometry(target) {
  return target.evaluate(() => {
    const panel = document.querySelector('.spatial-project-expanded'), grid = panel?.parentElement;
    const cards = grid ? [...grid.children].filter(el => el.matches('.project')) : [];
    const rect = el => { if (!el) return null; const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; };
    const columnsOf = el => el ? getComputedStyle(el).gridTemplateColumns.split(' ').filter(Boolean).length : 0;
    const selected = cards.find(el => el.dataset.project === panel?.dataset.expandedProject), p = rect(panel), g = rect(grid), s = rect(selected);
    const sameRow = s ? cards.filter(el => Math.abs(rect(el).top - s.top) < 2) : [];
    const next = panel?.nextElementSibling, bands = [...document.querySelectorAll('.spatial-date-band')].map(rect), columns = columnsOf(grid);
    const preceding = grid && panel ? [...grid.children].slice(0, [...grid.children].indexOf(panel)).filter(el => el.matches('.project')).length : 0;
    return { viewport: innerWidth, documentWidth: document.documentElement.scrollWidth, columns,
      panel: p, grid: g, selected: s, rowBottom: Math.max(0, ...sameRow.map(el => rect(el).bottom)), nextTop: next ? rect(next).top : null,
      panelAfterOwnRow: !!selected && preceding === Math.min(cards.length, (Math.floor(cards.indexOf(selected) / columns) + 1) * columns),
      datesContinuous: bands.every((band, i) => !i || band.top >= bands[i - 1].bottom - 1), datesCount: bands.length,
      accessiblePanelRows: panel ? [...panel.querySelectorAll('.conversation-open')].filter(el => el.getClientRects().length).length : 0,
      projects: rect(document.querySelector('.spatial-projects')), recent: rect(document.querySelector('.recent-section')),
      dateColumns: columnsOf(document.querySelector('.recent-section .spatial-date-list')),
      topbar: rect(document.querySelector('.topbar')), search: rect(document.querySelector('#search-trigger')),
      brandVisible: !!document.querySelector('.topbar .brand')?.getClientRects().length,
    };
  });
}
function correctExpansion(geometry, expectedRows) {
  return geometry.documentWidth <= geometry.viewport + 1 && !!geometry.panel && geometry.panelAfterOwnRow &&
    Math.abs(geometry.panel.left - geometry.grid.left) <= 2 && Math.abs(geometry.panel.right - geometry.grid.right) <= 2 &&
    geometry.panel.top >= geometry.rowBottom - 1 && (geometry.nextTop === null || geometry.nextTop >= geometry.panel.bottom - 1) &&
    geometry.datesCount > 1 && geometry.accessiblePanelRows === expectedRows;
}

try {
  const harness = await mkdtemp(join(tmpdir(), 'vaiwl-home-theme-extension-'));
  await cp(resolve('dist'), harness, { recursive: true });
  for (const [name, digest] of Object.entries(build.files)) assert.equal(createHash('sha256').update(await readFile(join(harness, name))).digest('hex'), digest, `${name}: production bundle hash`);
  const profile = await mkdtemp(join(tmpdir(), 'vaiwl-home-theme-profile-'));
  context = await chromium.launchPersistentContext(profile, {
    ...(process.env.VAIWL_CHROMIUM_EXECUTABLE ? { executablePath: process.env.VAIWL_CHROMIUM_EXECUTABLE } : { channel: process.env.VAIWL_BROWSER_CHANNEL || 'chromium' }),
    headless: process.env.VAIWL_HEADLESS !== 'false', timezoneId: 'UTC', viewport: { width: 1440, height: 1000 },
    args: ['--no-sandbox', `--disable-extensions-except=${harness}`, `--load-extension=${harness}`],
  });
  context.on('page', target => target.on('pageerror', error => errors.push(String(error))));
  await context.route(/^https?:\/\//, route => route.abort());
  worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  browserVersion = context.browser()?.version() || await worker.evaluate(() => navigator.userAgent);
  const extensionUrl = `chrome-extension://${new URL(worker.url()).host}/newtab.html`;
  page = await context.newPage(); await page.goto(extensionUrl); await ready(page);
  await page.evaluate(async () => { await chrome.storage.local.remove('native.homeTheme'); await chrome.storage.local.set({ 'native.homeMode': 'workspace' }); });
  assert.ok(layoutFixtures.dense, 'dense synthetic layout fixture exists');
  const receipt = await seedLayoutCatalog(page, 'dense', new Date().toISOString());
  await page.reload(); await ready(page); await theme(page, 'classic');
  const before = await raw(page), classicProjects = await projectSummary(page), classicLinks = await visibleLinks(page);
  check('THEME-default-missing-classic', classicProjects.length >= 4 && classicLinks.length > 4 && await page.locator('.spatial-project-expanded').count() === 0 && await page.locator('.spatial-date-band').count() > 0 && await page.locator('.spatial-expand').count() > 0 && await page.getAttribute('html', 'data-home-theme') === 'classic',
    { projects: classicProjects.length, visibleRecords: classicLinks.length, fixtureRecords: receipt.records });
  await settings(page);
  const offered = await page.locator('[data-home-theme-choice]').evaluateAll(nodes => nodes.map(el => ({ value: el.dataset.homeThemeChoice, selected: el.getAttribute('aria-pressed') })));
  check('THEME-four-choices-in-settings', JSON.stringify(offered.map(item => item.value)) === JSON.stringify(['classic', 'spatial', 'workbench', 'folio']) && offered.filter(item => item.selected === 'true').length === 1 && offered[0].selected === 'true', offered);
  await closeSettings(page);
  await capture('classic-default');

  await choose(page, 'spatial');
  check('THEME-settings-immediate-and-stored', await page.locator('[data-home-theme-choice="spatial"]').getAttribute('aria-pressed') === 'true' && await page.locator('.spatial-date-band').count() > 0,
    { selected: 'spatial', dates: await page.locator('.spatial-date-band').count() });
  await capture('settings-spatial'); await closeSettings(page);
  const spatialProjects = await projectSummary(page), spatialLinks = await visibleLinks(page);
  const classicMap = new Map(classicLinks.map(record => [record.key, record]));
  const shared = spatialLinks.filter(record => classicMap.has(record.key));
  check('THEME-project-identity-and-link-parity', JSON.stringify(spatialProjects) === JSON.stringify(classicProjects) && shared.length > 12 && shared.every(record => record.href === classicMap.get(record.key).href && record.title === classicMap.get(record.key).title),
    { classicProjectKeys: classicProjects.map(p => p.key), spatialProjectKeys: spatialProjects.map(p => p.key), unchangedSharedLinks: shared.length });
  check('THEME-four-row-previews', await page.locator('.spatial-project-preview').evaluateAll(nodes => nodes.length > 0 && nodes.every(el => el.querySelectorAll('.conversation-open').length <= 4) && nodes.some(el => el.querySelectorAll('.conversation-open').length === 4)),
    'Project previews have at most four real conversation rows.');

  const firstExpand = page.locator('.spatial-expand[data-spatial-expand]').first();
  const expandedKey = await firstExpand.getAttribute('data-spatial-expand');
  await firstExpand.click();
  await page.locator('.spatial-project-expanded').waitFor();
  const expectedMembers = Object.values(before).flat().filter(row => row?.localProject?.projectKey === expandedKey);
  const expandedLinks = await page.evaluate(key => [...document.querySelectorAll('.project[data-project],.spatial-project-expanded[data-expanded-project]')]
    .filter(el => el.dataset.project === key || el.dataset.expandedProject === key)
    .flatMap(el => [...el.querySelectorAll('a.conversation-open')].map(a => ({ key: a.dataset.recordKey, href: a.href, visible: !!a.getClientRects().length }))), expandedKey);
  check('THEME-expanded-all-members-with-original-links', expectedMembers.length > 4 && expandedLinks.length === expectedMembers.length && new Set(expandedLinks.map(row => row.key)).size === expectedMembers.length && expectedMembers.every(record => expandedLinks.some(link => link.key === record.key && link.visible && link.href === `https://chatgpt.com/c/${record.conversationId}`)),
    { project: expandedKey, expected: expectedMembers.length, accessible: expandedLinks.length });

  for (const width of [1920, 1720, 1648, 1440, 1280, 960, 768, 390]) {
    await page.setViewportSize({ width, height: width < 600 ? 844 : 1000 });
    await until(() => page.evaluate(key => document.querySelector('.spatial-project-expanded')?.dataset.expandedProject === key, expandedKey), `expanded project at ${width}`);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const geometry = await modernGeometry(page);
    const columns = width <= 600 ? 1 : width <= 850 ? 2 : width <= 1180 ? 3 : 4;
    measurements.push({ theme: 'spatial', width, ...geometry });
    check(`THEME-spatial-responsive-${width}`, geometry.columns === columns && correctExpansion(geometry, expectedMembers.length - 4) && geometry.datesContinuous, geometry);
    if (width === 1440) check('THEME-spatial-quiet-header', !geometry.brandVisible && geometry.topbar.height <= 60 && geometry.search.width <= 220 && geometry.search.width >= 180, { topbar: geometry.topbar, search: geometry.search, brandVisible: geometry.brandVisible });
    if ([1440, 390].includes(width)) await capture(`spatial-${width}`);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  const lastDateMore = page.locator('[data-spatial-date-more]').first();
  const dateKey = await lastDateMore.getAttribute('data-spatial-date-more');
  await lastDateMore.focus(); await page.keyboard.press('Enter');
  check('THEME-last-date-page-retains-keyboard-position', await page.evaluate(key => {
    const active = document.activeElement;
    return !!active?.matches('a[data-record-key]') && active.closest('.spatial-date-content')?.id === `spatial-date-${encodeURIComponent(key)}`;
  }, dateKey), 'Finishing the last date batch focuses its first newly revealed conversation.');
  await page.reload(); await ready(page); await theme(page, 'spatial');
  check('THEME-reload-persists', await page.locator('.spatial-date-band').count() > 0, 'Reload retains spatial rendering.');
  const sibling = await context.newPage(); await sibling.goto(extensionUrl); await ready(sibling); await theme(sibling, 'spatial');
  check('THEME-new-tab-persists', await sibling.locator('.spatial-date-band').count() > 0, 'A separate new tab restores the saved preference.');
  for (const selectedTheme of ['workbench', 'folio']) {
    await choose(page, selectedTheme); await theme(sibling, selectedTheme); await closeSettings(page);
    const themedProjects = await projectSummary(page), themedLinks = await visibleLinks(page), sharedLinks = themedLinks.filter(record => classicMap.has(record.key));
    check(`THEME-${selectedTheme}-identity-and-cross-tab`, JSON.stringify(themedProjects) === JSON.stringify(classicProjects) && sharedLinks.length > 12 && sharedLinks.every(record => record.href === classicMap.get(record.key).href && record.title === classicMap.get(record.key).title) && await sibling.locator('.spatial-date-band').count() > 0,
      { projectKeys: themedProjects.map(p => p.key), unchangedSharedLinks: sharedLinks.length, siblingTheme: selectedTheme });
    for (const width of [1920, 1720, 1648, 1440, 1280, 960, 768, 390]) {
      await page.setViewportSize({ width, height: width < 600 ? 844 : 1000 });
      await until(() => page.evaluate(key => document.querySelector('.spatial-project-expanded')?.dataset.expandedProject === key, expandedKey), `${selectedTheme} expansion at ${width}`);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const geometry = await modernGeometry(page);
      const columns = width <= 600 ? 1 : width <= 850 ? 2 : width <= 1180 ? 3 : 4;
      measurements.push({ theme: selectedTheme, width, ...geometry });
      check(`THEME-${selectedTheme}-responsive-${width}`, geometry.columns === columns && correctExpansion(geometry, expectedMembers.length - 4), geometry);
      if (width === 1440) {
        const presentation = geometry.recent.top >= geometry.projects.bottom && Math.abs(geometry.recent.left - geometry.projects.left) <= 1
          && Math.abs(geometry.recent.width - geometry.projects.width) <= 1 && geometry.dateColumns === 4 && geometry.datesContinuous;
        check(`THEME-${selectedTheme}-shared-reading-order-and-quiet-header`, presentation && !geometry.brandVisible && geometry.topbar.height <= 60 && geometry.search.width <= 220 && geometry.search.width >= 180,
          { projects: geometry.projects, recent: geometry.recent, dateColumns: geometry.dateColumns, topbar: geometry.topbar, search: geometry.search, brandVisible: geometry.brandVisible });
      }
      if ([1440, 390].includes(width)) await capture(`${selectedTheme}-${width}`);
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.reload(); await ready(page); await theme(page, selectedTheme);
    check(`THEME-${selectedTheme}-reload-persists`, await page.locator('.spatial-date-band').count() > 0 && await page.locator('.spatial-project-expanded').count() === 1, 'Reload retains the selected theme and expanded project.');
  }
  await choose(page, 'classic'); await theme(sibling, 'classic'); await closeSettings(page);
  check('THEME-classic-return-and-cross-tab', await page.locator('.spatial-project-expanded').count() === 1 && await page.locator('.spatial-date-band').count() > 0 && await sibling.locator('.spatial-date-band').count() > 0 && await sibling.locator('.spatial-expand').count() > 0 && JSON.stringify(await projectSummary(page)) === JSON.stringify(classicProjects), 'Both open tabs retain the shared renderer and original project identities with classic presentation.');
  for (const width of [1920, 1720, 1648, 1440, 1280, 960, 768, 390]) {
    await page.setViewportSize({ width, height: width < 600 ? 844 : 1000 });
    await until(() => page.evaluate(key => document.querySelector('.spatial-project-expanded')?.dataset.expandedProject === key, expandedKey), `classic expansion at ${width}`);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const geometry = await modernGeometry(page);
    const columns = width <= 600 ? 1 : width <= 850 ? 2 : width <= 1180 ? 3 : 4;
    measurements.push({ theme: 'classic', width, ...geometry });
    check(`THEME-classic-responsive-${width}`, geometry.columns === columns && correctExpansion(geometry, expectedMembers.length - 4), geometry);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await capture('classic-restored');
  await page.evaluate(() => chrome.storage.local.set({ 'native.homeTheme': 'synthetic-unknown-theme' }));
  await page.reload(); await ready(page); await theme(page, 'classic');
  check('THEME-unknown-preference-falls-back', await page.getAttribute('html', 'data-home-theme') === 'classic' && await page.locator('.spatial-date-band').count() > 0 && await page.locator('.spatial-expand').count() > 0 && JSON.stringify(await projectSummary(page)) === JSON.stringify(classicProjects), 'Unknown saved preference restores classic presentation with the complete shared project renderer.');

  await settings(page);
  await page.evaluate(() => {
    window.__homeThemeOriginalSet = chrome.storage.local.set.bind(chrome.storage.local);
    window.__homeThemeSyntheticFailedWrites = 0;
    chrome.storage.local.set = async values => {
      if (Object.hasOwn(values, 'native.homeTheme')) { window.__homeThemeSyntheticFailedWrites++; throw new Error('Synthetic homepage theme storage failure'); }
      return window.__homeThemeOriginalSet(values);
    };
  });
  await page.locator('[data-home-theme-choice="folio"]').click();
  await until(() => page.evaluate(() => window.__homeThemeSyntheticFailedWrites === 1 && document.querySelector('#home-theme-status')?.dataset.state === 'error'), 'injected storage failure handled');
  check('THEME-synthetic-storage-failure-retains-renderer', await page.evaluate(() => document.documentElement.dataset.homeTheme === 'classic' && document.querySelector('[data-home-theme-choice="classic"]')?.getAttribute('aria-pressed') === 'true'), 'A clearly injected storage rejection retains classic and shows the save error.');
  await page.evaluate(() => { chrome.storage.local.set = window.__homeThemeOriginalSet; });
  await closeSettings(page);
  check('THEME-catalog-is-unchanged', JSON.stringify(await raw(page)) === JSON.stringify(before), 'Switch, reload, expand, resize and failed save leave every catalog object store unchanged.');

  await sibling.close();
  await page.evaluate(() => chrome.storage.local.set({ 'native.homeMode': 'life', 'native.homeTheme': 'classic' }));
  const life = await context.newPage();
  await life.addInitScript(() => {
    window.__homeThemeLifeReads = { catalogOpen: 0, commands: [] };
    const open = indexedDB.open.bind(indexedDB);
    indexedDB.open = (name, ...args) => { if (name === 'vaiwl-start') window.__homeThemeLifeReads.catalogOpen++; return open(name, ...args); };
    const send = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = (message, ...args) => { window.__homeThemeLifeReads.commands.push(message?.command); return send(message, ...args); };
  });
  await life.goto(extensionUrl);
  await until(() => life.evaluate(() => document.documentElement.dataset.homeMode === 'life' && document.documentElement.dataset.startReady === 'true'), 'life ready');
  for (const selectedTheme of ['spatial', 'workbench', 'folio']) {
    await choose(life, selectedTheme); await theme(page, selectedTheme);
    check(`THEME-${selectedTheme}-life-mode-remains-independent`, await life.evaluate(() => document.documentElement.dataset.homeMode === 'life' && document.querySelector('#life-content')?.hidden === false), 'Choosing a homepage theme does not switch life to workspace.');
  }
  await choose(life, 'classic');
  const lifeState = await life.evaluate(() => ({ ...window.__homeThemeLifeReads, mode: document.documentElement.dataset.homeMode,
    workspaceChildren: document.querySelector('#workspace-content')?.children.length,
    theme: document.documentElement.dataset.homeTheme }));
  check('THEME-life-switch-without-catalog-or-snapshot', lifeState.catalogOpen === 0 && !lifeState.commands.includes('SNAPSHOT') && lifeState.mode === 'life' && lifeState.workspaceChildren === 0 && lifeState.theme === 'classic', lifeState);
  check('THEME-no-runtime-errors', errors.length === 0, errors);
} catch (error) {
  failure = String(error?.stack || error);
  checks.push({ id: 'THEME-harness-completion', status: 'FAIL', observed: failure });
  if (page) { try { await capture('failure'); } catch {} }
} finally {
  if (context) await context.close();
  const report = { status: failure || checks.some(item => item.status === 'FAIL') ? 'FAIL' : 'PASS', browser: family, browserVersion, build, checks, screenshots, measurements, errors,
    limitations: ['Catalog/account records are synthetic in disposable profiles.', 'Storage failure case deliberately replaces only the homepage preference write API.', 'Viewport widths are available content widths; no physical browser sidebar is simulated.'] };
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`${report.status}: ${checks.filter(item => item.status === 'PASS').length}/${checks.length} homepage theme checks; ${reportPath}`);
}
if (failure) { console.error(failure); process.exitCode = 1; }
