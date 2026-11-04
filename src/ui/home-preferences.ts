import {
  DEFAULT_HOME_PREFERENCES, HOME_PERIOD_DAYS_KEY, HOME_PREFERENCE_KEYS,
  PROJECT_LAYOUT_KEY, RECENT_PINNED_KEYS_KEY, normalizeHomePreferences,
  normalizePeriodDays, normalizePinnedKeys, normalizeProjectLayout,
  sameHomePreferences, samePinnedKeys,
} from '../domain/home-preferences.js';
import type { HomePreferences } from '../domain/home-preferences.js';

export type HomePreferencesController = {
  readonly value: HomePreferences;
  readonly ready: Promise<void>;
  refresh(): Promise<void>;
  setPinnedKeys(keys: readonly string[]): Promise<boolean>;
  /** Compute from the effective value when the queued operation starts. */
  togglePinnedKey(key: string): Promise<boolean>;
  dispose(): void;
};

type Field = keyof HomePreferences;
type Status = { state: 'idle' | 'saving' | 'success' | 'error'; message: string };
const fields = ['periodDays', 'projectLayout', 'recentPinnedKeys'] as const;
const storageKeys: Record<Field, string> = {
  periodDays: HOME_PERIOD_DAYS_KEY,
  projectLayout: PROJECT_LAYOUT_KEY,
  recentPinnedKeys: RECENT_PINNED_KEYS_KEY,
};
const statusIds: Record<Field, string> = {
  periodDays: 'home-period-status', projectLayout: 'project-layout-status', recentPinnedKeys: 'pins-status',
};
const labels: Record<Field, string> = {
  periodDays: '时段偏好', projectLayout: '卡片布局', recentPinnedKeys: '置顶偏好',
};

export function initHomePreferences(options: {
  onChange: (next: HomePreferences, previous: HomePreferences) => void;
}): HomePreferencesController {
  const page = document;
  const storage = typeof chrome === 'undefined' ? undefined : chrome.storage;
  let value = DEFAULT_HOME_PREFERENCES;
  let disposed = false;
  let initialized = false;
  let readRevision = 0;
  const revisions: Record<Field, number> = { periodDays: 0, projectLayout: 0, recentPinnedKeys: 0 };
  const statuses: Record<Field, Status> = {
    periodDays: { state: 'idle', message: '' },
    projectLayout: { state: 'idle', message: '' },
    recentPinnedKeys: { state: 'idle', message: '' },
  };
  let pending: { field: Field; next: HomePreferences; latestEvent: HomePreferences | null } | null = null;

  const equalField = (field: Field, left: HomePreferences, right: HomePreferences): boolean => (
    field === 'recentPinnedKeys' ? samePinnedKeys(left.recentPinnedKeys, right.recentPinnedKeys)
      : left[field] === right[field]
  );
  const replaceField = (base: HomePreferences, field: Field, source: HomePreferences): HomePreferences => (
    Object.freeze({ ...base, [field]: source[field] })
  );
  const normalizeField = (field: Field, raw: unknown): HomePreferences => normalizeHomePreferences({
    [HOME_PERIOD_DAYS_KEY]: value.periodDays,
    [PROJECT_LAYOUT_KEY]: value.projectLayout,
    [RECENT_PINNED_KEYS_KEY]: value.recentPinnedKeys,
    [storageKeys[field]]: raw,
  });

  const render = (): void => {
    const period = page.getElementById('home-period-days') as HTMLSelectElement | null;
    if (period) {
      period.value = String(value.periodDays);
      period.disabled = !initialized;
      period.setAttribute('aria-busy', String(statuses.periodDays.state === 'saving'));
    }
    for (const button of page.querySelectorAll<HTMLButtonElement>('[data-project-layout-choice]')) {
      const choice = button.dataset.projectLayoutChoice;
      if (choice !== 'equal' && choice !== 'adaptive') continue;
      button.disabled = !initialized;
      button.setAttribute('aria-pressed', String(choice === value.projectLayout));
      button.setAttribute('aria-busy', String(statuses.projectLayout.state === 'saving'));
    }
    for (const field of fields) {
      const element = page.getElementById(statusIds[field]);
      if (element) {
        element.textContent = statuses[field].message;
        element.dataset.state = statuses[field].state;
      }
    }
  };

  const apply = (next: HomePreferences): void => {
    const previous = value;
    value = next;
    render();
    if (!sameHomePreferences(next, previous)) options.onChange(next, previous);
  };

  const refresh = async (): Promise<void> => {
    if (disposed) return;
    const request = ++readRevision;
    const before = { ...revisions };
    try {
      if (!storage?.local) throw new Error('Storage unavailable');
      const stored = await storage.local.get([...HOME_PREFERENCE_KEYS]);
      if (disposed || request !== readRevision) return;
      const restored = normalizeHomePreferences(stored);
      let next = value;
      for (const field of fields) {
        if (before[field] !== revisions[field] || pending?.field === field) continue;
        next = replaceField(next, field, restored);
        statuses[field] = { state: 'idle', message: '' };
      }
      initialized = true;
      apply(next);
    } catch {
      if (disposed || request !== readRevision) return;
      for (const field of fields) {
        if (before[field] !== revisions[field] || pending?.field === field) continue;
        statuses[field] = { state: 'error', message: `暂时无法读取${labels[field]}，已保留当前设置。` };
      }
    } finally {
      if (!disposed && request === readRevision) {
        initialized = true;
        render();
      }
    }
  };

  // A single queue keeps overlapping settings and pin operations in invocation order.
  // Each item writes only its own storage key, preserving unrelated preferences.
  let queue: Promise<unknown>;
  const enqueue = (field: Field, makeNext: (current: HomePreferences) => HomePreferences): Promise<boolean> => {
    const result = queue.then(async (): Promise<boolean> => {
      if (disposed) return false;
      const next = makeNext(value);
      if (equalField(field, value, next)) return true;
      const operation = { field, next, latestEvent: null as HomePreferences | null };
      pending = operation;
      revisions[field] += 1;
      statuses[field] = { state: 'saving', message: `正在保存${labels[field]}…` };
      render();
      try {
        if (!storage?.local) throw new Error('Storage unavailable');
        await storage.local.set({ [storageKeys[field]]: next[field] });
      } catch {
        if (!disposed) {
          pending = null;
          revisions[field] += 1;
          statuses[field] = { state: 'error', message: `${labels[field]}保存失败，已保留当前设置。请重试。` };
          render();
        }
        return false;
      }
      if (disposed) return false;
      pending = null;
      revisions[field] += 1;
      statuses[field] = { state: 'success', message: `${labels[field]}已保存。` };
      // The newest storage event wins when another tab writes during this operation.
      apply(replaceField(value, field, operation.latestEvent ?? next));
      return true;
    });
    // A caller's rendering callback cannot poison later persistence operations.
    queue = result.catch(() => undefined);
    return result;
  };

  const onChange = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof Element) || target.id !== 'home-period-days') return;
    const next = normalizePeriodDays(Number((target as HTMLSelectElement).value));
    void enqueue('periodDays', current => Object.freeze({ ...current, periodDays: next }));
  };
  const onClick = (event: MouseEvent): void => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const choice = target.closest<HTMLElement>('[data-project-layout-choice]')?.dataset.projectLayoutChoice;
    if (choice !== 'equal' && choice !== 'adaptive') return;
    const next = normalizeProjectLayout(choice);
    void enqueue('projectLayout', current => Object.freeze({ ...current, projectLayout: next }));
  };
  const onStorageChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string): void => {
    if (disposed || area !== 'local') return;
    let next = value;
    for (const field of fields) {
      if (!Object.prototype.hasOwnProperty.call(changes, storageKeys[field])) continue;
      revisions[field] += 1;
      const changed = normalizeField(field, changes[storageKeys[field]]?.newValue);
      if (pending?.field === field) {
        pending.latestEvent = changed;
        // Storage may notify before set() settles. Do not apply our attempted value
        // until persistence succeeds; a rejected write must preserve the prior value.
        if (equalField(field, pending.next, changed)) continue;
      } else {
        statuses[field] = { state: 'idle', message: '' };
      }
      next = replaceField(next, field, changed);
    }
    apply(next);
  };

  page.addEventListener('change', onChange);
  page.addEventListener('click', onClick);
  storage?.onChanged?.addListener(onStorageChanged);
  render();
  const ready = refresh();
  queue = ready;

  return {
    get value() { return value; },
    ready,
    refresh,
    setPinnedKeys(keys) {
      const next = normalizePinnedKeys(keys);
      return enqueue('recentPinnedKeys', current => Object.freeze({ ...current, recentPinnedKeys: next }));
    },
    togglePinnedKey(key) {
      if (normalizePinnedKeys([key]).length === 0) return Promise.resolve(false);
      return enqueue('recentPinnedKeys', current => {
        const keys = current.recentPinnedKeys.includes(key)
          ? current.recentPinnedKeys.filter(existing => existing !== key)
          : [...current.recentPinnedKeys, key];
        return Object.freeze({ ...current, recentPinnedKeys: normalizePinnedKeys(keys) });
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      page.removeEventListener('change', onChange);
      page.removeEventListener('click', onClick);
      storage?.onChanged?.removeListener(onStorageChanged);
    },
  };
}
