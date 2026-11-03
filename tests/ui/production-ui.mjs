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
async function openLegacy(page) {
  await page.locator('#settings-trigger').click();
  await page.locator('#legacy-sites').click();
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

  await openLegacy(page);
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
  await openLegacy(page);
  await page.locator('#site-toggle').click();
  await page.waitForFunction(() => document.getElementById('site-toggle')?.getAttribute('aria-expanded') === 'false');
  check('UI-collapsed-pins-only', (await page.locator('.site-title').allTextContents()).join('|') === 'Second', 'Collapsed sites show only pinned shortcuts.');
  await page.reload(); await page.waitForSelector('html[data-start-ready="true"]');
  await installTestFont(page);
  await openLegacy(page);
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
    await openLegacy(target);
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

  await page.locator('#sites-dialog [data-close]').first().click();
  const scope = `scope:${'a'.repeat(64)}`;
  const otherScope = `scope:${'b'.repeat(64)}`;
  const now = new Date(Date.now() - 600000);
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
    if (index === 0) records.push(conversation('VAIWL另一旧会话', membership, old));
  }
  records.push(conversation('整理一份阅读清单', { state: 'NONE', projectId: null, evidenceId: 'test-none', confirmedAt: today }));
  records.push(conversation('更早区间的独立会话', { state: 'NONE', projectId: null, evidenceId: 'test-older-none', confirmedAt: today }, old));
  const undated = conversation('尚无日期的无项目会话', { state: 'NONE', projectId: null, evidenceId: 'test-none-undated', confirmedAt: today }, null);
  undated.browserLastVisitAt = null; records.push(undated);
  records.push(conversation('<img src=x onerror=window.__xss=1>', { state: 'UNKNOWN', projectId: null, reason: 'no-membership-source' }, null));
  records.push(conversation('未分项目的最近阅读', { state: 'UNKNOWN', projectId: null, reason: 'no-membership-source' }));
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
  for (const filter of ['project', 'none']) {
    await page.locator(`[data-filter="${filter}"]`).click();
    const keys = await workspaceKeys();
    check(`UI-filter-${filter}-display-position`, keys.length > 0 && keys.every(key => records.some(record => record.key === key && record.owner.scopeKey === scope && (filter === 'project' ? record.membership.state === 'PROJECT' : record.membership.state !== 'PROJECT' && record.activity))), `${filter} renders its current-scope display position; recent combines dated NONE and UNKNOWN without changing either membership fact.`);
  }
  check('UI-no-confirmation-filter', await page.locator('[data-filter="unknown"], [data-search-filter="unknown"]').count() === 0 && (await page.locator('[data-filter]').allTextContents()).join('|') === '全部|项目|最近', 'Homepage and search contain no confirmation queue; the three filters use the approved product labels.');
  await page.locator('[data-filter="all"]').click();
  await page.locator('#scope-selector').selectOption(otherScope);
  await page.getByText('Other account secret', { exact: true }).waitFor();
  const projectlessHome = await page.locator('.project').count() === 0 && await page.locator('.new-chat').isVisible() && await page.locator('.date-window').count() === 1 && await page.locator('#scope-selector').inputValue() === otherScope;
  await page.locator('[data-filter="none"]').click();
  const projectlessNone = (await workspaceKeys()).length === 1 && await page.getByText('Other account secret', { exact: true }).isVisible() && await page.getByText('Other account pending', { exact: true }).count() === 0;
  await page.locator('#search-trigger').click(); await page.locator('#search-input').fill('Other account pending');
  const projectlessSearch = await page.locator('#search-results [data-record-key]').count() === 1 && await page.locator('#search-results').getByText('Other account pending', { exact: true }).isVisible();
  await page.keyboard.press('Escape');
  await page.locator('[data-filter="project"]').click();
  const projectlessEmpty = (await workspaceKeys()).length === 0 && await page.locator('.new-chat').isVisible() && await page.getByText('这一段没有记录', { exact: true }).isVisible();
  check('UI-projectless-scope-home', projectlessHome && projectlessNone && projectlessSearch && projectlessEmpty, 'A synthetic verified scope with zero projects retains its homepage, new-chat link and scope selector; Recent uses available time evidence; the undated UNKNOWN stays searchable without a homepage queue and the project filter has a usable empty state.');
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
  await firstCard.getByRole('button', { name: '更早', exact: true }).click();
  const expectedOldKeys = records.filter(record => record.membership.state === 'PROJECT' && record.membership.projectId === projects[0].projectId && record.activity?.lastConfirmedOpenAt === old).map(record => record.key);
  const renderedOldKeys = await firstCard.locator('.old-list [data-record-key]').evaluateAll(rows => rows.map(row => row.getAttribute('data-record-key')));
  check('UI-old-stays-in-parent', expectedOldKeys.length === 2 && JSON.stringify(renderedOldKeys) === JSON.stringify(expectedOldKeys) && await firstCard.getByText('VAIWL较早方案', { exact: true }).isVisible() && await firstCard.getByText('VAIWL另一旧会话', { exact: true }).isVisible(), 'Exactly both old members expand under their one parent; no current member is mixed into the old-member list.');
  await firstCard.getByRole('button', { name: '更早', exact: true }).click();
  check('UI-no-top-arrow', await page.locator('#period-newer').count() === 0, 'k=0 has no newer-period button.');
  await page.locator('#period-older').click();
  check('UI-empty-adjacent-segment', await page.evaluate(() => JSON.parse(sessionStorage.getItem('vaiwl-start-view/1')).k) === 1
    && await page.locator('.date-window').count() === 0 && await page.locator('.project').count() === 0
    && await page.getByText('这一段没有记录', { exact: true }).isVisible()
    && await page.locator(`#workspace-content [data-record-key="${undated.key}"]`).count() === 0,
    'One click reaches empty k1 without skipping it. An ungrouped undated record stays outside the homepage; search still reaches it.');
  await page.locator('#period-older').click();
  const earlierKnownVisible = await page.getByText('更早区间的独立会话', { exact: true }).isVisible();
  const olderProjectsAbsent = await page.locator('.project').count() === 0;
  await page.locator('#period-newer').click();
  const returnedToEmpty = await page.getByText('这一段没有记录', { exact: true }).isVisible();
  await page.locator('#period-newer').click();
  check('UI-empty-segment-to-known-and-back', earlierKnownVisible && olderProjectsAbsent && returnedToEmpty && await page.locator('.project').count() === 6 && await page.locator('#period-newer').count() === 0, 'k0 → empty k1 → known NONE at k2 → empty k1 → k0; no empty segment is skipped and old project members do not duplicate their current parent.');
  check('UI-undated-search-only', await page.locator(`#workspace-content [data-record-key="${undated.key}"]`).count() === 0, 'A record with neither project nor valid time is absent from homepage normal lists and remains in the complete search catalog.');
  await page.keyboard.press('/'); await page.locator('#search-input').fill(undated.nativeTitle);
  assert.equal(await page.locator('.search-result').getAttribute('data-record-key'), undated.key);
  const undatedTabPromise = context.waitForEvent('page'); await page.keyboard.press('Control+Enter');
  const undatedTab = await undatedTabPromise;
  const undatedAfterOpen = await worker.evaluate(async key => {
    const request = indexedDB.open('vaiwl-start'); const db = await new Promise(resolve => { request.onsuccess = () => resolve(request.result); });
    const tx = db.transaction(['conversations', 'openIntents', 'openDays'], 'readonly');
    const record = tx.objectStore('conversations').get(key), intents = tx.objectStore('openIntents').getAll(), days = tx.objectStore('openDays').getAll();
    return new Promise(resolve => { tx.oncomplete = () => { db.close(); resolve({ record: record.result, intents: intents.result, days: days.result }); }; });
  }, undated.key);
  check('UI-undated-search-open-remains-undated', undatedAfterOpen.record.activity === null && undatedAfterOpen.record.browserLastVisitAt === null && undatedAfterOpen.intents.some(intent => intent.targetRecordKey === undated.key && intent.evidence.gesture === 'keyboard') && !undatedAfterOpen.days.some(day => day.recordKey === undated.key), 'The undated entry is searchable and dispatches a persistent open intent; unverified arrival cannot turn history.lastVisitTime into an activity date.');
  await undatedTab.close(); await page.bringToFront(); await page.keyboard.press('Escape');
  // Closing a native dialog alone does not assert the documented '/' preconditions.
  // Wait for them without forcing focus, retrying the key, or extending the timeout.
  await page.evaluate(() => {
    window.__searchReopenKeys = [];
    window.__searchReopenListener = event => {
      if (['/', 'Escape'].includes(event.key) && window.__searchReopenKeys.length < 4) window.__searchReopenKeys.push({ key: event.key, code: event.code, ctrl: event.ctrlKey, meta: event.metaKey, alt: event.altKey, shift: event.shiftKey, composing: event.isComposing, targetTag: event.target?.tagName || null, targetId: event.target?.id || null });
    };
    document.addEventListener('keydown', window.__searchReopenListener, true);
  });
  try {
    await page.waitForFunction(() => document.hasFocus() && !document.hidden && !document.querySelector('dialog[open]') && !document.activeElement?.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"]'));
    await page.keyboard.press('/');
    await page.locator('#search-input').fill('VAIWL较早方案');
  } catch (error) {
    const state = await page.evaluate(() => ({ activeTag: document.activeElement?.tagName || null, activeId: document.activeElement?.id || null, focused: document.hasFocus(), hidden: document.hidden, openDialogs: [...document.querySelectorAll('dialog[open]')].map(d => d.id), url: location.href, keys: window.__searchReopenKeys }));
    console.error(JSON.stringify({ failure: 'search-reopen-after-background-open', buildSha: buildInfo.sha, state }));
    throw error;
  } finally {
    await page.evaluate(() => { document.removeEventListener('keydown', window.__searchReopenListener, true); delete window.__searchReopenListener; delete window.__searchReopenKeys; });
  }
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
  await page.locator('#search-trigger').click(); await page.locator('#search-input').fill('<img src=x onerror=window.__xss=1>');
  check('UI-unknown-text-only', await page.locator('#search-results').getByText('<img src=x onerror=window.__xss=1>', { exact: true }).isVisible() && !await page.evaluate(() => window.__xss), 'An undated HTML-looking native title is searchable and rendered as plain text.');
  await page.keyboard.press('Escape');
  check('UI-no-home-technical-status', !(await page.locator('#workspace-content').textContent()).match(/待确认|待归属|本地已观察|本地候选|尚无可用日期|会话已保存在本机|已观察的原生项目会在这里展开/) && await page.locator('.import-note, .pending-dates, .unknown-section, .undated-section').count() === 0, 'The normal homepage contains project and recent content without provenance cards, diagnosis bars or confirmation sections.');
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

  // Real extension-page commands produce the worker's actual revision broadcast.
  // Only the test process writes synthetic sorting evidence into its isolated IDB.
  const publisher = await context.newPage();
  publisher.on('pageerror', error => errors.push(error.message));
  await publisher.goto(`chrome-extension://${id}/newtab.html`); await publisher.waitForSelector('html[data-start-ready="true"]');
  const publishCommand = (command, payload) => publisher.evaluate(async ({ command, payload }) => {
    const envelope = (command, payload, expectedRevision) => ({ protocol: 'vaiwl-start-internal/1', operationId: crypto.randomUUID(), command, payload, expectedRevision });
    const snapshot = await chrome.runtime.sendMessage(envelope('SNAPSHOT', {}, 0));
    if (!snapshot.ok) throw Error(snapshot.code);
    const response = await chrome.runtime.sendMessage(envelope(command, payload, snapshot.data.revision));
    if (!response.ok) throw Error(response.code); return response.data;
  }, { command, payload });
  const publishSortChange = async (key, activeAt, nativeTitle) => {
    await publisher.evaluate(async ({ key, activeAt, nativeTitle }) => {
      const request = indexedDB.open('vaiwl-start'); const db = await new Promise(resolve => { request.onsuccess = () => resolve(request.result); });
      const tx = db.transaction(['conversations', 'revisions'], 'readwrite');
      const record = tx.objectStore('conversations').get(key), revision = tx.objectStore('revisions').get('main');
      record.onsuccess = () => tx.objectStore('conversations').put({ ...record.result, nativeTitle, activity: { ...record.result.activity, lastConfirmedOpenAt: activeAt, lastActiveDate: activeAt.slice(0, 10) }, lastActiveAt: activeAt });
      revision.onsuccess = () => tx.objectStore('revisions').put({ ...revision.result, value: revision.result.value + 1 });
      await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = () => reject(tx.error); }); db.close();
    }, { key, activeAt, nativeTitle });
    return publishCommand('SETTINGS_UPDATE', { patch: { shortcutSectionCollapsed: false } });
  };
  await page.bringToFront();
  await page.evaluate(() => {
    window.__testRevisionEvents = [];
    chrome.runtime.onMessage.addListener((message, sender) => { if (message.event === 'revision' && sender.id === chrome.runtime.id) window.__testRevisionEvents.push(message.revision); });
    window.__gestureEvidence = {};
    document.addEventListener('pointerup', event => { window.__gestureEvidence.pointerEnd = { at: performance.now(), trusted: event.isTrusted }; }, true);
    document.addEventListener('compositionstart', event => { window.__gestureEvidence.imeStart = { at: performance.now(), trusted: event.isTrusted }; }, true);
    document.addEventListener('compositionend', event => { window.__gestureEvidence.imeEnd = { at: performance.now(), trusted: event.isTrusted }; }, true);
  });
  const pointerKey = records[6].key, pointerChangedKey = records[17].key;
  // The compact native-bookmark header shortens the page. Keep scroll headroom
  // for the exact-anchor oracle; bottom-clamped pages cannot move past maxScroll.
  await page.evaluate(() => window.scrollTo(0, Math.min(250, Math.max(0, document.documentElement.scrollHeight - innerHeight - 100))));
  const pointerTarget = page.locator(`#workspace-content [data-record-key="${pointerKey}"]`);
  const pointerBox = await pointerTarget.boundingBox(); assert.ok(pointerBox && pointerBox.y >= 0);
  await page.mouse.move(pointerBox.x + 35, pointerBox.y + pointerBox.height / 2);
  await page.keyboard.down(process.platform === 'darwin' ? 'Meta' : 'Control'); await page.mouse.down();
  const pointerBefore = await page.evaluate(changedKey => {
    const anchor = [...document.querySelectorAll('#workspace-content [data-record-key]')].find(row => row.getBoundingClientRect().bottom > 80);
    window.__pointerAnchorKey = anchor.dataset.recordKey;
    new MutationObserver(() => { if (!window.__gestureEvidence.pointerApplied && document.querySelector('.project [data-record-key]')?.dataset.recordKey === changedKey) window.__gestureEvidence.pointerApplied = performance.now(); }).observe(document.getElementById('workspace-content'), { childList: true, subtree: true });
    return { focus: document.activeElement.dataset.recordKey, anchor: anchor.dataset.recordKey, offset: anchor.getBoundingClientRect().top, first: document.querySelector('.project [data-record-key]').dataset.recordKey };
  }, pointerChangedKey);
  const pointerPublished = await publishSortChange(pointerChangedKey, new Date(now.getTime() + 60000).toISOString(), '设计讨论 18 · 指针更新');
  await page.waitForFunction(revision => window.__testRevisionEvents.includes(revision), pointerPublished.revision);
  await page.waitForTimeout(150);
  const pointerHeld = await page.evaluate(() => ({ first: document.querySelector('.project [data-record-key]').dataset.recordKey, focus: document.activeElement.dataset.recordKey, offset: document.querySelector(`[data-record-key="${window.__pointerAnchorKey}"]`).getBoundingClientRect().top }));
  await mkdir('artifacts', { recursive: true }); await page.screenshot({ path: 'artifacts/ui-pointer-held.png', fullPage: false });
  assert.equal(pointerHeld.first, pointerBefore.first); assert.equal(pointerHeld.focus, pointerKey); assert.ok(Math.abs(pointerHeld.offset - pointerBefore.offset) <= 1);
  const pointerOpenPromise = context.waitForEvent('page'); await page.mouse.up(); await page.keyboard.up(process.platform === 'darwin' ? 'Meta' : 'Control');
  const pointerOpen = await pointerOpenPromise;
  await page.waitForFunction(() => !!window.__gestureEvidence.pointerApplied, null, { timeout: 1000 });
  const pointerAfter = await page.evaluate(() => ({ evidence: window.__gestureEvidence, focus: document.activeElement.dataset.recordKey, offset: document.querySelector(`[data-record-key="${window.__pointerAnchorKey}"]`).getBoundingClientRect().top }));
  const pointerCatalog = await readBusinessStores();
  check('UI-pointer-revision-safe-point', pointerAfter.evidence.pointerEnd.trusted && pointerAfter.evidence.pointerApplied >= pointerAfter.evidence.pointerEnd.at && pointerAfter.evidence.pointerApplied - pointerAfter.evidence.pointerEnd.at <= 1000 && pointerAfter.focus === pointerKey && Math.abs(pointerAfter.offset - pointerBefore.offset) <= 1 && pointerCatalog.openIntents.some(intent => intent.targetRecordKey === pointerKey && intent.evidence.gesture === 'click'), `Trusted held pointer retains its record target and anchor while a real other-tab revision waits; release applies in ${Math.round(pointerAfter.evidence.pointerApplied - pointerAfter.evidence.pointerEnd.at)} ms with the same record focus/anchor and exact open intent.`);
  await pointerOpen.close(); await page.bringToFront();

  await page.locator('#search-trigger').click();
  const ime = await context.newCDPSession(page);
  await ime.send('Input.imeSetComposition', { text: '设计讨论', selectionStart: 4, selectionEnd: 4 });
  const imeBefore = await page.evaluate(changedKey => {
    const anchor = [...document.querySelectorAll('#workspace-content [data-record-key]')].find(row => row.getBoundingClientRect().bottom > 80);
    window.__imeAnchorKey = anchor.dataset.recordKey; window.__imeFirst = document.querySelector('.search-result');
    new MutationObserver(() => { if (!window.__gestureEvidence.imeApplied && document.querySelector('.search-result')?.dataset.recordKey === changedKey) window.__gestureEvidence.imeApplied = performance.now(); }).observe(document.getElementById('search-results'), { childList: true });
    return { started: window.__gestureEvidence.imeStart, query: document.getElementById('search-input').value, offset: anchor.getBoundingClientRect().top };
  }, records[16].key);
  assert.ok(imeBefore.started?.trusted); assert.equal(imeBefore.query, '设计讨论');
  const imePublished = await publishSortChange(records[16].key, new Date(now.getTime() + 120000).toISOString(), '设计讨论 17 · 输入更新');
  await page.waitForFunction(revision => window.__testRevisionEvents.includes(revision), imePublished.revision);
  await page.waitForTimeout(150);
  const imeHeld = await page.evaluate(() => ({ unchanged: document.querySelector('.search-result') === window.__imeFirst, focus: document.activeElement.id, query: document.getElementById('search-input').value }));
  await page.screenshot({ path: 'artifacts/ui-ime-held.png', fullPage: false });
  assert.ok(imeHeld.unchanged); assert.equal(imeHeld.focus, 'search-input'); assert.equal(imeHeld.query, '设计讨论');
  await ime.send('Input.insertText', { text: '设计讨论' });
  await page.waitForFunction(() => !!window.__gestureEvidence.imeApplied, null, { timeout: 1000 });
  const imeAfter = await page.evaluate(() => ({ evidence: window.__gestureEvidence, focus: document.activeElement.id, query: document.getElementById('search-input').value, offset: document.querySelector(`[data-record-key="${window.__imeAnchorKey}"]`).getBoundingClientRect().top }));
  check('UI-ime-revision-safe-point', !!imeAfter.evidence.imeEnd && imeAfter.evidence.imeApplied >= imeAfter.evidence.imeEnd.at && imeAfter.evidence.imeApplied - imeAfter.evidence.imeEnd.at <= 1000 && imeAfter.focus === 'search-input' && imeAfter.query === '设计讨论' && Math.abs(imeAfter.offset - imeBefore.offset) <= 1, `Real Chromium CDP composition start is trusted; the browser-generated end has isTrusted=${imeAfter.evidence.imeEnd?.trusted}. Other-tab revision waits through composition and applies in ${Math.round(imeAfter.evidence.imeApplied - imeAfter.evidence.imeEnd.at)} ms, preserving the input buffer, focus and same record anchor. No DOM event is synthesized by the test.`);
  await ime.detach(); await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  const sourceDescription = await page.locator('#source-description').textContent();
  check('UI-source-limit-visible', sourceDescription.includes('本地历史可按日期浏览') && sourceDescription.includes('浏览日期不计活跃') && sourceDescription.includes('已有目录和本地项目继续保留') && sourceDescription.includes('完整账号空间认证与全量同步尚未完成') && sourceDescription.includes('连接 ChatGPT 并开启继续收录后'), 'Settings disclose preserved local Project capability separately from incomplete account/Workspace certification and full sync; disconnected capture does not promise new activity.');
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
  await page.close(); await reviewPage.close();
  const historyPage = await context.newPage(); historyPage.on('pageerror', error => errors.push(error.message));
  await historyPage.clock.install({ time: new Date(`${today.slice(0, 10)}T23:59:50.000Z`) });
  await historyPage.goto(`chrome-extension://${id}/newtab.html`); await historyPage.waitForSelector('html[data-start-ready="true"]');
  await historyPage.locator('#period-older').click(); await historyPage.locator('#period-older').click();
  const oldNone = records.find(record => record.nativeTitle === '更早区间的独立会话');
  await historyPage.locator(`[data-record-key="${oldNone.key}"]`).waitFor();
  const historicalRange = await historyPage.locator('#history-rail').textContent();
  await historyPage.clock.pauseAt(new Date(`${today.slice(0, 10)}T23:59:59.000Z`));
  await publishCommand('RECORD_REMOVE', { recordKey: oldNone.key }); await historyPage.clock.runFor(100);
  assert.equal(await historyPage.locator(`[data-record-key="${oldNone.key}"]`).count(), 0);
  assert.equal(await historyPage.locator('#history-rail').textContent(), historicalRange);
  await historyPage.clock.runFor(2000);
  const midnightDate = await historyPage.evaluate(() => new Date().toISOString().slice(0, 10));
  assert.notEqual(midnightDate, today.slice(0, 10));
  await publishCommand('RECORD_RESTORE', { recordKey: oldNone.key }); await historyPage.clock.runFor(100);
  check('UI-history-segment-tab-update-midnight', await historyPage.locator(`[data-record-key="${oldNone.key}"]`).count() === 1 && await historyPage.locator('#history-rail').textContent() === historicalRange && await historyPage.locator('#period-newer').count() === 1 && await historyPage.evaluate(() => JSON.parse(sessionStorage.getItem('vaiwl-start-view/1')).k) === 2, 'Actual commands from another Start page remove/restore a historical entry; each revision applies within 100 ms of controlled clock advancement. Crossing UTC midnight leaves the current k=2 segment and its frozen range unchanged.');

  // Contract-correction fixtures: real production projection/UI over isolated
  // IndexedDB. These 564 rows are synthetic, never the user's history or a source proof.
  const localPage = await context.newPage(); localPage.on('pageerror', error => errors.push(error.message));
  await localPage.goto(`chrome-extension://${id}/newtab.html`); await localPage.waitForSelector('html[data-start-ready="true"]');
  const localSeed = await localPage.evaluate(async () => {
    const req = indexedDB.open('vaiwl-start', 1); const db = await new Promise(resolve => { req.onsuccess = () => resolve(req.result); });
    const tx = db.transaction(['settings', 'conversations', 'openDays', 'revisions'], 'readwrite');
    const settings = tx.objectStore('settings').get('main'), beforeDays = tx.objectStore('openDays').count();
    const at = new Date(Date.now() - 1000); const now = at.toISOString();
    settings.onsuccess = () => {
      const profile = settings.result.localProfileKey;
      for (let n = 0; n < 564; n++) {
        const ordinal = 50000 + n, conversationId = `00000000-0000-4000-8000-${String(ordinal).padStart(12, '0')}`;
        tx.objectStore('conversations').put({ key: `staging:ui-history-${n}`, provider: 'chatgpt', conversationId, canonicalUrl: `https://chatgpt.com/c/${conversationId}`,
          nativeTitle: `合成历史 ${String(n + 1).padStart(5, '0')}`, titleBasis: 'browser-history', titleObservedAt: now, availability: 'unverified', firstSeenAt: now, lastSeenAt: now,
          browserLastVisitAt: new Date(at.getTime() - (n % 94) * 86400000).toISOString(), activity: null, stableRank: ordinal, revision: 1,
          owner: { kind: 'unassigned', localProfileKey: profile, accountKey: null }, ownerKey: `unassigned:${profile}`,
          membership: { state: 'UNKNOWN', projectId: null, reason: 'scope-unverified' }, membershipState: 'UNKNOWN' });
      }
    };
    const revision = tx.objectStore('revisions').get('main'); revision.onsuccess = () => tx.objectStore('revisions').put({ ...revision.result, value: revision.result.value + 1, nextRank: 50565 });
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = () => reject(tx.error); }); db.close();
    return { beforeDays: beforeDays.result, now };
  });
  await localPage.reload(); await localPage.waitForSelector('html[data-start-ready="true"]');
  await localPage.locator('#scope-selector').selectOption('unassigned');
  const historySection = localPage.locator('.recent-section');
  // Both scopes now use the same recent component. Its existence alone can
  // match the previous scope while the requested SNAPSHOT is still pending.
  await historySection.locator('[data-record-key="staging:ui-history-0"]').waitFor();
  const localHistoryWindow = {
    dateWindows: await historySection.locator('.date-window').count(),
    olderVisible: await localPage.locator('#period-older').isVisible(),
    recentHeadingVisible: await localPage.getByRole('heading', { name: '最近', exact: true }).isVisible(),
    confirmedOpenSections: await localPage.locator('[data-date-basis="confirmed-open"]').count(),
    unknownSections: await localPage.locator('.unknown-section').count(),
  };
  check('UI-local-564-history-date-windows', localHistoryWindow.dateWindows === 30 && localHistoryWindow.olderVisible
    && localHistoryWindow.recentHeadingVisible && localHistoryWindow.confirmedOpenSections === 0 && localHistoryWindow.unknownSections === 0,
  `564 synthetic local histories occupy their browser-visit calendar windows; the current window has 30 dates, no false active-date section or unstructured pending list. ${JSON.stringify(localHistoryWindow)}`);
  const firstHistoryDate = historySection.locator('.date-window').first();
  assert.equal(await firstHistoryDate.locator('.conversation-row').count(), 5);
  await firstHistoryDate.locator('[data-more]').click();
  check('UI-history-date-show-more', await firstHistoryDate.locator('.conversation-row').count() === 6 && await firstHistoryDate.locator('[data-more]').count() === 0,
    'Date windows use the existing bounded row expansion; all six same-day records are reachable without rendering the whole catalog.');
  await localPage.locator('[data-filter="none"]').click(); await localPage.locator('#period-older').click();
  check('UI-local-recent-30-day-navigation', await localPage.locator('#period-newer').isVisible() && await localPage.locator('[data-record-key="staging:ui-history-30"]').count() === 1
    && await localPage.locator('[data-record-key="staging:ui-history-0"]').count() === 0, 'The recent filter retains adjacent 30-day navigation and shows only that window.');
  await localPage.locator('#search-trigger').click(); await localPage.locator('#search-input').fill('合成历史');
  assert.equal(await localPage.locator('#search-results').getAttribute('data-total-matches'), '564');
  await localPage.locator('#search-input').fill('合成历史 00564');
  check('UI-local-full-history-search', await localPage.locator('.search-result').count() === 1, 'An entry outside the displayed dates remains searchable from the full local catalog.');
  await localPage.keyboard.press('Escape'); await localPage.locator('#period-newer').click();
  await localPage.reload(); await localPage.waitForSelector('html[data-start-ready="true"]');
  const localAfter = await localPage.evaluate(async () => {
    const req = indexedDB.open('vaiwl-start', 1); const db = await new Promise(resolve => { req.onsuccess = () => resolve(req.result); });
    const tx = db.transaction(['conversations', 'openDays'], 'readonly'), records = tx.objectStore('conversations').getAll(), days = tx.objectStore('openDays').count();
    await new Promise(resolve => { tx.oncomplete = resolve; }); db.close();
    return { count: records.result.filter(row => row.key.startsWith('staging:ui-history-')).length,
      activity: records.result.filter(row => row.key.startsWith('staging:ui-history-') && row.activity).length, days: days.result };
  });
  check('UI-local-history-reload-no-passive-activity', localAfter.count === 564 && localAfter.activity === 0 && localAfter.days === localSeed.beforeDays,
    'Date browsing, filtering, search and actual page reload preserve all 564 stable records and create no OpenDay or activity summary.');
  await localPage.evaluate(async at => {
    const req = indexedDB.open('vaiwl-start', 1); const db = await new Promise(resolve => { req.onsuccess = () => resolve(req.result); });
    const tx = db.transaction(['conversations', 'revisions'], 'readwrite');
    for (const n of [1, 65]) {
      const record = tx.objectStore('conversations').get(`staging:ui-history-${n}`);
      record.onsuccess = () => tx.objectStore('conversations').put({ ...record.result, localProjectCandidate: {
        key: 'local-project:ui-synthetic', projectId: 'g-p-eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', nativeTitle: '合成局部项目',
        canonicalUrl: 'https://chatgpt.com/g/g-p-eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee/project', observedAt: at, basis: 'local-project-observation' } });
    }
    const revision = tx.objectStore('revisions').get('main'); revision.onsuccess = () => tx.objectStore('revisions').put({ ...revision.result, value: revision.result.value + 1 });
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = () => reject(tx.error); }); db.close();
  }, localSeed.now);
  await localPage.reload(); await localPage.waitForSelector('html[data-start-ready="true"]');
  await localPage.locator('[data-filter="all"]').click();
  const candidateCard = localPage.locator('[data-candidate-project="local-project:ui-synthetic"]');
  await candidateCard.waitFor(); await candidateCard.getByRole('button', { name: '更早', exact: true }).click();
  check('UI-local-project-candidate-unified', (await candidateCard.getAttribute('class')) === 'project'
    && !(await candidateCard.textContent()).match(/本地候选|待确认|原生项目/)
    && await localPage.locator('[data-record-key="staging:ui-history-1"]').count() === 1 && await candidateCard.locator('[data-record-key="staging:ui-history-65"]').isVisible()
    && await localPage.locator('[data-project]').count() === 1,
  'Supported legacy Project relationships retain their identity boundary and older child, while using the same project component without provenance labels.');
  await localPage.screenshot({ path: 'artifacts/ui-local-history.png', fullPage: true });
  await localPage.close();
  check('UI-no-script-errors', errors.length === 0, JSON.stringify(errors));
  const status = checks.length > 0 && checks.every(item => item.status === 'PASS') && errors.length === 0 ? 'PASS' : 'FAIL';
  assert.equal(status, 'PASS', 'UI validation cannot pass with failed checks or page errors.');
  await writeFile('artifacts/ui-validation.json', JSON.stringify({ status, buildSha: buildInfo.sha, dirty: buildInfo.dirty, browser: await context.browser()?.version(), environment: 'isolated-headless-Chromium-MV3-synthetic-only', sourceGate: buildInfo.sourceGate, testFont: fontData ? 'Temporary Noto Sans CJK SC injected for test rendering; no font ships or downloads in production.' : 'System fonts', checks, limitations: ['Synthetic direct-IDB fixtures only; this is not ChatGPT metadata, true Edge, or Mac acceptance.', 'Chromium CDP native compositionstart/update/input are trusted; its browser-generated compositionend isTrusted is false. This exercises actual browser composition, not a Mac operating-system IME.'] }, null, 2));
  console.log(JSON.stringify({ uiChecks: checks.length, status, errors }));
} finally { await context.close(); }
