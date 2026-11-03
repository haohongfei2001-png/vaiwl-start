// Installed-extension acceptance for persistent home modes and the native bookmark shelf.
// All profiles/catalogs are disposable. A localhost favicon proves the browser-cache path.
import { chromium } from 'playwright';
import { mkdtemp, mkdir, cp, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { deflateSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { waitForAsync } from './wait-async.mjs';

const family = process.env.VAIWL_TEST_BROWSER_FAMILY || 'chrome';
const executable = process.env.VAIWL_CHROMIUM_EXECUTABLE;
const channel = process.env.VAIWL_BROWSER_CHANNEL || 'chromium';
const build = JSON.parse(await readFile('dist/build.json', 'utf8'));
const out = resolve('artifacts', 'life-bookmarks', family);
await mkdir(out, { recursive: true });
const checks = [], errors = [], root = await mkdtemp(join(tmpdir(), 'vaiwl-life-bookmarks-'));
const modeKey = 'native.homeMode';
let context, worker, extensionId, status = 'FAIL', browserVersion = '', faviconRequests = 0;
const pass = (id, observed) => checks.push({ id, status: 'PASS', observed });
const check = (id, value, observed) => { assert.ok(value, `${id}: ${observed}`); pass(id, observed); };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function png() {
  const crc32 = bytes => { let crc = -1; for (const byte of bytes) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); } return (crc ^ -1) >>> 0; };
  const chunk = (name, data) => { const type = Buffer.from(name), length = Buffer.alloc(4), crc = Buffer.alloc(4); length.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([type, data]))); return Buffer.concat([length, type, data, crc]); };
  const header = Buffer.alloc(13); header.writeUInt32BE(32, 0); header.writeUInt32BE(32, 4); header[8] = 8; header[9] = 6;
  const pixels = Buffer.alloc(32 * (1 + 32 * 4));
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) { const p = y * 129 + 1 + x * 4; pixels[p] = 39; pixels[p + 1] = 99; pixels[p + 2] = 183; pixels[p + 3] = 255; }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}
const iconBytes = png();
const server = createServer((req, res) => {
  if (req.url === '/favicon.png' || req.url === '/favicon.ico') { faviconRequests++; res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'max-age=3600' }); res.end(iconBytes); }
  else if (req.url === '/known') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<!doctype html><title>Known local icon</title><link rel="icon" href="/favicon.png"><h1>Favicon fixture</h1>'); }
  else { res.writeHead(404); res.end('Missing'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

async function launch(profile, extension = resolve('dist')) {
  context = await chromium.launchPersistentContext(profile, { ...(executable ? { executablePath: executable } : { channel }), headless: process.env.VAIWL_HEADLESS !== 'false', viewport: { width: 1440, height: 1000 }, args: ['--no-sandbox', '--no-first-run', `--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  // Observe genuine production IPC; only explicitly named failure cases below inject faults.
  await context.addInitScript(() => {
    window.__startCommands = []; window.__snapshotReleases = [];
    const send = chrome?.runtime?.sendMessage?.bind(chrome.runtime);
    if (!send) return;
    chrome.runtime.sendMessage = (...args) => {
      if (args[0]?.protocol === 'vaiwl-start-internal/1') window.__startCommands.push(args[0].command);
      const result = send(...args);
      return args[0]?.command === 'SNAPSHOT' && window.__holdSnapshot ? Promise.resolve(result).then(async value => { await new Promise(resolve => { window.__snapshotReleases.push(resolve); window.__releaseSnapshot = () => { for (const release of window.__snapshotReleases.splice(0)) release(); }; }); return value; }) : result;
    };
  });
  worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 15000 });
  extensionId = new URL(worker.url()).host;
  browserVersion = await worker.evaluate(() => navigator.userAgent);
  assert.equal(/Edg\//.test(browserVersion), family === 'edge', `Requested ${family}, received ${browserVersion}`);
}
async function ready(page) {
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForSelector('html[data-start-ready="true"][data-native-ready="true"]', { timeout: 15000 });
  return page;
}
async function nativePage() {
  const pending = context.waitForEvent('page', { timeout: 15000 });
  await worker.evaluate(() => chrome.tabs.create({ active: true }));
  return ready(await pending);
}
async function directPage(configure) {
  const page = await context.newPage();
  if (configure) await configure(page);
  await page.goto(`chrome-extension://${extensionId}/newtab.html`);
  return page;
}
async function mode(page, value) {
  if (await page.getAttribute('html', 'data-home-mode') !== value) await page.locator('#mode-toggle').click();
  await page.waitForSelector(`html[data-home-mode="${value}"]`);
  await waitForAsync(page, async ({ key, value }) => (await chrome.storage.local.get(key))[key] === value, { key: modeKey, value });
  await page.waitForFunction(() => document.querySelector('#mode-toggle').getAttribute('aria-busy') !== 'true');
}
async function noWork(page) {
  assert.ok(await page.locator('#life-content').isVisible());
  assert.ok(await page.locator('#workspace-content').isHidden());
  assert.equal(await page.locator('.project:visible,.candidate-project:visible,.conversation-row:visible,.pending-dates:visible,.history-rail:visible,dialog[open] [data-record-key]:visible').count(), 0);
}
async function raw(page) {
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => { const r = indexedDB.open('vaiwl-start'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const stores = [...db.objectStoreNames], tx = db.transaction(stores), values = {};
    await Promise.all(stores.map(name => new Promise((resolve, reject) => { const r = tx.objectStore(name).getAll(); r.onsuccess = () => { values[name] = r.result; resolve(); }; r.onerror = () => reject(r.error); })));
    const result = { name: db.name, version: db.version, stores, values }; db.close(); return result;
  });
}
async function seed(page) {
  await page.evaluate(async () => {
    const db = await new Promise(resolve => { const r = indexedDB.open('vaiwl-start'); r.onsuccess = () => resolve(r.result); });
    const tx = db.transaction([...db.objectStoreNames], 'readwrite'), at = new Date(Date.now() - 60000).toISOString();
    const r = tx.objectStore('settings').get('main');
    r.onsuccess = () => {
      const profile = r.result.localProfileKey, key = 'staging:life-private', cid = '00000000-0000-4000-8000-000000000123';
      const record = { key, provider: 'chatgpt', conversationId: cid, canonicalUrl: `https://chatgpt.com/c/${cid}`, nativeTitle: 'Private synthetic work conversation', titleBasis: 'browser-history', titleObservedAt: at, availability: 'unverified', firstSeenAt: at, lastSeenAt: at, browserLastVisitAt: at, activity: null, stableRank: 0, revision: 1, owner: { kind: 'unassigned', localProfileKey: profile, accountKey: null }, ownerKey: profile, membership: { state: 'UNKNOWN', projectId: null, reason: 'scope-unverified' }, membershipState: 'UNKNOWN' };
      tx.objectStore('conversations').put(record);
      tx.objectStore('shortcuts').put({ id: 'life-legacy', label: 'Preserved old shortcut', url: 'https://example.com/legacy', icon: { kind: 'builtin', value: 'globe' }, order: 0, pinned: true, createdAt: at, updatedAt: at });
      tx.objectStore('tombstones').put({ key: 'staging:life-removed', removedAt: at, reason: 'user-removed', record: { ...record, key: 'staging:life-removed' } });
      tx.objectStore('openDays').put({ recordKey: key, timeZone: 'UTC', localDate: at.slice(0, 10), firstOpenedAt: at, lastOpenedAt: at, confirmationBasis: 'synthetic-preservation-fixture' });
      tx.objectStore('revisions').put({ key: 'main', value: 10, nextRank: 100 });
    };
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = () => reject(tx.error); }); db.close();
  });
}
async function preference(page, value) {
  if (!await page.locator('#settings-dialog').isVisible()) await page.locator('#settings-trigger').click();
  await page.locator('#bookmark-preference').selectOption(value);
  await waitForAsync(page, async value => (await chrome.storage.local.get('native.bookmarks'))['native.bookmarks'] === value, value);
  await page.locator('#settings-dialog [data-close]').first().click();
}
async function layout(page) {
  return page.evaluate(() => {
    const shelf = document.querySelector('.bookmark-shelf'), list = document.querySelector('.native-bookmark-list'), control = document.querySelector('#bookmark-toggle');
    const bounds = node => { const r = node.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height }; };
    const items = [...list.children].filter(n => n.dataset.bookmarkId).map(n => ({ id: n.dataset.bookmarkId, hidden: n.hidden, inert: n.inert, ...bounds(n) }));
    return { shelf: bounds(shelf), list: bounds(list), toggle: bounds(control), expanded: control.getAttribute('aria-expanded'), items, scrollHeight: list.scrollHeight, clientHeight: list.clientHeight };
  });
}
async function collapsedRow(page) {
  await page.waitForFunction(() => { const root = document.querySelector('.bookmark-shelf'); return root && Number(root.dataset.visibleCount) > 0; });
  const state = await layout(page), visible = state.items.filter(x => !x.hidden);
  assert.ok(visible.length > 0 && visible.length < state.items.length);
  assert.ok(visible.every(x => Math.abs(x.top - visible[0].top) < 1 && x.right <= state.toggle.left + 1 && x.width > 0), JSON.stringify(state));
  assert.ok(state.items.filter(x => x.hidden).every(x => x.inert));
  return visible.length;
}

try {
  const productionProfile = join(root, 'production');
  await launch(productionProfile);
  let page = await nativePage();
  check('L-first-install-workspace', await page.getAttribute('html', 'data-home-mode') === 'workspace' && await page.locator('#workspace-content').isVisible(), 'Unmodified production extension, actual browser new-tab entry, first installation defaults to workspace.');
  check('L-correct-toggle-position', await page.evaluate(() => { const search = document.querySelector('#search-trigger'), toggle = document.querySelector('#mode-toggle'), settings = document.querySelector('#settings-trigger'); return !!(search.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING) && !!(toggle.compareDocumentPosition(settings) & Node.DOCUMENT_POSITION_FOLLOWING); }), 'Labelled mode capsule lies between search and settings.');
  await seed(page); await page.reload(); await ready(page);
  await page.locator('[data-record-key="staging:life-private"]').waitFor();
  const catalogBefore = await raw(page);
  await page.screenshot({ path: join(out, 'workspace.png'), fullPage: true });
  const realTabsBefore = (await worker.evaluate(() => chrome.tabs.query({}))).map(tab => tab.id).sort();
  check('L-unconfigured-bookmarks-no-banner', await page.locator('#bookmarks-home').isHidden() && await page.locator('#bookmark-choose,#bookmark-home-connect').count() === 0, 'An unconfigured workspace does not display a bookmark setup banner or duplicate settings button.');
  await mode(page, 'life'); await noWork(page);
  assert.deepEqual((await worker.evaluate(() => chrome.tabs.query({}))).map(tab => tab.id).sort(), realTabsBefore);
  pass('L-switch-does-not-close-real-tabs', 'Mode switch leaves all actual browser tab IDs unchanged.');
  check('L-switch-removes-work-material', (await page.locator('#mode-toggle').innerText()).includes('工作空间'), 'Life has its own web-search surface and no visible project, conversation, pending record or date rail.');
  await page.screenshot({ path: join(out, 'life.png'), fullPage: true });
  const lifePeer = await nativePage(); await noWork(lifePeer);
  check('L-new-native-tab-inherits-life-no-projection', await lifePeer.evaluate(() => !window.__startCommands.includes('SNAPSHOT')), 'New native tab reads only home preferences/bookmarks; no catalog SNAPSHOT IPC.');
  await page.evaluate(() => chrome.storage.local.set({ 'native.homeMode': 'workspace' }));
  await pause(100);
  check('L-storage-event-does-not-switch-open-pages', await page.getAttribute('html', 'data-home-mode') === 'life' && await lifePeer.getAttribute('html', 'data-home-mode') === 'life', 'A default-mode update leaves both already-open life tabs unchanged.');
  const workPeer = await nativePage();
  check('L-future-tab-inherits-workspace', await workPeer.getAttribute('html', 'data-home-mode') === 'workspace', 'Only subsequently created native tabs read the changed default.');
  await mode(workPeer, 'life');
  await mode(page, 'workspace'); await page.locator('[data-record-key="staging:life-private"]').waitFor();
  check('L-roundtrip-restores-workspace-peer-stays-life', await lifePeer.getAttribute('html', 'data-home-mode') === 'life' && await workPeer.getAttribute('html', 'data-home-mode') === 'life', 'Explicit return restores original work records without switching other existing tabs.');
  await mode(page, 'life');
  // The browser API owns the user's default search engine; this tests our exact invocation.
  await page.evaluate(() => { chrome.search.query = async options => { window.__searchInvocation = options; }; });
  await page.locator('#life-search-input').fill('A deliberate search'); await page.locator('#life-search-input').press('Enter');
  check('L-search-uses-default-engine-api', await page.evaluate(() => window.__searchInvocation?.text === 'A deliberate search' && window.__searchInvocation?.disposition === 'CURRENT_TAB'), 'Production form invokes chrome.search.query(CURRENT_TAB), with no hard-coded search provider. Invocation captured to avoid an external query.');
  await preference(page, 'newtab');
  await page.locator('#settings-trigger').click();
  await page.evaluate(() => { chrome.permissions.request = async requested => { window.__deniedPermissions = requested; return false; }; });
  await page.locator('#bookmark-connect').click(); await page.waitForFunction(() => document.querySelector('#native-status').textContent.includes('未获得'));
  await page.locator('#settings-dialog [data-close]').first().click(); await noWork(page);
  check('L-denied-bookmarks-nonblocking', await page.evaluate(() => window.__deniedPermissions?.permissions?.join() === 'bookmarks') && await page.locator('#bookmarks-home').isHidden() && await page.locator('#bookmark-choose,#bookmark-home-connect').count() === 0, 'Injected consent refusal leaves life mode/search usable and requests only bookmarks. Native consent UI is not claimed.');
  await context.close(); context = null;
  await launch(productionProfile); page = await nativePage(); await noWork(page);
  check('L-browser-restart-retains-life', await page.evaluate(() => !window.__startCommands.includes('SNAPSHOT')), 'Full isolated browser-process restart retains life and avoids workspace projection.');
  const beforeOrigin = await worker.evaluate(() => performance.timeOrigin);
  let reloadManager, reloadObserver;
  if (family === 'chrome') {
    // Match the native Reload path already verified by native-experience.mjs.
    // runtime.reload() does not reliably surface a replacement worker target in
    // this Chromium/Playwright combination; a silent life page should not need
    // to request a catalog merely to make a test's worker watcher succeed.
    reloadManager = await context.newPage(); await reloadManager.goto('chrome://extensions');
    await reloadManager.locator('extensions-item').first().waitFor(); await reloadManager.locator('#devMode').click();
    await reloadManager.evaluate(() => { window.__reloadEvents = []; chrome.developerPrivate.onItemStateChanged.addListener(event => window.__reloadEvents.push({ event: event.event_type, id: event.item_id, state: event.extensionInfo?.state })); });
    await reloadManager.locator('#dev-reload-button').click();
    await reloadManager.waitForFunction(id => window.__reloadEvents.some(event => event.event === 'LOADED' && event.id === id && event.state === 'ENABLED'), extensionId, { timeout: 15000 });
    reloadObserver = await directPage(); await ready(reloadObserver); await noWork(reloadObserver);
    assert.ok(await reloadObserver.evaluate(() => !window.__startCommands.includes('SNAPSHOT')));
    // This deliberately unsupported envelope wakes the event worker and is
    // rejected by parseEnvelope before any repository command can execute.
    const rejected = await reloadObserver.evaluate(() => chrome.runtime.sendMessage({ protocol: 'vaiwl-reload-observer/1' }));
    assert.equal(rejected?.ok, false);
  } else await worker.evaluate(() => { setTimeout(() => chrome.runtime.reload(), 20); });
  const until = Date.now() + 15000; let replacement;
  while (Date.now() < until && !replacement) {
    for (const candidate of context.serviceWorkers()) {
      try { if (new URL(candidate.url()).host === extensionId && await candidate.evaluate(() => performance.timeOrigin) > beforeOrigin) { replacement = candidate; break; } } catch {}
    }
    if (!replacement) await pause(100);
  }
  assert.ok(replacement, 'Extension reload must start a fresh service worker'); worker = replacement;
  page = await nativePage(); await noWork(page);
  check('L-extension-reload-retains-life', await page.evaluate(() => !window.__startCommands.includes('SNAPSHOT')), `${family === 'chrome' ? 'Native extensions manager Reload emits LOADED/ENABLED' : 'Actual chrome.runtime.reload()'} and a fresh worker global is verified; native tab still opens life without workspace data.`);
  if (reloadObserver) await reloadObserver.close(); if (reloadManager) await reloadManager.close();
  assert.deepEqual(await raw(page), catalogBefore); pass('L-catalog-preserved', 'All twelve IndexedDB stores, keys, values, old shortcuts, OpenDays, removed record and capture settings are identical across switching, browser restart and extension reload.');

  const failedRead = await directPage(async target => target.addInitScript(() => {
    const get = chrome.storage.local.get.bind(chrome.storage.local); window.__failModeRead = true;
    chrome.storage.local.get = (...args) => window.__failModeRead && JSON.stringify(args[0]).includes('native.homeMode') ? Promise.reject(Error('TEST_MODE_READ_FAILURE')) : get(...args);
  }));
  await failedRead.locator('#mode-load-retry').waitFor();
  check('L-storage-read-fails-closed', await failedRead.evaluate(() => !window.__startCommands.includes('SNAPSHOT')) && await failedRead.locator('#workspace-content').isHidden(), 'Injected preference-read failure presents a recoverable shell without reading or exposing work data.');
  await failedRead.evaluate(() => { window.__failModeRead = false; }); await failedRead.locator('#mode-load-retry').click(); await ready(failedRead); await noWork(failedRead);
  await failedRead.evaluate(() => { const set = chrome.storage.local.set.bind(chrome.storage.local); window.__failModeWrite = true; window.__holdSnapshot = true; delete window.__releaseSnapshot; chrome.storage.local.set = patch => window.__failModeWrite && 'native.homeMode' in patch ? Promise.reject(Error('TEST_MODE_WRITE_FAILURE')) : set(patch); });
  await failedRead.locator('#mode-toggle').click(); await failedRead.waitForSelector('html[data-home-mode="workspace"]'); await failedRead.locator('#mode-save-retry').waitFor(); await failedRead.waitForFunction(() => typeof window.__releaseSnapshot === 'function');
  check('L-storage-write-failure-explicit', await failedRead.evaluate(async () => (await chrome.storage.local.get('native.homeMode'))['native.homeMode'] === 'life'), 'Current page switches immediately, failed persistence leaves the prior default intact and shows a retry control.');
  await failedRead.evaluate(() => { window.__failModeWrite = false; }); await failedRead.locator('#mode-save-retry').click();
  await waitForAsync(failedRead, async () => (await chrome.storage.local.get('native.homeMode'))['native.homeMode'] === 'workspace');
  await failedRead.evaluate(() => { window.__holdSnapshot = false; window.__releaseSnapshot(); });
  await failedRead.locator('[data-record-key="staging:life-private"]').waitFor();
  pass('L-save-retry-keeps-inflight-workspace', 'Retrying failed mode persistence while a real workspace reply is held does not invalidate the current view load.');
  await mode(failedRead, 'life');
  await failedRead.evaluate(() => { window.__holdSnapshot = true; delete window.__releaseSnapshot; });
  await failedRead.locator('#mode-toggle').click(); await failedRead.waitForFunction(() => typeof window.__releaseSnapshot === 'function');
  await failedRead.waitForFunction(() => document.querySelector('#mode-toggle').getAttribute('aria-busy') !== 'true');
  await failedRead.locator('#mode-toggle').click(); await failedRead.waitForSelector('html[data-home-mode="life"]');
  await failedRead.evaluate(() => { window.__holdSnapshot = false; window.__releaseSnapshot(); }); await pause(100); await noWork(failedRead);
  pass('L-late-workspace-response-rejected', 'A genuine SNAPSHOT reply delayed across a workspace-to-life switch cannot reveal or re-render work data.');
  // UI-driver fault injection only: a running job is projected into an otherwise
  // genuine snapshot; synthetic IMPORT_STEP replies never touch the history API/DB.
  await failedRead.evaluate(() => {
    const send = chrome.runtime.sendMessage.bind(chrome.runtime);
    const job = { id: 'synthetic-driver-job', state: 'running', startTimeMs: 0, endTimeMs: Date.now(), acceptedCandidates: 0, pendingIntervals: [], pendingCandidates: [], saturatedIntervals: [] };
    window.__importStepCalls = 0; window.__importDriverComplete = false;
    window.__driverCommandsAt = window.__startCommands.length;
    window.__restoreImportDriver = () => { chrome.runtime.sendMessage = send; };
    chrome.runtime.sendMessage = (...args) => {
      const message = args[0];
      if (message?.command === 'IMPORT_STEP' && message.payload?.jobId === job.id) {
        window.__startCommands.push('IMPORT_STEP'); window.__importStepCalls++;
        const reply = state => ({ protocol: 'vaiwl-start-internal/1', ok: true, data: { job: { ...job, state } } });
        if (window.__importStepCalls === 1) return new Promise(resolve => { window.__releaseImportStep = () => resolve(reply('running')); });
        window.__importDriverComplete = true; return Promise.resolve(reply('complete'));
      }
      const result = send(...args);
      return message?.command === 'SNAPSHOT' ? Promise.resolve(result).then(reply => ({ ...reply, data: { ...reply.data, importJobs: [{ ...job, state: window.__importDriverComplete ? 'complete' : 'running' }] } })) : result;
    };
  });
  await mode(failedRead, 'workspace'); await failedRead.waitForFunction(() => window.__importStepCalls === 1);
  await mode(failedRead, 'life'); await failedRead.evaluate(() => window.__releaseImportStep()); await pause(150); await noWork(failedRead);
  check('L-import-driver-stops-between-batches', await failedRead.evaluate(() => window.__importStepCalls === 1 && !window.__startCommands.slice(window.__driverCommandsAt).some(command => ['IMPORT_PAUSE', 'IMPORT_CANCEL', 'SETTINGS_UPDATE'].includes(command))), 'UI fault injection: an already-started batch may finish in life, but no next batch, persistent pause/cancel or capture-settings mutation is issued.');
  await mode(failedRead, 'workspace'); await failedRead.waitForFunction(() => window.__importStepCalls === 2 && window.__importDriverComplete);
  await failedRead.waitForSelector('html[data-start-ready="true"]');
  pass('L-import-driver-resumes-after-return', 'UI fault injection: returning to workspace starts the next batch; the in-memory importPumping guard does not remain stuck.');
  await failedRead.evaluate(() => window.__restoreImportDriver()); await mode(failedRead, 'life');
  assert.deepEqual(await raw(failedRead), catalogBefore);
  await page.evaluate(() => chrome.storage.local.set({ 'native.homeMode': { bad: true } }));
  const corrupt = await nativePage();
  check('L-invalid-mode-defaults-workspace', await corrupt.getAttribute('html', 'data-home-mode') === 'workspace', 'Malformed mode preference normalizes safely to workspace without mutating the catalog.');
  assert.deepEqual(await raw(corrupt), catalogBefore);
  await mode(corrupt, 'life');
  await context.close(); context = null;

  // Pregranted native bookmark API harness changes the manifest only; production JS/CSS stays byte-identical.
  const harness = join(root, 'bookmarks-extension'), bookmarkProfile = join(root, 'bookmarks-profile');
  await cp(resolve('dist'), harness, { recursive: true });
  const originalManifest = JSON.parse(await readFile(join(harness, 'manifest.json'), 'utf8'));
  const manifest = structuredClone(originalManifest); manifest.permissions.push('bookmarks'); manifest.optional_permissions = manifest.optional_permissions.filter(value => value !== 'bookmarks');
  await writeFile(join(harness, 'manifest.json'), JSON.stringify(manifest));
  await launch(bookmarkProfile, harness); page = await nativePage();
  check('L-browser-profiles-independent', await page.getAttribute('html', 'data-home-mode') === 'workspace', 'A separate browser Profile starts in workspace while the previous Profile retains life.');
  await preference(page, 'newtab');
  const visit = await context.newPage(); await visit.goto(`${origin}/known`); await visit.waitForLoadState('load');
  const iconUntil = Date.now() + 5000; while (!faviconRequests && Date.now() < iconUntil) await pause(50);
  assert.ok(faviconRequests > 0, 'Normal browser visit must fetch fixture favicon');
  const fixture = await worker.evaluate(async origin => {
    const roots = (await chrome.bookmarks.getTree())[0].children;
    const bar = (roots.find(n => n.folderType === 'bookmarks-bar') || roots.find(n => n.id === '1')).id;
    const known = await chrome.bookmarks.create({ parentId: bar, title: 'Blue favicon', url: `${origin}/known` });
    const folder = await chrome.bookmarks.create({ parentId: bar, title: 'Reading' });
    const nested = await chrome.bookmarks.create({ parentId: folder.id, title: 'Nested folder' });
    const leaf = await chrome.bookmarks.create({ parentId: nested.id, title: 'Nested original name', url: `${origin}/known?nested=1` });
    const sibling = await chrome.bookmarks.create({ parentId: folder.id, title: 'Folder sibling', url: `${origin}/missing` });
    const missing = await chrome.bookmarks.create({ parentId: bar, title: 'No icon', url: 'https://vaiwl-no-favicon.invalid/' });
    const ids = [known.id, folder.id, missing.id];
    for (let n = 0; n < 180; n++) ids.push((await chrome.bookmarks.create({ parentId: bar, title: n % 3 === 0 ? `Long bookmark name ${n} — original native label stays intact` : `Website ${n}`, url: `${origin}/missing?bookmark=${n}` })).id);
    return { bar, known: known.id, folder: folder.id, nested: nested.id, leaf: leaf.id, sibling: sibling.id, missing: missing.id, ids };
  }, origin);
  await page.waitForFunction(count => document.querySelectorAll('.native-bookmark-list > [data-bookmark-id]').length === count, fixture.ids.length);
  assert.deepEqual(await page.locator('.native-bookmark-list > [data-bookmark-id]').evaluateAll(nodes => nodes.map(n => n.dataset.bookmarkId)), fixture.ids);
  check('B-single-settings-entry', await page.locator('#bookmarks-home #bookmark-choose,#bookmarks-home #bookmark-home-connect').count() === 0 && !/显示设置|选择显示方式/.test(await page.locator('#bookmarks-home').textContent()), 'The configured bookmark shelf contains no settings or setup shortcut in either mode.');
  pass('B-native-order-and-labels', 'Actual browser bookmark creation order, mixed folders and original labels are kept exactly; no URL sort or flattening.');
  const blue = page.locator(`.native-bookmark-list > [data-bookmark-id="${fixture.known}"] .bookmark-favicon img`);
  await blue.waitFor();
  await page.waitForFunction(id => { const img = document.querySelector(`[data-bookmark-id="${id}"] .bookmark-favicon img`); return img?.complete && img.naturalWidth > 0; }, fixture.known);
  const pixels = await blue.evaluate(img => { const canvas = document.createElement('canvas'); canvas.width = canvas.height = 32; const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0, 32, 32); return [...ctx.getImageData(16, 16, 1, 1).data]; });
  check('B-real-chromium-favicon-pixels', pixels[0] === 39 && pixels[1] === 99 && pixels[2] === 183 && pixels[3] === 255 && (await blue.getAttribute('src')).includes('/_favicon/'), `Real local favicon cached from normal browsing, decoded through Chromium _favicon: RGBA ${pixels.join(',')}.`);
  await visit.close(); await page.bringToFront();
  await page.waitForFunction(id => ['ready', 'fallback'].includes(document.querySelector(`[data-bookmark-id="${id}"] .bookmark-favicon`)?.dataset.favicon), fixture.missing);
  check('B-uncached-favicon-usable', await page.locator(`[data-bookmark-id="${fixture.missing}"]`).isVisible(), 'An uncached site remains a readable, clickable bookmark while Chromium supplies its stock icon or the local fallback.');
  check('B-no-third-party-icon-proxy', await page.locator('.bookmark-favicon img').evaluateAll(images => images.every(img => img.src.startsWith(chrome.runtime.getURL('_favicon/')))), 'Every website icon request uses the extension-owned Chromium _favicon path.');
  const wideCount = await collapsedRow(page);
  pass('B-single-complete-row', `${wideCount} complete entries fit actual 1440px viewport, including reserved end control; hidden entries are inert.`);
  await page.setViewportSize({ width: 760, height: 900 });
  await page.waitForFunction(previous => Number(document.querySelector('.bookmark-shelf').dataset.visibleCount) < previous, wideCount);
  const narrowCount = await collapsedRow(page);
  check('B-resize-recomputes-count', narrowCount < wideCount, `${narrowCount} complete entries fit the narrower container; no fixed count.`);
  await page.bringToFront();
  let zoomPage = page, zoomMethod = 'native NTP setZoom', nativeShortcut = false;
  const zoomKey = process.platform === 'darwin' ? 'Meta' : 'Control';
  try { await page.evaluate(async () => { const tab = await chrome.tabs.getCurrent(); await chrome.tabs.setZoom(tab.id, 1.5); }); }
  catch (error) {
    if (!/access|restricted|chrome:\/\/|edge:\/\/|not allowed|cannot zoom/i.test(String(error))) throw error;
    // Some versions treat the visible native NTP URL as restricted for setZoom.
    // Try the genuine browser shortcut and verify its effect before claiming it.
    for (let n = 0; n < 3; n++) await page.keyboard.press(`${zoomKey}+=`);
    nativeShortcut = await page.evaluate(async () => { const tab = await chrome.tabs.getCurrent(); return await chrome.tabs.getZoom(tab.id) > 1; });
    if (nativeShortcut) zoomMethod = 'native NTP browser shortcut';
    else {
      checks.push({ id: 'B-native-NTP-zoom', status: 'BLOCKED', observed: `This browser rejects native-NTP setZoom and automation did not change zoom using the browser shortcut: ${String(error)}` });
      // Set the fallback fixture viewport before navigation, so ready() cannot
      // expose a wide-page count while the resize measurement is still queued.
      // The actual resize assertion above and the zoom assertions below remain.
      zoomPage = await directPage(page => page.setViewportSize({ width: 760, height: 900 }));
      await ready(zoomPage); await collapsedRow(zoomPage);
      await zoomPage.evaluate(async () => { const tab = await chrome.tabs.getCurrent(); await chrome.tabs.setZoom(tab.id, 1.5); });
      zoomMethod = 'direct extension page setZoom; native NTP API restricted';
    }
  }
  await pause(100); const zoomCount = await collapsedRow(zoomPage);
  const zoomFactor = await zoomPage.evaluate(async () => { const tab = await chrome.tabs.getCurrent(); return chrome.tabs.getZoom(tab.id); });
  check('B-browser-zoom-recomputes', zoomFactor > 1 && zoomCount <= narrowCount, `Actual browser zoom ${zoomFactor} via ${zoomMethod} retains one complete row (${zoomCount} entries).`);
  if (nativeShortcut) { await page.keyboard.press(`${zoomKey}+0`); }
  else await zoomPage.evaluate(async () => { const tab = await chrome.tabs.getCurrent(); await chrome.tabs.setZoom(tab.id, 1); });
  if (zoomPage !== page) await zoomPage.close();
  await page.bringToFront(); await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('#bookmark-toggle').click();
  await page.waitForFunction(() => document.querySelector('#bookmark-toggle').getAttribute('aria-expanded') === 'true');
  const expanded = await layout(page);
  check('B-expanded-list-bounded', expanded.list.height <= 260 && expanded.scrollHeight > expanded.clientHeight && expanded.items.every(x => !x.hidden), 'All 183 root entries are reachable in the bounded internal scroller.');
  const workspaceTop = await page.locator('#workspace-content').evaluate(node => node.getBoundingClientRect().top);
  check('B-bookmarks-do-not-overlay-work', workspaceTop >= expanded.shelf.bottom - 1, 'Expanded shelf remains in normal page flow above the workspace.');
  await page.screenshot({ path: join(out, 'bookmarks-expanded.png'), fullPage: true });
  await page.locator('#bookmark-toggle').click(); await collapsedRow(page);
  await page.locator(`[data-bookmark-id="${fixture.folder}"]`).click(); await page.locator('#bookmark-folder-panel').waitFor();
  assert.deepEqual(await page.locator('#bookmark-folder-list > [data-bookmark-id]').evaluateAll(nodes => nodes.map(n => n.dataset.bookmarkId)), [fixture.nested, fixture.sibling]);
  await page.locator(`#bookmark-folder-list [data-bookmark-id="${fixture.nested}"]`).click();
  await page.locator(`#bookmark-folder-list [data-bookmark-id="${fixture.leaf}"]`).waitFor();
  await page.locator('#bookmark-folder-back').click(); await page.locator(`#bookmark-folder-list [data-bookmark-id="${fixture.sibling}"]`).waitFor();
  await page.locator('#bookmark-folder-close').click();
  pass('B-layered-folders-preserve-structure', 'Opening nested native folders, going back and closing keep the original ordered child lists without recursive page growth.');
  await worker.evaluate(id => chrome.bookmarks.update(id, { title: 'Renamed native bookmark' }), fixture.known);
  await page.waitForFunction(id => document.querySelector(`[data-bookmark-id="${id}"]`).textContent.includes('Renamed native'), fixture.known);
  await worker.evaluate(({ id, parentId }) => chrome.bookmarks.move(id, { parentId, index: 0 }), { id: fixture.folder, parentId: fixture.bar });
  await page.waitForFunction(id => document.querySelector('.native-bookmark-list > [data-bookmark-id]').dataset.bookmarkId === id, fixture.folder);
  await worker.evaluate(id => chrome.bookmarks.remove(id), fixture.ids.at(-1));
  await page.waitForFunction(id => !document.querySelector(`[data-bookmark-id="${id}"]`), fixture.ids.at(-1));
  pass('B-real-native-CRUD-events', 'Actual bookmark rename, move and removal APIs update the visible shelf without a reload.');
  const finalTree = await worker.evaluate(() => chrome.bookmarks.getTree());
  await preference(page, 'always'); check('B-always-suppresses-duplicate', await page.locator('#bookmarks-home').isHidden(), 'User has a persistent native bar: Start does not render a duplicate.');
  await preference(page, 'hidden'); check('B-hidden-respected', await page.locator('#bookmarks-home').isHidden(), 'User-hidden bookmarks remain hidden in Start.');
  await preference(page, 'newtab'); await mode(page, 'life'); await noWork(page); await collapsedRow(page);
  pass('B-life-shares-single-shelf', 'Life mode uses the same one bookmark shelf and the same display preference.');
  await page.screenshot({ path: join(out, 'life-bookmarks.png'), fullPage: true });
  await context.setOffline(true);
  await page.reload(); await ready(page); await noWork(page); await collapsedRow(page);
  check('B-offline-home-remains-usable', await page.locator('#life-search-input').isVisible(), 'Offline reload keeps local mode, bookmark names, layout and search controls responsive.');
  await context.setOffline(false);
  await page.evaluate(() => { const img = document.querySelector('.bookmark-favicon img'); img.dispatchEvent(new Event('error')); });
  check('B-favicon-error-falls-back', await page.locator('[data-favicon="fallback"]').count() > 0 && await page.locator('#life-content').isVisible(), 'Injected image decode/load failure swaps to a local fallback without blocking the homepage.');
  const failedBookmarks = await directPage(async target => target.addInitScript(() => {
    const getTree = chrome.bookmarks.getTree.bind(chrome.bookmarks);
    window.__restoreBookmarkRead = () => { chrome.bookmarks.getTree = getTree; };
    chrome.bookmarks.getTree = async () => { throw Error('TEST_BOOKMARK_READ_FAILURE'); };
  }));
  await ready(failedBookmarks); await failedBookmarks.locator('#bookmark-retry').waitFor(); await noWork(failedBookmarks);
  await failedBookmarks.evaluate(() => window.__restoreBookmarkRead()); await failedBookmarks.locator('#bookmark-retry').click();
  await failedBookmarks.waitForFunction(() => Number(document.querySelector('.bookmark-shelf')?.dataset.totalCount) > 100);
  pass('B-bookmark-load-failure-recovers', 'Injected getTree failure leaves the life homepage usable; retry restores the actual native tree without reloading the extension.');
  const malformed = await directPage(async target => target.addInitScript(() => {
    chrome.bookmarks.getTree = async () => [{ id: '0', title: '', children: [{ id: '1', title: 'Bookmarks bar', folderType: 'bookmarks-bar', children: [null, 42, { id: 'safe', title: '<img src=x onerror=window.__unsafe=true>', url: 'https://example.com/' }, { id: 'unsafe', title: 'Unsupported native URL', url: 'javascript:alert(1)' }, { id: 'broken-folder', title: 'Unexpected folder children', children: 'malformed' }] }] }];
  }));
  await ready(malformed); await noWork(malformed);
  check('B-malformed-tree-nonblocking', await malformed.locator('.native-bookmark-list > [data-bookmark-id]').count() === 3 && await malformed.locator('.native-bookmark-disabled').count() === 1 && !await malformed.evaluate(() => window.__unsafe), 'Injected malformed rows are ignored, HTML-like names stay text, and unsupported URLs remain disabled.');
  await malformed.locator('[data-bookmark-id="broken-folder"]').click();
  check('B-malformed-folder-nonblocking', (await malformed.locator('#bookmark-folder-list').innerText()).includes('空文件夹'), 'Malformed children fall back to an empty folder layer without stopping the homepage.');
  assert.deepEqual(await worker.evaluate(() => chrome.bookmarks.getTree()), finalTree);
  pass('B-read-and-mode-do-not-write-bookmarks', 'Layout, folder navigation, settings, mode changes, failure handling and offline reload leave the native bookmark tree identical.');
  await context.close(); context = null;
  // Keep the harness installation path, restore optional permissions, then use the actual revoke API.
  await writeFile(join(harness, 'manifest.json'), JSON.stringify(originalManifest));
  await launch(bookmarkProfile, harness); page = await nativePage(); await page.locator('#settings-trigger').click();
  if (!await worker.evaluate(() => chrome.permissions.contains({ permissions: ['bookmarks'] }))) {
    await page.locator('#bookmark-connect').click(); await page.waitForFunction(() => document.querySelector('#bookmark-connect').textContent.includes('撤销'));
  }
  await page.locator('#bookmark-connect').click(); await page.waitForFunction(() => document.querySelector('#bookmark-connect').textContent.includes('授权'));
  check('B-real-optional-revocation', !await worker.evaluate(() => chrome.permissions.contains({ permissions: ['bookmarks'] })) && await page.locator('.native-bookmark').count() === 0, 'Actual optional permission revocation removes bookmark entries without changing the selected mode.');
  await page.locator('#settings-dialog [data-close]').first().click(); await noWork(page);
  check('L-no-unhandled-page-errors', errors.length === 0, JSON.stringify(errors));
  status = 'PASS';
} catch (error) {
  checks.push({ id: 'L/B-failure', status: 'FAIL', observed: String(error.stack || error) });
  throw error;
} finally {
  if (context) await context.close();
  await new Promise(resolve => server.close(resolve));
  const report = { status, buildSha: build.sha, dirty: build.dirty, browserFamily: family, browserVersion, executable: executable || `playwright:${channel}`, blockedChecks: checks.filter(check => check.status === 'BLOCKED').map(check => check.id), checks, errors, limitations: ['Isolated installed-extension profiles and synthetic catalog/bookmarks only; no personal browser state touched.', 'Normal new tabs use chrome.tabs.create with no URL; failure-injection pages use direct extension URLs and are named explicitly.', 'Browser permission denial, storage faults, image error and the import-driver delayed batch are injected; native bookmark CRUD, cached favicon, mode storage, process restart and extension Reload use real APIs.', 'Search invocation is captured without sending an external query; engine selection is delegated to chrome.search.', 'No claim about the separate Edge native tab-strip favicon defect.'] };
  await writeFile(join(out, 'validation.json'), JSON.stringify(report, null, 2));
  await writeFile(resolve('artifacts', family === 'edge' ? 'edge-life-bookmarks-validation.json' : 'life-bookmarks-validation.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status, checks: checks.length, buildSha: build.sha, browserFamily: family }));
}
