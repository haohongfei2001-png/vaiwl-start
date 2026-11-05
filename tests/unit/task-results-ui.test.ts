import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { initTaskResults } from '../../src/ui/task-results.js';
import type { TaskSnapshot } from '../../src/tasks/types.js';

const settle = () => new Promise<void>(resolve => setImmediate(resolve));

test('task settings unlock after privacy notification renders before an action response', async () => {
  const html = await readFile(new URL('../../public/newtab.html', import.meta.url), 'utf8');
  for (const command of ['CONFIGURE', 'CLEAR_CACHE']) {
    const dom = new JSDOM(html, { pretendToBeVisual: true });
    const names = ['window', 'document', 'chrome'];
    const descriptors = Object.fromEntries(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
    const assign = (name: string, value: unknown) => Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    assign('window', dom.window); assign('document', dom.window.document);
    dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new dom.window.Event('close')); };
    const snapshot: TaskSnapshot = {
      settings: { enabled: true, automatic: false, showWidget: false, preview: true, selections: {} },
      principal: null, tasks: [], sync: { status: 'ok', code: null, attemptedAt: null, succeededAt: null, mode: 'visit' },
      completeList: true, permission: true,
    };
    let notify!: (message: unknown, sender: { id: string }) => void;
    let finishAction!: (response: unknown) => void;
    let snapshots = 0;
    assign('chrome', { runtime: {
      id: 'task-ui-fixture', onMessage: { addListener(listener: typeof notify) { notify = listener; } },
      sendMessage(message: { command: string }) {
        if (message.command === 'SNAPSHOT') { snapshots++; return Promise.resolve({ ok: true, data: structuredClone(snapshot) }); }
        assert.equal(message.command, command);
        return new Promise(resolve => { finishAction = resolve; });
      },
    } });
    const query = <T extends HTMLElement>(id: string) => dom.window.document.getElementById(id) as T;
    const disabled = () => ['tasks-enabled', 'tasks-widget', 'tasks-preview', 'tasks-mode'].map(id => query<HTMLInputElement>(id).disabled);
    try {
      initTaskResults().setContext('workspace', true); await settle();
      assert.deepEqual(disabled(), [false, false, false, false], command + ': initially interactive');
      if (command === 'CONFIGURE') {
        query<HTMLInputElement>('tasks-enabled').checked = false;
        query('tasks-enabled').dispatchEvent(new dom.window.Event('change'));
        snapshot.settings.enabled = false;
      } else query('tasks-clear-confirm').click();
      assert.ok(finishAction); assert.deepEqual(disabled(), [true, true, true, true]);
      notify({ protocol: 'vaiwl-tasks/1', event: 'changed', privacyChanged: true }, { id: 'task-ui-fixture' });
      await settle();
      assert.equal(snapshots, 2, 'The new privacy-safe snapshot renders before the action completes');
      assert.deepEqual(disabled(), [true, true, true, true]);
      finishAction({ ok: true, data: {} }); await settle();
      assert.deepEqual(disabled(), [false, false, false, false], command + ': unlock without another notification');
      assert.equal(query<HTMLInputElement>('tasks-enabled').checked, snapshot.settings.enabled, 'Keep the new snapshot, not the stale action state');
    } finally {
      dom.window.close();
      for (const name of names) {
        if (descriptors[name]) Object.defineProperty(globalThis, name, descriptors[name]!);
        else Reflect.deleteProperty(globalThis, name);
      }
    }
  }
});
