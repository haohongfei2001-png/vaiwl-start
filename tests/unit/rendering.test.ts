import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readView, saveView, SafeRendering, preservePosition } from '../../src/ui/view-state.js';

test('T07 a gesture starting after refresh scheduling still defers rendering until its safe endpoint', async () => {
  const dom = new JSDOM('<!doctype html><div id="workspace-content"></div>', { pretendToBeVisual: true });
  const globals = globalThis as any, previous = { document: globals.document, window: globals.window };
  globals.document = dom.window.document; globals.window = dom.window;
  const pause = () => new Promise(resolve => setTimeout(resolve, 10));
  try {
    const safe = new SafeRendering(); let calls = 0;
    safe.schedule(() => calls++);
    const down = new dom.window.Event('pointerdown'); Object.defineProperty(down, 'pointerId', { value: 9 });
    dom.window.document.dispatchEvent(down); await pause();
    assert.equal(calls, 0);
    const up = new dom.window.Event('pointerup'); Object.defineProperty(up, 'pointerId', { value: 9 });
    dom.window.document.dispatchEvent(up); await pause(); assert.equal(calls, 1);
    dom.window.document.dispatchEvent(new dom.window.Event('compositionstart'));
    safe.schedule(() => calls++); await pause(); assert.equal(calls, 1);
    dom.window.document.dispatchEvent(new dom.window.Event('compositionend')); await pause(); assert.equal(calls, 2);
  } finally { globals.document = previous.document; globals.window = previous.window; dom.window.close(); }
});


test('saved confirmation filter migrates to all without losing scope, page, expansions or scroll', () => {
  const dom = new JSDOM('', { url: 'https://example.test' });
  const globals = globalThis as any, previous = globals.sessionStorage;
  globals.sessionStorage = dom.window.sessionStorage;
  try {
    sessionStorage.setItem('vaiwl-start-view/1', JSON.stringify({ k: 4, filter: 'unknown', selectedScope: 'scope:test', older: ['project:kept'], limits: { 'project:kept': 17 }, unknownOpen: true, scrollY: 320 }));
    const migrated = readView();
    assert.equal(migrated.filter, 'all'); assert.equal(migrated.k, 4); assert.equal(migrated.selectedScope, 'scope:test');
    assert.deepEqual(migrated.older, ['project:kept']); assert.deepEqual(migrated.limits, { 'project:kept': 17 }); assert.equal(migrated.scrollY, 320);
    assert.equal(migrated.earlierProjectsOpen, false);
    saveView({ ...migrated, earlierProjectsOpen: true }); assert.equal(readView().earlierProjectsOpen, true);
  } finally { globals.sessionStorage = previous; dom.window.close(); }
});


test('background projection changes wait for drag completion and retain only the latest revision', async () => {
  const dom = new JSDOM('<!doctype html><div id="workspace-content"></div>', { pretendToBeVisual: true });
  const globals = globalThis as any, previous = { document: globals.document, window: globals.window };
  globals.document = dom.window.document; globals.window = dom.window;
  const pause = () => new Promise(resolve => setTimeout(resolve, 10));
  try {
    const safe = new SafeRendering(); const applied: number[] = [];
    dom.window.document.dispatchEvent(new dom.window.Event('dragstart'));
    safe.schedule(() => applied.push(1)); await pause();
    safe.schedule(() => applied.push(2)); await pause();
    assert.deepEqual(applied, []);
    dom.window.document.dispatchEvent(new dom.window.Event('dragend')); await pause();
    assert.deepEqual(applied, [2]);
  } finally { globals.document = previous.document; globals.window = previous.window; dom.window.close(); }
});


test('a focused record leaving the current projection returns to its selected filter without scrolling', () => {
  const dom = new JSDOM('<!doctype html><div id="workspace-content"><button data-filter="none" aria-selected="true">最近</button><a href="#" data-record-key="gone" data-focus-key="record:gone">Conversation</a></div>', { pretendToBeVisual: true });
  const globals = globalThis as any, previous = { document: globals.document, window: globals.window, CSS: globals.CSS };
  globals.document = dom.window.document; globals.window = dom.window; globals.CSS = { escape: (value: string) => value };
  let scroll = 120;
  Object.defineProperty(dom.window, 'scrollY', { get: () => scroll });
  dom.window.scrollTo = ((_x: number, y: number) => { scroll = y; }) as any;
  dom.window.scrollBy = ((_x: number, y: number) => { scroll += y; }) as any;
  try {
    const row = dom.window.document.querySelector<HTMLAnchorElement>('a')!;
    row.getBoundingClientRect = () => ({ top: 100, bottom: 135 } as DOMRect); row.focus();
    preservePosition(() => { row.remove(); });
    assert.equal(dom.window.document.activeElement?.getAttribute('data-filter'), 'none'); assert.equal(scroll, 120);
    const search = dom.window.document.createElement('dialog'); search.id = 'search-dialog'; search.setAttribute('open', '');
    search.innerHTML = '<button data-search-filter="project" aria-pressed="true">项目</button><a href="#" data-focus-key="search:gone">Search result</a>';
    dom.window.document.body.append(search); search.querySelector<HTMLAnchorElement>('a')!.focus();
    preservePosition(() => search.querySelector('a')!.remove());
    assert.equal(dom.window.document.activeElement?.getAttribute('data-search-filter'), 'project'); assert.equal(scroll, 120);
  } finally { Object.assign(globals, previous); dom.window.close(); }
});

test('a modern-theme record or details control leaving the projection returns to the selected header filter', () => {
  const dom = new JSDOM('<!doctype html><header><div id="theme-controls"><button data-filter="project" aria-selected="true">项目</button></div></header><main id="workspace-content"></main>', { pretendToBeVisual: true });
  const globals = globalThis as any, previous = { document: globals.document, window: globals.window, CSS: globals.CSS };
  globals.document = dom.window.document; globals.window = dom.window; globals.CSS = { escape: (value: string) => value };
  let scroll = 240;
  Object.defineProperty(dom.window, 'scrollY', { get: () => scroll });
  dom.window.scrollTo = ((_x: number, y: number) => { scroll = y; }) as any;
  dom.window.scrollBy = ((_x: number, y: number) => { scroll += y; }) as any;
  try {
    const content = document.getElementById('workspace-content')!;
    const controls = document.getElementById('theme-controls')!;
    assert.equal(content.contains(controls), false, 'Modern filters live in the topbar, outside the projected content');
    for (const theme of ['spatial', 'workbench', 'folio']) {
      document.documentElement.dataset.homeTheme = theme;
      for (const kind of ['record', 'details']) {
        const focused = document.createElement('button');
        focused.dataset.focusKey = `${kind}:gone`;
        focused.dataset.recordKey = 'gone';
        focused.getBoundingClientRect = () => ({ top: 100, bottom: 135 } as DOMRect);
        content.append(focused); focused.focus();
        preservePosition(() => {
          content.replaceChildren();
          // Both regions are reconstructed when applying a fresh projection.
          controls.innerHTML = '<button data-filter="project" aria-selected="true">项目</button>';
        });
        assert.equal(document.activeElement, controls.querySelector('[data-filter]'), `${theme} ${kind} fallback`);
        assert.equal(scroll, 240);
      }
    }
  } finally { Object.assign(globals, previous); dom.window.close(); }
});


test('an awaited mutation response cannot use immediate rendering during the next user gesture', async () => {
  const dom = new JSDOM('<!doctype html><div id="workspace-content"></div>', { pretendToBeVisual: true });
  const globals = globalThis as any, previous = { document: globals.document, window: globals.window };
  globals.document = dom.window.document; globals.window = dom.window;
  const pause = () => new Promise(resolve => setTimeout(resolve, 10));
  try {
    const safe = new SafeRendering(); let calls = 0;
    safe.render(() => calls++, true); assert.equal(calls, 1);
    for (const [start, end] of [['pointerdown', 'pointerup'], ['compositionstart', 'compositionend'], ['dragstart', 'dragend']]) {
      let receive!: () => void;
      const mutationResponse = new Promise<void>(resolve => { receive = resolve; }).then(() => safe.render(() => calls++, true));
      const first = new dom.window.Event(start!); Object.defineProperty(first, 'pointerId', { value: 9 });
      dom.window.document.dispatchEvent(first); const before: number = calls; receive(); await mutationResponse; await pause();
      assert.equal(calls, before, start);
      const last = new dom.window.Event(end!); Object.defineProperty(last, 'pointerId', { value: 9 });
      dom.window.document.dispatchEvent(last); await pause(); assert.equal(calls, before + 1, end);
    }
  } finally { globals.document = previous.document; globals.window = previous.window; dom.window.close(); }
});
