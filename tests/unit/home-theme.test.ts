import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { DEFAULT_HOME_THEME, HOME_THEME_KEY, isHomeTheme, normalizeHomeTheme } from '../../src/domain/home-theme.js';
import { initHomeTheme } from '../../src/ui/home-theme.js';
import type { HomeThemeController, HomeThemeStatus } from '../../src/ui/home-theme.js';
import type { HomeTheme } from '../../src/domain/home-theme.js';

type StorageListener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => void;
const themes: HomeTheme[] = ['classic', 'spatial', 'workbench', 'folio'];

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

function fixture(initial: Record<string, unknown> = {}) {
  const dom = new JSDOM(`<!doctype html><html><body>${themes.map(theme => `<button data-home-theme-choice="${theme}"><span>${theme}</span></button>`).join('')}<p id="home-theme-status"></p><input id="other-setting"></body></html>`, { pretendToBeVisual: true });
  const keys = ['window', 'document', 'navigator', 'Element', 'HTMLElement', 'chrome'];
  const originals = new Map(keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const assign = (key: string, value: unknown) => Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  for (const key of ['window', 'document', 'navigator', 'Element', 'HTMLElement']) assign(key, (dom.window as unknown as Record<string, unknown>)[key]);
  const data = { ...initial };
  const reads: string[] = [];
  const writes: Record<string, unknown>[] = [];
  const listeners = new Set<StorageListener>();
  const emit = (changes: Record<string, chrome.storage.StorageChange>, area = 'local') => {
    for (const listener of listeners) listener(changes, area);
  };
  const local = {
    async get(key: string): Promise<Record<string, unknown>> { reads.push(key); return { [key]: data[key] }; },
    async set(values: Record<string, unknown>): Promise<void> {
      writes.push(values);
      const changes: Record<string, chrome.storage.StorageChange> = {};
      for (const [key, value] of Object.entries(values)) {
        changes[key] = { oldValue: data[key], newValue: value };
        data[key] = value;
      }
      emit(changes);
    },
  };
  assign('chrome', { storage: { local, onChanged: { addListener: (listener: StorageListener) => listeners.add(listener), removeListener: (listener: StorageListener) => listeners.delete(listener) } } });
  const controllers: HomeThemeController[] = [];
  const changes: HomeTheme[] = [];
  const statuses: HomeThemeStatus[] = [];
  const init = () => {
    const controller = initHomeTheme({ onChange: (theme) => changes.push(theme), onStatus: (status) => statuses.push(status) });
    controllers.push(controller);
    return controller;
  };
  const button = (theme: HomeTheme) => dom.window.document.querySelector<HTMLButtonElement>(`[data-home-theme-choice="${theme}"]`)!;
  return {
    dom, data, local, reads, writes, listeners, emit, init, button, changes, statuses, assign,
    close() {
      for (const controller of controllers) controller.dispose();
      dom.window.close();
      for (const [key, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
    },
  };
}

test('missing preference uses classic without persisting a default or notifying a visual change', async () => {
  const f = fixture();
  try {
    const controller = f.init();
    assert.equal(controller.value, DEFAULT_HOME_THEME);
    await controller.ready;
    assert.equal(controller.value, 'classic');
    assert.equal(f.button('classic').getAttribute('aria-pressed'), 'true');
    for (const theme of themes.slice(1)) assert.equal(f.button(theme).getAttribute('aria-pressed'), 'false');
    assert.deepEqual(f.reads, [HOME_THEME_KEY]);
    assert.deepEqual(f.writes, []);
    assert.deepEqual(f.changes, []);
  } finally { f.close(); }
});

test('invalid persisted values normalize to classic without accepting arbitrary theme names', async () => {
  for (const invalid of [undefined, null, '', 'SPATIAL', 'workBench', 'FOLIO', 'life', ['folio'], {}, false, 7]) {
    assert.equal(isHomeTheme(invalid), false);
    assert.equal(normalizeHomeTheme(invalid), 'classic');
  }
  for (const theme of themes) {
    assert.equal(isHomeTheme(theme), true);
    assert.equal(normalizeHomeTheme(theme), theme);
  }
  const f = fixture({ [HOME_THEME_KEY]: '<img src=x onerror=alert(1)>' });
  try {
    const controller = f.init();
    await controller.ready;
    assert.equal(controller.value, 'classic');
    assert.equal(f.dom.window.document.querySelector('img'), null);
    assert.deepEqual(f.changes, []);
  } finally { f.close(); }
});

test('every stored theme is restored without rerendering on an unchanged refresh', async () => {
  for (const theme of themes) {
    const f = fixture({ [HOME_THEME_KEY]: theme });
    try {
      const controller = f.init();
      await controller.ready;
      await controller.refresh();
      assert.equal(controller.value, theme);
      assert.deepEqual(f.changes, theme === 'classic' ? [] : [theme]);
      assert.equal(f.button(theme).getAttribute('aria-pressed'), 'true');
      assert.equal(f.dom.window.document.querySelectorAll('[data-home-theme-choice][aria-pressed="true"]').length, 1);
      assert.deepEqual(f.writes, []);
    } finally { f.close(); }
  }
});

test('all four choices persist only the theme, survive reload, and ignore repeated selection', async () => {
  const f = fixture({ 'native.homeMode': 'life', unrelated: { keep: true } });
  try {
    let controller = f.init();
    await controller.ready;
    const choices: HomeTheme[] = ['spatial', 'workbench', 'folio', 'classic'];
    for (const [index, choice] of choices.entries()) {
      f.button(choice).querySelector('span')!.click();
      await settle();
      assert.equal(controller.value, choice);
      assert.equal(f.data[HOME_THEME_KEY], choice);
      assert.equal(f.statuses.at(-1)?.state, 'success');
      assert.equal(f.button(choice).getAttribute('aria-pressed'), 'true');
      assert.equal(f.dom.window.document.querySelectorAll('[data-home-theme-choice][aria-pressed="true"]').length, 1);
      f.button(choice).click();
      await settle();
      assert.equal(f.writes.length, index + 1);
      controller.dispose();
      controller = f.init();
      await controller.ready;
      assert.equal(controller.value, choice);
    }
    assert.deepEqual(f.writes, choices.map(choice => ({ [HOME_THEME_KEY]: choice })));
    assert.equal(f.data['native.homeMode'], 'life');
    assert.deepEqual(f.data.unrelated, { keep: true });
  } finally { f.close(); }
});

test('rapid choices during a pending save cannot start a competing theme write', async () => {
  const f = fixture({ [HOME_THEME_KEY]: 'spatial' });
  try {
    const controller = f.init();
    await controller.ready;
    const pending = deferred<void>(), save = f.local.set;
    let attempts = 0;
    f.local.set = async values => { attempts++; await pending.promise; await save(values); };
    f.button('workbench').focus();
    f.button('workbench').click();
    f.button('folio').click();
    f.button('classic').click();
    assert.equal(attempts, 1);
    assert.equal(controller.value, 'spatial');
    assert.ok(themes.every(choice => f.button(choice).getAttribute('aria-disabled') === 'true'));
    pending.resolve();
    await settle();
    assert.equal(controller.value, 'workbench');
    assert.deepEqual(f.writes, [{ [HOME_THEME_KEY]: 'workbench' }]);
    assert.equal(f.dom.window.document.activeElement, f.button('workbench'));
    assert.ok(themes.every(choice => f.button(choice).getAttribute('aria-disabled') === 'false'));
    f.button('folio').click();
    await settle();
    assert.equal(controller.value, 'folio');
    assert.equal(attempts, 2);
    assert.deepEqual(f.writes.at(-1), { [HOME_THEME_KEY]: 'folio' });
  } finally { f.close(); }
});

test('a rejected new theme keeps the previously selected workbench and can be retried', async () => {
  const f = fixture({ [HOME_THEME_KEY]: 'workbench', 'native.homeMode': 'workspace' });
  try {
    const controller = f.init();
    await controller.ready;
    const save = f.local.set;
    f.local.set = async () => { throw new Error('Storage unavailable'); };
    f.button('folio').focus();
    f.button('folio').click();
    await settle();
    assert.equal(controller.value, 'workbench');
    assert.equal(f.data[HOME_THEME_KEY], 'workbench');
    assert.deepEqual(f.changes, ['workbench']);
    assert.equal(f.button('workbench').getAttribute('aria-pressed'), 'true');
    assert.equal(f.button('folio').getAttribute('aria-pressed'), 'false');
    assert.equal(f.dom.window.document.activeElement, f.button('folio'));
    assert.equal(f.statuses.at(-1)?.state, 'error');
    f.local.set = save;
    f.button('folio').click();
    await settle();
    assert.equal(controller.value, 'folio');
    assert.deepEqual(f.changes, ['workbench', 'folio']);
    assert.equal(f.data['native.homeMode'], 'workspace');
  } finally { f.close(); }
});

test('pending and failed saves retain the previous selection and focus; retry can succeed', async () => {
  const f = fixture();
  try {
    const controller = f.init();
    await controller.ready;
    const pending = deferred<void>();
    const save = f.local.set;
    f.local.set = async () => pending.promise;
    const spatial = f.button('spatial');
    spatial.focus();
    spatial.click();
    assert.equal(controller.value, 'classic');
    assert.equal(f.button('classic').getAttribute('aria-pressed'), 'true');
    assert.equal(spatial.getAttribute('aria-disabled'), 'true');
    assert.equal(f.statuses.at(-1)?.state, 'saving');
    spatial.click();
    pending.reject(new Error('QUOTA_BYTES quota exceeded <img src=x>'));
    await settle();
    assert.equal(controller.value, 'classic');
    assert.deepEqual(f.changes, []);
    assert.equal(spatial.getAttribute('aria-disabled'), 'false');
    assert.equal(f.dom.window.document.activeElement, spatial);
    assert.equal(f.statuses.at(-1)?.state, 'error');
    assert.match(f.dom.window.document.getElementById('home-theme-status')!.textContent!, /空间不足/);
    assert.equal(f.dom.window.document.querySelector('img'), null);
    f.local.set = save;
    spatial.click();
    await settle();
    assert.equal(controller.value, 'spatial');
    assert.equal(f.dom.window.document.activeElement, spatial);
  } finally { f.close(); }
});

test('read failure resolves initialization with classic and keeps later applied preference on refresh failure', async () => {
  const f = fixture();
  try {
    f.local.get = async () => { throw new Error('Storage disconnected'); };
    const controller = f.init();
    await controller.ready;
    assert.equal(controller.value, 'classic');
    assert.equal(f.statuses.at(-1)?.state, 'error');
    f.emit({ [HOME_THEME_KEY]: { newValue: 'spatial' } });
    await controller.refresh();
    assert.equal(controller.value, 'spatial');
    assert.deepEqual(f.changes, ['spatial']);
  } finally { f.close(); }
});

test('a stale initial read cannot overwrite a user change', async () => {
  const f = fixture();
  try {
    const initialRead = deferred<Record<string, unknown>>();
    f.local.get = async () => initialRead.promise;
    const controller = f.init();
    f.button('spatial').click();
    await settle();
    assert.equal(controller.value, 'spatial');
    initialRead.resolve({ [HOME_THEME_KEY]: 'classic' });
    await controller.ready;
    assert.equal(controller.value, 'spatial');
    assert.deepEqual(f.changes, ['spatial']);
  } finally { f.close(); }
});

test('cross-tab local changes synchronize once, including removed or invalid preferences', async () => {
  const f = fixture();
  try {
    const controller = f.init();
    await controller.ready;
    f.emit({ [HOME_THEME_KEY]: { newValue: 'spatial' } }, 'sync');
    f.emit({ unrelated: { newValue: 'spatial' } });
    assert.equal(controller.value, 'classic');
    for (const theme of ['spatial', 'workbench', 'folio'] as HomeTheme[]) {
      f.emit({ [HOME_THEME_KEY]: { newValue: theme } });
      f.emit({ [HOME_THEME_KEY]: { newValue: theme } });
      assert.equal(controller.value, theme);
      assert.equal(f.button(theme).getAttribute('aria-pressed'), 'true');
    }
    f.emit({ [HOME_THEME_KEY]: { oldValue: 'folio' } });
    assert.equal(controller.value, 'classic');
    f.emit({ [HOME_THEME_KEY]: { newValue: 'spatial' } });
    f.emit({ [HOME_THEME_KEY]: { newValue: 'unknown' } });
    assert.equal(controller.value, 'classic');
    assert.deepEqual(f.changes, ['spatial', 'workbench', 'folio', 'classic', 'spatial', 'classic']);
    assert.deepEqual(f.writes, []);
  } finally { f.close(); }
});

test('a newer external choice is not overwritten when an earlier local save finishes', async () => {
  const f = fixture();
  try {
    const controller = f.init();
    await controller.ready;
    const pending = deferred<void>();
    f.local.set = async () => pending.promise;
    f.button('workbench').click();
    f.emit({ [HOME_THEME_KEY]: { newValue: 'workbench' } });
    f.emit({ [HOME_THEME_KEY]: { newValue: 'folio' } });
    pending.resolve();
    await settle();
    assert.equal(controller.value, 'folio');
    assert.deepEqual(f.changes, ['workbench', 'folio']);
    assert.equal(f.button('folio').getAttribute('aria-pressed'), 'true');
  } finally { f.close(); }
});

test('settings refresh recovers a missed change and ignores an older overlapping read without moving focus', async () => {
  const f = fixture();
  try {
    const controller = f.init();
    await controller.ready;
    const input = f.dom.window.document.getElementById('other-setting') as HTMLInputElement;
    input.focus();
    f.data[HOME_THEME_KEY] = 'spatial';
    await controller.refresh();
    assert.equal(controller.value, 'spatial');
    assert.equal(f.dom.window.document.activeElement, input);
    const older = deferred<Record<string, unknown>>();
    const newer = deferred<Record<string, unknown>>();
    let count = 0;
    f.local.get = async () => (++count === 1 ? older.promise : newer.promise);
    const oldRefresh = controller.refresh();
    const newRefresh = controller.refresh();
    newer.resolve({ [HOME_THEME_KEY]: 'classic' });
    await newRefresh;
    older.resolve({ [HOME_THEME_KEY]: 'spatial' });
    await oldRefresh;
    assert.equal(controller.value, 'classic');
    assert.deepEqual(f.changes, ['spatial', 'classic']);
    assert.equal(f.dom.window.document.activeElement, input);
  } finally { f.close(); }
});

test('dispose removes listeners and prevents late initialization or clicks from applying changes', async () => {
  const f = fixture();
  try {
    const pending = deferred<Record<string, unknown>>();
    f.local.get = async () => pending.promise;
    const controller = f.init();
    assert.equal(f.listeners.size, 1);
    controller.dispose();
    controller.dispose();
    assert.equal(f.listeners.size, 0);
    pending.resolve({ [HOME_THEME_KEY]: 'spatial' });
    await controller.ready;
    f.button('spatial').click();
    f.emit({ [HOME_THEME_KEY]: { newValue: 'spatial' } });
    await settle();
    assert.equal(controller.value, 'classic');
    assert.deepEqual(f.changes, []);
    assert.deepEqual(f.writes, []);
  } finally { f.close(); }
});

test('missing Chrome storage fails open and selection failures remain safe and visible', async () => {
  const f = fixture();
  try {
    f.assign('chrome', undefined);
    const controller = f.init();
    await controller.ready;
    assert.equal(controller.value, 'classic');
    f.button('spatial').click();
    await settle();
    assert.equal(controller.value, 'classic');
    assert.equal(f.statuses.at(-1)?.state, 'error');
    assert.match(f.dom.window.document.getElementById('home-theme-status')!.textContent!, /保存失败/);
    assert.deepEqual(f.changes, []);
  } finally { f.close(); }
});


test('external updates clear stale errors while preserving an active save status', async () => {
  const f = fixture();
  try {
    const controller = f.init();
    await controller.ready;
    f.local.set = async () => { throw new Error('Storage failed'); };
    f.button('spatial').click();
    await settle();
    const statusElement = f.dom.window.document.getElementById('home-theme-status')!;
    assert.equal(statusElement.dataset.state, 'error');
    assert.equal(controller.value, 'classic');

    f.emit({ [HOME_THEME_KEY]: { newValue: 'spatial' } });
    assert.equal(controller.value, 'spatial');
    assert.equal(statusElement.dataset.state, 'idle');
    assert.equal(statusElement.textContent, '');
    assert.deepEqual(f.statuses.at(-1), { state: 'idle', message: '' });

    const save = deferred<void>();
    f.local.set = () => save.promise;
    f.button('classic').click();
    assert.equal(statusElement.dataset.state, 'saving');
    f.emit({ [HOME_THEME_KEY]: { newValue: 'classic' } });
    assert.equal(controller.value, 'classic');
    assert.equal(statusElement.dataset.state, 'saving');
    save.resolve();
    await settle();
    assert.equal(statusElement.dataset.state, 'success');
  } finally { f.close(); }
});
