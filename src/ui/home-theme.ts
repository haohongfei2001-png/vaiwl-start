import { DEFAULT_HOME_THEME, HOME_THEME_KEY, isHomeTheme, normalizeHomeTheme } from '../domain/home-theme.js';
import type { HomeTheme } from '../domain/home-theme.js';

export type HomeThemeStatus = {
  state: 'idle' | 'saving' | 'success' | 'error';
  message: string;
};

export type HomeThemeController = {
  readonly value: HomeTheme;
  readonly ready: Promise<void>;
  refresh(): Promise<void>;
  dispose(): void;
};

export function initHomeTheme(options: {
  onChange: (theme: HomeTheme) => void;
  onStatus?: (status: HomeThemeStatus) => void;
}): HomeThemeController {
  const page = document;
  const storage = typeof chrome === 'undefined' ? undefined : chrome.storage;
  let value: HomeTheme = DEFAULT_HOME_THEME;
  let disposed = false;
  let saving = false;
  let preferenceRevision = 0;
  let readRevision = 0;
  let status: HomeThemeStatus = { state: 'idle', message: '' };

  const render = (): void => {
    for (const button of page.querySelectorAll<HTMLElement>('[data-home-theme-choice]')) {
      const choice = button.dataset.homeThemeChoice;
      if (!isHomeTheme(choice)) continue;
      button.setAttribute('aria-pressed', String(choice === value));
      button.setAttribute('aria-disabled', String(saving));
    }
    const statusElement = page.getElementById('home-theme-status');
    if (statusElement) {
      statusElement.textContent = status.message;
      statusElement.dataset.state = status.state;
    }
  };

  const setStatus = (next: HomeThemeStatus): void => {
    status = next;
    render();
    options.onStatus?.(next);
  };

  const apply = (next: HomeTheme): void => {
    const changed = value !== next;
    value = next;
    render();
    // The caller owns the HTML theme attribute and layout, so SafeRendering can update both together.
    if (changed) options.onChange(next);
  };

  const refresh = async (): Promise<void> => {
    if (disposed) return;
    render();
    if (saving) return;
    const request = ++readRevision;
    const revision = preferenceRevision;
    let stored: Record<string, unknown>;
    try {
      if (!storage?.local) throw new Error('Storage unavailable');
      stored = await storage.local.get(HOME_THEME_KEY);
    } catch {
      if (!disposed && request === readRevision && revision === preferenceRevision) {
        setStatus({ state: 'error', message: '暂时无法读取主题偏好，已保留当前主题。' });
      }
      return;
    }
    if (disposed || request !== readRevision || revision !== preferenceRevision) return;
    setStatus({ state: 'idle', message: '' });
    apply(normalizeHomeTheme(stored[HOME_THEME_KEY]));
  };

  const select = async (next: HomeTheme): Promise<void> => {
    if (disposed || saving || next === value) return;
    saving = true;
    const revision = ++preferenceRevision;
    setStatus({ state: 'saving', message: '正在保存主题…' });
    let failure: unknown;
    let failed = false;
    try {
      if (!storage?.local) throw new Error('Storage unavailable');
      await storage.local.set({ [HOME_THEME_KEY]: next });
    } catch (error) {
      failed = true;
      failure = error;
    }
    if (disposed) return;
    saving = false;
    if (failed) {
      const quota = failure instanceof Error && /quota|QUOTA_BYTES|storage.*full/i.test(failure.message);
      setStatus({ state: 'error', message: quota ? '本地存储空间不足，原主题已保留。' : '主题保存失败，请重试。' });
      return;
    }
    setStatus({ state: 'success', message: '主题已保存。' });
    if (revision === preferenceRevision) apply(next);
  };

  const onClick = (event: MouseEvent): void => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const choice = target.closest<HTMLElement>('[data-home-theme-choice]')?.dataset.homeThemeChoice;
    if (isHomeTheme(choice)) void select(choice);
  };

  const onStorageChanged = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: string,
  ): void => {
    if (disposed || area !== 'local' || !Object.prototype.hasOwnProperty.call(changes, HOME_THEME_KEY)) return;
    preferenceRevision += 1;
    if (!saving) setStatus({ state: 'idle', message: '' });
    apply(normalizeHomeTheme(changes[HOME_THEME_KEY]?.newValue));
  };

  page.addEventListener('click', onClick);
  storage?.onChanged?.addListener(onStorageChanged);
  render();
  const ready = refresh();

  return {
    get value() { return value; },
    ready,
    refresh,
    dispose() {
      if (disposed) return;
      disposed = true;
      page.removeEventListener('click', onClick);
      storage?.onChanged?.removeListener(onStorageChanged);
    },
  };
}
