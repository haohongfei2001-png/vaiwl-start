import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { mountProjectLayout, placeProjectItems } from '../../src/ui/project-layout.js';

const geometry = { width: 640, columns: 3, columnGap: 20, rowGap: 12, mode: 'adaptive' as const };

test('adaptive placement fills the shortest open column while visual and DOM reading order agree', () => {
  const items = [240, 92, 160, 100, 80, 120, 70].map(height => ({ height }));
  const result = placeProjectItems(items, geometry);
  assert.deepEqual(result.placements.map(({ left, top }) => [left, top]), [
    [0, 0], [220, 0], [440, 0], [220, 104], [440, 172], [220, 216], [0, 252],
  ]);
  assert.equal(result.height, 336);
  const indices = result.placements.map((placement, index) => ({ ...placement, index }));
  assert.deepEqual([...indices].sort((a, b) => a.top - b.top || a.left - b.left).map(item => item.index), items.map((_, index) => index));
  for (let a = 0; a < result.placements.length; a++) for (let b = a + 1; b < result.placements.length; b++) {
    const first = result.placements[a]!, second = result.placements[b]!;
    assert.ok(first.left + first.width <= second.left || second.left + second.width <= first.left || first.top + first.height <= second.top || second.top + second.height <= first.top, 'Cards may not overlap');
  }
});

test('equal mode gives short and empty-content cards the same breakpoint height', () => {
  const input = [90, 230, 65, 130].map(height => ({ height }));
  const result = placeProjectItems(input, { ...geometry, mode: 'equal', equalHeight: 252 });
  assert.deepEqual(result.placements.map(item => item.height), [252, 252, 252, 252]);
  assert.deepEqual(result.placements.map(item => [item.left, item.top]), [[0, 0], [220, 0], [440, 0], [0, 264]]);
  assert.equal(result.height, 516);
  assert.equal(placeProjectItems([{ height: 65 }], { ...geometry, mode: 'equal', equalHeight: 252 }).height, 252);
});

test('full-width expansion flushes earlier columns and all later cards start after its barrier', () => {
  const items = [{ height: 240 }, { height: 80 }, { height: 120 }, { height: 180, fullWidth: true }, { height: 60 }, { height: 100 }];
  for (const mode of ['adaptive', 'equal'] as const) {
    const result = placeProjectItems(items, { ...geometry, mode, equalHeight: 252 });
    const panel = result.placements[3]!;
    assert.equal(panel.width, 640);
    assert.equal(panel.left, 0);
    assert.equal(panel.height, 180, 'Expansion height is independent of card height');
    assert.equal(panel.top, mode === 'equal' ? 264 : 252);
    for (const placement of result.placements.slice(4)) assert.equal(placement.top, panel.top + 192);
    assert.deepEqual(result.placements.slice(4).map(item => item.left), [0, 220]);
  }
});

test('single-column reflow preserves order and scales widths without leaving trailing gaps', () => {
  const result = placeProjectItems([{ height: 95 }, { height: 120 }, { height: 150, fullWidth: true }, { height: 60 }], { ...geometry, width: 350, columns: 1 });
  assert.deepEqual(result.placements.map(item => [item.left, item.top, item.width]), [[0, 0, 350], [0, 107, 350], [0, 239, 350], [0, 401, 350]]);
  assert.equal(result.height, 461);
  assert.deepEqual(placeProjectItems([], geometry), { placements: [], height: 0 });
});

function fixture() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
  const { window: win } = dom;
  const grid = win.document.createElement('div');
  grid.className = 'spatial-project-grid';
  grid.style.cssText = 'display:grid;grid-template-columns:200px 200px 200px;column-gap:20px;row-gap:12px';
  win.document.body.append(grid);
  let width = 640;
  const heights = [240, 92, 160, 100];
  const nodes = heights.map((height, index) => {
    const article = win.document.createElement('article');
    article.className = 'project';
    article.dataset.project = String(index);
    const link = win.document.createElement('a');
    link.href = `https://example.test/${index}`;
    link.textContent = `Project ${index}`;
    article.append(link);
    grid.append(article);
    article.getBoundingClientRect = () => {
      const left = Number.parseFloat(article.style.left) || 0, top = Number.parseFloat(article.style.top) || 0;
      const measuredWidth = Number.parseFloat(article.style.width) || 200;
      const measuredHeight = Number.parseFloat(article.style.height) || (grid.dataset.projectLayout === 'equal' ? 252 : heights[index]!);
      return { left, top, right: left + measuredWidth, bottom: top + measuredHeight, x: left, y: top, width: measuredWidth, height: measuredHeight, toJSON() {} };
    };
    link.getBoundingClientRect = () => article.getBoundingClientRect();
    return article;
  });
  grid.getBoundingClientRect = () => ({ left: 0, top: 0, right: width, bottom: Number.parseFloat(grid.style.height) || 500, x: 0, y: 0, width, height: Number.parseFloat(grid.style.height) || 500, toJSON() {} });
  const queued: (() => void)[] = [];
  let resizeCallback: ResizeObserverCallback | undefined;
  const observed = new Set<Element>();
  let disconnected = false;
  class Observer {
    constructor(callback: ResizeObserverCallback) { resizeCallback = callback; }
    observe(node: Element) { observed.add(node); }
    unobserve(node: Element) { observed.delete(node); }
    disconnect() { disconnected = true; observed.clear(); }
  }
  Object.defineProperty(win, 'ResizeObserver', { value: Observer });
  const fonts = new win.EventTarget();
  Object.defineProperty(fonts, 'ready', { value: Promise.resolve(fonts) });
  Object.defineProperty(win.document, 'fonts', { value: fonts });
  const notify = (...targets: Element[]) => resizeCallback?.(targets.map(target => ({ target } as ResizeObserverEntry)), {} as ResizeObserver);
  const controller = mountProjectLayout(grid, { mode: 'adaptive', theme: 'spatial', schedule: work => queued.push(work) });
  return { dom, win, grid, nodes, heights, queued, observed, fonts, notify, controller,
    resize: (next: number) => { width = next; }, isDisconnected: () => disconnected,
    flush: () => { while (queued.length) queued.shift()!(); },
  };
}

test('controller gates every layout through the scheduler, preserves DOM/tab order and updates measured sizes', () => {
  const f = fixture();
  try {
    const originalOrder = Array.from(f.grid.querySelectorAll('a'));
    const focused = originalOrder[2]!;
    focused.focus();
    assert.equal(f.queued.length, 1);
    assert.equal(f.nodes[0]!.style.position, '', 'Mount must not move cards before the safe scheduler runs');
    f.flush();
    assert.equal(f.nodes[3]!.style.left, '220px');
    assert.equal(f.nodes[3]!.style.top, '104px');
    assert.equal(f.win.getComputedStyle(f.grid).gridTemplateColumns, '200px 200px 200px');
    assert.deepEqual(Array.from(f.grid.querySelectorAll('a')), originalOrder);
    assert.equal(f.win.document.activeElement, focused);
    f.notify(f.grid, ...f.nodes);
    assert.equal(f.queued.length, 0, 'Own measurements do not create a resize observer loop');
    f.heights[1] = 120;
    f.notify(f.nodes[1]!);
    assert.equal(f.queued.length, 1);
    assert.equal(f.nodes[3]!.style.top, '104px', 'Height change waits for interaction-safe application');
    f.flush();
    assert.equal(f.nodes[3]!.style.top, '132px');
    f.resize(420);
    f.grid.style.gridTemplateColumns = '200px 200px';
    f.win.dispatchEvent(new f.win.Event('resize'));
    f.flush();
    assert.equal(f.nodes[2]!.style.left, '220px');
    assert.equal(f.nodes[2]!.style.top, '132px');
    assert.deepEqual(Array.from(f.grid.querySelectorAll('a')), originalOrder);
    assert.equal(f.win.document.activeElement, focused);
    f.controller.update({ mode: 'equal' });
    f.flush();
    assert.deepEqual(f.nodes.map(node => node.style.height), ['252px', '252px', '252px', '252px']);
    assert.equal(f.nodes[2]!.style.top, '264px');
  } finally { f.controller.dispose(); f.dom.window.close(); }
});

test('font changes are scheduled and disposal removes observers/listeners and cancels pending writes', () => {
  const f = fixture();
  try {
    const originalGridStyle = f.grid.getAttribute('style');
    f.flush();
    assert.equal(f.observed.size, 5);
    f.fonts.dispatchEvent(new f.win.Event('loadingdone'));
    assert.equal(f.queued.length, 1);
    f.controller.dispose();
    assert.equal(f.isDisconnected(), true);
    assert.equal(f.grid.getAttribute('style'), originalGridStyle);
    assert.equal(f.grid.hasAttribute('data-project-layout'), false);
    assert.ok(f.nodes.every(node => !node.hasAttribute('style')));
    f.flush();
    f.win.dispatchEvent(new f.win.Event('resize'));
    f.fonts.dispatchEvent(new f.win.Event('loadingdone'));
    f.controller.update({ mode: 'equal' });
    assert.equal(f.queued.length, 0);
    assert.equal(f.grid.getAttribute('style'), originalGridStyle);
    assert.ok(f.nodes.every(node => !node.hasAttribute('style')));
  } finally { f.controller.dispose(); f.dom.window.close(); }
});

test('idle height updates preserve the focused card viewport anchor without replacing or refocusing it', () => {
  const f = fixture();
  try {
    f.flush();
    const focused = f.nodes[3]!.querySelector('a')!;
    focused.focus();
    Object.defineProperty(f.win, 'scrollY', { value: 100, configurable: true });
    const scrolls: ScrollToOptions[] = [];
    f.win.scrollTo = ((position: ScrollToOptions) => { scrolls.push(position); }) as typeof f.win.scrollTo;
    f.heights[1] = 120;
    f.notify(f.nodes[1]!);
    assert.equal(scrolls.length, 0);
    f.flush();
    assert.equal(f.win.document.activeElement, focused);
    assert.deepEqual(scrolls, [{ top: 128, left: 0, behavior: 'instant' }]);
  } finally { f.controller.dispose(); f.dom.window.close(); }
});
