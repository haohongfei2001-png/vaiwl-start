import { bookmarkFaviconUrl, orderedBookmarks, safeBookmarkUrl, visibleBookmarkCount, type BookmarkNode } from '../domain/native-experience.js';
import { element as el, button, icon } from './dom.js';

export interface BookmarkShelfState { expanded: boolean; path: string[] }

/** A page-local disclosure. Only the user's native tree is read, never rewritten. */
export function createBookmarkShelf(bars: BookmarkNode[], state: BookmarkShelfState, onState: (state: BookmarkShelfState) => void): { element: HTMLDivElement; refreshLayout: () => void; destroy: () => void } {
  const roots = bars.length === 1 ? orderedBookmarks(bars[0]?.children) : orderedBookmarks(bars);
  let expanded = state.expanded, path = [...state.path], frame = 0, disposed = false;
  const content = el('div', { id: 'native-bookmark-content', class: 'native-bookmark-content bookmark-shelf' });
  const row = el('div', { class: 'bookmark-shelf-row' });
  const list = el('div', { class: 'native-bookmark-list', id: 'bookmark-root-list', 'aria-label': '书签栏' });
  const toggle = button('展开', { id: 'bookmark-toggle', class: 'bookmark-more', 'aria-expanded': 'false', 'aria-controls': list.id }, 'down');
  const panel = el('section', { id: 'bookmark-folder-panel', class: 'bookmark-folder-panel', 'aria-label': '书签文件夹', hidden: true });
  row.append(list, toggle); content.append(row, panel);
  const notify = () => onState({ expanded, path: [...path] });

  function favicon(node: BookmarkNode): HTMLElement {
    const badge = el('span', { class: 'bookmark-favicon', 'data-favicon': 'fallback', 'aria-hidden': 'true' }, [icon('globe')]);
    let href: string | null = null;
    try { href = bookmarkFaviconUrl(node.url, chrome.runtime.getURL('/')); } catch { /* Browser cache unavailable; keep local globe. */ }
    if (!href) return badge;
    const img = el('img', { alt: '', width: 16, height: 16, decoding: 'async', loading: 'lazy', draggable: 'false' });
    badge.dataset.favicon = 'loading';
    img.addEventListener('load', () => { if (img.naturalWidth) badge.dataset.favicon = 'ready'; else badge.dataset.favicon = 'fallback'; }, { once: true });
    img.addEventListener('error', () => { badge.dataset.favicon = 'fallback'; img.remove(); }, { once: true });
    img.src = href; badge.append(img); return badge;
  }
  function entry(node: BookmarkNode, parentPath: string[]): HTMLElement {
    const title = node.title;
    const accessibleName = title || (node.url !== undefined ? safeBookmarkUrl(node.url) || '未命名书签' : '未命名文件夹');
    // An empty native name intentionally means an icon-only bookmark.
    const label = el('span', { class: 'bookmark-label', hidden: title === '' }, [title]);
    if (node.url !== undefined) {
      const url = safeBookmarkUrl(node.url);
      return url ? el('a', { href: url, class: 'site-link native-bookmark bookmark-chip', title: title ? `${title}\n${url}` : url, 'aria-label': accessibleName, 'data-bookmark-id': node.id, 'data-focus-key': `bookmark:${node.id}` }, [favicon(node), label])
        : el('span', { class: 'native-bookmark-disabled bookmark-chip', title: `${accessibleName} — 请在浏览器原生书签栏中打开此类网址`, 'aria-label': accessibleName, 'data-bookmark-id': node.id, 'data-focus-key': `bookmark:${node.id}` }, [icon('globe'), label]);
    }
    const item = button('', { class: 'bookmark-folder bookmark-chip', title: accessibleName, 'aria-label': accessibleName, 'data-bookmark-id': node.id, 'data-focus-key': `bookmark:${node.id}`, 'aria-expanded': String(path.includes(node.id)), 'aria-controls': panel.id });
    item.append(icon('folder'), label);
    item.addEventListener('click', () => { expanded = false; path = [...parentPath, node.id]; renderPanel(); notify(); measure(); panel.querySelector<HTMLButtonElement>('#bookmark-folder-back')?.focus({ preventScroll: true }); });
    return item;
  }
  for (const node of roots) list.append(entry(node, []));
  if (!roots.length) list.append(el('p', { class: 'field-help bookmark-empty' }, ['书签栏为空。你在浏览器中添加的书签会自动出现在这里。']));

  function renderPanel(): void {
    let children = roots; const folders: BookmarkNode[] = [];
    for (const id of path) {
      const folder = children.find(node => node.id === id && node.url === undefined);
      if (!folder) break;
      folders.push(folder); children = orderedBookmarks(folder.children);
    }
    path = folders.map(node => node.id); panel.hidden = !path.length;
    content.dataset.folderOpen = String(path.length > 0);
    for (const item of list.querySelectorAll<HTMLButtonElement>('.bookmark-folder')) item.setAttribute('aria-expanded', String(path[0] === item.dataset.bookmarkId));
    if (!folders.length) { panel.replaceChildren(); return; }
    const back = button('返回', { id: 'bookmark-folder-back', class: 'bookmark-folder-back', 'aria-label': path.length === 1 ? '返回书签栏' : '返回上一级文件夹' }, 'chevron');
    const close = button('', { id: 'bookmark-folder-close', class: 'icon-button', 'aria-label': '关闭书签文件夹' }, 'close');
    const heading = el('div', { class: 'bookmark-folder-heading' }, [back, el('span', { class: 'bookmark-breadcrumb', title: folders.map(node => node.title || '未命名文件夹').join(' / ') }, folders.map(node => node.title || '未命名文件夹').map((name, index) => `${index ? ' / ' : ''}${name}`)), close]);
    const folderList = el('div', { id: 'bookmark-folder-list', class: 'bookmark-folder-list', 'data-parent-id': path.at(-1)!, 'aria-label': folders.at(-1)!.title || '未命名文件夹' }, children.length ? children.map(node => entry(node, path)) : [el('p', { class: 'field-help bookmark-empty' }, ['空文件夹'])]);
    const returnFocus = () => {
      const target = path[0]; path = []; renderPanel(); notify(); measure();
      const item = [...list.querySelectorAll<HTMLButtonElement>('.bookmark-folder')].find(item => item.dataset.bookmarkId === target && !item.hidden);
      (item ?? (toggle.hidden ? undefined : toggle))?.focus({ preventScroll: true });
    };
    back.addEventListener('click', () => { if (path.length === 1) returnFocus(); else { path.pop(); renderPanel(); notify(); panel.querySelector<HTMLButtonElement>('#bookmark-folder-back')?.focus({ preventScroll: true }); } });
    close.addEventListener('click', returnFocus);
    panel.replaceChildren(heading, folderList);
  }

  function measure(): void {
    frame = 0; if (disposed || !content.isConnected) return;
    const width = row.getBoundingClientRect().width; if (width <= 0) return;
    content.dataset.expanded = String(expanded);
    const items = [...list.children].filter((node): node is HTMLElement => node instanceof HTMLElement && !!node.dataset.bookmarkId);
    for (const item of items) { item.hidden = false; item.inert = false; }
    const gap = Number.parseFloat(getComputedStyle(list).columnGap) || 6;
    const rowGap = Number.parseFloat(getComputedStyle(row).columnGap) || 6;
    // First test the full width, then reserve the real disclosure width if needed.
    // Measuring only with the control present could shrink long labels and falsely
    // conclude that all chips fit when removing that control enlarges them again.
    toggle.hidden = true;
    const fullWidths = items.map(item => item.getBoundingClientRect().width);
    const allFit = visibleBookmarkCount(fullWidths, width, gap, 0) === items.length;
    toggle.hidden = false;
    const toggleWidth = toggle.getBoundingClientRect().width;
    const count = allFit ? items.length : visibleBookmarkCount(items.map(item => item.getBoundingClientRect().width), width - toggleWidth - rowGap, gap, 0);
    toggle.hidden = count === items.length;
    toggle.setAttribute('aria-expanded', String(expanded));
    toggle.replaceChildren(icon(expanded ? 'up' : 'down'), expanded ? '收起' : '展开');
    toggle.title = expanded ? '收起至一行书签' : `展开其余 ${Math.max(0, items.length - count)} 项书签`;
    content.dataset.expanded = String(expanded);
    content.dataset.visibleCount = String(expanded ? items.length : count);
    content.dataset.totalCount = String(items.length);
    for (let index = 0; index < items.length; index++) {
      const item = items[index]!; item.hidden = !expanded && index >= count; item.inert = item.hidden;
      if (item.hidden && item.contains(document.activeElement)) toggle.focus({ preventScroll: true });
    }
    content.dataset.ready = 'true';
  }
  const schedule = () => { if (!disposed && !frame) frame = requestAnimationFrame(measure); };
  toggle.addEventListener('click', () => { expanded = !expanded; if (expanded) { path = []; renderPanel(); } notify(); measure(); });
  panel.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); panel.querySelector<HTMLButtonElement>('#bookmark-folder-close')?.click(); } });
  const observer = new ResizeObserver(schedule); observer.observe(row);
  window.addEventListener('resize', schedule); window.visualViewport?.addEventListener('resize', schedule);
  document.fonts?.addEventListener('loadingdone', schedule);
  renderPanel(); schedule();
  return { element: content, refreshLayout: () => { cancelAnimationFrame(frame); measure(); }, destroy: () => { disposed = true; cancelAnimationFrame(frame); observer.disconnect(); window.removeEventListener('resize', schedule); window.visualViewport?.removeEventListener('resize', schedule); document.fonts?.removeEventListener('loadingdone', schedule); } };
}
