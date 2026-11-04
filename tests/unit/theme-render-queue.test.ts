import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { SafeRendering } from '../../src/ui/view-state.js';

const settle = () => new Promise<void>(resolve => setTimeout(resolve, 10));
async function withDom(run: (dom: JSDOM) => Promise<void>): Promise<void> {
  const dom = new JSDOM('<!doctype html><html><body><main id="workspace-content"></main></body></html>', { pretendToBeVisual: true });
  const globals = globalThis as any;
  const previous = { document: globals.document, window: globals.window };
  globals.document = dom.window.document;
  globals.window = dom.window;
  try { await run(dom); } finally { Object.assign(globals, previous); dom.window.close(); }
}
function pointer(dom: JSDOM, type: 'pointerdown' | 'pointerup'): void {
  const event = new dom.window.Event(type);
  Object.defineProperty(event, 'pointerId', { value: 17 });
  document.dispatchEvent(event);
}
function renderSnapshot(revision: number, theme: string): void {
  document.documentElement.dataset.homeTheme = theme;
  document.getElementById('workspace-content')!.textContent = `revision:${revision}`;
}

test('a theme append keeps the queued snapshot and waits for pointer release', () => withDom(async dom => {
  const safe = new SafeRendering(), order: string[] = [];
  let revision = 1;
  pointer(dom, 'pointerdown');
  safe.render(() => { revision = 2; order.push('snapshot:2'); });
  safe.renderAfterPending(() => { order.push(`theme:${revision}`); renderSnapshot(revision, 'spatial'); }, true);
  await settle();
  assert.equal(revision, 1, 'A pending pointer gesture must prevent the snapshot commit.');
  assert.deepEqual(order, [], 'The immediate theme request must also respect the gesture.');
  pointer(dom, 'pointerup');
  await settle();
  assert.deepEqual(order, ['snapshot:2', 'theme:2']);
  assert.equal(document.getElementById('workspace-content')!.textContent, 'revision:2');
  assert.equal(document.documentElement.dataset.homeTheme, 'spatial');
}));

test('keyboard-held theme callbacks use the latest shared preference after the snapshot commits', () => withDom(async dom => {
  const safe = new SafeRendering(), seen: { revision: number; theme: string }[] = [];
  let revision = 1, activeTheme = 'classic';
  const paint = () => { seen.push({ revision, theme: activeTheme }); renderSnapshot(revision, activeTheme); };
  document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowDown' }));
  safe.render(() => { revision = 3; });
  activeTheme = 'spatial';
  safe.renderAfterPending(paint, true);
  activeTheme = 'classic';
  safe.renderAfterPending(paint, true);
  await settle();
  assert.deepEqual(seen, []);
  document.dispatchEvent(new dom.window.KeyboardEvent('keyup', { key: 'ArrowDown' }));
  await settle();
  assert.deepEqual(seen, [{ revision: 3, theme: 'classic' }, { revision: 3, theme: 'classic' }]);
  assert.equal(document.getElementById('workspace-content')!.textContent, 'revision:3');
  assert.equal(document.documentElement.dataset.homeTheme, 'classic');
}));

test('an idle immediate theme render commits an already scheduled snapshot exactly once', () => withDom(async () => {
  const safe = new SafeRendering(), order: string[] = [];
  let revision = 1;
  safe.render(() => { revision = 4; order.push('snapshot:4'); });
  safe.renderAfterPending(() => { order.push(`theme:${revision}`); renderSnapshot(revision, 'spatial'); }, true);
  assert.deepEqual(order, ['snapshot:4', 'theme:4'], 'Idle immediate rendering must drain the scheduled commit first.');
  assert.equal(document.getElementById('workspace-content')!.textContent, 'revision:4');
  await settle();
  assert.deepEqual(order, ['snapshot:4', 'theme:4'], 'The old timer must not replay the commit.');
}));

test('a newer snapshot replaces the obsolete queued revision while rendering the current theme', () => withDom(async dom => {
  const safe = new SafeRendering(), applied: number[] = [];
  let revision = 1, activeTheme = 'classic';
  pointer(dom, 'pointerdown');
  safe.render(() => { revision = 2; applied.push(revision); renderSnapshot(revision, activeTheme); });
  activeTheme = 'spatial';
  safe.renderAfterPending(() => renderSnapshot(revision, activeTheme));
  // Production snapshot application renders the full workspace using shared theme state.
  safe.render(() => { revision = 5; applied.push(revision); renderSnapshot(revision, activeTheme); });
  await settle();
  assert.deepEqual(applied, []);
  pointer(dom, 'pointerup');
  await settle();
  assert.deepEqual(applied, [5], 'The latest snapshot may supersede an older revision and its redundant repaint.');
  assert.equal(document.getElementById('workspace-content')!.textContent, 'revision:5');
  assert.equal(document.documentElement.dataset.homeTheme, 'spatial');
}));
