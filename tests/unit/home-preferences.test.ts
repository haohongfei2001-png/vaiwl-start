import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  DEFAULT_HOME_PREFERENCES, HOME_PERIOD_DAYS_KEY, HOME_PREFERENCE_KEYS,
  PROJECT_LAYOUT_KEY, RECENT_PINNED_KEYS_KEY, normalizeHomePreferences,
} from '../../src/domain/home-preferences.js';
import type { HomePreferences } from '../../src/domain/home-preferences.js';
import { initHomePreferences } from '../../src/ui/home-preferences.js';
import type { HomePreferencesController } from '../../src/ui/home-preferences.js';

type Listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => void;
const settle = () => new Promise<void>(resolve => setImmediate(resolve));
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function fixture(initial: Record<string, unknown> = {}) {
  const dom = new JSDOM(`<!doctype html><html><body>
    <select id="home-period-days" disabled><option value="7">7 天</option><option value="30">30 天</option><option value="90">90 天</option></select>
    <button data-project-layout-choice="adaptive" disabled>自适应</button><button data-project-layout-choice="equal" disabled><span>等高</span></button>
    <p id="home-period-status"></p><p id="project-layout-status"></p><p id="pins-status"></p>
    </body></html>`, { pretendToBeVisual: true });
  const globals = ['window', 'document', 'Element', 'HTMLElement', 'chrome'];
  const originals = new Map(globals.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const assign = (key: string, value: unknown) => Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  for (const key of globals.filter(key => key !== 'chrome')) assign(key, (dom.window as unknown as Record<string, unknown>)[key]);
  const data = { ...initial };
  const reads: string[][] = [];
  const writes: Record<string, unknown>[] = [];
  const listeners = new Set<Listener>();
  const emit = (changes: Record<string, chrome.storage.StorageChange>, area = 'local') => {
    for (const listener of listeners) listener(changes, area);
  };
  const local = {
    async get(keys: string[]): Promise<Record<string, unknown>> {
      reads.push(keys);
      return Object.fromEntries(keys.map(key => [key, data[key]]));
    },
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
  // No runtime or database API is available: display settings must work in Life.
  assign('chrome', { storage: { local, onChanged: {
    addListener: (listener: Listener) => listeners.add(listener),
    removeListener: (listener: Listener) => listeners.delete(listener),
  } } });
  const changes: Array<{ next: HomePreferences; previous: HomePreferences }> = [];
  const controllers: HomePreferencesController[] = [];
  const init = () => {
    const controller = initHomePreferences({ onChange: (next, previous) => changes.push({ next, previous }) });
    controllers.push(controller);
    return controller;
  };
  const period = dom.window.document.getElementById('home-period-days') as HTMLSelectElement;
  const choosePeriod = (days: number) => {
    period.value = String(days);
    period.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  };
  const layout = (choice: string) => dom.window.document.querySelector<HTMLButtonElement>(`[data-project-layout-choice="${choice}"]`)!;
  const status = (id: string) => dom.window.document.getElementById(id)!;
  return {
    dom, data, local, reads, writes, listeners, emit, init, period, choosePeriod, layout, status, changes,
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

test('invalid preferences normalize safely and opaque explicit pins remain immutable', () => {
  for (const invalid of [null, undefined, '7', 0, 15, [], {}, false]) {
    assert.equal(normalizeHomePreferences({ [HOME_PERIOD_DAYS_KEY]: invalid }).periodDays, 30);
  }
  const value = normalizeHomePreferences({
    [HOME_PERIOD_DAYS_KEY]: 90, [PROJECT_LAYOUT_KEY]: 'EQUAL',
    [RECENT_PINNED_KEYS_KEY]: ['account/chat', '', '  ', 12, null, 'account/chat', ' other ', 'bad\nkey'],
  });
  assert.deepEqual(value, { periodDays: 90, projectLayout: 'adaptive', recentPinnedKeys: ['account/chat', ' other '] });
  assert.ok(Object.isFrozen(value));
  assert.ok(Object.isFrozen(value.recentPinnedKeys));
});

test('defaults initialize controls without writing, notifying, or changing workspace layout', async () => {
  const f = fixture();
  try {
    const controller = f.init();
    assert.equal(f.period.disabled, true);
    await controller.ready;
    assert.deepEqual(controller.value, DEFAULT_HOME_PREFERENCES);
    assert.equal(f.period.disabled, false);
    assert.equal(f.period.value, '30');
    assert.equal(f.layout('adaptive').getAttribute('aria-pressed'), 'true');
    assert.equal(f.dom.window.document.documentElement.dataset.projectLayout, undefined);
    assert.deepEqual(f.reads, [[...HOME_PREFERENCE_KEYS]]);
    assert.deepEqual(f.writes, []);
    assert.deepEqual(f.changes, []);
  } finally { f.close(); }
});

test('stored values restore for every theme and mode without reading library content', async () => {
  for (const theme of ['classic', 'spatial', 'workbench', 'folio']) {
    for (const mode of ['workspace', 'life']) {
      const f = fixture({
        'native.homeTheme': theme, 'native.homeMode': mode,
        [HOME_PERIOD_DAYS_KEY]: 7, [PROJECT_LAYOUT_KEY]: 'equal', [RECENT_PINNED_KEYS_KEY]: ['explicit'],
      });
      try {
        const controller = f.init();
        await controller.ready;
        assert.deepEqual(controller.value, { periodDays: 7, projectLayout: 'equal', recentPinnedKeys: ['explicit'] });
        assert.equal(f.layout('equal').getAttribute('aria-pressed'), 'true');
        assert.equal(f.dom.window.document.documentElement.dataset.projectLayout, undefined);
        await controller.refresh();
        assert.equal(f.changes.length, 1);
        assert.deepEqual(f.writes, []);
        assert.ok(f.reads.every(keys => keys.every(key => HOME_PREFERENCE_KEYS.includes(key))));
      } finally { f.close(); }
    }
  }
});

test('settings and explicit pins persist independently and restore after reload', async () => {
  const f = fixture({ 'native.homeTheme': 'folio', 'native.homeMode': 'life', untouched: true });
  try {
    let controller = f.init();
    await controller.ready;
    f.choosePeriod(90);
    f.layout('equal').querySelector('span')!.click();
    assert.equal(await controller.setPinnedKeys(['a', 'a', 'b']), true);
    assert.deepEqual(f.writes, [
      { [HOME_PERIOD_DAYS_KEY]: 90 }, { [PROJECT_LAYOUT_KEY]: 'equal' }, { [RECENT_PINNED_KEYS_KEY]: ['a', 'b'] },
    ]);
    assert.equal(await controller.setPinnedKeys(['a', 'b']), true);
    assert.equal(f.writes.length, 3);
    controller.dispose();
    controller = f.init();
    await controller.ready;
    assert.deepEqual(controller.value, { periodDays: 90, projectLayout: 'equal', recentPinnedKeys: ['a', 'b'] });
    assert.equal(f.data['native.homeTheme'], 'folio');
    assert.equal(f.data['native.homeMode'], 'life');
    assert.equal(f.data.untouched, true);
  } finally { f.close(); }
});

test('failed restoration resolves ready and refresh recovers without inferred pins', async () => {
  const f = fixture({ [HOME_PERIOD_DAYS_KEY]: 7 });
  try {
    const get = f.local.get;
    f.local.get = async () => { throw new Error('unavailable'); };
    const controller = f.init();
    await controller.ready;
    assert.deepEqual(controller.value, DEFAULT_HOME_PREFERENCES);
    assert.equal(f.period.disabled, false);
    assert.equal(f.status('home-period-status').dataset.state, 'error');
    assert.doesNotMatch(f.status('pins-status').textContent ?? '', /\d/);
    f.local.get = get;
    await controller.refresh();
    assert.equal(controller.value.periodDays, 7);
    assert.equal(f.status('home-period-status').dataset.state, 'idle');
    assert.deepEqual(controller.value.recentPinnedKeys, []);
  } finally { f.close(); }
});

test('explicit clearing removes unread persisted pins even when effective defaults are empty', async () => {
  const f = fixture({ [RECENT_PINNED_KEYS_KEY]: ['private-record'] });
  try {
    f.local.get = async () => { throw new Error('read failed'); };
    const controller = f.init();
    await controller.ready;
    assert.deepEqual(controller.value.recentPinnedKeys, []);
    assert.equal(await controller.clearPinnedKeys(), true);
    assert.deepEqual(f.writes, [{ [RECENT_PINNED_KEYS_KEY]: [] }]);
    assert.deepEqual(f.data[RECENT_PINNED_KEYS_KEY], []);
    assert.deepEqual(controller.value.recentPinnedKeys, []);
  } finally { f.close(); }
});

test('explicit clearing reports write failure and follows any already queued pin write', async () => {
  const f = fixture();
  try {
    const controller = f.init();
    await controller.ready;
    const save = f.local.set;
    f.local.set = async () => { throw new Error('write failed'); };
    assert.equal(await controller.clearPinnedKeys(), false);
    assert.equal(f.status('pins-status').dataset.state, 'error');
    f.local.set = save;
    const pin = controller.setPinnedKeys(['queued-before-clear']);
    const clear = controller.clearPinnedKeys();
    assert.deepEqual(await Promise.all([pin, clear]), [true, true]);
    assert.deepEqual(f.writes, [{ [RECENT_PINNED_KEYS_KEY]: ['queued-before-clear'] }, { [RECENT_PINNED_KEYS_KEY]: [] }]);
    assert.deepEqual(f.data[RECENT_PINNED_KEYS_KEY], []);
    assert.deepEqual(controller.value.recentPinnedKeys, []);
  } finally { f.close(); }
});

test('cross-tab events normalize every field and ignore unrelated keys and storage areas', async () => {
  const f = fixture();
  try {
    const controller = f.init();
    await controller.ready;
    f.emit({ [HOME_PERIOD_DAYS_KEY]: { newValue: 7 } }, 'sync');
    f.emit({ 'native.homeTheme': { newValue: 'workbench' } });
    assert.deepEqual(f.changes, []);
    f.emit({ [HOME_PERIOD_DAYS_KEY]: { newValue: 90 }, [PROJECT_LAYOUT_KEY]: { newValue: 'equal' }, [RECENT_PINNED_KEYS_KEY]: { newValue: ['p', 'p'] } });
    assert.deepEqual(controller.value, { periodDays: 90, projectLayout: 'equal', recentPinnedKeys: ['p'] });
    assert.equal(f.period.value, '90');
    assert.equal(f.dom.window.document.documentElement.dataset.projectLayout, undefined);
    f.emit({ [HOME_PERIOD_DAYS_KEY]: {}, [PROJECT_LAYOUT_KEY]: { newValue: 'bad' }, [RECENT_PINNED_KEYS_KEY]: { newValue: {} } });
    assert.deepEqual(controller.value, DEFAULT_HOME_PREFERENCES);
    assert.deepEqual(f.writes, []);
  } finally { f.close(); }
});

test('a stale initial read cannot replace newer cross-tab fields but restores unrelated fields', async () => {
  const f = fixture();
  try {
    const read = deferred<Record<string, unknown>>();
    f.local.get = () => read.promise;
    const controller = f.init();
    f.emit({ [HOME_PERIOD_DAYS_KEY]: { newValue: 7 } });
    read.resolve({ [HOME_PERIOD_DAYS_KEY]: 90, [PROJECT_LAYOUT_KEY]: 'equal' });
    await controller.ready;
    assert.deepEqual(controller.value, { periodDays: 7, projectLayout: 'equal', recentPinnedKeys: [] });
  } finally { f.close(); }
});

test('a newer refresh wins and an older failure cannot replace its successful status', async () => {
  const f = fixture();
  try {
    const controller = f.init();
    await controller.ready;
    const old = deferred<Record<string, unknown>>();
    const fresh = deferred<Record<string, unknown>>();
    let calls = 0;
    f.local.get = () => (++calls === 1 ? old.promise : fresh.promise);
    const oldRequest = controller.refresh();
    const newRequest = controller.refresh();
    fresh.resolve({ [HOME_PERIOD_DAYS_KEY]: 7 });
    await newRequest;
    old.reject(new Error('stale error'));
    await oldRequest;
    assert.equal(controller.value.periodDays, 7);
    assert.equal(f.status('home-period-status').dataset.state, 'idle');
  } finally { f.close(); }
});

test('failed writes retain the effective value even when storage sends a premature matching event', async () => {
  const f = fixture({ [RECENT_PINNED_KEYS_KEY]: ['before'] });
  try {
    const controller = f.init();
    await controller.ready;
    const original = controller.value;
    const save = f.local.set;
    f.local.set = async values => {
      f.emit({ [RECENT_PINNED_KEYS_KEY]: { newValue: values[RECENT_PINNED_KEYS_KEY] } });
      throw new Error('quota exceeded');
    };
    assert.equal(await controller.setPinnedKeys(['after']), false);
    assert.equal(controller.value, original);
    assert.equal(f.changes.length, 1);
    assert.equal(f.status('pins-status').dataset.state, 'error');
    assert.doesNotMatch(f.status('pins-status').textContent ?? '', /\d/);
    f.local.set = save;
    assert.equal(await controller.setPinnedKeys(['retry']), true);
    assert.deepEqual(controller.value.recentPinnedKeys, ['retry']);
  } finally { f.close(); }
});

test('rapid settings and pin toggles serialize and calculate from the latest effective value', async () => {
  const f = fixture();
  try {
    const controller = f.init();
    await controller.ready;
    const pending = deferred<void>();
    const save = f.local.set;
    let attempts = 0;
    f.local.set = async values => { attempts++; if (attempts === 1) await pending.promise; await save(values); };
    f.choosePeriod(7);
    f.choosePeriod(90);
    const a = controller.togglePinnedKey('a');
    const b = controller.togglePinnedKey('b');
    const removeA = controller.togglePinnedKey('a');
    await settle();
    assert.equal(attempts, 1);
    assert.deepEqual(controller.value, DEFAULT_HOME_PREFERENCES);
    pending.resolve();
    assert.deepEqual(await Promise.all([a, b, removeA]), [true, true, true]);
    assert.equal(controller.value.periodDays, 90);
    assert.deepEqual(controller.value.recentPinnedKeys, ['b']);
    assert.deepEqual(f.writes, [
      { [HOME_PERIOD_DAYS_KEY]: 7 }, { [HOME_PERIOD_DAYS_KEY]: 90 },
      { [RECENT_PINNED_KEYS_KEY]: ['a'] }, { [RECENT_PINNED_KEYS_KEY]: ['a', 'b'] }, { [RECENT_PINNED_KEYS_KEY]: ['b'] },
    ]);
  } finally { f.close(); }
});

test('a refresh started during a rejected write cannot restore its stale attempted value', async () => {
  const f = fixture({ [RECENT_PINNED_KEYS_KEY]: ['before'] });
  try {
    const controller = f.init();
    await controller.ready;
    const pendingWrite = deferred<void>();
    const pendingRead = deferred<Record<string, unknown>>();
    f.local.set = () => pendingWrite.promise;
    const save = controller.setPinnedKeys(['attempt']);
    await settle();
    f.local.get = () => pendingRead.promise;
    const refresh = controller.refresh();
    pendingWrite.reject(new Error('write rejected'));
    assert.equal(await save, false);
    pendingRead.resolve({ [RECENT_PINNED_KEYS_KEY]: ['attempt'], [PROJECT_LAYOUT_KEY]: 'equal' });
    await refresh;
    assert.deepEqual(controller.value.recentPinnedKeys, ['before']);
    assert.equal(controller.value.projectLayout, 'equal');
    assert.equal(f.status('pins-status').dataset.state, 'error');
  } finally { f.close(); }
});

test('failed layout and period choices retain their prior controls and do not block the queue', async () => {
  const f = fixture({ [HOME_PERIOD_DAYS_KEY]: 7, [PROJECT_LAYOUT_KEY]: 'equal' });
  try {
    const controller = f.init();
    await controller.ready;
    const save = f.local.set;
    f.local.set = async values => {
      if (RECENT_PINNED_KEYS_KEY in values) return save(values);
      throw new Error('write unavailable');
    };
    f.choosePeriod(90);
    f.layout('adaptive').click();
    assert.equal(await controller.setPinnedKeys(['after-failures']), true);
    assert.equal(controller.value.periodDays, 7);
    assert.equal(f.period.value, '7');
    assert.equal(controller.value.projectLayout, 'equal');
    assert.equal(f.layout('equal').getAttribute('aria-pressed'), 'true');
    assert.equal(f.status('home-period-status').dataset.state, 'error');
    assert.equal(f.status('project-layout-status').dataset.state, 'error');
    assert.deepEqual(controller.value.recentPinnedKeys, ['after-failures']);
  } finally { f.close(); }
});

test('the latest cross-tab event wins over an earlier local acknowledgement', async () => {
  const f = fixture();
  try {
    const controller = f.init();
    await controller.ready;
    const pending = deferred<void>();
    f.local.set = async values => {
      f.emit({ [RECENT_PINNED_KEYS_KEY]: { newValue: values[RECENT_PINNED_KEYS_KEY] } });
      await pending.promise;
    };
    const save = controller.setPinnedKeys(['local']);
    await settle();
    f.emit({ [RECENT_PINNED_KEYS_KEY]: { newValue: ['remote'] }, [PROJECT_LAYOUT_KEY]: { newValue: 'equal' } });
    assert.deepEqual(controller.value.recentPinnedKeys, ['remote']);
    pending.resolve();
    assert.equal(await save, true);
    assert.deepEqual(controller.value, { periodDays: 30, projectLayout: 'equal', recentPinnedKeys: ['remote'] });
  } finally { f.close(); }
});

test('dispose removes listeners and prevents pending or queued work from changing the page', async () => {
  const f = fixture();
  try {
    const controller = f.init();
    await controller.ready;
    const pending = deferred<void>();
    f.local.set = () => pending.promise;
    const first = controller.setPinnedKeys(['a']);
    const second = controller.setPinnedKeys(['b']);
    await settle();
    controller.dispose();
    assert.equal(f.listeners.size, 0);
    pending.resolve();
    assert.deepEqual(await Promise.all([first, second]), [false, false]);
    assert.deepEqual(controller.value, DEFAULT_HOME_PREFERENCES);
    assert.deepEqual(f.changes, []);
  } finally { f.close(); }
});
