import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { SafeRendering } from '../../src/ui/view-state.js';

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
