import { byId } from './dom.js';

export type SettingsPage = 'newtab' | 'workspace' | 'data' | 'about' | 'legacy' | 'diagnostics';
const pages: Record<SettingsPage, { title: string; parent?: SettingsPage; workspace?: boolean }> = {
  newtab: { title: '新标签页' },
  workspace: { title: 'AI 工作空间', workspace: true },
  data: { title: '数据与隐私', workspace: true },
  about: { title: '帮助与关于' },
  legacy: { title: '旧快捷网站', parent: 'newtab', workspace: true },
  diagnostics: { title: '技术诊断', parent: 'about', workspace: true },
};

/** Navigation owns only presentation. Reading a workspace requires a deliberate visit. */
export function initSettingsView(options: {
  onNavigate: (page: SettingsPage) => void;
  onClose: () => void;
}) {
  const dialog = byId<HTMLDialogElement>('settings-dialog');
  const scroll = byId('settings-scroll');
  let page: SettingsPage = 'newtab';
  let loading = false;
  const positions = new Map<SettingsPage, number>();
  const returnFocus = new Map<SettingsPage, HTMLElement>();
  function visit(next: SettingsPage, focus = true): void {
    positions.set(page, scroll.scrollTop);
    if (pages[next].parent && document.activeElement instanceof HTMLElement) returnFocus.set(next, document.activeElement);
    const previous = page;
    page = next; dialog.dataset.settingsPage = next;
    byId('settings-page-title').textContent = pages[next].title;
    byId('settings-back').hidden = !pages[next].parent;
    for (const [key] of Object.entries(pages)) byId(`settings-panel-${key}`).hidden = key !== next;
    const active = pages[next].parent || next;
    for (const button of dialog.querySelectorAll<HTMLButtonElement>('.settings-nav button')) {
      if (button.dataset.settingsPage === active) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    }
    byId('settings-status').textContent = '';
    options.onNavigate(next);
    scroll.scrollTop = positions.get(next) || 0;
    if (focus) {
      const backTo = pages[previous].parent === next ? returnFocus.get(previous) : null;
      (backTo?.isConnected ? backTo : byId('settings-page-title')).focus({ preventScroll: true });
    }
  }
  dialog.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('button') : null;
    if (!target || target.disabled) return;
    const next = target.dataset.settingsPage as SettingsPage;
    if (next && next in pages) visit(next);
    if (target.id === 'settings-back' && pages[page].parent) visit(pages[page].parent!);
    if (target.id === 'settings-load-retry') options.onNavigate(page);
  });
  dialog.addEventListener('cancel', event => {
    if (pages[page].parent) { event.preventDefault(); visit(pages[page].parent!); }
  });
  dialog.addEventListener('close', () => {
    positions.set(page, scroll.scrollTop);
    options.onClose();
    byId('settings-trigger').focus({ preventScroll: true });
  });
  // Arrow keys supplement ordinary tab navigation without creating a custom focus trap.
  byId('settings-nav-newtab').parentElement!.addEventListener('keydown', event => {
    if (!(event instanceof KeyboardEvent) || !['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const controls = [...dialog.querySelectorAll<HTMLButtonElement>('.settings-nav button')];
    const index = controls.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? controls.length - 1
      : (index + (event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : -1) + controls.length) % controls.length;
    controls[next].focus();
  });
  byId('settings-version').textContent = chrome.runtime.getManifest().version;
  return {
    get page(): SettingsPage { return page; },
    get isOpen(): boolean { return dialog.open; },
    get needsWorkspace(): boolean { return !!pages[page].workspace && dialog.open; },
    open(): void { visit('newtab', false); },
    setLoading(value: boolean): void {
      loading = value;
      byId('settings-loading').hidden = !value;
      byId('settings-load-error').hidden = true;
      byId('settings-panels').hidden = value;
      scroll.setAttribute('aria-busy', String(value));
    },
    loadFailed(): void {
      loading = false;
      byId('settings-loading').hidden = true;
      byId('settings-panels').hidden = true;
      byId('settings-load-error').hidden = false;
      scroll.setAttribute('aria-busy', 'false');
    },
    showStatus(message: string, error = false, target = 'settings-status'): void {
      const node = byId(target); node.textContent = message;
      node.dataset.error = String(error);
    },
    get loading(): boolean { return loading; },
  };
}
