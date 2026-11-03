import type { WebsiteShortcut } from '../../contracts/free-v1.js';
import { NATIVE_KEYS, browserFamily, defaultTabTitle, validTitle, normalizeTitle, normalizeIcon, bookmarkPreference, safeBookmarkUrl, bookmarkBars, imageDimensions, type BookmarkNode } from '../domain/native-experience.js';
import { element as el, byId, button } from './dom.js';
import { createBookmarkShelf, type BookmarkShelfState } from './bookmark-shelf.js';

export async function sanitizeIcon(file: File): Promise<string> {
  if (file.size > 1_048_576) throw Error('图片须小于或等于 1 MB。');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const expected = imageDimensions(bytes, file.type);
  const bitmap = await createImageBitmap(file);
  try {
    if (!(bitmap.width === expected.width && bitmap.height === expected.height || bitmap.width === expected.height && bitmap.height === expected.width)) throw Error('图片尺寸校验失败。');
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
    const context = canvas.getContext('2d'); if (!context) throw Error('浏览器无法处理这张图片。');
    const ratio = Math.min(128 / bitmap.width, 128 / bitmap.height);
    context.drawImage(bitmap, (128 - bitmap.width * ratio) / 2, (128 - bitmap.height * ratio) / 2, bitmap.width * ratio, bitmap.height * ratio);
    const data = canvas.toDataURL('image/png');
    if (normalizeIcon({ kind: 'upload', data }).kind !== 'upload') throw Error('处理后的图标过大，请使用更简单的图片。');
    return data;
  } finally { bitmap.close(); }
}

export function initNativeExperience(options: { shortcuts: () => WebsiteShortcut[]; preserve: (fn: () => void) => void }): { refresh: () => void } {
  const browser = browserFamily(navigator.userAgent);
  const language = chrome.i18n.getUILanguage();
  let values: Record<string, unknown> = {}, bars: BookmarkNode[] = [], granted = false, epoch = 0, linked = false;
  let bookmarkError = '', pendingSave = Promise.resolve(), iconEpoch = 0;
  let shelf: ReturnType<typeof createBookmarkShelf> | undefined;
  let shelfState: BookmarkShelfState = { expanded: false, path: [] };
  let bookmarkRevision = 0, bookmarkRenderKey = '';
  const message = (text: string) => { byId('native-status').textContent = text; };
  const save = (patch: Record<string, unknown>): Promise<void> => {
    // Serialize this page's edits; independent keys avoid cross-tab title/icon clobbering.
    const task = pendingSave.then(() => chrome.storage.local.set(patch));
    pendingSave = task.catch(() => {});
    return task.then(async () => { values = await chrome.storage.local.get([...NATIVE_KEYS]); render(); });
  };
  const run = (task: Promise<unknown>) => { void task.catch(error => message(error instanceof Error ? error.message : '操作未完成，原有数据保留。')); };
  function identity(): void {
    document.title = normalizeTitle(values['native.title']) || defaultTabTitle(language, browser);
    const chosen = normalizeIcon(values['native.icon']);
    const href = chosen.kind === 'upload' ? chosen.data : chrome.runtime.getURL(`tab-${chosen.kind === 'product' ? 'product' : browser}.svg`);
    const favicon = byId<HTMLLinkElement>('tab-favicon');
    favicon.type = chosen.kind === 'upload' ? 'image/png' : 'image/svg+xml';
    if (favicon.href !== href) favicon.href = href;
    const input = byId<HTMLInputElement>('tab-title');
    if (document.activeElement !== input) input.value = normalizeTitle(values['native.title']);
    input.placeholder = defaultTabTitle(language, browser);
    const mode = byId<HTMLSelectElement>('tab-icon'); if (document.activeElement !== mode) mode.value = chosen.kind;
    byId('tab-identity-mode').textContent = !normalizeTitle(values['native.title']) && chosen.kind === 'browser' ? '遵从浏览器新标签页风格' : '自定义标签页身份';
  }
  function render(): void {
    identity();
    const pref = bookmarkPreference(values['native.bookmarks']);
    const select = byId<HTMLSelectElement>('bookmark-preference'); if (document.activeElement !== select) select.value = pref;
    byId('bookmark-connect').textContent = granted ? '撤销书签权限' : '授权读取浏览器书签';
    const migrate = byId<HTMLButtonElement>('bookmark-migrate'); migrate.disabled = !granted || !options.shortcuts().length || !bars.some(bar => !bar.unmodifiable);
    byId('legacy-count').textContent = `${options.shortcuts().length} 个旧快捷项完整保留在本机；迁移不会删除它们。`;
    const destination = byId<HTMLSelectElement>('bookmark-destination'), selected = destination.value;
    destination.replaceChildren(...bars.filter(bar => !bar.unmodifiable).map(bar => el('option', { value: bar.id }, [bar.title || '书签栏'])));
    if ([...destination.options].some(option => option.value === selected)) destination.value = selected;
    destination.hidden = destination.options.length < 2;
    const home = byId('bookmarks-home');
    const key = JSON.stringify([pref, granted, bookmarkError, bookmarkRevision]);
    // Catalog refreshes and identity edits must not rebuild a settled bookmark row.
    if (bookmarkRenderKey === key) return;
    bookmarkRenderKey = key;
    const focused = home.contains(document.activeElement) ? document.activeElement as HTMLElement : null;
    const focusId = focused?.id, focusBookmark = focused?.dataset.bookmarkId;
    shelf?.destroy(); shelf = undefined;
    // Preferences and permission requests belong to the one settings dialog.
    // An unconfigured/disconnected shelf must not become a permanent homepage banner.
    home.hidden = pref !== 'newtab' || !granted;
    if (home.hidden) { home.replaceChildren(); return; }
    let content = el('div', { id: 'native-bookmark-content', class: 'native-bookmark-content' });
    if (bookmarkError) content.append(el('p', { role: 'status', class: 'field-help' }, [bookmarkError]), button('重新读取', { id: 'bookmark-retry', class: 'text-button' }));
    else if (!bars.length) content.append(el('p', { class: 'field-help' }, ['未找到可读取的原生书签栏。可在浏览器书签管理器中检查。']));
    else {
      shelf = createBookmarkShelf(bars, shelfState, state => { shelfState = state; });
      content = shelf.element;
    }
    home.replaceChildren(el('div', { class: 'section-line' }, [el('h2', { class: 'bookmark-section-label' }, ['浏览器书签'])]), content);
    shelf?.refreshLayout();
    const restore = focusId ? document.getElementById(focusId) : focusBookmark ? [...home.querySelectorAll<HTMLElement>('[data-bookmark-id]')].find(node => node.dataset.bookmarkId === focusBookmark && !node.hidden) : null;
    if (restore && home.contains(restore) && !restore.hidden) restore.focus({ preventScroll: true });
  }
  function listen(): void {
    if (linked || !chrome.bookmarks) return;
    linked = true;
    for (const event of [chrome.bookmarks.onCreated, chrome.bookmarks.onRemoved, chrome.bookmarks.onChanged, chrome.bookmarks.onMoved, chrome.bookmarks.onChildrenReordered, chrome.bookmarks.onImportEnded]) event.addListener(refreshBookmarks);
  }
  async function refreshBookmarks(): Promise<void> {
    const sequence = ++epoch;
    try {
      const allowed = await chrome.permissions.contains({ permissions: ['bookmarks'] });
      if (allowed) listen(); // Observe mutations before the initial tree read resolves.
      const tree = allowed ? await chrome.bookmarks.getTree() : [];
      if (sequence !== epoch) return;
      granted = allowed; bars = allowed ? bookmarkBars(tree) : []; bookmarkError = ''; bookmarkRevision++; if (allowed) listen();
    } catch { if (sequence !== epoch) return; bars = []; granted = await chrome.permissions.contains({ permissions: ['bookmarks'] }).catch(() => false); bookmarkError = '书签暂时不可读取；原始书签未被改动。'; bookmarkRevision++; }
    if (sequence === epoch) options.preserve(render);
  }
  async function migrate(): Promise<void> {
    await navigator.locks.request('vaiwl-native-bookmark-migration', async () => {
      if (!await chrome.permissions.contains({ permissions: ['bookmarks'] })) throw Error('请先授权读取书签。');
      const tree = await chrome.bookmarks.getTree();
      const target = bookmarkBars(tree).find(bar => bar.id === byId<HTMLSelectElement>('bookmark-destination').value && !bar.unmodifiable);
      if (!target) throw Error('目标书签栏已改变，请重新选择。');
      const urls = new Set<string>();
      const visit = (node: BookmarkNode) => { const url = safeBookmarkUrl(node.url); if (url) urls.add(url); node.children?.forEach(visit); }; tree.forEach(visit);
      let added = 0, existing = 0, invalid = 0;
      try {
        for (const site of [...options.shortcuts()].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))) {
          const url = safeBookmarkUrl(site.url); if (!url) { invalid++; continue; }
          if (urls.has(url) || (await chrome.bookmarks.search({ url })).some(node => safeBookmarkUrl(node.url) === url)) { existing++; continue; }
          await chrome.bookmarks.create({ parentId: target.id, title: site.label, url }); urls.add(url); added++;
        }
        message(`已加入 ${added} 项，跳过已有 ${existing} 项、无效 ${invalid} 项。所有旧快捷项保留。`);
      } catch { throw Error(`已加入 ${added} 项后迁移中断。旧快捷项全部保留；再次迁移会跳过已加入项。`); }
    });
    await refreshBookmarks();
  }
  byId('tab-title-form').addEventListener('submit', event => { event.preventDefault(); run(Promise.resolve().then(() => save({ 'native.title': validTitle(byId<HTMLInputElement>('tab-title').value) })).then(() => message('标签页名称已保存。'))); });
  byId('tab-icon').addEventListener('change', event => {
    iconEpoch++; const kind = (event.target as HTMLSelectElement).value;
    if (kind === 'upload') { byId<HTMLInputElement>('tab-icon-upload').click(); return; }
    run(save({ 'native.icon': { kind } }).then(() => message('标签页图标已保存。')));
  });
  byId('tab-upload-again').addEventListener('click', () => { byId<HTMLInputElement>('tab-icon-upload').click(); });
  byId('tab-icon-upload').addEventListener('change', event => {
    const input = event.target as HTMLInputElement, file = input.files?.[0], sequence = ++iconEpoch; if (!file) { render(); return; }
    run(sanitizeIcon(file).then(data => sequence === iconEpoch ? save({ 'native.icon': { kind: 'upload', data } }) : undefined).then(() => message('上传图标仅保存在本机。')).finally(() => { input.value = ''; render(); }));
  });
  byId('tab-identity-reset').addEventListener('click', () => { iconEpoch++; run(save({ 'native.title': '', 'native.icon': { kind: 'browser' } }).then(() => message('已恢复浏览器新标签页风格。'))); });
  byId('bookmark-preference').addEventListener('change', event => { run(save({ 'native.bookmarks': bookmarkPreference((event.target as HTMLSelectElement).value) })); });
  document.addEventListener('click', event => {
    const target = (event.target as Element)?.closest('button'); if (!target) return;
    if (target.id === 'bookmark-retry') run(refreshBookmarks());
    if (target.id === 'bookmark-connect') {
      if (!event.isTrusted) return;
      // Call request in the original gesture turn, before any asynchronous work.
      const operation = granted ? chrome.permissions.remove({ permissions: ['bookmarks'] }) : chrome.permissions.request({ permissions: ['bookmarks'] });
      run(operation.then(async accepted => { if (!accepted) message('未获得书签权限，工作空间及旧快捷项不受影响。'); await refreshBookmarks(); }));
    }
    if (target.id === 'bookmark-migrate' && event.isTrusted && confirm('将旧快捷网站加入所选原生书签栏？已有网址会跳过；原有书签和旧快捷项都不会删除。')) run(migrate());
  });
  chrome.permissions.onAdded.addListener(change => { if (change.permissions?.includes('bookmarks')) run(refreshBookmarks()); });
  chrome.permissions.onRemoved.addListener(change => { if (!change.permissions?.includes('bookmarks')) return; ++epoch; bars = []; granted = false; render(); run(refreshBookmarks()); });
  chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && NATIVE_KEYS.some(key => key in changes)) run(chrome.storage.local.get([...NATIVE_KEYS]).then(data => { values = data; options.preserve(render); })); });
  window.addEventListener('focus', () => { run(refreshBookmarks()); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) run(refreshBookmarks()); });
  run(chrome.storage.local.get([...NATIVE_KEYS]).then(async data => { values = data; render(); await refreshBookmarks(); document.documentElement.dataset.nativeReady = 'true'; }));
  return { refresh: () => render() };
}
