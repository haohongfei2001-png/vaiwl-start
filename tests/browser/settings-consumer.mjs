/** Installed settings-center acceptance. Every profile and catalog is synthetic. */
import { chromium } from 'playwright';
import { mkdtemp, mkdir, cp, readFile, writeFile, readdir, symlink } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { waitForAsync } from './wait-async.mjs';

const family = process.env.VAIWL_TEST_BROWSER_FAMILY || 'chrome';
const channel = process.env.VAIWL_BROWSER_CHANNEL || (family === 'edge' ? 'msedge' : 'chromium');
const build = JSON.parse(await readFile('dist/build.json', 'utf8'));
const baseline = '1c2aee3cd344889a8b5313a23c19c0489ca0ef5d';
const out = resolve('artifacts', 'settings-consumer', family);
const root = await mkdtemp(join(tmpdir(), 'vaiwl-settings-consumer-'));
const baselineSource = join(root, 'baseline'), runtime = join(root, 'extension'), profile = join(root, 'profile');
await mkdir(out, { recursive: true });
const checks = [], errors = [], screenshots = [];
let context, worker, page, extensionId, browserVersion = '', status = 'FAIL', baselineAdded = false;
const check = (id, condition, observed) => {
  checks.push({ id, status: condition ? 'PASS' : 'FAIL', observed });
  assert.ok(condition, `${id}: ${typeof observed === 'string' ? observed : JSON.stringify(observed)}`);
  console.log(`${id}: PASS`);
};

async function launch(currentProfile = profile, extension = runtime) {
  context = await chromium.launchPersistentContext(currentProfile, {
    ...(process.env.VAIWL_CHROMIUM_EXECUTABLE ? { executablePath: process.env.VAIWL_CHROMIUM_EXECUTABLE } : { channel }),
    headless: true, viewport: { width: 1440, height: 1000 },
    args: ['--no-sandbox', '--no-first-run', `--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  await context.addInitScript(() => {
    window.__settingsCommands = []; window.__settingsDatabaseReads = 0;
    const send = chrome?.runtime?.sendMessage?.bind(chrome.runtime);
    if (send) chrome.runtime.sendMessage = (...args) => {
      if (args[0]?.protocol === 'vaiwl-start-internal/1') window.__settingsCommands.push(args[0].command);
      return send(...args);
    };
    const open = indexedDB.open.bind(indexedDB);
    indexedDB.open = (...args) => { window.__settingsDatabaseReads++; return open(...args); };
  });
  context.on('page', candidate => candidate.on('pageerror', error => errors.push(error.message)));
  await context.route(/^https?:\/\//, route => route.abort());
  worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 15000 });
  extensionId = new URL(worker.url()).host;
  browserVersion = await worker.evaluate(() => navigator.userAgent);
  assert.equal(/Edg\//.test(browserVersion), family === 'edge', `Requested ${family}; received ${browserVersion}`);
  page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/newtab.html`);
  await ready();
}
async function ready() {
  await page.waitForSelector('html[data-start-ready="true"][data-native-ready="true"]', { timeout: 15000 });
}
async function close() { if (context) { await context.close(); context = null; } }
async function shot(name) {
  await page.screenshot({ path: join(out, `${name}.png`), fullPage: true });
  screenshots.push({ file: `${name}.png`, viewport: page.viewportSize() });
}
async function command(name, payload = {}) {
  return page.evaluate(async ({ name, payload }) => {
    const send = (command, payload, expectedRevision) => chrome.runtime.sendMessage({ protocol: 'vaiwl-start-internal/1', operationId: crypto.randomUUID(), command, payload, expectedRevision });
    const current = await send('SNAPSHOT', {}, 0); if (!current.ok) throw Error(current.code);
    const reply = await send(name, payload, current.data.revision); if (!reply.ok) throw Error(reply.code); return reply.data;
  }, { name, payload });
}
async function raw() {
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => { const r = indexedDB.open('vaiwl-start'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const stores = [...db.objectStoreNames], values = {}, tx = db.transaction(stores);
    await Promise.all(stores.map(name => new Promise((resolve, reject) => { const r = tx.objectStore(name).getAll(); r.onsuccess = () => { values[name] = r.result; resolve(); }; r.onerror = () => reject(r.error); })));
    const result = { version: db.version, stores, values }; db.close(); return result;
  });
}
async function seed() {
  await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => { const r = indexedDB.open('vaiwl-start'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const tx = db.transaction([...db.objectStoreNames], 'readwrite'), at = new Date(Date.now() - 60000).toISOString();
    const r = tx.objectStore('settings').get('main');
    r.onsuccess = () => {
      const localProfileKey = r.result.localProfileKey, key = 'staging:settings-retained';
      const record = { key, provider: 'chatgpt', conversationId: '80000000-0000-4000-8000-000000000001', canonicalUrl: 'https://chatgpt.com/c/80000000-0000-4000-8000-000000000001', nativeTitle: '合成测试：保留的工作会话', titleBasis: 'browser-history', titleObservedAt: at, availability: 'unverified', firstSeenAt: at, lastSeenAt: at, browserLastVisitAt: at, activity: { firstConfirmedOpenAt: at, lastConfirmedOpenAt: at, lastActiveDate: at.slice(0, 10), timeZone: 'UTC' }, stableRank: 0, revision: 10, owner: { kind: 'unassigned', localProfileKey, accountKey: null }, ownerKey: localProfileKey, membership: { state: 'UNKNOWN', projectId: null, reason: 'scope-unverified' }, membershipState: 'UNKNOWN' };
      tx.objectStore('conversations').put(record);
      tx.objectStore('shortcuts').put({ id: 'settings-legacy', label: '合成测试旧快捷网站', url: 'https://example.com/retained', icon: { kind: 'builtin', value: 'globe' }, order: 0, pinned: true, createdAt: at, updatedAt: at });
      tx.objectStore('tombstones').put({ key: 'staging:settings-removed', removedAt: at, reason: 'user-removed', record: { ...record, key: 'staging:settings-removed', conversationId: '80000000-0000-4000-8000-000000000002', canonicalUrl: 'https://chatgpt.com/c/80000000-0000-4000-8000-000000000002', nativeTitle: '合成测试：被移除的会话', activity: null, stableRank: 1 } });
      tx.objectStore('openDays').put({ recordKey: key, timeZone: 'UTC', localDate: at.slice(0, 10), firstOpenedAt: at, lastOpenedAt: at, activityUnit: 1, firstIntentId: 'settings-fixture-intent', lastIntentId: 'settings-fixture-intent' });
      tx.objectStore('openIntents').put({ id: 'settings-fixture-intent', browserSessionId: 'synthetic-before-test', targetRecordKey: key, resolvedRecordKey: null, committedRecordKey: key, targetConversationId: record.conversationId, expectedScopeKey: null, targetUrl: record.canonicalUrl, evidence: { kind: 'start-gesture', sourceDocumentId: 'settings-fixture-document', gesture: 'click' }, disposition: 'new-background-tab', sourceTabId: 1, targetTabId: 2, targetDocumentId: 'settings-fixture-target', sourceScopeEpoch: 1, issuedAt: at, issuedTimeZone: 'UTC', issuedLocalDate: at.slice(0, 10), expiresAt: at, state: 'committed', confirmationBasis: 'browser-navigation' });
      tx.objectStore('revisions').put({ key: 'main', value: 10, nextRank: 100 });
    };
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = () => reject(tx.error); }); db.close();
    await chrome.storage.local.set({ 'native.title': '', 'native.icon': { kind: 'browser' }, 'native.bookmarks': 'newtab', 'native.homeMode': 'workspace' });
  });
  await page.reload(); await ready();
}
async function section(name) {
  if (!await page.locator('#settings-dialog').isVisible()) await page.locator('#settings-trigger').click();
  const primary = page.locator(`#settings-nav-${name}`);
  await (await primary.count() ? primary : page.locator(`#settings-${name}-link`)).click();
  await page.locator(`#settings-panel-${name}`).waitFor({ state: 'visible' });
}
async function closeSettings() {
  await page.locator('#settings-dialog [data-close="settings-dialog"]').first().click();
  await page.locator('#settings-dialog').waitFor({ state: 'hidden' });
}
async function assertBounds(id) {
  const bounds = await page.evaluate(() => {
    const dialog = document.activeElement?.closest('dialog[open]') || document.querySelector('#settings-dialog');
    const box = dialog.getBoundingClientRect();
    const visible = node => { const r = node.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(node).visibility !== 'hidden'; };
    const controls = [...dialog.querySelectorAll('button,input:not([type="file"]),select,a[href]')].filter(visible);
    const overflowing = controls.filter(node => { const r = node.getBoundingClientRect(); return r.left < Math.max(0, box.left) - 1 || r.right > Math.min(innerWidth, box.right) + 1; }).map(node => node.id || node.textContent.trim().slice(0, 40));
    const close = dialog.querySelector('[data-close]')?.getBoundingClientRect();
    return { viewport: { width: innerWidth, height: innerHeight }, box: { left: box.left, top: box.top, right: box.right, bottom: box.bottom }, overflowing, scrollWidth: dialog.scrollWidth, clientWidth: dialog.clientWidth, close: close && { top: close.top, bottom: close.bottom, left: close.left, right: close.right } };
  });
  check(id, bounds.box.left >= -1 && bounds.box.right <= bounds.viewport.width + 1 && bounds.box.top >= -1 && bounds.box.bottom <= bounds.viewport.height + 1 && bounds.overflowing.length === 0 && bounds.scrollWidth <= bounds.clientWidth + 1 && bounds.close?.top >= 0 && bounds.close.bottom <= bounds.viewport.height, bounds);
}

try {
  try { execFileSync('git', ['cat-file', '-e', `${baseline}^{commit}`], { stdio: 'pipe' }); }
  catch { execFileSync('git', ['fetch', '--depth=1', 'origin', baseline], { stdio: 'pipe' }); }
  execFileSync('git', ['worktree', 'add', '--detach', baselineSource, baseline], { stdio: 'pipe' }); baselineAdded = true;
  await mkdir(join(baselineSource, 'node_modules'));
  for (const entry of await readdir(resolve('node_modules'))) await symlink(join(resolve('node_modules'), entry), join(baselineSource, 'node_modules', entry));
  execFileSync(process.execPath, ['scripts/build.mjs'], { cwd: baselineSource, stdio: 'pipe' });
  const oldBuild = JSON.parse(await readFile(join(baselineSource, 'dist', 'build.json'), 'utf8'));
  check('SC-clean-real-baseline', oldBuild.sha === baseline && !oldBuild.dirty, 'The actual approved source is independently built without modifying its runtime or manifest.');
  await cp(join(baselineSource, 'dist'), runtime, { recursive: true });
  await launch(); await seed();
  await page.locator('#settings-trigger').click();
  await shot('before-1440x1000');
  await page.setViewportSize({ width: 390, height: 844 }); await shot('before-390x844');
  const before = await raw(), oldId = extensionId;
  const nativeBefore = await page.evaluate(() => chrome.storage.local.get(['native.title', 'native.icon', 'native.bookmarks', 'native.homeMode']));
  await close();
  await cp(resolve('dist'), runtime, { recursive: true });
  for (const [name, digest] of Object.entries(build.files)) assert.equal(createHash('sha256').update(await readFile(join(runtime, name))).digest('hex'), digest, `Unchanged candidate runtime: ${name}`);
  await launch();
  check('SC-upgrade-same-extension-id', extensionId === oldId, 'Old and new packages occupy the same unpacked extension path and browser Profile; no uninstall.');
  assert.deepEqual(await raw(), before);
  assert.deepEqual(await page.evaluate(() => chrome.storage.local.get(['native.title', 'native.icon', 'native.bookmarks', 'native.homeMode'])), nativeBefore);
  check('SC-upgrade-retains-old-database-and-preferences', true, 'Database version, 12 stores, every stored record/key, removed entry, activity and existing native preferences are exactly retained.');

  // Main acceptance cases are below; all navigation and writes use production controls.
  await page.locator('#settings-trigger').click();
  await shot('after-1440x1000');
  check('SC-four-settings-categories', await page.locator('#settings-dialog [id^="settings-nav-"]').count() === 4, 'Four compact categories; daily bookmarks are not duplicated in another category.');
  for (const name of ['newtab', 'workspace', 'data', 'about']) {
    await section(name);
    check(`SC-category-${name}`, await page.locator(`#settings-panel-${name}`).isVisible(), 'The corresponding panel is reachable by its visible navigation control.');
    await shot(`after-${name}-1440x1000`);
  }

  await section('newtab');
  const dailyText = await page.locator('#settings-panel-newtab').innerText();
  check('SC-no-engineering-status-in-daily-settings', !/Source Gate|UNKNOWN|NONE|PROJECT|OpenDay|适配器|账号空间未验证/.test(dailyText) && await page.locator('#settings-dialog #mode-toggle').count() === 0, 'Daily settings contain neither internal provenance codes nor a duplicated life/workspace mode switch.');
  await page.locator('#tab-title').fill('尚未保存的名称');
  await section('workspace'); await section('newtab');
  check('SC-draft-survives-category-roundtrip', await page.locator('#tab-title').inputValue() === '尚未保存的名称' && await page.title() !== '尚未保存的名称', 'An unfinished safe text edit survives category navigation without committing itself.');
  await page.locator('#tab-title').fill('我的 Start'); await page.locator('#tab-title-form button[type="submit"]').click();
  await page.waitForFunction(() => document.title === '我的 Start');
  check('SC-title-independent-from-icon', (await page.locator('#tab-favicon').getAttribute('href')).endsWith(`tab-${family}.svg`), 'Saving the tab name preserves the independently selected browser-style icon.');
  await page.locator('#tab-icon').selectOption('product');
  await page.waitForFunction(() => document.querySelector('#tab-favicon').href.endsWith('tab-product.svg'));
  check('SC-icon-independent-from-title', await page.title() === '我的 Start', 'An immediate icon selection preserves the saved tab name.');
  const png = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = c.height = 48; const ctx = c.getContext('2d'); ctx.fillStyle = '#364f54'; ctx.fillRect(0, 0, 48, 48); return c.toDataURL('image/png').split(',')[1]; });
  await page.locator('#tab-icon-upload').setInputFiles({ name: 'synthetic-icon.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await page.waitForFunction(() => document.querySelector('#tab-favicon').href.startsWith('data:image/png;base64,'));
  const savedIcon = await page.locator('#tab-favicon').getAttribute('href');
  check('SC-valid-upload-real-browser-decode', savedIcon.length > 100, 'The production decoder re-encodes a valid isolated PNG and updates the tab favicon.');
  await page.evaluate(() => { document.querySelector('#native-status').textContent = ''; });
  await page.locator('#tab-icon-upload').setInputFiles({ name: 'invalid.png', mimeType: 'image/png', buffer: Buffer.from('<svg onload="alert(1)"/>') });
  await page.waitForFunction(() => document.querySelector('#tab-icon-upload').value === '' && document.querySelector('#native-status').textContent.length > 0);
  check('SC-invalid-upload-preserves-previous-identity', (await page.locator('#tab-favicon').getAttribute('href')) === savedIcon && await page.title() === '我的 Start', 'An invalid upload reports a nearby failure and retains both existing settings.');
  await shot('after-upload-failure');

  await page.evaluate(() => {
    window.__settingsOriginalSet = chrome.storage.local.set.bind(chrome.storage.local); window.__settingsFailedWrites = 0;
    chrome.storage.local.set = async value => { if ('native.title' in value) { window.__settingsFailedWrites++; throw Error('Synthetic settings storage failure'); } return window.__settingsOriginalSet(value); };
  });
  await page.locator('#tab-title').fill('失败后仍可重试'); await page.locator('#tab-title-form button[type="submit"]').click();
  await page.waitForFunction(() => window.__settingsFailedWrites === 1 && document.querySelector('#native-status').textContent.length > 0);
  check('SC-save-failure-keeps-value-and-draft', await page.title() === '我的 Start' && await page.locator('#tab-title').inputValue() === '失败后仍可重试', 'Injected write rejection retains the persisted title and the unfinished edit for retry.');
  await shot('after-save-failure');
  await page.evaluate(() => { chrome.storage.local.set = window.__settingsOriginalSet; });
  await page.locator('#tab-title-form button[type="submit"]').click();
  await page.waitForFunction(() => document.title === '失败后仍可重试');
  check('SC-save-retry-recovers', true, 'The same visible Save operation succeeds after the named injected storage fault is removed.');

  for (const value of ['always', 'hidden', 'newtab']) {
    await page.locator('#bookmark-preference').selectOption(value);
    await waitForAsync(page, async value => (await chrome.storage.local.get('native.bookmarks'))['native.bookmarks'] === value, value);
  }
  check('SC-three-bookmark-behaviors-persist', await page.locator('#bookmarks-home').isHidden(), 'All three preferences persist; without an actual bookmark grant the homepage reveals no bookmark content.');
  await page.evaluate(() => { window.__settingsPermissionRequest = null; chrome.permissions.request = async value => { window.__settingsPermissionRequest = value; return false; }; });
  await page.locator('#bookmark-connect').click();
  await page.waitForFunction(() => window.__settingsPermissionRequest?.permissions?.includes('bookmarks'));
  check('SC-bookmark-permission-refusal', !(await page.evaluate(() => chrome.permissions.contains({ permissions: ['bookmarks'] }))) && await page.locator('#bookmarks-home').isHidden(), 'Explicitly injected refusal requests bookmarks alone and leaves data and the bookmark shelf unchanged.');
  await shot('after-bookmark-permission-refusal');

  await section('workspace');
  check('SC-disconnected-capture-not-misrepresented', !await page.locator('#capture-enabled').isChecked() && await page.locator('#capture-enabled').isDisabled(), 'Disconnected ChatGPT is not represented as an actively running capture switch.');
  await page.locator('#connect-chatgpt').click();
  await page.waitForFunction(() => window.__settingsPermissionRequest?.origins?.includes('https://chatgpt.com/*'));
  check('SC-chatgpt-permission-refusal-independent', !(await command('SNAPSHOT')).capabilities.chatgpt && !await page.locator('#capture-enabled').isChecked(), 'A named ChatGPT permission refusal cannot enable collection or grant history access.');
  await shot('after-chatgpt-permission-refusal');
  const oldZone = (await command('SNAPSHOT')).settings.libraryTimeZone, activitiesBeforeZone = (await raw()).values.openDays;
  await page.evaluate(() => { document.querySelector('#timezone-status').textContent = ''; });
  await page.locator('#time-zone').fill('Mars/Olympus'); await page.locator('#timezone-form button[type="submit"]').click();
  await page.waitForFunction(() => document.querySelector('#timezone-status').textContent.length > 0);
  check('SC-invalid-timezone-preserves-setting', (await command('SNAPSHOT')).settings.libraryTimeZone === oldZone, 'An invalid IANA time zone is rejected near the field and cannot replace the saved zone.');
  await page.locator('#time-zone').fill('Asia/Shanghai'); await page.locator('#timezone-form button[type="submit"]').click();
  await waitForAsync(page, async () => { const r = await chrome.runtime.sendMessage({ protocol: 'vaiwl-start-internal/1', operationId: crypto.randomUUID(), expectedRevision: 0, command: 'SNAPSHOT', payload: {} }); return r.ok && r.data.settings.libraryTimeZone === 'Asia/Shanghai'; });
  assert.deepEqual((await raw()).values.openDays, activitiesBeforeZone);
  check('SC-timezone-changes-projection-not-original-activity', true, 'Saving a valid library time zone changes the persisted preference while every original OpenDay record retains its prior time zone and dates.');
  await page.locator('#settings-import').click();
  await page.locator('#import-dialog').waitFor();
  check('SC-import-discoverable-with-independent-options', await page.locator('#import-range').isVisible() && await page.locator('#include-synced').isVisible() && await page.locator('#confirm-import').isVisible(), 'Import has a direct workspace entry, explicit range, synced-history option and its own permission action.');
  await shot('after-history-permission');
  await page.locator('#import-range').selectOption('all'); await page.locator('#include-synced').check();
  await page.keyboard.press('Escape');
  await page.locator('#import-dialog').waitFor({ state: 'hidden' });
  check('SC-nested-escape-returns-to-parent', await page.locator('#settings-dialog').isVisible() && await page.evaluate(() => document.activeElement?.id === 'settings-import'), 'Escape dismisses the import layer, retains the settings parent and restores its initiating control.');
  await page.locator('#settings-import').click();
  check('SC-import-unsubmitted-options-preserved', await page.locator('#import-range').inputValue() === 'all' && await page.locator('#include-synced').isChecked(), 'Returning to an unfinished import retains the selected range and synced-history choice.');
  await page.locator('#import-dialog [data-close]').first().click();

  await section('data');
  const beforeClear = await raw();
  await page.locator('#clear-local').click();
  await page.locator('#clear-dialog').waitFor();
  const clearText = await page.locator('#clear-dialog').innerText();
  check('SC-danger-scope-explicit', /ChatGPT/.test(clearText) && /书签/.test(clearText) && /不能撤销|不可恢复|无法撤销/.test(clearText), 'The separate destructive confirmation states its scope and explicitly protects native ChatGPT conversations and bookmarks.');
  await shot('after-clear-confirmation');
  await page.keyboard.press('Escape'); await page.locator('#clear-dialog').waitFor({ state: 'hidden' });
  assert.deepEqual(await raw(), beforeClear);
  check('SC-danger-cancel-has-no-effects', await page.evaluate(() => document.activeElement?.id === 'clear-local'), 'Cancelling the destructive layer preserves every database value and returns focus to Clear.');
  await page.locator('#show-removed').click(); await page.locator('#removed-dialog').waitFor();
  check('SC-removed-record-restore-reachable', await page.locator('[data-restore-record="staging:settings-removed"]').isVisible(), 'The pre-upgrade removed record remains recoverable from Data and Privacy.');
  await shot('after-removed-records');
  await page.locator('[data-restore-record="staging:settings-removed"]').click();
  await waitForAsync(page, async () => { const r = await chrome.runtime.sendMessage({ protocol: 'vaiwl-start-internal/1', operationId: crypto.randomUUID(), expectedRevision: 0, command: 'SNAPSHOT', payload: {} }); return r.ok && !r.data.tombstones.length && r.data.conversations.some(c => c.key === 'staging:settings-removed'); });
  const restored = (await raw()).values.conversations.find(c => c.key === 'staging:settings-removed');
  const { revision: oldRemovedRevision, ...oldRemovedFields } = beforeClear.values.tombstones[0].record;
  const { revision: restoredRevision, ...restoredFields } = restored;
  assert.deepEqual(restoredFields, oldRemovedFields);
  check('SC-restore-writes-original-record', restoredRevision > oldRemovedRevision, 'The actual Restore button removes the tombstone and returns the original key, title, URL, ownership and membership; only the mutation revision advances.');
  await page.keyboard.press('Escape'); await page.locator('#removed-dialog').waitFor({ state: 'hidden' });
  await section('newtab'); await section('legacy');
  check('SC-legacy-compatibility-reachable', await page.locator('#legacy-sites').isVisible() && await page.locator('#bookmark-migrate').isVisible(), 'Legacy edit and native bookmark migration remain reachable in one subordinate area.');
  await shot('after-legacy-websites');
  await page.locator('#legacy-sites').click(); await page.locator('#sites-dialog').waitFor();
  check('SC-legacy-original-data-visible', await page.getByRole('link', { name: '打开 合成测试旧快捷网站', exact: true }).isVisible(), 'The stored old shortcut survives the UI redesign and opens in the actual compatibility editor.');
  await page.keyboard.press('Escape'); await page.locator('#sites-dialog').waitFor({ state: 'hidden' });
  await page.locator('#settings-back').click();
  check('SC-detail-back-restores-parent', await page.locator('#settings-panel-newtab').isVisible(), 'The detail back action restores the parent category without dismissing settings.');
  await section('about'); await section('diagnostics');
  check('SC-honest-technical-diagnostics-retained', (await page.locator('#source-details').textContent()).includes(build.sha) && await page.locator('a[href="source-check.html"]').isVisible(), 'Exact build SHA and the controlled source-check entry remain in the low-frequency diagnostic detail.');
  await shot('after-diagnostics');
  await page.locator('#settings-back').click();

  for (const viewport of [{ width: 1440, height: 1000 }, { width: 960, height: 720 }, { width: 720, height: 800 }, { width: 390, height: 844 }, { width: 320, height: 640 }]) {
    await page.setViewportSize(viewport);
    for (const name of ['newtab', 'workspace', 'data', 'about']) {
      await section(name); await assertBounds(`SC-bounds-${name}-${viewport.width}x${viewport.height}`);
      if (viewport.width === 390) await shot(`after-${name}-390x844`);
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  for (const zoom of [1.25, 1.5]) {
    const zoomState = await page.evaluate(async zoom => { const tab = await chrome.tabs.getCurrent(); await chrome.tabs.setZoom(tab.id, zoom); return { zoom: await chrome.tabs.getZoom(tab.id), tabId: tab.id }; }, zoom);
    check(`SC-browser-zoom-${zoom}`, zoomState.zoom === zoom, zoomState);
    await section('newtab'); await assertBounds(`SC-zoom-bounds-newtab-${zoom}`);
    await section('workspace'); await assertBounds(`SC-zoom-bounds-workspace-${zoom}`);
    await shot(`after-zoom-${Math.round(zoom * 100)}`);
  }
  await page.evaluate(async () => { const tab = await chrome.tabs.getCurrent(); await chrome.tabs.setZoom(tab.id, 1); });
  await section('newtab');
  await page.locator('#tab-title').focus();
  const escapedFocus = [];
  for (let n = 0; n < 64; n++) {
    const key = n < 32 ? 'Tab' : 'Shift+Tab'; await page.keyboard.press(key);
    const focus = await page.evaluate(() => ({ contained: document.querySelector('#settings-dialog').contains(document.activeElement), tag: document.activeElement?.tagName, id: document.activeElement?.id, hasDocumentFocus: document.hasFocus() }));
    if (!focus.contained) escapedFocus.push({ step: n + 1, key, ...focus });
  }
  check('SC-keyboard-focus-contained', escapedFocus.length === 0, { description: 'Modal keyboard traversal keeps focus inside the settings surface.', escapedFocus });
  const unnamed = await page.locator('#settings-dialog').evaluate(root => [...root.querySelectorAll('button,input:not([type="hidden"]):not([type="file"]),select')].filter(n => n.getBoundingClientRect().width > 0 && !n.disabled).filter(n => {
    const labelled = (n.getAttribute('aria-label') || '') + (n.getAttribute('aria-labelledby') || '').split(/\s+/).map(id => document.getElementById(id)?.textContent || '').join(' ') + [...(n.labels || [])].map(label => label.textContent).join(' ') + (n.tagName === 'BUTTON' ? n.textContent : '');
    return !labelled.trim();
  }).map(n => n.id || n.outerHTML.slice(0, 120)));
  check('SC-controls-have-accessible-names', unnamed.length === 0, unnamed);
  await page.keyboard.press('Escape'); await page.locator('#settings-dialog').waitFor({ state: 'hidden' });
  check('SC-close-restores-trigger-focus', await page.evaluate(() => document.activeElement?.id === 'settings-trigger'), 'Escape closes settings and returns keyboard focus to the original gear button.');

  await page.locator('#mode-toggle').click(); await page.waitForSelector('html[data-home-mode="life"]');
  await waitForAsync(page, async () => (await chrome.storage.local.get('native.homeMode'))['native.homeMode'] === 'life');
  await page.reload(); await ready();
  await page.locator('#settings-trigger').click(); await section('about'); await section('newtab');
  const unrequested = await page.evaluate(() => ({ commands: window.__settingsCommands, opens: window.__settingsDatabaseReads }));
  check('SC-life-common-settings-zero-work-reads', !unrequested.commands.includes('SNAPSHOT') && unrequested.opens === 0 && await page.locator('#workspace-content').isHidden(), unrequested);
  await shot('after-life-common-settings');
  await section('workspace');
  await page.waitForFunction(() => window.__settingsCommands.includes('SNAPSHOT'));
  check('SC-life-explicit-work-settings-without-mode-switch', await page.getAttribute('html', 'data-home-mode') === 'life' && await page.locator('#workspace-content').isHidden() && await page.locator('.conversation-row:visible,[data-record-key]:visible').count() === 0, 'Only the deliberate AI settings action loads workspace metadata; no conversation material or work homepage is exposed.');
  await section('newtab');
  await page.evaluate(() => { window.__settingsCommands = []; });
  await section('about'); await closeSettings();
  check('SC-life-work-access-cleared-on-leave', !await page.evaluate(() => window.__settingsCommands.includes('SNAPSHOT')) && await page.locator('#workspace-content').isHidden(), 'Leaving work settings returns to the no-work-read common settings path and retains life mode.');
  await close(); await launch();
  check('SC-full-browser-restart-persists-settings', await page.title() === '失败后仍可重试' && (await page.locator('#tab-favicon').getAttribute('href')) === savedIcon && await page.getAttribute('html', 'data-home-mode') === 'life' && !await page.evaluate(() => window.__settingsCommands.includes('SNAPSHOT')), 'A complete isolated browser process restart retains custom identity and life mode without reading the workspace.');
  await page.locator('#settings-trigger').click(); await section('newtab'); await page.locator('#tab-identity-reset').click();
  await page.waitForFunction(() => !['我的 Start', '失败后仍可重试'].includes(document.title));
  check('SC-identity-reset-only', (await page.locator('#tab-favicon').getAttribute('href')).endsWith(`tab-${family}.svg`) && (await page.evaluate(() => chrome.storage.local.get('native.bookmarks')))['native.bookmarks'] === 'newtab' && await page.getAttribute('html', 'data-home-mode') === 'life', 'Restore identity resets title and icon together without changing bookmark behavior or current mode.');

  // Actual permission states and real browser APIs. Only the temporary manifest
  // controls initial grants; after restart they become optional and are revoked normally.
  await close();
  const productionManifest = JSON.parse(await readFile(join(runtime, 'manifest.json'), 'utf8'));
  const required = ['bookmarks', 'history', 'scripting', 'webNavigation'];
  await writeFile(join(runtime, 'manifest.json'), JSON.stringify({ ...productionManifest, permissions: [...productionManifest.permissions, ...required], optional_permissions: productionManifest.optional_permissions.filter(p => !required.includes(p)), host_permissions: ['https://chatgpt.com/*'], optional_host_permissions: [] }));
  const grantProfile = join(root, 'granted-profile');
  await launch(grantProfile); await seed();
  const actualGrants = await worker.evaluate(() => chrome.permissions.getAll());
  check('SC-real-granted-permissions', required.every(p => actualGrants.permissions.includes(p)) && actualGrants.origins.includes('https://chatgpt.com/*'), 'A temporary isolated manifest pre-grants actual browser capabilities; production JavaScript remains byte-identical.');
  await section('workspace');
  check('SC-connected-status-with-paused-capture', (await command('SNAPSHOT')).capabilities.chatgpt && !await page.locator('#capture-enabled').isChecked() && !await page.locator('#capture-enabled').isDisabled(), 'Actual connection permission and the independent saved capture toggle are represented separately.');
  await page.locator('#capture-enabled').check();
  await waitForAsync(page, async () => { const r = await chrome.runtime.sendMessage({ protocol: 'vaiwl-start-internal/1', operationId: crypto.randomUUID(), expectedRevision: 0, command: 'SNAPSHOT', payload: {} }); return r.ok && r.data.settings.captureEnabled; });
  await shot('after-connected-collecting');
  await page.locator('#capture-enabled').uncheck();
  await waitForAsync(page, async () => { const r = await chrome.runtime.sendMessage({ protocol: 'vaiwl-start-internal/1', operationId: crypto.randomUUID(), expectedRevision: 0, command: 'SNAPSHOT', payload: {} }); return r.ok && !r.data.settings.captureEnabled; });
  check('SC-pause-is-persisted-without-disconnecting', (await command('SNAPSHOT')).capabilities.chatgpt, 'Pausing writes the real repository setting while preserving the separate ChatGPT permission.');
  await close(); await writeFile(join(runtime, 'manifest.json'), JSON.stringify(productionManifest)); await launch(grantProfile);
  check('SC-real-optional-grants-survive-restart', (await command('SNAPSHOT')).capabilities.chatgpt && (await command('SNAPSHOT')).capabilities.history && !await page.locator('#capture-enabled').isChecked(), 'The same profile and extension path retain the real grants and paused setting when the production optional manifest is restored.');

  const folder = await worker.evaluate(async () => { const roots = (await chrome.bookmarks.getTree())[0].children; const bar = roots.find(n => n.folderType === 'bookmarks-bar') || roots.find(n => n.id === '1'); return (await chrome.bookmarks.create({ parentId: bar.id, title: '设置迁移目标（合成测试）' })).id; });
  await command('SHORTCUT_UPSERT', { shortcut: { label: '第二个合成快捷网站', url: 'https://example.com/second' } });
  await command('SHORTCUT_UPSERT', { shortcut: { label: '第三个合成快捷网站', url: 'https://example.com/third' } });
  const legacyBeforeMigration = (await command('SNAPSHOT')).shortcuts;
  await worker.evaluate(async parentId => chrome.bookmarks.create({ parentId, title: '已有网址（合成测试）', url: 'https://example.com/retained' }), folder);
  await section('newtab'); await section('legacy');
  await page.locator(`#bookmark-destination option[value="${folder}"]`).waitFor({ state: 'attached' });
  await page.locator('#bookmark-destination').selectOption(folder);
  await page.evaluate(() => {
    window.__settingsRealBookmarkCreate = chrome.bookmarks.create.bind(chrome.bookmarks); window.__settingsBookmarkCreateCalls = 0;
    chrome.bookmarks.create = async value => { if (++window.__settingsBookmarkCreateCalls === 2) throw Error('Synthetic second-create rejection'); return window.__settingsRealBookmarkCreate(value); };
  });
  page.once('dialog', dialog => dialog.accept()); await page.locator('#bookmark-migrate').click();
  await page.waitForFunction(() => window.__settingsBookmarkCreateCalls === 2 && document.querySelector('#bookmark-migration-status').textContent.includes('迁移中断') && !document.querySelector('#bookmark-migrate').disabled);
  const partialBookmarks = await worker.evaluate(parentId => chrome.bookmarks.getChildren(parentId), folder);
  assert.deepEqual((await command('SNAPSHOT')).shortcuts, legacyBeforeMigration);
  check('SC-migration-partial-failure-retains-real-progress', partialBookmarks.length === 2 && partialBookmarks.some(n => n.url === 'https://example.com/second') && !partialBookmarks.some(n => n.url === 'https://example.com/third'), 'Only the second create is explicitly rejected; the first real browser bookmark survives, all three original shortcut records are unchanged and the nearby status accurately reports interruption.');
  await shot('after-bookmark-migration-partial-failure');
  await page.evaluate(() => { chrome.bookmarks.create = window.__settingsRealBookmarkCreate; });
  page.once('dialog', dialog => dialog.accept()); await page.locator('#bookmark-migrate').click();
  await waitForAsync(page, async parentId => (await chrome.bookmarks.getChildren(parentId)).some(n => n.url === 'https://example.com/third'), folder);
  const migrated = await worker.evaluate(parentId => chrome.bookmarks.getChildren(parentId), folder);
  assert.deepEqual((await command('SNAPSHOT')).shortcuts, legacyBeforeMigration);
  check('SC-real-native-folder-migration-deduplicates', migrated.length === 3 && migrated.filter(n => n.url === 'https://example.com/second').length === 1 && (await command('SNAPSHOT')).shortcuts.length === 3, 'Retry in the selected nested folder skips the pre-existing URL and the first successful write, creates only the remaining bookmark and retains every legacy record.');
  page.once('dialog', dialog => dialog.accept()); await page.locator('#bookmark-migrate').click();
  await page.waitForFunction(() => !document.querySelector('#bookmark-migrate').disabled);
  check('SC-repeat-migration-is-idempotent', (await worker.evaluate(parentId => chrome.bookmarks.getChildren(parentId), folder)).length === 3, 'Repeating migration through the visible control creates no duplicate native bookmark.');
  await shot('after-native-bookmark-migration');

  await section('workspace');
  const historyUrls = Array.from({ length: 5 }, (_, n) => `https://chatgpt.com/c/80000000-0000-4000-8000-${String(n + 20).padStart(12, '0')}`);
  await worker.evaluate(async urls => { for (const url of urls) await chrome.history.addUrl({ url }); }, historyUrls);
  check('SC-history-does-not-imply-capture', !(await command('SNAPSHOT')).settings.captureEnabled && (await command('SNAPSHOT')).conversations.length === 1, 'History access and synthetic visits do not auto-enable the paused collector.');
  await page.locator('#settings-import').click(); await page.locator('#import-range').selectOption('all');
  const safeImportOptions = { range: await page.locator('#import-range').inputValue(), synced: await page.locator('#include-synced').isChecked() };
  await page.locator('#confirm-import').click();
  await waitForAsync(page, async () => { const r = await chrome.runtime.sendMessage({ protocol: 'vaiwl-start-internal/1', operationId: crypto.randomUUID(), expectedRevision: 0, command: 'SNAPSHOT', payload: {} }); return r.ok && r.data.importJobs.some(j => j.state === 'complete'); });
  const imported = await command('SNAPSHOT');
  check('SC-real-history-import-while-capture-paused', imported.conversations.length === 6 && !imported.settings.captureEnabled && imported.conversations.filter(c => historyUrls.includes(c.canonicalUrl)).every(c => c.activity === null), 'The explicit import UI reads five real synthetic chrome.history entries while automatic capture stays paused and creates no active-open fact.');
  await page.locator('#confirm-import').waitFor({ state: 'visible' });
  const completedOptionsRestored = await page.locator('#import-range').isVisible() && await page.locator('#include-synced').isVisible() && await page.locator('#import-range').inputValue() === safeImportOptions.range && await page.locator('#include-synced').isChecked() === safeImportOptions.synced;
  await shot('after-history-complete');

  // Hold the real browser search result, not repository writes, to exercise the
  // visible pause/resume/cancel controls while an actual import batch is in flight.
  await worker.evaluate(() => {
    globalThis.__settingsHistorySearch = chrome.history.search.bind(chrome.history); globalThis.__settingsHeldSearches = [];
    chrome.history.search = async query => { const result = await globalThis.__settingsHistorySearch(query); return new Promise(resolve => globalThis.__settingsHeldSearches.push(() => resolve(result))); };
  });
  await page.locator('#confirm-import').click(); await page.locator('[data-import-pause]').waitFor();
  const managedJobId = await page.locator('[data-import-pause]').getAttribute('data-import-pause');
  check('SC-running-import-has-one-task-control-set', await page.locator('#confirm-import').isHidden() && await page.locator('#import-range').isHidden() && await page.locator('#include-synced').isHidden(), 'A running real import exposes its progress, Pause and Cancel controls without simultaneously offering to create another import.');
  await page.locator('[data-import-pause]').click();
  await page.locator('[data-import-resume]').waitFor();
  check('SC-import-pause-live-control', (await command('SNAPSHOT')).importJobs.some(j => j.state === 'paused'), 'The visible Pause command persists an actual paused checkpoint during a named delayed-search interleaving.');
  await page.locator('#import-dialog [data-close]').first().click(); await page.locator('#settings-import').click(); await page.locator('[data-import-resume]').waitFor();
  check('SC-paused-import-reopen-keeps-task-and-controls', await page.locator('[data-import-resume]').getAttribute('data-import-resume') === managedJobId && await page.locator('#confirm-import').isHidden() && await page.locator('#import-range').isHidden() && await page.locator('#include-synced').isHidden(), 'Closing and reopening a paused import preserves the exact task ID and its Resume/Cancel actions; hidden new-task inputs remain retained, and closing does not cancel the task.');
  await shot('after-history-paused');
  await worker.evaluate(() => { chrome.history.search = globalThis.__settingsHistorySearch; for (const release of globalThis.__settingsHeldSearches.splice(0)) release(); });
  await page.locator('[data-import-resume]').click();
  await waitForAsync(page, async () => { const r = await chrome.runtime.sendMessage({ protocol: 'vaiwl-start-internal/1', operationId: crypto.randomUUID(), expectedRevision: 0, command: 'SNAPSHOT', payload: {} }); return r.ok && r.data.importJobs.length === 2 && r.data.importJobs.every(j => j.state === 'complete'); });
  check('SC-import-resume-deduplicates', (await command('SNAPSHOT')).conversations.length === 6, 'Resume completes the same saved import without duplicating previously imported conversations.');
  await worker.evaluate(() => { globalThis.__settingsHeldSearches = []; chrome.history.search = async query => { const result = await globalThis.__settingsHistorySearch(query); return new Promise(resolve => globalThis.__settingsHeldSearches.push(() => resolve(result))); }; });
  await page.evaluate(() => {
    window.__settingsBeforeLateBatchProbe = chrome.runtime.sendMessage.bind(chrome.runtime);
    window.__settingsCancelProbeJob = null; window.__settingsLateStepReply = null; window.__settingsPostStepSnapshot = null;
    chrome.runtime.sendMessage = async (...args) => {
      const message = args[0], startsAfterLateStep = message?.protocol === 'vaiwl-start-internal/1' && message?.command === 'SNAPSHOT' && !!window.__settingsLateStepReply;
      const reply = await window.__settingsBeforeLateBatchProbe(...args);
      if (message?.command === 'IMPORT_STEP' && message.payload.jobId === window.__settingsCancelProbeJob) window.__settingsLateStepReply = { jobId: message.payload.jobId, ok: reply?.ok, code: reply?.code };
      if (startsAfterLateStep) window.__settingsPostStepSnapshot = { ok: reply?.ok, jobId: window.__settingsCancelProbeJob, state: reply?.data?.importJobs?.find(job => job.id === window.__settingsCancelProbeJob)?.state };
      return reply;
    };
  });
  await page.locator('#confirm-import').click(); await page.locator('[data-import-cancel]').waitFor();
  const cancelledInFlightId = await page.locator('[data-import-cancel]').getAttribute('data-import-cancel');
  await page.evaluate(id => { window.__settingsCancelProbeJob = id; }, cancelledInFlightId);
  await waitForAsync(worker, () => globalThis.__settingsHeldSearches.length > 0);
  check('SC-immediate-next-import-starts', (await command('SNAPSHOT')).importJobs.some(job=>job.id===cancelledInFlightId&&job.state==='running'), 'Starting a different import immediately after completion reaches the native history read even while the previous driver finishes its last render delay.');
  await page.locator('[data-import-cancel]').click();
  await waitForAsync(page, async () => { const r = await chrome.runtime.sendMessage({ protocol: 'vaiwl-start-internal/1', operationId: crypto.randomUUID(), expectedRevision: 0, command: 'SNAPSHOT', payload: {} }); return r.ok && r.data.importJobs.some(j => j.state === 'cancelled'); });
  await worker.evaluate(() => { chrome.history.search = globalThis.__settingsHistorySearch; for (const release of globalThis.__settingsHeldSearches.splice(0)) release(); });
  // No test SNAPSHOT calls occur after release until the production error/recovery
  // chain has returned a fresh snapshot; two animation frames also pass its paint boundary.
  await page.waitForFunction(() => window.__settingsLateStepReply && window.__settingsPostStepSnapshot?.ok && window.__settingsPostStepSnapshot.state === 'cancelled');
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const lateBatchEvidence = await page.evaluate(() => ({ step: window.__settingsLateStepReply, snapshot: window.__settingsPostStepSnapshot, status: document.querySelector('#import-status').textContent, error: document.querySelector('#import-status').dataset.error }));
  check('SC-cancelled-import-ignores-stale-batch-error', lateBatchEvidence.step.ok === false && /revision|conflict/i.test(lateBatchEvidence.step.code || '') && lateBatchEvidence.snapshot.jobId === cancelledInFlightId && lateBatchEvidence.error !== 'true' && !/另一标签页|请重试|没有完成|失败/.test(lateBatchEvidence.status), { description: 'The genuinely delayed IMPORT_STEP is rejected by the revision fence after Cancel. Its subsequent production SNAPSHOT confirms the same cancelled task; after the render boundary the UI reports no stale batch error.', ...lateBatchEvidence });
  await page.evaluate(() => { chrome.runtime.sendMessage = window.__settingsBeforeLateBatchProbe; });
  check('SC-import-cancel-retains-completed-results', (await command('SNAPSHOT')).conversations.length === 6, 'Cancel terminates the new checkpoint while preserving already retained local results.');
  await page.locator('#confirm-import').waitFor({ state: 'visible' });
  check('SC-terminal-import-restores-retained-new-task-options', completedOptionsRestored && await page.locator('#import-range').isVisible() && await page.locator('#include-synced').isVisible() && await page.locator('#import-range').inputValue() === safeImportOptions.range && await page.locator('#include-synced').isChecked() === safeImportOptions.synced && (await page.locator('[data-import-resume]').textContent()).includes('继续上次导入'), 'Completed and cancelled imports restore the new-import entry and the original safe range/synced choices. A cancelled checkpoint clearly labels its separate action as continuing the previous import.');
  await shot('after-history-cancelled');
  await page.locator('#import-dialog [data-close]').first().click();

  // Named UI capability fixture: the real grant stays present, while SNAPSHOT
  // reports no history access so cancelled-task recovery must ask for permission.
  const cancelledWithoutPermission = (await raw()).values.importJobs.find(job => job.state === 'cancelled');
  await page.evaluate(() => {
    window.__settingsBeforeCancelledRead = chrome.runtime.sendMessage.bind(chrome.runtime);
    window.__settingsBeforeCancelledRequest = chrome.permissions.request.bind(chrome.permissions);
    window.__settingsCancelledAuthorizationRequests = 0; window.__settingsCommands = [];
    chrome.runtime.sendMessage = async (...args) => { const reply = await window.__settingsBeforeCancelledRead(...args); if (args[0]?.protocol === 'vaiwl-start-internal/1' && args[0]?.command === 'SNAPSHOT' && reply?.ok) reply.data.capabilities.history = false; return reply; };
    chrome.permissions.request = async value => { if (value.permissions?.includes('history')) { window.__settingsCancelledAuthorizationRequests++; return false; } return window.__settingsBeforeCancelledRequest(value); };
  });
  await section('workspace'); await page.locator('#settings-import').click(); await page.locator('[data-import-authorize-resume]').waitFor();
  const cancelledRecoveryLabel = await page.locator('[data-import-authorize-resume]').textContent();
  await page.locator('[data-import-authorize-resume]').click();
  await page.waitForFunction(() => window.__settingsCancelledAuthorizationRequests === 1 && document.querySelector('#import-status').textContent.includes('未授予') && !document.querySelector('[data-import-authorize-resume]').disabled);
  assert.deepEqual((await raw()).values.importJobs.find(job => job.id === cancelledWithoutPermission.id), cancelledWithoutPermission);
  check('SC-cancelled-without-history-asks-before-resume', cancelledRecoveryLabel.includes('授权并继续上次导入') && !await page.evaluate(() => window.__settingsCommands.some(name => ['IMPORT_START', 'IMPORT_RESUME'].includes(name))), 'With an explicitly injected no-history SNAPSHOT and permission refusal, cancelled-task recovery requests authorization first, preserves the original checkpoint exactly and dispatches neither Resume nor Start.');
  await page.evaluate(() => { chrome.runtime.sendMessage = window.__settingsBeforeCancelledRead; chrome.permissions.request = window.__settingsBeforeCancelledRequest; });
  await page.locator('#import-dialog [data-close]').first().click();

  // Explicit state fixture: the browser grant remains real and present; only a
  // retained checkpoint is marked permission-revoked to cover its recovery UI.
  const revokedCheckpoint = await worker.evaluate(async () => {
    const db = await new Promise(resolve => { const r = indexedDB.open('vaiwl-start'); r.onsuccess = () => resolve(r.result); });
    const tx = db.transaction('importJobs', 'readwrite'), store = tx.objectStore('importJobs');
    const jobs = await new Promise(resolve => { const r = store.getAll(); r.onsuccess = () => resolve(r.result); });
    const job = jobs.find(item => item.state === 'cancelled'); if (!job?.pendingIntervals.length && !job?.pendingCandidates?.length) throw Error('Cancelled checkpoint must retain work');
    job.state = 'permission-revoked'; store.put(job);
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = () => reject(tx.error); }); db.close(); return job;
  });
  await section('workspace'); await page.locator('#settings-import').click();
  await page.locator('[data-import-authorize-resume]').waitFor();
  await page.evaluate(() => { window.__settingsRealRequest = chrome.permissions.request.bind(chrome.permissions); window.__settingsCommands = []; chrome.permissions.request = async () => false; });
  await page.locator('[data-import-authorize-resume]').click();
  await page.waitForFunction(() => document.querySelector('#import-status').textContent.includes('未授予') && !document.querySelector('[data-import-authorize-resume]').disabled);
  assert.deepEqual((await raw()).values.importJobs.find(job => job.id === revokedCheckpoint.id), revokedCheckpoint);
  check('SC-import-reauthorize-refusal-preserves-checkpoint', !await page.evaluate(() => window.__settingsCommands.some(name => ['IMPORT_START', 'IMPORT_RESUME'].includes(name))), 'An explicitly injected permission refusal preserves the same checkpoint ID, pending intervals, candidates and counts, and dispatches neither Start nor Resume.');
  await shot('after-history-reauthorize-refusal');
  await page.evaluate(() => { chrome.permissions.request = window.__settingsRealRequest; window.__settingsCommands = []; });
  await page.locator('[data-import-authorize-resume]').click();
  await waitForAsync(page, async id => { const r = await chrome.runtime.sendMessage({ protocol: 'vaiwl-start-internal/1', operationId: crypto.randomUUID(), expectedRevision: 0, command: 'SNAPSHOT', payload: {} }); return r.ok && r.data.importJobs.find(job => job.id === id)?.state === 'complete'; }, revokedCheckpoint.id);
  check('SC-import-reauthorize-resumes-same-job', (await command('SNAPSHOT')).importJobs.length === 3 && await page.evaluate(() => window.__settingsCommands.includes('IMPORT_RESUME') && !window.__settingsCommands.includes('IMPORT_START')), 'With the actual browser grant still present, the recovery button calls real IMPORT_RESUME for the original job and does not replace it with a new import.');
  await page.locator('#import-dialog [data-close]').first().click();

  // A life-page import is allowed only during the deliberate work-settings visit.
  const moreUrls = Array.from({ length: 257 }, (_, n) => `https://chatgpt.com/c/80000000-0000-4000-8001-${String(n + 1).padStart(12, '0')}`);
  await worker.evaluate(async urls => { for (const url of urls) await chrome.history.addUrl({ url }); }, moreUrls); historyUrls.push(...moreUrls);
  await closeSettings(); await page.locator('#mode-toggle').click(); await page.waitForSelector('html[data-home-mode="life"]');
  await page.locator('#settings-trigger').click(); await section('workspace'); await page.locator('#settings-import').click();
  await worker.evaluate(() => { globalThis.__settingsHeldSearches = []; chrome.history.search = async query => { const result = await globalThis.__settingsHistorySearch(query); return new Promise(resolve => globalThis.__settingsHeldSearches.push(() => resolve(result))); }; });
  await page.locator('#confirm-import').click(); await page.locator('[data-import-pause]').waitFor();
  await waitForAsync(worker, () => globalThis.__settingsHeldSearches.length > 0);
  const lifeJobId = (await command('SNAPSHOT')).importJobs.find(j => j.state === 'running').id;
  await page.locator('#import-dialog [data-close]').first().click(); await closeSettings();
  await page.evaluate(() => { window.__settingsCommands = []; });
  await worker.evaluate(() => { chrome.history.search = globalThis.__settingsHistorySearch; for (const release of globalThis.__settingsHeldSearches.splice(0)) release(); });
  await waitForAsync(worker, async id => { const db = await new Promise(resolve => { const r = indexedDB.open('vaiwl-start'); r.onsuccess = () => resolve(r.result); }); const job = await new Promise(resolve => { const r = db.transaction('importJobs').objectStore('importJobs').get(id); r.onsuccess = () => resolve(r.result); }); db.close(); return job?.state === 'running' && job.pendingCandidates?.length > 0; }, lifeJobId);
  check('SC-life-close-stops-after-inflight-batch', !await page.evaluate(() => window.__settingsCommands.includes('SNAPSHOT')) && await page.locator('#workspace-content').isHidden(), 'Closing settings allows the in-flight real batch to persist, then leaves a running checkpoint with remaining candidates and performs no new foreground workspace read.');
  await page.locator('#settings-trigger').click(); await section('workspace');
  await waitForAsync(page, async id => { const r = await chrome.runtime.sendMessage({ protocol: 'vaiwl-start-internal/1', operationId: crypto.randomUUID(), expectedRevision: 0, command: 'SNAPSHOT', payload: {} }); return r.ok && r.data.importJobs.find(j => j.id === id)?.state === 'complete'; }, lifeJobId);
  check('SC-life-reopen-resumes-existing-import', (await command('SNAPSHOT')).importJobs.length === 4 && (await command('SNAPSHOT')).conversations.length === 263 && await page.getAttribute('html', 'data-home-mode') === 'life', 'Reopening AI settings resumes the same checkpoint, keeps life mode and completes all synthetic candidates without another import job.');
  await page.locator('#settings-import').click();
  await worker.evaluate(() => { globalThis.__settingsHeldSearches = []; chrome.history.search = async query => { const result = await globalThis.__settingsHistorySearch(query); return new Promise(resolve => globalThis.__settingsHeldSearches.push(() => resolve(result))); }; });
  await page.locator('#confirm-import').click(); await page.locator('[data-import-pause]').waitFor(); await waitForAsync(worker, () => globalThis.__settingsHeldSearches.length > 0);
  const visibilityJobId = (await command('SNAPSHOT')).importJobs.find(j => j.state === 'running').id;
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
  await worker.evaluate(() => { chrome.history.search = globalThis.__settingsHistorySearch; for (const release of globalThis.__settingsHeldSearches.splice(0)) release(); });
  await waitForAsync(worker, async id => { const db = await new Promise(resolve => { const r = indexedDB.open('vaiwl-start'); r.onsuccess = () => resolve(r.result); }); const job = await new Promise(resolve => { const r = db.transaction('importJobs').objectStore('importJobs').get(id); r.onsuccess = () => resolve(r.result); }); db.close(); return job?.state === 'running' && job.pendingCandidates?.length > 0; }, visibilityJobId);
  await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
  await waitForAsync(page, async id => { const r = await chrome.runtime.sendMessage({ protocol: 'vaiwl-start-internal/1', operationId: crypto.randomUUID(), expectedRevision: 0, command: 'SNAPSHOT', payload: {} }); return r.ok && r.data.importJobs.find(j => j.id === id)?.state === 'complete'; }, visibilityJobId);
  check('SC-life-explicit-visit-visibility-resumes-import', (await command('SNAPSHOT')).importJobs.length === 5 && await page.getAttribute('html', 'data-home-mode') === 'life', 'A named visibility-state injection pauses after the in-flight batch and resumes the same real import only while the explicit AI settings visit remains active.');
  await page.locator('#import-dialog [data-close]').first().click(); await closeSettings();
  await page.locator('#mode-toggle').click(); await page.waitForSelector('html[data-home-mode="workspace"][data-start-ready="true"]');
  const externalBeforeClear = await worker.evaluate(async urls => ({ bookmarks: await chrome.bookmarks.getTree(), history: (await chrome.history.search({ text: '', startTime: 0, maxResults: 1000 })).filter(item => urls.includes(item.url)) }), historyUrls);
  await page.evaluate(() => {
    const original = chrome.runtime.sendMessage.bind(chrome.runtime); window.__settingsClearReadFaults = 0; let armed = false;
    chrome.runtime.sendMessage = async (...args) => {
      if (args[0]?.protocol === 'vaiwl-start-internal/1' && args[0]?.command === 'SNAPSHOT' && armed) { armed = false; window.__settingsClearReadFaults++; return { ok: false, code: 'SYNTHETIC_READ_FAILED' }; }
      const reply = await original(...args); if (args[0]?.command === 'CLEAR_LOCAL' && reply?.ok) armed = true; return reply;
    };
  });
  await section('data'); await page.locator('#clear-local').click(); await page.locator('#confirm-clear').click();
  await page.locator('#clear-dialog').waitFor({ state: 'hidden' });
  await page.waitForFunction(() => window.__settingsClearReadFaults === 1 && /操作已完成|本地数据已清除/.test(document.querySelector('#settings-status').textContent));
  check('SC-clear-success-survives-followup-read-failure', !/已有数据仍保留|操作没有完成/.test(await page.locator('#settings-status').textContent()), 'The real Clear succeeds; exactly its first subsequent SNAPSHOT is rejected. The confirmation closes and the UI acknowledges completion instead of falsely claiming that deleted data remains.');
  await waitForAsync(page, async () => { const r = await chrome.runtime.sendMessage({ protocol: 'vaiwl-start-internal/1', operationId: crypto.randomUUID(), expectedRevision: 0, command: 'SNAPSHOT', payload: {} }); return r.ok && !r.data.conversations.length && !r.data.shortcuts.length && !r.data.tombstones.length && !r.data.importJobs.length; });
  const cleared = await raw(), nativeAfterClear = await page.evaluate(() => chrome.storage.local.get(['native.title', 'native.icon', 'native.bookmarks', 'native.homeMode']));
  check('SC-confirmed-clear-removes-only-start-state', cleared.version === 1 && cleared.stores.length === 12 && Object.entries(cleared.values).filter(([name]) => !['settings', 'revisions'].includes(name)).every(([, rows]) => rows.length === 0) && Object.keys(nativeAfterClear).length === 0, 'Confirmed Clear empties Start catalog, activity, old shortcuts, removed records and native identity/mode preferences while retaining the existing v1 schema.');
  const externalAfterClear = await worker.evaluate(async urls => ({ bookmarks: await chrome.bookmarks.getTree(), history: (await chrome.history.search({ text: '', startTime: 0, maxResults: 1000 })).filter(item => urls.includes(item.url)) }), historyUrls);
  assert.deepEqual(externalAfterClear, externalBeforeClear);
  check('SC-clear-retains-real-bookmarks-and-history', true, 'Every native bookmark node and all 262 actual synthetic browser-history entries remain exactly unchanged by confirmed Start data deletion.');
  await shot('after-clear-completed');
  await section('workspace');
  await page.evaluate(() => {
    window.__settingsRealRemovePermission = chrome.permissions.remove.bind(chrome.permissions); window.__settingsRefusedHistoryRemovals = 0;
    chrome.permissions.remove = async value => { if (value.permissions?.includes('history')) { window.__settingsRefusedHistoryRemovals++; return false; } return window.__settingsRealRemovePermission(value); };
  });
  await page.locator('#revoke-history').click();
  await page.waitForFunction(() => window.__settingsRefusedHistoryRemovals === 1 && document.querySelector('#workspace-status').textContent.includes('未撤销') && !document.querySelector('#revoke-history').disabled);
  check('SC-history-revoke-false-keeps-honest-status', await page.evaluate(() => chrome.permissions.contains({ permissions: ['history'] })) && await page.locator('#revoke-history').isVisible(), 'A named remove=false injection keeps the actual history grant intact; the UI reports that revocation did not succeed and retains the retry control.');
  await shot('after-history-revocation-refused');
  await page.evaluate(() => { chrome.permissions.remove = window.__settingsRealRemovePermission; });
  await page.locator('#revoke-history').click();
  await waitForAsync(page, async () => !await chrome.permissions.contains({ permissions: ['history'] }));
  await page.waitForFunction(() => document.querySelector('#revoke-history').hidden);
  check('SC-real-history-permission-revocation', (await command('SNAPSHOT')).conversations.length === 0 && !(await command('SNAPSHOT')).capabilities.history, 'The real optional history grant is removed and the UI immediately stops representing it as authorized; the explicitly cleared catalog stays empty.');
  await page.locator('#capture-enabled').check();
  await waitForAsync(page, async () => { const r = await chrome.runtime.sendMessage({ protocol: 'vaiwl-start-internal/1', operationId: crypto.randomUUID(), expectedRevision: 0, command: 'SNAPSHOT', payload: {} }); return r.ok && r.data.settings.captureEnabled; });
  await page.locator('#connect-chatgpt').click();
  await waitForAsync(page, async () => !await chrome.permissions.contains({ origins: ['https://chatgpt.com/*'] }));
  await page.waitForFunction(() => document.querySelector('#capture-enabled').disabled && !document.querySelector('#capture-enabled').checked);
  check('SC-real-disconnect-stops-active-appearance', !(await command('SNAPSHOT')).capabilities.chatgpt && (await command('SNAPSHOT')).conversations.length === 0, 'Actual connection removal disables and unchecks the effective capture control without inventing or restoring any conversation.');
  await shot('after-disconnected');
  await section('newtab'); await page.locator('#bookmark-connect').click();
  await waitForAsync(page, async () => !await chrome.permissions.contains({ permissions: ['bookmarks'] }));
  check('SC-real-bookmark-permission-revocation', await page.locator('#bookmarks-home').isHidden(), 'Real native bookmark permission removal hides the shelf and invalidates the cached permission state.');
  await shot('after-permission-revoked');
  check('SC-no-runtime-errors', errors.length === 0, errors);
  status = 'PASS';
} catch (error) {
  checks.push({ id: 'SC-failure', status: 'FAIL', observed: String(error.stack || error) });
  if (page && !page.isClosed()) await shot('failure').catch(() => {});
  throw error;
} finally {
  await close();
  if (baselineAdded) execFileSync('git', ['worktree', 'remove', '--force', baselineSource], { stdio: 'pipe' });
  const receipt = { status, buildSha: build.sha, dirty: build.dirty, baseline, browserFamily: family, browserVersion, executable: process.env.VAIWL_CHROMIUM_EXECUTABLE || `playwright:${channel}`, checks, errors, screenshots, limitations: [
    'Every browser Profile, website entry and conversation is isolated and synthetic; no user database or signed-in ChatGPT page is accessed.',
    'Screenshots show the actually installed extension content. They do not prove browser-native tab-strip icons or operating-system UI.',
    'Permission refusal and storage exceptions, where named, are explicit fault injections. Temporary required-permission manifests exercise actual permission state and API behavior, not native consent-popup acceptance.',
  ] };
  await writeFile(join(out, 'validation.json'), JSON.stringify(receipt, null, 2));
  await writeFile(resolve('artifacts', `${family === 'edge' ? 'edge-' : ''}settings-consumer-validation.json`), JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify({ status, checks: checks.length, buildSha: build.sha, browserVersion }));
}
