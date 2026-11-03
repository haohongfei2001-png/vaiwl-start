import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { bookmarkMigrationDestinations, initNativeExperience } from '../../src/ui/native-experience.js';
import type { BookmarkNode } from '../../src/domain/native-experience.js';

const settle = () => new Promise<void>(resolve => setImmediate(resolve));

function fixture(initial: Record<string, unknown> = {}) {
  const dom = new JSDOM(`<!doctype html><html><head><link id="tab-favicon"></head><body>
    <form id="tab-title-form"><input id="tab-title"><button type="submit">保存</button></form>
    <select id="tab-icon"><option value="browser">默认</option><option value="product">产品</option><option value="upload">上传</option></select>
    <button id="tab-upload-again">上传</button><input id="tab-icon-upload" type="file"><button id="tab-identity-reset">恢复默认</button>
    <span id="settings-tab-preview-title"></span><img id="settings-tab-preview-icon"><p id="tab-identity-status"></p>
    <select id="bookmark-preference"><option value="ask">选择</option><option value="always">常驻</option><option value="newtab">新标签</option><option value="hidden">隐藏</option></select>
    <button id="bookmark-connect">连接</button><span id="bookmark-permission-label"></span><p id="bookmark-status"></p>
    <button id="bookmark-migrate">迁移</button><p id="legacy-count"></p><select id="bookmark-destination"></select><p id="bookmark-migration-status"></p>
    <section id="bookmarks-home"></section><p id="native-status"></p><button id="other">其他页面</button></body></html>`, { pretendToBeVisual: true, url: 'https://settings.example/' });
  const names = ['window', 'document', 'navigator', 'Element', 'HTMLElement', 'chrome', 'createImageBitmap'];
  const globals = globalThis as any;
  const descriptors = Object.fromEntries(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const assign = (name: string, value: unknown) => Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  for (const name of ['window', 'document', 'navigator', 'Element', 'HTMLElement']) assign(name, (dom.window as any)[name]);
  let stored: Record<string, unknown> = { 'native.title': 'Original', 'native.icon': { kind: 'browser' }, 'native.bookmarks': 'always', ...initial };
  let failWrite = false, allowed = false, legacy = false, reads = 0;
  let holdWrite: (() => Promise<void>) | null = null;
  let tree: BookmarkNode[] = [];
  const listeners = new Map<string, ((...args: any[]) => void)[]>();
  const event = (name: string) => ({ addListener: (fn: (...args: any[]) => void) => listeners.set(name, [...listeners.get(name) || [], fn]) });
  const emit = (name: string, ...args: any[]) => listeners.get(name)?.forEach(fn => fn(...args));
  const chrome = {
    i18n: { getUILanguage: () => 'zh-CN' }, runtime: { getURL: (path: string) => `chrome-extension://fixture/${path}` },
    storage: { local: {
      get: async () => structuredClone(stored),
      set: async (patch: Record<string, unknown>) => {
        await holdWrite?.(); if (failWrite) throw Error('本地存储空间不足。');
        const changes = Object.fromEntries(Object.entries(patch).map(([key, newValue]) => [key, { oldValue: stored[key], newValue }]));
        stored = { ...stored, ...patch }; emit('storage', changes, 'local');
      }
    }, onChanged: event('storage') },
    permissions: { contains: async () => allowed, onAdded: event('permission-added'), onRemoved: event('permission-removed') },
    bookmarks: { getTree: async () => structuredClone(tree), onCreated: event('bookmark-created'), onRemoved: event('bookmark-removed'), onChanged: event('bookmark-changed'), onMoved: event('bookmark-moved'), onChildrenReordered: event('bookmark-reordered'), onImportEnded: event('bookmark-imported') }
  };
  assign('chrome', chrome);
  const instance = initNativeExperience({ shortcuts: () => { reads++; return []; }, legacyAvailable: () => legacy, preserve: fn => fn() });
  const query = <T extends HTMLElement>(id: string) => dom.window.document.getElementById(id) as T;
  const input = (value: string) => { query<HTMLInputElement>('tab-title').value = value; query('tab-title').dispatchEvent(new dom.window.Event('input', { bubbles: true })); };
  const select = (id: string, value: string) => { query<HTMLSelectElement>(id).value = value; query(id).dispatchEvent(new dom.window.Event('change', { bubbles: true })); };
  const submit = () => query('tab-title-form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  return {
    dom, query, instance, input, select, submit, emit, stored: () => stored, reads: () => reads,
    setFailWrite: (value: boolean) => { failWrite = value; }, holdWrite: (value: (() => Promise<void>) | null) => { holdWrite = value; },
    setAllowed: (value: boolean) => { allowed = value; }, setLegacy: (value: boolean) => { legacy = value; }, setTree: (value: BookmarkNode[]) => { tree = value; },
    external: (patch: Record<string, unknown>) => { stored = { ...stored, ...patch }; emit('storage', Object.fromEntries(Object.entries(patch).map(([key, newValue]) => [key, { newValue }])), 'local'); },
    close: () => { dom.window.close(); for (const name of names) { if (descriptors[name]) Object.defineProperty(globalThis, name, descriptors[name]!); else delete globals[name]; } }
  };
}

test('settings title draft survives blur, navigation and independent external icon changes', async () => {
  const f = fixture();
  try {
    await settle(); f.input('Draft title'); f.query('other').focus(); f.instance.refresh();
    f.external({ 'native.icon': { kind: 'product' }, 'native.title': 'Other tab title' }); await settle();
    assert.equal(f.query<HTMLInputElement>('tab-title').value, 'Draft title');
    assert.equal(f.query('settings-tab-preview-title').textContent, 'Draft title');
    assert.equal(f.dom.window.document.title, 'Other tab title');
    assert.equal(f.query<HTMLSelectElement>('tab-icon').value, 'product');
    f.submit(); await settle();
    assert.equal(f.stored()['native.title'], 'Draft title'); assert.equal(f.dom.window.document.title, 'Draft title');
    assert.deepEqual(f.stored()['native.icon'], { kind: 'product' });
  } finally { f.close(); }
});

test('settings title edited during a slow save retains the new draft without saving it accidentally', async () => {
  const f = fixture();
  try {
    await settle(); let release!: () => void; const wait = new Promise<void>(resolve => { release = resolve; }); f.holdWrite(() => wait);
    f.input('First submitted'); f.submit(); await settle(); f.input('Still editing'); f.query('other').focus(); release(); await settle();
    assert.equal(f.stored()['native.title'], 'First submitted'); assert.equal(f.dom.window.document.title, 'First submitted');
    assert.equal(f.query<HTMLInputElement>('tab-title').value, 'Still editing');
    f.holdWrite(null); f.submit(); await settle(); assert.equal(f.stored()['native.title'], 'Still editing');
  } finally { f.close(); }
});

test('failed native preference writes roll back controls and keep the original icon and name draft', async () => {
  const f = fixture();
  try {
    await settle(); f.setFailWrite(true); f.input('Unsaved draft'); f.submit(); await settle();
    assert.equal(f.stored()['native.title'], 'Original'); assert.equal(f.query<HTMLInputElement>('tab-title').value, 'Unsaved draft');
    assert.equal(f.query('tab-identity-status').dataset.state, 'error');
    f.query('tab-icon').focus(); f.select('tab-icon', 'product'); await settle();
    assert.equal(f.query<HTMLSelectElement>('tab-icon').value, 'browser'); assert.deepEqual(f.stored()['native.icon'], { kind: 'browser' });
    assert.equal(f.query<HTMLSelectElement>('tab-icon').disabled, false);
    f.query('bookmark-preference').focus(); f.select('bookmark-preference', 'newtab'); await settle();
    assert.equal(f.query<HTMLSelectElement>('bookmark-preference').value, 'always'); assert.equal(f.stored()['native.bookmarks'], 'always');
    assert.equal(f.query('bookmark-status').dataset.state, 'error'); assert.equal(f.query<HTMLSelectElement>('bookmark-preference').disabled, false);
  } finally { f.close(); }
});

test('opening native settings does not read legacy workspace shortcuts until the dedicated detail is authorized', async () => {
  const f = fixture();
  try {
    await settle(); f.instance.refresh(); f.input('Safe local title'); f.external({ 'native.bookmarks': 'hidden' }); await settle();
    assert.equal(f.reads(), 0); assert.equal(f.query('legacy-count').textContent, ''); assert.equal(f.query<HTMLButtonElement>('bookmark-migrate').disabled, true);
    f.setLegacy(true); f.instance.refresh(); assert.equal(f.reads(), 1); assert.equal(f.query('legacy-count').textContent, '0 个快捷网站');
    f.setLegacy(false); f.instance.refresh(); assert.equal(f.reads(), 1); assert.equal(f.query('legacy-count').textContent, '');
  } finally { f.close(); }
});

test('migration destinations include nested folders in native order and exclude managed descendants', () => {
  const tree: BookmarkNode[] = [{ id: '0', title: '', children: [
    { id: '1', title: '书签栏', folderType: 'bookmarks-bar', children: [
      { id: 'z', title: 'Z folder', children: [{ id: 'deep', title: 'Nested', children: [] }] },
      { id: 'url', title: 'A website', url: 'https://example.com' }, { id: 'a', title: 'A folder', children: [] }
    ] },
    { id: 'other', title: '其他书签', children: [] },
    { id: 'managed', title: 'Managed', unmodifiable: 'managed', children: [{ id: 'managed-child', title: 'Inherited managed folder', children: [] }] }
  ] }];
  const before = JSON.stringify(tree);
  assert.deepEqual(bookmarkMigrationDestinations(tree), [
    { id: '1', title: '书签栏' }, { id: 'z', title: '书签栏 / Z folder' }, { id: 'deep', title: '书签栏 / Z folder / Nested' },
    { id: 'a', title: '书签栏 / A folder' }, { id: 'other', title: '其他书签' }
  ]);
  assert.equal(JSON.stringify(tree), before);
});

test('malformed bookmark rows and folder children do not break migration targets or the shared shelf refresh', async () => {
  const tree = [{ id: '0', title: '', children: [{ id: '1', title: 'Bar', children: [null, 42, { id: 'url', title: 'Safe site', url: 'https://example.com/' }, { id: 'broken-folder', title: 'Unexpected folder children', children: 'malformed' }] }] }] as unknown as BookmarkNode[];
  assert.deepEqual(bookmarkMigrationDestinations(tree), [{ id: '1', title: 'Bar' }, { id: 'broken-folder', title: 'Bar / Unexpected folder children' }]);
  const f = fixture();
  try {
    await settle(); f.setAllowed(true); f.setTree(tree); f.emit('permission-added', { permissions: ['bookmarks'] }); await settle();
    assert.equal(f.query('bookmark-permission-label').textContent, '已授权');
    assert.deepEqual([...f.query<HTMLSelectElement>('bookmark-destination').options].map(option => option.value), ['1', 'broken-folder']);
    assert.doesNotMatch(f.query('bookmark-status').textContent || '', /不可读取/);
  } finally { f.close(); }
});

test('native folder selection survives unrelated renders and permission revocation removes stale targets', async () => {
  const f = fixture();
  try {
    await settle(); f.setAllowed(true); f.setTree([{ id: '0', title: '', children: [{ id: '1', title: 'Bar', children: [{ id: 'nested', title: 'Nested', children: [] }] }] }]);
    f.emit('permission-added', { permissions: ['bookmarks'] }); await settle();
    const select = f.query<HTMLSelectElement>('bookmark-destination'); assert.deepEqual([...select.options].map(o => o.value), ['1', 'nested']);
    select.value = 'nested'; select.focus(); f.instance.refresh(); assert.equal(select.value, 'nested'); assert.equal(f.dom.window.document.activeElement, select);
    f.setAllowed(false); f.emit('permission-removed', { permissions: ['bookmarks'] }); await settle();
    assert.equal(select.options.length, 0); assert.equal(select.hidden, true); assert.equal(f.query('bookmark-permission-label').textContent, '未授权');
  } finally { f.close(); }
});

test('canceling an upload preserves the previously saved icon and does not report success', async () => {
  const f = fixture({ 'native.icon': { kind: 'product' } });
  try {
    await settle(); f.select('tab-icon', 'upload'); f.query('tab-icon-upload').dispatchEvent(new f.dom.window.Event('cancel'));
    await settle(); assert.deepEqual(f.stored()['native.icon'], { kind: 'product' }); assert.equal(f.query<HTMLSelectElement>('tab-icon').value, 'product');
    assert.equal(f.query('tab-identity-status').textContent, '');
  } finally { f.close(); }
});

test('a rejected image clears the picker without replacing the saved icon or reporting a successful upload', async () => {
  const f = fixture({ 'native.icon': { kind: 'product' } });
  try {
    await settle();
    const input = f.query<HTMLInputElement>('tab-icon-upload');
    const badImage = { size: 8, type: 'image/png', arrayBuffer: async () => new ArrayBuffer(8) };
    Object.defineProperty(input, 'files', { configurable: true, value: [badImage] });
    input.dispatchEvent(new f.dom.window.Event('change', { bubbles: true })); await settle();
    assert.deepEqual(f.stored()['native.icon'], { kind: 'product' });
    assert.equal(f.query<HTMLSelectElement>('tab-icon').value, 'product'); assert.equal(f.query<HTMLSelectElement>('tab-icon').disabled, false);
    assert.equal(input.value, ''); assert.equal(f.query('tab-identity-status').dataset.state, 'error');
    assert.match(f.query('tab-identity-status').textContent || '', /仅支持/); assert.doesNotMatch(f.query('tab-identity-status').textContent || '', /已保存/);
  } finally { f.close(); }
});
