import { chromium } from 'playwright';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

// Synthetic catalog writes exist only in this isolated test; no fixture hooks ship.
const directory = await mkdtemp(join(tmpdir(), 'vaiwl-ui-'));
const context = await chromium.launchPersistentContext(directory, {
  ...(process.env.VAIWL_CHROMIUM_EXECUTABLE ? { executablePath: process.env.VAIWL_CHROMIUM_EXECUTABLE } : { channel: 'chromium' }),
  headless: true, viewport: { width: 1440, height: 1080 },
  args: ['--no-sandbox', `--disable-extensions-except=${resolve('dist')}`, `--load-extension=${resolve('dist')}`],
});
const errors = [];
const checks = [];
const buildInfo = JSON.parse(await readFile('dist/build.json', 'utf8'));
const fontData = process.env.VAIWL_TEST_CJK_FONT ? (await readFile(process.env.VAIWL_TEST_CJK_FONT)).toString('base64') : null;
async function installTestFont(page) {
  if (!fontData) return;
  await page.evaluate(async data => {
    const bytes = Uint8Array.from(atob(data), char => char.charCodeAt(0));
    const font = new FontFace('VAIWL Review CJK', bytes);
    await font.load(); document.fonts.add(font);
    const sheet = new CSSStyleSheet();
    sheet.replaceSync('* { font-family: "VAIWL Review CJK", sans-serif !important; }');
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    await document.fonts.ready;
    if (!document.fonts.check('14px "VAIWL Review CJK"', '工作区')) throw Error('test-cjk-font-unavailable');
  }, fontData);
}
const check = (id, condition, observed) => { assert.ok(condition, `${id}: ${observed}`); checks.push({ id, status: 'PASS', observed }); };
try {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host;
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await context.route(/^https?:\/\//, route => route.abort());
  await page.goto(`chrome-extension://${id}/newtab.html`);
  await page.waitForSelector('html[data-start-ready="true"]');
  await installTestFont(page);
  check('UI-empty-real-extension', await page.getByText('让对话留在手边。', { exact: true }).isVisible(), 'Actual MV3 installation initially contains no synthetic data.');
  check('UI-no-autofocus', await page.evaluate(() => document.activeElement?.id !== 'search-input'), 'Local search does not take initial focus.');
  const permission = await worker.evaluate(() => chrome.permissions.getAll());
  check('UI-no-auto-permission', !['history', 'scripting', 'webNavigation'].some(name => permission.permissions?.includes(name)) && !permission.origins?.some(origin => origin.includes('chatgpt.com')), `Initial granted permissions: ${JSON.stringify(permission)}`);

  await page.getByRole('button', { name: '添加网站', exact: true }).click();
  await page.locator('#site-name').focus(); await page.keyboard.press('/');
  const slashEditor = await page.evaluate(() => ({ searchOpen: document.getElementById('search-dialog').open, text: document.getElementById('site-name').value }));
  await page.locator('#site-name').fill('First'); await page.locator('#site-url').fill('https://example.com/one');
  await page.locator('#save-site').click(); await page.getByRole('button', { name: '固定 First', exact: true }).waitFor();
  await page.locator('#site-name').fill('Second'); await page.locator('#site-url').fill('https://example.com/two');
  await page.locator('#save-site').click(); await page.getByRole('button', { name: '固定 Second', exact: true }).waitFor();
  await page.getByRole('button', { name: '固定 Second', exact: true }).click();
  await page.getByRole('button', { name: '取消固定 Second', exact: true }).waitFor();
  let sites = await page.locator('.edit-site-name').allTextContents();
  check('UI-pinning-preserves-order', sites.join('|') === 'First|Second', sites.join('|'));
  await page.getByRole('button', { name: '向前移动 Second', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.edit-site-name')?.textContent === 'Second');
  check('UI-keyboard-order-controls', (await page.locator('.edit-site-name').allTextContents()).join('|') === 'Second|First', 'Explicit order buttons persist user order.');
  await page.getByRole('button', { name: 'First', exact: true }).click();
  await page.locator('#site-name').fill('First edited'); await page.locator('#site-url').fill('http://example.com/edited');
  await page.locator('#save-site').click(); await page.getByRole('button', { name: 'First edited', exact: true }).waitFor();
  check('UI-edit-website', (await page.locator('.edit-site-name').allTextContents()).join('|') === 'Second|First edited', 'Editing changes label/URL while preserving order.');
  await page.locator('#site-name').fill('Unsafe'); await page.locator('#site-url').fill('javascript:alert(1)');
  await page.locator('#save-site').click();
  check('UI-reject-script-shortcut', await page.locator('#site-error').isVisible() && await page.locator('.edit-site-row').count() === 2, 'javascript: website is rejected without creating an entry.');
  await page.locator('#site-url').fill('data:text/html,test'); await page.locator('#save-site').click();
  check('UI-reject-data-shortcut', await page.locator('#site-error').isVisible() && await page.locator('.edit-site-row').count() === 2, 'data: website is rejected without creating an entry.');
  await page.locator('#site-url').fill('https://user:password@example.com/'); await page.locator('#save-site').click();
  check('UI-reject-credential-shortcut', await page.locator('#site-error').isVisible() && await page.locator('.edit-site-row').count() === 2, 'Embedded-credential URL is rejected.');
  await page.locator('#site-name').fill('Disposable'); await page.locator('#site-url').fill('https://example.com/remove'); await page.locator('#save-site').click();
  await page.getByRole('button', { name: '移除 Disposable', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.edit-site-row').length === 2);
  check('UI-remove-website', (await page.locator('.edit-site-name').allTextContents()).join('|') === 'Second|First edited', 'Removing a shortcut leaves the other order unchanged.');
  await page.locator('.edit-site-row').nth(0).dragTo(page.locator('.edit-site-row').nth(1));
  await page.waitForFunction(() => document.querySelector('.edit-site-name')?.textContent === 'First edited');
  check('UI-native-drag-order', (await page.locator('.edit-site-name').allTextContents()).join('|') === 'First edited|Second', 'Native pointer drag moves the first website after the second through the production drop handler.');
  await page.locator('#sites-dialog [data-close]').first().click();
  const slashModifiers = await page.evaluate(() => {
    const cancelled = [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { shiftKey: true }].map(modifiers => {
      const event = new KeyboardEvent('keydown', { key: '/', ...modifiers, bubbles: true, cancelable: true }); document.dispatchEvent(event); return event.defaultPrevented;
    });
    return { cancelled, open: document.getElementById('search-dialog').open };
  });
  check('UI-slash-editing-modifier-guards', slashEditor.text === '/' && !slashEditor.searchOpen && !slashModifiers.open && slashModifiers.cancelled.every(value => !value), 'A real slash types into the website editor; modified slash events on the non-editing page neither open search nor cancel browser handling.');
  await page.locator('#site-toggle').click();
  await page.waitForFunction(() => document.getElementById('site-toggle')?.getAttribute('aria-expanded') === 'false');
  check('UI-collapsed-pins-only', (await page.locator('.site-title').allTextContents()).join('|') === 'Second', 'Collapsed sites show only pinned shortcuts.');
  await page.reload(); await page.waitForSelector('html[data-start-ready="true"]');
  await installTestFont(page);
  check('UI-shortcuts-reload', (await page.locator('.site-title').allTextContents()).join('|') === 'Second', 'Pinned order and collapse survive actual page reload.');
  await page.locator('#site-toggle').click();
  await page.getByRole('link', { name: '打开 First edited', exact: true }).waitFor();
  check('UI-native-drag-order-reload', (await page.locator('.site-title').allTextContents()).join('|') === 'First edited|Second', 'The actual dragged website order survives reload; its pinned website remains visible while collapsed.');
  for (const [label, url] of [['Second', 'https://example.com/two'], ['First edited', 'http://example.com/edited']]) {
    await context.route(url, route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Shortcut verification</title><p>Synthetic website target</p>' }));
    // Use the frozen default: a normal click navigates this already-controlled Start tab.
    // A native popup's initial TLS navigation can precede test interception in Chrome.
    const target = await context.newPage();
    await target.goto(`chrome-extension://${id}/newtab.html`); await target.waitForSelector('html[data-start-ready="true"]');
    await target.getByRole('link', { name: `打开 ${label}`, exact: true }).click();
    await target.waitForURL(url, { waitUntil: 'domcontentloaded', timeout: 5000 });
    assert.equal(await target.title(), 'Shortcut verification'); await target.close();
  }
  const shortcutActivity = await worker.evaluate(async () => {
    const req = indexedDB.open('vaiwl-start', 1); const db = await new Promise(resolve => { req.onsuccess = () => resolve(req.result); });
    const tx = db.transaction(['openIntents', 'openDays'], 'readonly'), intents = tx.objectStore('openIntents').count(), days = tx.objectStore('openDays').count();
    return new Promise(resolve => { tx.oncomplete = () => { db.close(); resolve({ intents: intents.result, days: days.result }); }; });
  });
  check('UI-website-native-open-no-activity', shortcutActivity.intents === 0 && shortcutActivity.days === 0, 'Both HTTP and HTTPS shortcuts open their exact controlled native-browser targets; neither creates a ChatGPT intent or OpenDay.');

  const scope = `scope:${'a'.repeat(64)}`;
  const otherScope = `scope:${'b'.repeat(64)}`;
  const now = new Date(); now.setUTCHours(8, 0, 0, 0);
  const today = now.toISOString();
  const old = new Date(now.getTime() - 70 * 86400000).toISOString();
  const projects = ['VAIWL', 'Riftlet', '研究笔记', 'PAIA', '产品调研', 'HOLDSNOW'].map((nativeTitle, index) => ({
    key: `project:${String(index + 1).padStart(64, '0')}`, scopeKey: scope, projectId: `g-p-${String(index + 1).padStart(32, '0')}`,
    nativeTitle, canonicalUrl: `https://chatgpt.com/g/g-p-${String(index + 1).padStart(32, '0')}/project`, evidenceId: `test-p-${index}`,
    observedAt: today, membershipCoverage: 'observed-only', stableRank: index + 1, revision: 20,
  }));
  let rank = 1;
  const conversation = (nativeTitle, membership, activityAt = today, ownerKey = scope) => {
    const n = rank++; const conversationId = `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
    return { key: `conversation:${String(n).padStart(64, '0')}`, provider: 'chatgpt', conversationId, canonicalUrl: `https://chatgpt.com/c/${conversationId}`,
      nativeTitle, titleBasis: 'native-label', titleObservedAt: today, availability: 'reachable', firstSeenAt: today, lastSeenAt: today, browserLastVisitAt: null,
      activity: activityAt ? { firstConfirmedOpenAt: activityAt, lastConfirmedOpenAt: activityAt, lastActiveDate: activityAt.slice(0, 10), timeZone: 'UTC' } : null,
      stableRank: n, revision: 20, owner: { kind: 'scoped', scopeKey: ownerKey }, ownerKey, membership, membershipState: membership.state,
      ...(membership.state === 'PROJECT' ? { projectId: membership.projectId } : {}), ...(activityAt ? { lastActiveAt: activityAt } : {}) };
  };
  const records = [];
  for (const [index, project] of projects.entries()) {
    const membership = { state: 'PROJECT', projectId: project.projectId, evidenceId: `test-p-${index}`, confirmedAt: today };
    const names = ['工作区导航方案', '历史记录的整理方式', '页面布局的比较'];
    for (let i = 0; i < (index === 0 ? 18 : 3); i++) records.push(conversation(index === 0 ? `设计讨论 ${i + 1}` : names[i], membership));
    records.push(conversation(`${project.nativeTitle}较早方案`, membership, old));
  }
  records.push(conversation('整理一份阅读清单', { state: 'NONE', projectId: null, evidenceId: 'test-none', confirmedAt: today }));
  records.push(conversation('更早区间的独立会话', { state: 'NONE', projectId: null, evidenceId: 'test-older-none', confirmedAt: today }, old));
  records.push(conversation('尚无日期的无项目会话', { state: 'NONE', projectId: null, evidenceId: 'test-none-undated', confirmedAt: today }, null));
  records.push(conversation('<img src=x onerror=window.__xss=1>', { state: 'UNKNOWN', projectId: null, reason: 'no-membership-source' }, null));
  records.push(conversation('Other account secret', { state: 'NONE', projectId: null, evidenceId: 'test-other', confirmedAt: today }, today, otherScope));
  records.push(conversation('Other account pending', { state: 'UNKNOWN', projectId: null, reason: 'no-membership-source' }, null, otherScope));
  await page.evaluate(async data => {
    const req = indexedDB.open('vaiwl-start', 1); const db = await new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
    const tx = db.transaction(['scopes', 'projects', 'conversations', 'settings', 'revisions'], 'readwrite');
    for (const key of [data.scope, data.otherScope]) tx.objectStore('scopes').put({ key, provider: 'chatgpt', principalKey: 'synthetic-principal', contextKey: key === data.scope ? 'synthetic-A' : 'synthetic-B', identity: 'verified', label: key === data.scope ? '合成资料库 A' : '合成资料库 B', verifiedAt: data.today, identityAdapterVersion: 'ui-test-only', contextWitnessId: 'synthetic-witness', state: 'ready' });
    for (const project of data.projects) tx.objectStore('projects').put(project);
    for (const record of data.records) tx.objectStore('conversations').put(record);
    const setting = tx.objectStore('settings').get('main'); setting.onsuccess = () => tx.objectStore('settings').put({ ...setting.result, selectedScope: data.scope, libraryTimeZone: 'UTC', shortcutSectionCollapsed: false });
    tx.objectStore('revisions').put({ key: 'main', value: 20, nextRank: 100 });
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = () => reject(tx.error); }); db.close(); sessionStorage.clear();
  }, { scope, otherScope, today, projects, records });
  await page.reload(); await page.waitForSelector('html[data-start-ready="true"]');
  await installTestFont(page);
  await page.locator('#scope-selector').selectOption(scope);
  await page.locator('.project').first().waitFor();
  const projectCount = await page.locator('.project').count();
  check('UI-six-project-cards', projectCount === 6, `Six synthetic projects rendered by the actual bundled UI/domain/storage; count ${projectCount}.`);
  check('UI-scope-isolation', !await page.getByText('Other account secret', { exact: true }).count(), 'Other account title does not appear in current scope.');
  const readBusinessStores = () => worker.evaluate(async () => {
    const req = indexedDB.open('vaiwl-start', 1);
    const db = await new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
    const names = [...db.objectStoreNames].filter(name => !['settings', 'revisions'].includes(name));
    const tx = db.transaction(names, 'readonly');
    const reads = names.map(name => [name, tx.objectStore(name).getAll()]);
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => { const snapshot = Object.fromEntries(reads.map(([name, read]) => [name, read.result])); db.close(); resolve(snapshot); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    });
  });
  const businessBeforeFilters = await readBusinessStores();
  const workspaceKeys = () => page.locator('#workspace-content a[data-record-key]').evaluateAll(links => links.map(link => link.dataset.recordKey));
  for (const [filter, state] of [['project', 'PROJECT'], ['none', 'NONE'], ['unknown', 'UNKNOWN']]) {
    await page.locator(`[data-filter="${filter}"]`).click();
    const keys = await workspaceKeys();
    check(`UI-filter-${filter}-exact-membership`, keys.length > 0 && keys.every(key => records.some(record => record.key === key && record.owner.scopeKey === scope && record.membership.state === state)), `${filter} renders only current-scope ${state} records; UNKNOWN is never classified as NONE.`);
  }
  await page.locator('[data-filter="all"]').click();
  await page.locator('#scope-selector').selectOption(otherScope);
  await page.getByText('Other account secret', { exact: true }).waitFor();
  const projectlessHome = await page.locator('.project').count() === 0 && await page.locator('.new-chat').isVisible() && await page.locator('.date-window').count() === 1 && await page.locator('#scope-selector').inputValue() === otherScope;
  await page.locator('[data-filter="none"]').click();
  const projectlessNone = (await workspaceKeys()).length === 1 && await page.getByText('Other account secret', { exact: true }).isVisible() && await page.getByText('Other account pending', { exact: true }).count() === 0;
  await page.locator('[data-filter="unknown"]').click();
  const projectlessUnknown = (await workspaceKeys()).length === 1 && await page.getByText('Other account pending', { exact: true }).isVisible() && await page.getByText('Other account secret', { exact: true }).count() === 0 && await page.locator('.date-window').count() === 0;
  await page.locator('[data-filter="project"]').click();
  const projectlessEmpty = (await workspaceKeys()).length === 0 && await page.locator('.new-chat').isVisible() && await page.getByText('这一段没有记录', { exact: true }).isVisible();
  check('UI-projectless-scope-home', projectlessHome && projectlessNone && projectlessUnknown && projectlessEmpty, 'A synthetic verified scope with zero projects retains its homepage, new-chat link and scope selector; NONE and UNKNOWN remain separate and the project filter has a usable empty state.');
  await page.locator('[data-filter="all"]').click();
  await page.locator('#scope-selector').selectOption(scope);
  await page.locator('.project').first().waitFor();
  assert.deepEqual(await readBusinessStores(), businessBeforeFilters);
  check('UI-filters-view-only', true, 'All business stores are byte-for-byte equivalent before and after all membership filters and both scope selections; settings/revision bookkeeping is excluded.');
  const firstCard = page.locator('.project').first();
  check('UI-initial-five', await firstCard.locator('.project-body > .conversation-list .conversation-row').count() === 5, 'Current project initially shows exactly 5 rows.');
  await firstCard.getByRole('button', { name: '显示更多', exact: true }).click();
  check('UI-add-twelve', await firstCard.locator('.project-body > .conversation-list .conversation-row').count() === 17, 'One Show More increases 5 to 17.');
  await firstCard.getByRole('button', { name: '显示更多', exact: true }).click();
  check('UI-project-more-complete', await firstCard.locator('.project-body > .conversation-list .conversation-row').count() === 18 && await firstCard.getByRole('button', { name: '显示更多', exact: true }).count() === 0, 'The final recent member is reachable and Show More ends at the actual collection boundary.');
  await firstCard.getByRole('button', { name: '较早会话', exact: true }).click();
  check('UI-old-stays-in-parent', await firstCard.getByText('VAIWL较早方案', { exact: true }).isVisible(), 'Older member expands under its single project card.');
  await firstCard.getByRole('button', { name: '较早会话', exact: true }).click();
  check('UI-no-top-arrow', await page.locator('#period-newer').count() === 0, 'k=0 has no newer-period button.');
  await page.locator('#period-older').click();
  check('UI-empty-adjacent-segment', await page.getByText('这一段没有记录', { exact: true }).isVisible(), 'One click goes to the adjacent empty segment rather than skipping it.');
  await page.locator('#period-older').click();
  const earlierKnownVisible = await page.getByText('更早区间的独立会话', { exact: true }).isVisible();
  const olderProjectsAbsent = await page.locator('.project').count() === 0;
  await page.locator('#period-newer').click();
  const returnedToEmpty = await page.getByText('这一段没有记录', { exact: true }).isVisible();
  await page.locator('#period-newer').click();
  check('UI-empty-segment-to-known-and-back', earlierKnownVisible && olderProjectsAbsent && returnedToEmpty && await page.locator('.project').count() === 6 && await page.locator('#period-newer').count() === 0, 'k0 → empty k1 → known NONE at k2 → empty k1 → k0; no empty segment is skipped and old project members do not duplicate their current parent.');
  await page.keyboard.press('/');
  await page.locator('#search-input').fill('VAIWL较早方案');
  check('UI-cross-period-search', await page.locator('.search-result').count() === 1, 'Search finds a 70-day-old member across date segments.');
  await page.locator('#search-input').fill('设计讨论 1');
  await page.keyboard.press('ArrowDown');
  const focusedFirst = await page.evaluate(() => document.activeElement?.getAttribute('data-record-key'));
  await page.keyboard.press('ArrowDown');
  const focusedSecond = await page.evaluate(() => document.activeElement?.getAttribute('data-record-key'));
  await page.keyboard.press('ArrowUp');
  check('UI-search-arrows', !!focusedFirst && focusedFirst !== focusedSecond && await page.evaluate(() => document.activeElement?.getAttribute('data-record-key')) === focusedFirst, 'Search ArrowDown/ArrowUp move and restore result focus.');
  await page.locator('#search-input').focus();
  const newPagePromise = context.waitForEvent('page');
  await page.keyboard.press('Control+Enter');
  const openedPage = await newPagePromise;
  const openState = await worker.evaluate(async () => {
    const request = indexedDB.open('vaiwl-start', 1); const db = await new Promise(resolve => { request.onsuccess = () => resolve(request.result); });
    const tx = db.transaction(['openIntents', 'openDays'], 'readonly');
    const all = tx.objectStore('openIntents').getAll(); const count = tx.objectStore('openDays').count();
    return new Promise(resolve => { tx.oncomplete = () => { db.close(); resolve({ intents: all.result, openDays: count.result }); }; });
  });
  check('UI-search-keyboard-open', openState.intents.some(intent => intent.evidence.gesture === 'keyboard' && intent.disposition === 'new-background-tab' && intent.targetRecordKey === focusedFirst) && openState.openDays === 0, 'Ctrl+Enter in search dispatches the exact target through persisted keyboard intent; blocked source produces no activity.');
  await openedPage.close();
  await page.bringToFront();
  await page.locator('#search-input').fill('Other account secret');
  check('UI-search-scope-isolation', await page.locator('.search-result').count() === 0, 'Search does not mix in another account.');
  await page.keyboard.press('Escape');
  const removeKey = records[0].key;
  await page.locator(`[data-record-menu="${removeKey}"]`).click();
  await page.locator('#remove-record').click();
  await page.waitForFunction(key => !document.querySelector(`#workspace-content [data-record-key="${key}"]`) || !document.getElementById('toast').hidden, removeKey);
  check('UI-remove-conversation', await page.locator(`#workspace-content [data-record-key="${removeKey}"]`).count() === 0, `Local remove after keyboard open: ${await page.locator('#toast').textContent()}`);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.locator('#show-removed').click();
  check('UI-restore-entry-visible', await page.locator(`[data-restore-record="${removeKey}"]`).isVisible(), 'The current-scope tombstone is reachable in Restore.');
  await page.locator(`[data-restore-record="${removeKey}"]`).click();
  await page.waitForFunction(key => !!document.querySelector(`#workspace-content [data-record-key="${key}"]`), removeKey);
  await page.locator('#removed-dialog [data-close]').first().click();
  check('UI-restore-conversation', await page.locator(`#workspace-content [data-record-key="${removeKey}"]`).count() === 1, 'Explicit restore returns exactly one local entry.');
  await page.locator('[data-filter="unknown"]').click();
  check('UI-unknown-text-only', await page.getByText('<img src=x onerror=window.__xss=1>', { exact: true }).isVisible() && !await page.evaluate(() => window.__xss), 'An HTML-looking native title is rendered as plain text.');
  await page.locator('[data-filter="all"]').click();
  const forwarded = await page.evaluate(() => ['ctrlKey', 'metaKey'].flatMap(modifier => ['k', 'l'].map(key => { const event = new KeyboardEvent('keydown', { key, [modifier]: true, bubbles: true, cancelable: true }); document.dispatchEvent(event); return event.defaultPrevented; })));
  check('UI-browser-shortcuts', forwarded.every(value => value === false), 'Ctrl+K/L and Meta+K/L events remain uncancelled in Linux Chromium; this is not a Mac native-shortcut claim.');
  await page.evaluate(() => {
    document.activeElement?.blur(); window.scrollTo(0, 0); window.__nativeScrollEvents = [];
    document.addEventListener('keydown', event => { if (['PageDown', 'PageUp'].includes(event.key)) queueMicrotask(() => window.__nativeScrollEvents.push({ key: event.key, cancelled: event.defaultPrevented })); });
    document.addEventListener('wheel', event => queueMicrotask(() => window.__nativeScrollEvents.push({ key: 'wheel', cancelled: event.defaultPrevented })), { passive: true });
  });
  await page.keyboard.press('PageDown');
  await page.waitForFunction(() => scrollY > 100);
  await page.evaluate(() => new Promise(resolve => { let before = -1, stable = 0; const tick = () => { stable = scrollY === before ? stable + 1 : 0; before = scrollY; if (stable === 5) resolve(); else requestAnimationFrame(tick); }; requestAnimationFrame(tick); }));
  const pageDownPosition = await page.evaluate(() => scrollY);
  await page.keyboard.press('PageUp');
  await page.waitForFunction(() => scrollY === 0);
  await page.mouse.move(700, 800); await page.mouse.wheel(0, 350);
  await page.waitForFunction(() => scrollY > 0);
  const nativeScroll = await page.evaluate(() => ({ events: window.__nativeScrollEvents, scrollY }));
  check('UI-native-page-scroll', pageDownPosition > 100 && nativeScroll.scrollY > 0 && ['PageDown', 'PageUp', 'wheel'].every(key => nativeScroll.events.some(event => event.key === key && !event.cancelled)) && nativeScroll.events.every(event => !event.cancelled), 'Trusted PageDown/PageUp and wheel input scroll the actual page and remain uncancelled in Linux Chromium.');
  const beforeSearchPosition = await page.evaluate(() => { window.scrollTo(0, 100); document.getElementById('search-trigger').focus({ preventScroll: true }); return { scrollY, focus: document.activeElement.id }; });
  await page.keyboard.press('/'); await page.locator('#search-input').fill('a-query-with-no-local-match');
  await page.keyboard.press('Escape');
  const afterSearchPosition = await page.evaluate(() => ({ scrollY, focus: document.activeElement.id, open: document.getElementById('search-dialog').open }));
  check('UI-search-escape-restores-position', !afterSearchPosition.open && afterSearchPosition.focus === beforeSearchPosition.focus && Math.abs(afterSearchPosition.scrollY - beforeSearchPosition.scrollY) <= 1, 'Escape closes search and restores the triggering focus and page scroll position.');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  check('UI-source-limit-visible', (await page.locator('#source-description').textContent()).includes('尚未通过真实验证'), 'Settings disclose source gate as blocked.');
  await page.locator('#settings-dialog [data-close]').first().click();
  for (const width of [320, 400, 720, 1000, 1440, 1920]) {
    await page.setViewportSize({ width, height: 1080 });
    await page.waitForTimeout(50);
    check(`UI-width-${width}`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `No horizontal overflow at ${width}px.`);
  }
  await page.setViewportSize({ width: 1440, height: 1080 });
  await page.evaluate(async () => {
    const db = await new Promise(resolve => { const request = indexedDB.open('vaiwl-start'); request.onsuccess = () => resolve(request.result); });
    const tx = db.transaction(['importJobs', 'revisions'], 'readwrite');
    const now = Date.now();
    tx.objectStore('importJobs').put({ id: 'synthetic-pending-batch', provider: 'browser-history', state: 'paused', startTimeMs: 0, endTimeMs: now, pendingIntervals: [], processedUniqueUrls: 1, acceptedCandidates: 0, rejectedUrls: 0, saturatedIntervals: [], sourceCoverage: 'browser-available-history', completedAt: null, includeSynced: false, seenKeys: [], pendingCandidates: [{ url: 'https://chatgpt.com/c/00000000-0000-4000-8000-000000009999' }], failureCode: null });
    const r = tx.objectStore('revisions').get('main'); r.onsuccess = () => tx.objectStore('revisions').put({ ...r.result, value: r.result.value + 1 });
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = () => reject(tx.error); }); db.close();
  });
  await page.reload(); await page.waitForSelector('html[data-start-ready="true"]');
  await page.locator('#settings-trigger').click(); await page.locator('#settings-import').click();
  check('UI-resume-persisted-batch', await page.locator('[data-import-resume="synthetic-pending-batch"]').isVisible(), 'A paused checkpoint remains resumable when its last interval is exhausted but persisted candidates remain.');
  await page.locator('#import-dialog [data-close]').first().click();
  // A new tab starts with independent 5-row view limits, while reading the same real IDB.
  const reviewPage = await context.newPage();
  reviewPage.on('pageerror', error => errors.push(error.message));
  await reviewPage.goto(`chrome-extension://${id}/newtab.html`);
  await reviewPage.waitForSelector('html[data-start-ready="true"]');
  await installTestFont(reviewPage);
  await mkdir('artifacts', { recursive: true });
  await reviewPage.screenshot({ path: 'artifacts/ui-review.png', fullPage: true });

  // A broad match must page DOM work, while searching the complete 2000-record set.
  await reviewPage.evaluate(async data => {
    const req = indexedDB.open('vaiwl-start', 1); const db = await new Promise(resolve => { req.onsuccess = () => resolve(req.result); });
    const tx = db.transaction(['conversations', 'revisions'], 'readwrite');
    for (let n = 1; n <= 2000; n++) {
      const ordinal = 10000 + n;
      const conversationId = `00000000-0000-4000-8000-${String(ordinal).padStart(12, '0')}`;
      tx.objectStore('conversations').put({ ...data.template, key: `conversation:${String(ordinal).padStart(64, '0')}`, conversationId,
        canonicalUrl: `https://chatgpt.com/c/${conversationId}`, nativeTitle: `分页会话 ${String(n).padStart(4, '0')}`, stableRank: ordinal });
    }
    const revision = tx.objectStore('revisions').get('main'); revision.onsuccess = () => tx.objectStore('revisions').put({ ...revision.result, value: revision.result.value + 1, nextRank: 12001 });
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = () => reject(tx.error); }); db.close();
  }, { template: records[0] });
  await reviewPage.reload(); await reviewPage.waitForSelector('html[data-start-ready="true"]');
  await reviewPage.locator('#search-trigger').click(); await reviewPage.locator('#search-input').fill('分页会话');
  check('UI-search-first-page-100', await reviewPage.locator('.search-result').count() === 100 && await reviewPage.locator('#search-results').getAttribute('data-total-matches') === '2000', 'Only the first 100 of all 2000 matches are materialized.');
  await reviewPage.locator('.search-result').last().focus(); await reviewPage.keyboard.press('ArrowDown');
  check('UI-search-more-keyboard-reachable', await reviewPage.evaluate(() => document.activeElement?.id) === 'search-more', 'ArrowDown at the last displayed result reaches Show More.');
  await reviewPage.keyboard.press('Enter');
  check('UI-search-more-next-100', await reviewPage.locator('.search-result').count() === 200 && await reviewPage.locator('#search-results').getAttribute('data-total-matches') === '2000', 'Show More appends the next 100 matches without truncating the result set.');
  await reviewPage.locator('[data-search-filter="project"]').click();
  check('UI-search-filter-resets-page', await reviewPage.locator('.search-result').count() === 100, 'Changing a search filter resets the visible slice to 100.');
  await reviewPage.locator('#search-input').fill('分页会话 1999');
  check('UI-search-final-record-reachable', await reviewPage.locator('.search-result').count() === 1 && await reviewPage.locator('.search-result strong').textContent() === '分页会话 1999', 'A match beyond the initial page remains directly searchable.');
  await reviewPage.locator('#search-input').fill('分页会话');
  check('UI-search-query-resets-page', await reviewPage.locator('.search-result').count() === 100, 'Changing the query resets pagination, without retaining a stale expanded count.');
  check('UI-no-script-errors', errors.length === 0, JSON.stringify(errors));
  const status = checks.length > 0 && checks.every(item => item.status === 'PASS') && errors.length === 0 ? 'PASS' : 'FAIL';
  assert.equal(status, 'PASS', 'UI validation cannot pass with failed checks or page errors.');
  await writeFile('artifacts/ui-validation.json', JSON.stringify({ status, buildSha: buildInfo.sha, dirty: buildInfo.dirty, browser: await context.browser()?.version(), environment: 'isolated-headless-Chromium-MV3-synthetic-only', sourceGate: 'SOURCE_GATE_BLOCKED', testFont: fontData ? 'Temporary Noto Sans CJK SC injected for test rendering; no font ships or downloads in production.' : 'System fonts', checks, limitations: ['Synthetic direct-IDB fixtures only; this is not ChatGPT metadata, true Edge, or Mac acceptance.'] }, null, 2));
  console.log(JSON.stringify({ uiChecks: checks.length, status, errors }));
} finally { await context.close(); }
