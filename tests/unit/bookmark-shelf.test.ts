import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { bookmarkFaviconUrl, orderedBookmarks, visibleBookmarkCount, type BookmarkNode } from '../../src/domain/native-experience.js';
import { createBookmarkShelf } from '../../src/ui/bookmark-shelf.js';

test('bookmark row uses measured widths and reserves disclosure only when overflow exists', () => {
  assert.equal(visibleBookmarkCount([91, 43, 122], 268, 6, 61), 3);
  assert.equal(visibleBookmarkCount([91, 43, 122], 267, 6, 61), 2);
  assert.equal(visibleBookmarkCount([91, 43, 122], 150, 6, 61), 0);
  assert.equal(visibleBookmarkCount([70, 40, 90], 116, 6, 0), 2);
  assert.equal(visibleBookmarkCount([70, 40, 90], 115, 6, 0), 1);
  assert.equal(visibleBookmarkCount([], 100, 6, 61), 0);
  assert.equal(visibleBookmarkCount([100], 0, 6, 61), 0);
  assert.equal(visibleBookmarkCount([100], Number.NaN, 6, 61), 0);
  assert.equal(visibleBookmarkCount([40, Number.NaN], 120, 6, 61), 1);
});

test('bookmark favicons use only the extension favicon route and preserve escaped page URLs', () => {
  const value = bookmarkFaviconUrl('https://example.com/path?q=hello&next=https://other.example/#part', 'chrome-extension://abc/');
  assert.ok(value);
  const url = new URL(value);
  assert.equal(url.protocol, 'chrome-extension:'); assert.equal(url.host, 'abc'); assert.equal(url.pathname, '/_favicon/');
  assert.equal(url.searchParams.get('pageUrl'), 'https://example.com/path?q=hello&next=https://other.example/#part');
  assert.equal(url.searchParams.get('size'), '32');
  for (const input of ['javascript:alert(1)', 'data:image/png,a', 'https://user:password@example.com', null, {}]) assert.equal(bookmarkFaviconUrl(input, 'chrome-extension://abc/'), null);
});

test('malformed native nodes are skipped without rearranging valid siblings', () => {
  const a = { id: 'a', title: 'Zulu' }, b = { id: 'b', title: 'Alpha' };
  assert.deepEqual(orderedBookmarks([null, a, { id: 'bad' }, b, 7, { id: 4, title: 'invalid id' }]), [a, b]);
  assert.deepEqual(orderedBookmarks({ children: [a] }), []);
});

test('shelf hides overflow from keyboard, follows resize, bounds folder rendering and falls back on icon failure', () => {
  const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
  const globals = globalThis as any;
  const names = ['window', 'document', 'HTMLElement', 'chrome', 'ResizeObserver', 'requestAnimationFrame', 'cancelAnimationFrame', 'getComputedStyle'];
  const previous = Object.fromEntries(names.map(name => [name, globals[name]]));
  let width = 210, nextFrame: FrameRequestCallback | undefined, resized: (() => void) | undefined;
  globals.window = dom.window; globals.document = dom.window.document; globals.HTMLElement = dom.window.HTMLElement;
  globals.chrome = { runtime: { getURL: (path: string) => new URL(path, 'chrome-extension://test/').href } };
  globals.ResizeObserver = class { constructor(callback: () => void) { resized = callback; } observe() {} disconnect() {} };
  globals.requestAnimationFrame = (callback: FrameRequestCallback) => { nextFrame = callback; return 1; };
  globals.cancelAnimationFrame = () => { nextFrame = undefined; };
  globals.getComputedStyle = () => ({ columnGap: '6px' });
  const rect = (size: number) => ({ width: size, height: 34, x: 0, y: 0, top: 0, left: 0, bottom: 34, right: size, toJSON() {} });
  dom.window.HTMLElement.prototype.getBoundingClientRect = function () {
    return rect(this.classList.contains('bookmark-shelf-row') ? width : this.id === 'bookmark-toggle' ? 61 : 90);
  };
  const bar: BookmarkNode = { id: '1', title: 'Bookmarks bar', children: [
    { id: 'a', title: 'First', url: 'https://first.example/' },
    { id: 'folder', title: 'Folder', children: [{ id: 'nested', title: 'Nested', children: [{ id: 'leaf', title: 'Leaf', url: 'https://leaf.example/' }] }] },
    { id: 'c', title: '<img src=x onerror=bad>', url: 'https://third.example/' },
    { id: 'unsafe', title: 'Special link', url: 'javascript:alert(1)' },
    { id: 'blank', title: '', url: 'https://icon-only.example/' },
    { id: 'blank-folder', title: '', children: [] }
  ] };
  const before = JSON.stringify(bar);
  let observed = { expanded: false, path: [] as string[] };
  const shelf = createBookmarkShelf([bar], observed, state => { observed = state; });
  try {
    dom.window.document.body.append(shelf.element);
    nextFrame?.(0);
    const query = <T extends Element>(selector: string) => shelf.element.querySelector<T>(selector)!;
    assert.equal(shelf.element.dataset.visibleCount, '1');
    assert.deepEqual([...query<HTMLElement>('.native-bookmark-list').children].map(node => (node as HTMLElement).dataset.bookmarkId), ['a', 'folder', 'c', 'unsafe', 'blank', 'blank-folder']);
    assert.deepEqual([...query<HTMLElement>('.native-bookmark-list').children].map(node => (node as HTMLElement).dataset.focusKey), ['bookmark:a', 'bookmark:folder', 'bookmark:c', 'bookmark:unsafe', 'bookmark:blank', 'bookmark:blank-folder']);
    assert.equal(query<HTMLElement>('[data-bookmark-id="folder"]').hidden, true);
    assert.equal(query<HTMLElement>('[data-bookmark-id="folder"]').inert, true);
    assert.equal(query<HTMLElement>('[data-bookmark-id="unsafe"]').hasAttribute('href'), false);
    assert.equal(query<HTMLElement>('[data-bookmark-id="c"]').textContent, '<img src=x onerror=bad>');
    assert.equal(query<HTMLElement>('[data-bookmark-id="blank"]').textContent, '');
    assert.equal(query<HTMLElement>('[data-bookmark-id="blank"] .bookmark-label').hidden, true);
    assert.equal(query<HTMLElement>('[data-bookmark-id="blank"]').getAttribute('aria-label'), 'https://icon-only.example/');
    assert.equal(query<HTMLElement>('[data-bookmark-id="blank-folder"]').textContent, '');
    assert.equal(query<HTMLElement>('[data-bookmark-id="blank-folder"]').getAttribute('aria-label'), '未命名文件夹');
    assert.equal(shelf.element.querySelector('[data-bookmark-id="leaf"]'), null);
    query<HTMLButtonElement>('#bookmark-toggle').click();
    assert.equal(observed.expanded, true); assert.equal(shelf.element.dataset.visibleCount, '6');
    assert.equal(query<HTMLElement>('[data-bookmark-id="folder"]').inert, false);
    query<HTMLButtonElement>('[data-bookmark-id="folder"]').click();
    assert.deepEqual(observed.path, ['folder']); assert.equal(observed.expanded, false);
    assert.equal(query<HTMLElement>('#bookmark-folder-panel').hidden, false);
    assert.equal(query<HTMLElement>('#bookmark-folder-list').dataset.parentId, 'folder');
    query<HTMLButtonElement>('[data-bookmark-id="nested"]').click();
    assert.deepEqual(observed.path, ['folder', 'nested']); assert.equal(query<HTMLAnchorElement>('[data-bookmark-id="leaf"]').href, 'https://leaf.example/');
    query<HTMLButtonElement>('#bookmark-folder-back').click(); assert.deepEqual(observed.path, ['folder']);
    query<HTMLButtonElement>('#bookmark-folder-close').click(); assert.equal(query<HTMLElement>('#bookmark-folder-panel').hidden, true);
    const badge = query<HTMLElement>('[data-bookmark-id="a"] .bookmark-favicon');
    assert.equal(badge.dataset.favicon, 'loading'); badge.querySelector('img')!.dispatchEvent(new dom.window.Event('error'));
    assert.equal(badge.dataset.favicon, 'fallback'); assert.ok(badge.querySelector('svg')); assert.equal(badge.querySelector('img'), null);
    width = 600; resized?.(); nextFrame?.(0); assert.equal(shelf.element.dataset.visibleCount, '6'); assert.equal(query<HTMLElement>('#bookmark-toggle').hidden, true);
    width = 210; resized?.(); nextFrame?.(0); assert.equal(shelf.element.dataset.visibleCount, '1'); assert.equal(query<HTMLElement>('#bookmark-toggle').hidden, false);
    assert.equal(JSON.stringify(bar), before);
  } finally { shelf.destroy(); for (const name of names) globals[name] = previous[name]; dom.window.close(); }
});
