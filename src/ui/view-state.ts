export interface SavedView {
  k: number;
  selectedScope?: string;
  filter: 'all' | 'project' | 'none';
  older: string[];
  limits: Record<string, number>;
  earlierProjectsOpen: boolean;
  scrollY: number;
}
const KEY = 'vaiwl-start-view/1';

export function readView(): SavedView {
  const empty: SavedView = { k: 0, filter: 'all', older: [], limits: {}, earlierProjectsOpen: false, scrollY: 0 };
  try {
    const value = JSON.parse(sessionStorage.getItem(KEY) || 'null');
    if (!value || !Number.isSafeInteger(value.k) || value.k < 0 || value.k > 100000) return empty;
    if (!['all', 'project', 'none', 'unknown'].includes(value.filter)) return empty;
    return { ...empty, k: value.k, filter: value.filter === 'unknown' ? 'all' : value.filter, selectedScope: typeof value.selectedScope === 'string' ? value.selectedScope : undefined,
      older: Array.isArray(value.older) ? value.older.filter((item: unknown) => typeof item === 'string').slice(0, 500) : [],
      limits: typeof value.limits === 'object' && value.limits !== null ? Object.fromEntries(Object.entries(value.limits).filter(([key, n]) => key.length <= 200 && Number.isSafeInteger(n) && Number(n) >= 5 && Number(n) <= 10000)) as Record<string, number> : {},
      earlierProjectsOpen: value.earlierProjectsOpen === true, scrollY: Number.isFinite(value.scrollY) ? Math.max(0, value.scrollY) : 0 };
  } catch { return empty; }
}

export function saveView(view: SavedView): void {
  try { sessionStorage.setItem(KEY, JSON.stringify(view)); } catch { /* A denied view cache does not affect the catalog. */ }
}

/** Background revisions wait for the current gesture, never move an item under it. */
export class SafeRendering {
  private pointers = new Set<number>();
  private keys = new Set<string>();
  private composing = false;
  private dragging = false;
  private pending: (() => void) | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  constructor() {
    document.addEventListener('pointerdown', event => this.pointers.add(event.pointerId), true);
    document.addEventListener('pointerup', event => { this.pointers.delete(event.pointerId); this.flushSoon(); }, true);
    document.addEventListener('pointercancel', event => { this.pointers.delete(event.pointerId); this.flushSoon(); }, true);
    document.addEventListener('compositionstart', () => { this.composing = true; }, true);
    document.addEventListener('compositionend', () => { this.composing = false; this.flushSoon(); }, true);
    document.addEventListener('dragstart', () => { this.dragging = true; }, true);
    document.addEventListener('dragend', () => { this.dragging = false; this.flushSoon(); }, true);
    document.addEventListener('keydown', event => { if (['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Tab', 'Enter', ' '].includes(event.key)) this.keys.add(event.key); }, true);
    document.addEventListener('keyup', event => { this.keys.delete(event.key); this.flushSoon(); }, true);
    window.addEventListener('blur', () => { this.pointers.clear(); this.keys.clear(); this.dragging = false; this.composing = false; this.flushSoon(); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.flushSoon(); });
  }
  /** A completed mutation may return after the user has begun a new gesture. */
  render(callback: () => void, immediate = false): void {
    if (immediate && !this.interacting) {
      if (this.timer !== null) clearTimeout(this.timer);
      this.timer = null; this.pending = null; preservePosition(callback);
    } else this.schedule(callback);
  }
  private get interacting(): boolean { return this.pointers.size > 0 || this.keys.size > 0 || this.composing || this.dragging; }
  schedule(callback: () => void): void { this.pending = callback; this.flushSoon(); }
  private flushSoon(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    if (!this.pending || this.interacting) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      // A gesture may begin after scheduling but before this task executes.
      if (this.interacting) return;
      const apply = this.pending; this.pending = null; if (apply) preservePosition(apply);
    }, 0);
  }
}

export function preservePosition(apply: () => void): void {
  const active = document.activeElement as HTMLElement | null;
  const focusId = active?.id || null;
  const focusKey = active?.dataset.focusKey || null;
  const rows = [...document.querySelectorAll<HTMLElement>('#workspace-content [data-record-key]')];
  const anchor = rows.find(row => row.getBoundingClientRect().bottom > 80);
  const anchorKey = anchor?.dataset.recordKey;
  const anchorOffset = anchor?.getBoundingClientRect().top;
  const previousScroll = window.scrollY;
  apply();
  const usable = (node: HTMLElement | null) => !!node && !node.closest('[hidden],[inert],dialog:not([open])');
  const restored = focusKey ? document.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(focusKey)}"]`) : focusId ? document.getElementById(focusId) : null;
  if (usable(restored) && restored !== document.activeElement) restored!.focus({ preventScroll: true });
  else if (focusKey?.startsWith('bookmark:') && (!restored || restored.closest('[hidden],[inert]'))) {
    const disclosure = document.getElementById('bookmark-toggle');
    if (disclosure && !disclosure.closest('[hidden],[inert]')) disclosure.focus({ preventScroll: true });
  }
  else if (focusKey && /^(?:record:|details:|search:)/.test(focusKey) && !usable(restored)) {
    // The entity may legitimately leave this interval/filter after stronger evidence.
    // Keep a meaningful keyboard position without retaining a duplicate stale row.
    const target = focusKey.startsWith('search:')
      ? document.querySelector<HTMLElement>('#search-dialog[open] [data-search-filter][aria-pressed="true"]')
      : document.querySelector<HTMLElement>('#workspace-content [data-filter][aria-selected="true"]');
    if (usable(target)) target!.focus({ preventScroll: true });
  }
  const newAnchor = anchorKey ? document.querySelector<HTMLElement>(`#workspace-content [data-record-key="${CSS.escape(anchorKey)}"]`) : null;
  if (usable(newAnchor) && anchorOffset !== undefined) window.scrollBy(0, newAnchor!.getBoundingClientRect().top - anchorOffset);
  else if (previousScroll !== window.scrollY) window.scrollTo(0, previousScroll);
}
