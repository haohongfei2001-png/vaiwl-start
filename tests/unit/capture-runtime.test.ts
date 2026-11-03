import test from 'node:test';
import assert from 'node:assert/strict';
import { createCaptureReconciler } from '../../src/background/permissions.js';

function harness() {
  let enabled = false, granted = true, registered = false, failRegistration = false, failuresRemaining = 0;
  let containsGate: Promise<void> | undefined;
  const calls: string[] = [], values: Record<string, any> = {
    browserSession: { id: 'isolated-session', scopeEpoch: 0, bindings: {
      7: { id: 'old-binding', tabId: 7, documentId: 'old-document', href: 'https://chatgpt.com/', routeEpoch: 0, scopeEpoch: 0 },
    } },
  };
  const previous = globalThis.chrome;
  Object.assign(globalThis, { chrome: {
    permissions: { contains: async () => { calls.push('contains'); await containsGate; return granted; } },
    storage: { session: {
      get: async (key: string) => ({ [key]: structuredClone(values[key]) }),
      set: async (patch: object) => { Object.assign(values, structuredClone(patch)); },
      remove: async (key: string) => { delete values[key]; },
    } },
    scripting: {
      getRegisteredContentScripts: async () => registered ? [{ id: 'vaiwl-start-chatgpt' }] : [],
      registerContentScripts: async (scripts: any[]) => {
        calls.push('register'); if (failRegistration || failuresRemaining-- > 0) throw Error('synthetic registration failure');
        assert.equal(scripts[0].world, 'ISOLATED'); assert.deepEqual(scripts[0].matches, ['https://chatgpt.com/*']);
        assert.deepEqual(scripts[0].js, ['content.js']); registered = true;
      },
      unregisterContentScripts: async () => { calls.push('unregister'); registered = false; },
      executeScript: async (request: any) => { calls.push('inject'); assert.equal(request.target.tabId, 7); assert.equal(request.world, 'ISOLATED'); assert.deepEqual(request.files, ['content.js']); return []; },
    },
    tabs: {
      query: async (query: any) => { assert.equal(query.url, 'https://chatgpt.com/*'); return [{ id: 7 }]; },
      sendMessage: async (id: number, message: any, target: any) => { assert.equal(id, 7); assert.equal(message.command, 'STOP'); assert.equal(target.documentId, 'old-document'); calls.push('stop'); },
    },
  } });
  const reconcile = createCaptureReconciler(async () => { calls.push('read:' + enabled); return enabled; });
  return { calls, values, reconcile, get registered() { return registered; }, setEnabled: (value: boolean) => { enabled = value; }, setGranted: (value: boolean) => { granted = value; },
    hold: (gate: Promise<void> | undefined) => { containsGate = gate; }, failRegistration: (value: boolean) => { failRegistration = value; }, failNextRegistration: () => { failuresRemaining = 1; },
    close: () => { Object.assign(globalThis, { chrome: previous }); } };
}

test('capture restoration respects persisted disabled state and never silently enables collection', async () => {
  const h = harness();
  try {
    await h.reconcile();
    assert.equal(h.registered, false); assert.equal(h.calls.includes('inject'), false);
    assert.equal(h.values.browserSession.scopeEpoch, 1); assert.deepEqual(h.values.browserSession.bindings, {});
    assert.equal(h.calls.filter(value => value === 'stop').length, 1);
  } finally { h.close(); }
});

test('capture restoration registers once and revives already-open documents while enabled', async () => {
  const h = harness();
  try {
    h.setEnabled(true); await h.reconcile(); await h.reconcile();
    assert.equal(h.registered, true); assert.equal(h.calls.filter(value => value === 'register').length, 1);
    assert.equal(h.calls.filter(value => value === 'inject').length, 2);
    assert.equal(h.values.browserSession.scopeEpoch, 0, 'worker wake/restoration must not rotate an existing browser session');
  } finally { h.close(); }
});

test('an overlapping lifecycle restore cannot leave collection registered after a later pause', async () => {
  const h = harness(); let release!: () => void;
  try {
    h.setEnabled(true); h.hold(new Promise(resolve => { release = resolve; }));
    const startup = h.reconcile();
    for (let attempt = 0; !h.calls.includes('contains') && attempt < 100; attempt++) await new Promise(resolve => setTimeout(resolve, 1));
    assert.ok(h.calls.includes('contains'), 'restoration must reach the permission check');
    h.setEnabled(false); const pause = h.reconcile(); release();
    await Promise.all([startup, pause]);
    assert.equal(h.registered, false); assert.equal(h.calls.at(-1), 'stop');
    assert.deepEqual(h.calls.filter(value => value.startsWith('read:')), ['read:true', 'read:false']);
  } finally { release?.(); h.close(); }
});

test('queued restoration rereads current preference instead of replaying an obsolete disable event', async () => {
  const h = harness(); let release!: () => void;
  try {
    h.setEnabled(true); h.hold(new Promise(resolve => { release = resolve; })); const first = h.reconcile();
    for (let attempt = 0; !h.calls.includes('contains') && attempt < 100; attempt++) await new Promise(resolve => setTimeout(resolve, 1));
    assert.ok(h.calls.includes('contains'), 'restoration must reach the permission check');
    h.setEnabled(false); const olderPause = h.reconcile(); h.setEnabled(true); const latestResume = h.reconcile(); release();
    await Promise.all([first, olderPause, latestResume]);
    assert.equal(h.registered, true); assert.equal(h.calls.includes('unregister'), false);
    assert.deepEqual(h.calls.filter(value => value.startsWith('read:')), ['read:true', 'read:true', 'read:true']);
  } finally { release?.(); h.close(); }
});

test('missing permission fails closed and a failed reconciliation does not poison a later authorized lifecycle', async () => {
  const h = harness();
  try {
    h.setEnabled(true); h.setGranted(false); await h.reconcile();
    assert.equal(h.calls.includes('inject'), false); assert.equal(h.registered, false);
    h.setGranted(true); h.failRegistration(true); await assert.rejects(h.reconcile(), /synthetic registration failure/);
    h.failRegistration(false); await h.reconcile(); assert.equal(h.registered, true);
  } finally { h.close(); }
});

test('one transient registration failure recovers within the same authorized restoration', async () => {
  const h = harness();
  try {
    h.setEnabled(true); h.failNextRegistration(); await h.reconcile();
    assert.equal(h.registered, true); assert.equal(h.calls.filter(value => value === 'register').length, 2);
    assert.equal(h.calls.filter(value => value === 'inject').length, 1);
  } finally { h.close(); }
});

test('a delayed restoration retry rereads pause state and does not inject after collection is disabled', async () => {
  const h = harness();
  try {
    h.setEnabled(true); h.failNextRegistration(); const pending = h.reconcile();
    for (let attempt = 0; !h.calls.includes('register') && attempt < 100; attempt++) await new Promise(resolve => setTimeout(resolve, 1));
    assert.ok(h.calls.includes('register'));
    h.setEnabled(false); await pending;
    assert.equal(h.registered, false); assert.equal(h.calls.includes('inject'), false);
    assert.deepEqual(h.calls.filter(value => value.startsWith('read:')), ['read:true', 'read:false']);
  } finally { h.close(); }
});
