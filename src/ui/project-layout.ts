import type { HomeTheme } from '../domain/home-theme.js';
import type { ProjectLayout } from '../domain/home-preferences.js';
import { spatialColumns } from './spatial-home.js';

export interface ProjectLayoutItem { height: number; fullWidth?: boolean }
export interface ProjectPlacement { left: number; top: number; width: number; height: number }
export interface ProjectLayoutGeometry {
  width: number; columns: number; columnGap: number; rowGap: number;
  mode: ProjectLayout; equalHeight?: number;
}

/** Input order is DOM and keyboard order. The next shortest column also keeps
 * increasing top-Y, with left-X as the tie-breaker. A full-width panel is a barrier. */
export function placeProjectItems(items: readonly ProjectLayoutItem[], options: ProjectLayoutGeometry): { placements: ProjectPlacement[]; height: number } {
  const columns = Math.max(1, Math.floor(options.columns));
  const columnGap = Math.max(0, options.columnGap), rowGap = Math.max(0, options.rowGap);
  const width = Math.max(0, options.width), cardWidth = Math.max(0, (width - columnGap * (columns - 1)) / columns);
  const heights = Array<number>(columns).fill(0);
  const equalHeight = options.equalHeight ?? Math.max(0, ...items.filter(item => !item.fullWidth).map(item => item.height));
  const placements = items.map(item => {
    const height = Math.max(0, item.fullWidth || options.mode === 'adaptive' ? item.height : equalHeight);
    if (item.fullWidth) {
      const top = Math.max(...heights);
      heights.fill(top + height + rowGap);
      return { left: 0, top, width, height };
    }
    const top = Math.min(...heights), column = heights.indexOf(top);
    heights[column] = top + height + rowGap;
    return { left: column * (cardWidth + columnGap), top, width: cardWidth, height };
  });
  return { placements, height: items.length ? Math.max(...heights) - rowGap : 0 };
}

export interface ProjectLayoutOptions {
  mode: ProjectLayout;
  theme: HomeTheme;
  /** All DOM writes, including resize/font updates, pass through interaction safety. */
  schedule: (work: () => void) => void;
}
export interface ProjectLayoutController {
  update(options?: Partial<ProjectLayoutOptions>): void;
  dispose(): void;
}

/** Mount after inserting the grid. Update after option/content changes. Dispose
 * before replacing/removing it. Never reorders or re-parents a child. */
export function mountProjectLayout(grid: HTMLElement, initial: ProjectLayoutOptions): ProjectLayoutController {
  let options = { ...initial }, disposed = false, pending = false;
  const win = grid.ownerDocument.defaultView;
  if (!win) return { update() {}, dispose() {} };
  const originals = new Map<HTMLElement, string | null>([[grid, grid.getAttribute('style')]]);
  const originalMode = grid.getAttribute('data-project-layout');
  const sizes = new Map<Element, string>();
  let children: HTMLElement[] = [];
  const sizeKey = (node: Element): string => {
    const rect = node.getBoundingClientRect();
    return node === grid ? String(Math.round(rect.width * 10)) : `${Math.round(rect.width * 10)}:${Math.round(rect.height * 10)}`;
  };
  const observer = typeof win.ResizeObserver === 'function' ? new win.ResizeObserver(entries => {
    if (!disposed && entries.some(entry => sizes.get(entry.target) !== sizeKey(entry.target))) request();
  }) : null;
  observer?.observe(grid);

  function layout(): void {
    pending = false;
    if (disposed || !grid.isConnected) return;
    const width = grid.getBoundingClientRect().width;
    if (width <= 0) return;
    const current = Array.from(grid.children).filter((node): node is HTMLElement => node instanceof win!.HTMLElement && !node.hidden);
    for (const child of children) if (!current.includes(child)) { observer?.unobserve(child); sizes.delete(child); }
    for (const child of current) if (!originals.has(child)) { originals.set(child, child.getAttribute('style')); observer?.observe(child); }
    children = current;
    const focused = grid.ownerDocument.activeElement;
    const anchor = focused instanceof win!.HTMLElement && grid.contains(focused) ? focused : children.find(child => {
      const rect = child.getBoundingClientRect();
      return rect.bottom > 0 && rect.top < win!.innerHeight;
    });
    const anchorTop = anchor?.getBoundingClientRect().top;
    const pageY = win!.scrollY;
    grid.dataset.projectLayout = options.mode;
    const computed = win!.getComputedStyle(grid);
    // Keep CSS gridTemplateColumns intact so responsive themes remain authoritative.
    const tracks = computed.gridTemplateColumns.trim().split(/\s+/).filter(track => /^\d+(?:\.\d+)?px$/.test(track));
    const columns = tracks.length || spatialColumns(win!.innerWidth, options.theme);
    const columnGap = Number.parseFloat(computed.columnGap) || 0, rowGap = Number.parseFloat(computed.rowGap) || 0;
    const cardWidth = Math.max(0, (width - columnGap * (columns - 1)) / columns);
    grid.style.position = 'relative';
    for (const child of children) {
      child.style.position = 'absolute';
      child.style.width = `${child.classList.contains('spatial-project-expanded') ? width : cardWidth}px`;
      child.style.height = '';
    }
    const items = children.map(child => ({ height: child.getBoundingClientRect().height, fullWidth: child.classList.contains('spatial-project-expanded') }));
    const equalHeight = Math.max(0, ...items.filter(item => !item.fullWidth).map(item => item.height));
    const result = placeProjectItems(items, { width, columns, columnGap, rowGap, mode: options.mode, equalHeight });
    result.placements.forEach((placement, index) => {
      const child = children[index]!;
      child.style.left = `${placement.left}px`;
      child.style.top = `${placement.top}px`;
      if (!items[index]!.fullWidth && options.mode === 'equal') child.style.height = `${placement.height}px`;
    });
    grid.style.height = `${result.height}px`;
    for (const node of [grid, ...children]) sizes.set(node, sizeKey(node));
    // No focus call: the original focused DOM node stays alive. Keep its screen
    // position (or the first visible card) when an idle resize changes heights.
    if (anchor && anchorTop !== undefined && pageY > 0) {
      const delta = anchor.getBoundingClientRect().top - anchorTop;
      if (Math.abs(delta) > 0.5) win!.scrollTo({ top: Math.max(0, pageY + delta), left: win!.scrollX, behavior: 'instant' });
    }
  }
  function request(): void {
    if (disposed || pending) return;
    pending = true;
    options.schedule(layout);
  }
  const onFonts = () => request();
  win.addEventListener('resize', request);
  grid.ownerDocument.fonts?.addEventListener('loadingdone', onFonts);
  void grid.ownerDocument.fonts?.ready.then(() => { if (!disposed) request(); });
  request();
  return {
    update(next = {}) { options = { ...options, ...next }; request(); },
    dispose() {
      if (disposed) return;
      disposed = true;
      observer?.disconnect();
      win.removeEventListener('resize', request);
      grid.ownerDocument.fonts?.removeEventListener('loadingdone', onFonts);
      for (const [node, style] of originals) {
        if (style === null) node.removeAttribute('style'); else node.setAttribute('style', style);
      }
      if (originalMode === null) grid.removeAttribute('data-project-layout'); else grid.setAttribute('data-project-layout', originalMode);
      sizes.clear(); originals.clear(); children = [];
    },
  };
}
