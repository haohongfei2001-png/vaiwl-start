import type { WebsiteShortcut } from '../../contracts/free-v1.js';
import { NATIVE_KEYS, browserFamily, defaultTabTitle, validTitle, normalizeTitle, normalizeIcon, bookmarkPreference, safeBookmarkUrl, bookmarkBars, orderedBookmarks, imageDimensions, type BookmarkNode } from '../domain/native-experience.js';
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

/** Writable native folders, in browser order. The synthetic root and managed subtrees are not destinations. */
export function bookmarkMigrationDestinations(tree: BookmarkNode[]): { id: string; title: string }[] {
  const destinations: { id: string; title: string }[] = [];
  const visit = (node: BookmarkNode, parent: string[]) => {
    if (node.url || node.unmodifiable) return;
    const path = [...parent, node.title || (node.folderType === 'bookmarks-bar' || node.id === '1' ? '书签栏' : '未命名文件夹')];
    destinations.push({ id: node.id, title: path.join(' / ') });
    orderedBookmarks(node.children).forEach(child => visit(child, path));
  };
  orderedBookmarks(tree).forEach(root => { if (!root.unmodifiable) orderedBookmarks(root.children).forEach(child => visit(child, [])); });
  return destinations;
}

export function initNativeExperience(options: { shortcuts: () => WebsiteShortcut[]; preserve: (fn: () => void) => void; legacyAvailable?: () => boolean }): { refresh: () => void } {
  const browser = browserFamily(navigator.userAgent);
  const language = chrome.i18n.getUILanguage();
  let values: Record<string, unknown> = {}, bars: BookmarkNode[] = [], granted = false, epoch = 0, linked = false;
  let bookmarkError = '', pendingSave = Promise.resolve(), iconEpoch = 0;
  const preferenceVersions: Record<string, number> = {};
  let migrationFolders: { id: string; title: string }[] = [], destinationKey = '';
  let titleDirty = false, titleVersion = 0, titleSaving = false, iconSaving = false, preferenceSaving = false, permissionChanging = false, migrating = false;
  let shelf: ReturnType<typeof createBookmarkShelf> | undefined;
  let shelfState: BookmarkShelfState = { expanded: false, path: [] };
  let bookmarkRevision = 0, bookmarkRenderKey = '';
  type MessageArea = 'identity' | 'bookmarks' | 'migration';
  const message = (text: string, area: MessageArea = 'identity', error = false) => {
    const receipt = byId('native-status');
    const node = document.getElementById(area === 'identity' ? 'tab-identity-status' : area === 'migration' ? 'bookmark-migration-status' : 'bookmark-status') || receipt;
    node.textContent = text; node.dataset.state = error ? 'error' : 'success';
    if (receipt !== node) { receipt.textContent = text; receipt.dataset.state = node.dataset.state; }
  };
  const save = (patch: Record<string, unknown>, current: () => boolean = () => true): Promise<boolean> => {
    // Serialize this page's edits; independent keys avoid cross-tab title/icon clobbering.
    const task = pendingSave.then(async () => {
      if (!current()) return false;
      const versions = Object.fromEntries(Object.keys(patch).map(key => [key, preferenceVersions[key] || 0]));
      await chrome.storage.local.set(patch);
      // An onChanged notification may already contain a newer edit from another tab.
      for (const [key, value] of Object.entries(patch)) if ((preferenceVersions[key] || 0) === versions[key]) values[key] = value;
      render();
      return true;
    });
    pendingSave = task.then(() => {}, () => {});
    return task;
  };
  const run = (task: Promise<unknown>, area: MessageArea = 'identity') => { void task.catch(error => {
    const detail = error instanceof Error ? error.message : '';
    const text = /[\u4e00-\u9fff]/.test(detail) ? detail : /quota/i.test(detail) ? '本地存储空间不足，原设置已保留。' : /permission|denied/i.test(detail) ? '尚未获得权限，请重新授权。' : '操作未完成，请重试。';
    message(text, area, true); render();
  }); };
  const retainControlFocus = () => {
    const control = document.activeElement as HTMLElement | null;
    return () => {
      if (!control || !control.matches('button,input,select') || !control.isConnected || control.closest('[hidden]') || control.closest<HTMLDialogElement>('dialog')?.open === false) return;
      if (document.activeElement === document.body || document.activeElement === control) control.focus({ preventScroll: true });
    };
  };
  function identity(): void {
    document.title = normalizeTitle(values['native.title']) || defaultTabTitle(language, browser);
    const chosen = normalizeIcon(values['native.icon']);
    const href = chosen.kind === 'upload' ? chosen.data : chrome.runtime.getURL(`tab-${chosen.kind === 'product' ? 'product' : browser}.svg`);
    const favicon = byId<HTMLLinkElement>('tab-favicon');
    favicon.type = chosen.kind === 'upload' ? 'image/png' : 'image/svg+xml';
    if (favicon.href !== href) favicon.href = href;
    const input = byId<HTMLInputElement>('tab-title');
    // A draft survives tab navigation, blur, bookmark refreshes and external preference events.
    if (!titleDirty) input.value = normalizeTitle(values['native.title']);
    input.placeholder = defaultTabTitle(language, browser);
    byId('tab-title-form').setAttribute('aria-busy', String(titleSaving));
    const submit = byId('tab-title-form').querySelector<HTMLButtonElement>('button[type="submit"]'); if (submit) submit.disabled = titleSaving;
    const mode = byId<HTMLSelectElement>('tab-icon'); mode.value = chosen.kind; mode.disabled = iconSaving;
    byId<HTMLButtonElement>('tab-upload-again').disabled = iconSaving;
    byId<HTMLButtonElement>('tab-identity-reset').disabled = titleSaving || iconSaving;
    const identityMode = document.getElementById('tab-identity-mode');
    if (identityMode) identityMode.textContent = !normalizeTitle(values['native.title']) && chosen.kind === 'browser' ? '浏览器默认' : '自定义';
    const previewTitle = document.getElementById('settings-tab-preview-title');
    if (previewTitle) previewTitle.textContent = titleDirty ? normalizeTitle(input.value) || defaultTabTitle(language, browser) : document.title;
    const previewIcon = document.getElementById('settings-tab-preview-icon') as HTMLImageElement | null;
    if (previewIcon && previewIcon.src !== href) previewIcon.src = href;
  }
  function render(): void {
    identity();
    const pref = bookmarkPreference(values['native.bookmarks']);
    const select = byId<HTMLSelectElement>('bookmark-preference'); select.value = pref; select.disabled = preferenceSaving;
    const connect = byId<HTMLButtonElement>('bookmark-connect'); connect.textContent = granted ? '撤销权限' : '允许访问'; connect.disabled = permissionChanging;
    const permissionLabel = document.getElementById('bookmark-permission-label'); if (permissionLabel) permissionLabel.textContent = granted ? '已授权' : '未授权';
    const legacyAvailable = options.legacyAvailable?.() ?? true;
    const shortcuts = legacyAvailable ? options.shortcuts() : [];
    const migrate = byId<HTMLButtonElement>('bookmark-migrate'); migrate.disabled = migrating || !legacyAvailable || !granted || !shortcuts.length || !migrationFolders.length;
    byId('legacy-count').textContent = legacyAvailable ? `${shortcuts.length} 个快捷网站` : '';
    const destination = byId<HTMLSelectElement>('bookmark-destination'), selected = destination.value;
    const nextDestinationKey = JSON.stringify(migrationFolders);
    if (destinationKey !== nextDestinationKey) {
      destinationKey = nextDestinationKey;
      destination.replaceChildren(...migrationFolders.map(folder => el('option', { value: folder.id }, [folder.title])));
      if ([...destination.options].some(option => option.value === selected)) destination.value = selected;
    }
    destination.hidden = !granted || !destination.options.length; destination.disabled = migrating;
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
      granted = allowed; bars = allowed ? bookmarkBars(tree) : []; migrationFolders = allowed ? bookmarkMigrationDestinations(tree) : []; bookmarkError = ''; bookmarkRevision++; if (allowed) listen();
    } catch { if (sequence !== epoch) return; bars = []; migrationFolders = []; granted = await chrome.permissions.contains({ permissions: ['bookmarks'] }).catch(() => false); bookmarkError = '书签暂时不可读取；原始书签未被改动。'; bookmarkRevision++; message(bookmarkError, 'bookmarks', true); }
    if (sequence === epoch) options.preserve(render);
  }
  async function migrate(): Promise<void> {
    if (migrating || !(options.legacyAvailable?.() ?? true)) return;
    const restoreFocus = retainControlFocus();
    migrating = true;
    const targetId = byId<HTMLSelectElement>('bookmark-destination').value;
    const shortcuts = [...options.shortcuts()].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
    render();
    try {
    await navigator.locks.request('vaiwl-native-bookmark-migration', async () => {
      if (!await chrome.permissions.contains({ permissions: ['bookmarks'] })) throw Error('请先授权读取书签。');
      const tree = await chrome.bookmarks.getTree();
      const target = bookmarkMigrationDestinations(tree).find(folder => folder.id === targetId);
      if (!target) throw Error('目标文件夹已改变，请重新选择。');
      const urls = new Set<string>();
      const visit = (node: BookmarkNode) => { const url = safeBookmarkUrl(node.url); if (url) urls.add(url); node.children?.forEach(visit); }; tree.forEach(visit);
      let added = 0, existing = 0, invalid = 0;
      try {
        for (const site of shortcuts) {
          if (!(options.legacyAvailable?.() ?? true)) throw Error('旧快捷网站已关闭。');
          const url = safeBookmarkUrl(site.url); if (!url) { invalid++; continue; }
          if (urls.has(url) || (await chrome.bookmarks.search({ url })).some(node => safeBookmarkUrl(node.url) === url)) { existing++; continue; }
          await chrome.bookmarks.create({ parentId: target.id, title: site.label, url }); urls.add(url); added++;
        }
        message(`已加入 ${added} 项，跳过已有 ${existing} 项${invalid ? `、无效 ${invalid} 项` : ''}。旧快捷网站已保留。`, 'migration');
      } catch { throw Error(`已加入 ${added} 项后迁移中断。旧快捷项全部保留；再次迁移会跳过已加入项。`); }
    });
    await refreshBookmarks();
    } finally { migrating = false; render(); restoreFocus(); }
  }
  byId('tab-title').addEventListener('input', () => { titleDirty = true; titleVersion++; identity(); });
  byId('tab-title-form').addEventListener('submit', event => {
    event.preventDefault(); if (titleSaving) return;
    const input = byId<HTMLInputElement>('tab-title'), version = titleVersion;
    let title: string;
    try { title = validTitle(input.value); } catch (error) { message((error as Error).message, 'identity', true); input.focus(); return; }
    const restoreFocus = retainControlFocus(); titleSaving = true; identity();
    run(save({ 'native.title': title }).then(() => {
      if (version === titleVersion) titleDirty = false;
      message('名称已保存。');
    }).finally(() => { titleSaving = false; identity(); restoreFocus(); }));
  });
  function saveIcon(kind: string): void {
    const sequence = ++iconEpoch, restoreFocus = retainControlFocus(); iconSaving = true;
    byId<HTMLSelectElement>('tab-icon').disabled = true; byId<HTMLButtonElement>('tab-upload-again').disabled = true;
    run(save({ 'native.icon': { kind } }, () => sequence === iconEpoch).then(saved => { if (saved && sequence === iconEpoch) message('图标已保存。'); }).finally(() => { if (sequence === iconEpoch) iconSaving = false; identity(); restoreFocus(); }));
  }
  byId('tab-icon').addEventListener('change', event => {
    const kind = (event.target as HTMLSelectElement).value;
    if (kind === 'upload') { ++iconEpoch; identity(); byId<HTMLInputElement>('tab-icon-upload').click(); return; }
    saveIcon(kind);
  });
  byId('tab-upload-again').addEventListener('click', () => { ++iconEpoch; byId<HTMLInputElement>('tab-icon-upload').click(); });
  byId('tab-icon-upload').addEventListener('cancel', () => { byId<HTMLInputElement>('tab-icon-upload').value = ''; identity(); });
  byId('tab-icon-upload').addEventListener('change', event => {
    const input = event.target as HTMLInputElement, file = input.files?.[0], sequence = ++iconEpoch; if (!file) { identity(); return; }
    const restoreFocus = retainControlFocus(); iconSaving = true; identity(); message('正在处理图片…');
    run(sanitizeIcon(file).then(data => save({ 'native.icon': { kind: 'upload', data } }, () => sequence === iconEpoch)).then(saved => {
      if (saved && sequence === iconEpoch) message('图标已保存。');
    }).finally(() => { input.value = ''; if (sequence === iconEpoch) iconSaving = false; identity(); restoreFocus(); }));
  });
  byId('tab-identity-reset').addEventListener('click', () => {
    const sequence = ++iconEpoch, version = titleVersion, restoreFocus = retainControlFocus(); iconSaving = true; titleSaving = true; identity();
    run(save({ 'native.title': '', 'native.icon': { kind: 'browser' } }).then(() => {
      if (version === titleVersion) titleDirty = false;
      message('已恢复默认名称与图标。');
    }).finally(() => { if (sequence === iconEpoch) iconSaving = false; titleSaving = false; identity(); restoreFocus(); }));
  });
  byId('bookmark-preference').addEventListener('change', event => {
    const select = event.target as HTMLSelectElement, pref = bookmarkPreference(select.value), restoreFocus = retainControlFocus(); preferenceSaving = true; select.disabled = true;
    run(save({ 'native.bookmarks': pref }).then(() => message('显示方式已保存。', 'bookmarks')).finally(() => { preferenceSaving = false; render(); restoreFocus(); }), 'bookmarks');
  });
  document.addEventListener('click', event => {
    const target = (event.target as Element)?.closest('button'); if (!target) return;
    if (target.id === 'bookmark-retry') run(refreshBookmarks(), 'bookmarks');
    if (target.id === 'bookmark-connect') {
      if (!event.isTrusted || permissionChanging) return;
      const removing = granted, restoreFocus = retainControlFocus();
      // Call request in the original gesture turn, before any asynchronous work.
      const operation = removing ? chrome.permissions.remove({ permissions: ['bookmarks'] }) : chrome.permissions.request({ permissions: ['bookmarks'] });
      permissionChanging = true; render();
      run(operation.then(async accepted => {
        await refreshBookmarks();
        if (bookmarkError) message(bookmarkError, 'bookmarks', true);
        else if (removing) message(granted ? '权限未撤销，请重试。' : '书签权限已撤销。', 'bookmarks', granted);
        else message(accepted && granted ? '已允许访问浏览器书签。' : '未获得书签权限。', 'bookmarks', !granted);
      }).finally(() => { permissionChanging = false; render(); restoreFocus(); }), 'bookmarks');
    }
    if (target.id === 'bookmark-migrate' && event.isTrusted && !migrating && (options.legacyAvailable?.() ?? true) && confirm('将旧快捷网站加入所选书签文件夹？已有网址会跳过，原有书签和旧快捷网站都会保留。')) run(migrate(), 'migration');
  });
  chrome.permissions.onAdded.addListener(change => { if (change.permissions?.includes('bookmarks')) run(refreshBookmarks().then(() => { if (granted && !bookmarkError) message('已允许访问浏览器书签。', 'bookmarks'); }), 'bookmarks'); });
  chrome.permissions.onRemoved.addListener(change => { if (!change.permissions?.includes('bookmarks')) return; ++epoch; bars = []; migrationFolders = []; granted = false; message('书签权限已撤销。', 'bookmarks'); render(); run(refreshBookmarks(), 'bookmarks'); });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !NATIVE_KEYS.some(key => key in changes)) return;
    for (const key of NATIVE_KEYS) if (key in changes) { preferenceVersions[key] = (preferenceVersions[key] || 0) + 1; values[key] = changes[key]!.newValue; }
    options.preserve(render);
  });
  window.addEventListener('focus', () => { run(refreshBookmarks()); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) run(refreshBookmarks()); });
  run(chrome.storage.local.get([...NATIVE_KEYS]).then(async data => { values = { ...data, ...values }; render(); await refreshBookmarks(); document.documentElement.dataset.nativeReady = 'true'; }));
  return { refresh: () => render() };
}
