import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { createRepository } from '../../src/storage/repository.js';
import { bindCurrentDocument, inspectStartOpenChain, registerNavigation, requireCurrentBinding } from '../../src/background/navigation.js';
import { changeSession, invalidateBindings, session } from '../../src/background/session.js';
import { openFromStart } from '../../src/background/open-broker.js';
import { request, transactionDone } from '../../src/storage/db.js';

const cid = '00000000-0000-4000-8000-000000000001';
const target = `https://chatgpt.com/c/${cid}`;
const other = 'https://chatgpt.com/c/00000000-0000-4000-8000-000000000002';
const sender = { documentId: 'start-doc', tab: { id: 1 } } as chrome.runtime.MessageSender;
const tick = () => new Promise<void>(resolve => setImmediate(resolve));

async function harness() {
  const factory = new IDBFactory(), name = crypto.randomUUID();
  const repo = await createRepository({ indexedDB: factory, name, timeZone: 'America/New_York' });
  await repo.setSettings({ captureEnabled: true });
  await repo.discoverCandidates([{ url: target, title: 'Synthetic target' }]);
  const record = (await repo.getSnapshot()).conversations[0]!;
  const previous = (globalThis as any).chrome;
  const saved: Record<string, unknown> = {};
  const listeners: Record<string, (...args: any[]) => Promise<void> | void> = {};
  const messages: Array<{ tabId: number; message: unknown; options: unknown }> = [];
  let frame: any = { documentId: 'target-doc', documentLifecycle: 'active', url: target };
  let connected = true, frameGate: (() => Promise<void>) | null = null;
  const event = (name: string) => ({ addListener: (callback: (...args: any[]) => Promise<void> | void) => { listeners[name] = callback; } });
  (globalThis as any).chrome = {
    storage: { session: {
      get: async (key: string) => ({ [key]: structuredClone(saved[key]) }),
      set: async (value: Record<string, unknown>) => { Object.assign(saved, structuredClone(value)); },
    } },
    permissions: { contains: async () => connected },
    webNavigation: {
      getFrame: async () => { const sample = structuredClone(frame); if (frameGate) await frameGate(); return sample; },
      onCommitted: event('committed'), onHistoryStateUpdated: event('history'), onCompleted: event('completed'), onErrorOccurred: event('error'),
    },
    tabs: { create: async () => ({ id: 8 }), update: async () => ({ id: 8 }), sendMessage: async (tabId: number, message: unknown, options: unknown) => { messages.push({ tabId, message, options }); }, onRemoved: event('removed') },
    windows: { create: async () => ({ tabs: [{ id: 8 }] }) },
  };
  registerNavigation(async () => repo, async () => {});
  const issue = async (id: string) => { await openFromStart(repo, sender, id, { recordKey: record.key, disposition: 'new-background-tab', gesture: 'auxclick' }); return (await repo.getIntent(id))!; };
  const emit = async (name: string, patch: Record<string, unknown> = {}) => {
    const details = { tabId: 8, frameId: 0, documentId: frame.documentId, documentLifecycle: frame.documentLifecycle, url: frame.url, transitionType: 'link', transitionQualifiers: [], ...patch };
    await listeners[name]!(details);
  };
  const close = async () => { await changeSession(() => {}); repo.close(); (globalThis as any).chrome = previous; };
  return { repo, factory, name, record, issue, emit, close, listeners, saved, messages,
    setFrame: (patch: Record<string, unknown>) => { frame = { ...frame, ...patch }; },
    setConnected: (value: boolean) => { connected = value; },
    setFrameGate: (value: (() => Promise<void>) | null) => { frameGate = value; },
  };
}

test('Local-first Start freezes one document; completed navigation writes one local OpenDay without body proof', async () => {
  const h = await harness();
  try {
    await h.issue('bind-once'); await h.emit('committed');
    const intent = (await h.repo.getIntent('bind-once'))!;
    assert.equal(intent.state, 'navigation-dispatched'); assert.equal(intent.targetDocumentId, 'target-doc');
    const binding = (await session()).bindings['8']!;
    assert.deepEqual(await inspectStartOpenChain(h.repo, binding), { state: 'navigation-bound-arrival-unproven', intentId: intent.id });
    assert.equal((await h.repo.getSnapshot()).conversations[0]!.activity, null);
    // A same-document replaceState to the same URL does not manufacture another event.
    await h.emit('history');
    assert.equal((await h.repo.getIntent(intent.id))!.state, 'navigation-dispatched');
    assert.equal((await h.repo.getSnapshot()).conversations[0]!.activity, null);
    await h.emit('completed');
    const committed = (await h.repo.getIntent(intent.id))!;
    assert.equal(committed.state, 'committed'); assert.equal(committed.confirmationBasis, 'browser-navigation');
    const record = (await h.repo.getSnapshot()).conversations[0]!;
    assert.equal(record.key, h.record.key); assert.equal(record.owner.kind, 'unassigned');
    assert.equal(record.membership.state, 'UNKNOWN'); assert.equal(record.availability, 'unverified');
    assert.equal(record.activity?.lastConfirmedOpenAt, intent.issuedAt);
    await h.emit('completed'); await h.emit('history');
    assert.deepEqual((await h.repo.getSnapshot()).conversations[0]!.activity, record.activity);
  } finally { await h.close(); }
});

test('Local-first repeated Start opens deduplicate the day and persist after closing the tab and repository', async () => {
  const h = await harness();
  try {
    await h.issue('first-day-open'); await h.emit('committed'); await h.emit('completed');
    const first = (await h.repo.getSnapshot()).conversations[0]!;
    h.setFrame({ documentId: 'second-target-doc' });
    await h.issue('second-day-open'); await h.emit('committed'); await h.emit('completed');
    const latest = (await h.repo.getSnapshot()).conversations[0]!;
    assert.equal(latest.key, first.key); assert.equal(latest.activity?.firstConfirmedOpenAt, first.activity?.firstConfirmedOpenAt);
    await h.emit('completed'); await h.emit('history');
    h.setFrame({ documentId: 'reload-doc' }); await h.emit('committed', { transitionType: 'reload' }); await h.emit('completed');
    assert.deepEqual((await h.repo.getSnapshot()).conversations[0]!.activity, latest.activity);
    await h.listeners.removed!(8); h.repo.close();
    const reopened = await createRepository({ indexedDB: h.factory, name: h.name });
    try { assert.deepEqual((await reopened.getSnapshot()).conversations[0]!.activity, latest.activity); }
    finally { reopened.close(); }
    const db = await request(h.factory.open(h.name, 1));
    try {
      const days = await request<any[]>(db.transaction('openDays').objectStore('openDays').getAll());
      assert.equal(days.length, 1); assert.equal(days[0].activityUnit, 1); assert.equal(days[0].recordKey, first.key);
      assert.equal(days[0].lastIntentId, 'second-day-open');
    } finally { db.close(); }
  } finally { await h.close(); }
});

test('Local-first completion without a gesture, after failure, disabled capture, revoked permission or replaced session writes no day', async () => {
  for (const scenario of ['passive', 'failure', 'disabled', 'revoked', 'session', 'wrong-document', 'scope-generation'] as const) {
    const h = await harness();
    try {
      if (scenario !== 'passive') await h.issue(scenario);
      await h.emit('committed');
      if (scenario === 'failure') await h.emit('error');
      if (scenario === 'disabled') await h.repo.setSettings({ captureEnabled: false });
      if (scenario === 'revoked') h.setConnected(false);
      if (scenario === 'session') delete h.saved.browserSession;
      if (scenario === 'wrong-document') h.setFrame({ documentId: 'different-doc' });
      if (scenario === 'scope-generation') await invalidateBindings();
      await h.emit('completed');
      assert.equal((await h.repo.getSnapshot()).conversations.find(c => c.key === h.record.key)!.activity, null, scenario);
    } finally { await h.close(); }
  }
});

test('Local-first capture disabled at the final transaction boundary cannot race an OpenDay write', async () => {
  const h = await harness();
  try {
    await h.issue('capture-race'); await h.emit('committed');
    const commit = h.repo.commitArrival.bind(h.repo);
    h.repo.commitArrival = async input => { await h.repo.setSettings({ captureEnabled: false }); return commit(input); };
    await h.emit('completed');
    assert.equal((await h.repo.getIntent('capture-race'))?.state, 'rejected');
    assert.equal((await h.repo.getSnapshot()).conversations[0]!.activity, null);
  } finally { await h.close(); }
});

test('M0-D blank staging commit and late unrelated navigation error cannot cancel a new Start intent', async () => {
  const h = await harness();
  try {
    await h.issue('blank-first');
    h.setFrame({ documentId: 'blank-doc', url: 'about:blank' }); await h.emit('committed');
    assert.equal((await h.repo.getIntent('blank-first'))!.state, 'navigation-dispatched');
    await h.emit('error', { documentId: 'old-document', url: other });
    assert.equal((await h.repo.getIntent('blank-first'))!.state, 'navigation-dispatched');
    h.setFrame({ documentId: 'target-doc', url: target }); await h.emit('committed');
    await h.emit('error', { documentId: 'old-document', url: target });
    assert.equal((await h.repo.getIntent('blank-first'))!.state, 'navigation-dispatched');
    await h.emit('error');
    assert.equal((await h.repo.getIntent('blank-first'))!.rejectionCode, 'navigation-failed');
    await h.issue('failed-before-commit');
    await h.emit('error', { documentId: 'unbound-failure-doc' });
    assert.equal((await h.repo.getIntent('failed-before-commit'))!.state, 'rejected');
    h.setFrame({ documentId: 'automatic-retry-doc' }); await h.emit('committed');
    assert.equal((await h.repo.getIntent('failed-before-commit'))!.targetDocumentId, null);
  } finally { await h.close(); }
});

test('M0-D reload, history traversal, wrong destination and changed document reject pending activity', async () => {
  for (const scenario of ['reload', 'back', 'wrong', 'replaced', 'spa-route'] as const) {
    const h = await harness();
    try {
      await h.issue(scenario);
      if (scenario === 'replaced' || scenario === 'spa-route') await h.emit('committed');
      if (scenario === 'wrong') h.setFrame({ url: other });
      if (scenario === 'replaced') h.setFrame({ documentId: 'replacement-doc' });
      if (scenario === 'spa-route') h.setFrame({ url: `https://chatgpt.com/g/g-p-1234567890abcdef1234567890abcdef/c/${cid}` });
      await h.emit(scenario === 'spa-route' ? 'history' : 'committed', scenario === 'reload' ? { transitionType: 'reload' } : scenario === 'back' ? { transitionQualifiers: ['forward_back'] } : {});
      const intent = (await h.repo.getIntent(scenario))!;
      assert.equal(intent.state, 'rejected', scenario);
      assert.equal((await h.repo.getSnapshot()).conversations.find(c => c.conversationId === cid)!.activity, null);
    } finally { await h.close(); }
  }
});

test('M0-D closed tab and ambiguous pending intents never survive as reusable navigation authority', async () => {
  const h = await harness();
  try {
    await h.issue('ambiguous-a'); await h.issue('ambiguous-b'); await h.emit('committed');
    assert.ok((await h.repo.listIntents()).every(i => i.rejectionCode === 'ambiguous-arrival'));
    await h.issue('closed'); await h.listeners.removed!(8);
    assert.equal((await h.repo.getIntent('closed'))!.state, 'rejected');
    assert.equal((await session()).bindings['8'], undefined);
  } finally { await h.close(); }
});

test('M0-D queued old HELLO cannot restore a binding after scope invalidation', async () => {
  const h = await harness();
  try {
    await session();
    let release!: () => void;
    const hold = new Promise<void>(resolve => { release = resolve; });
    const invalidation = changeSession(async s => { await hold; s.scopeEpoch++; s.bindings = {}; });
    await tick();
    const delayed = bindCurrentDocument({ documentId: 'target-doc', tab: { id: 8 } } as chrome.runtime.MessageSender, target);
    await tick(); release(); await invalidation;
    await assert.rejects(delayed, /STALE_DOCUMENT/);
    assert.deepEqual((await session()).bindings, {});
  } finally { await h.close(); }
});

test('M0-D collector guard rechecks route and scope after awaited live-frame validation', async () => {
  const h = await harness();
  try {
    const collector = { documentId: 'target-doc', tab: { id: 8 } } as chrome.runtime.MessageSender;
    const bound = await bindCurrentDocument(collector, target);
    assert.equal((await requireCurrentBinding(collector, bound)).id, bound.id);
    let release!: () => void, sampled!: () => void;
    const hold = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { sampled = resolve; });
    h.setFrameGate(async () => { sampled(); await hold; });
    const guarded = requireCurrentBinding(collector, bound);
    await started; await invalidateBindings(); release();
    await assert.rejects(guarded, /STALE_DOCUMENT/);
    h.setFrameGate(null);
    const rebound = await bindCurrentDocument(collector, target);
    h.setFrame({ url: other });
    await assert.rejects(requireCurrentBinding(collector, rebound), /STALE_DOCUMENT/);
    h.setFrame({ url: target }); h.setConnected(false);
    await assert.rejects(requireCurrentBinding(collector, rebound), /STALE_DOCUMENT/);
  } finally { await h.close(); }
});

test('M0-D no intent, prerender, stale navigation event and SPA-only route cannot create active-day evidence', async () => {
  const h = await harness();
  try {
    await h.emit('committed');
    const binding = (await session()).bindings['8']!;
    assert.equal((await inspectStartOpenChain(h.repo, binding)).state, 'no-matching-intent');
    await h.issue('spa-only');
    await h.emit('committed', { documentId: 'stale-doc' });
    await h.emit('committed', { documentLifecycle: 'prerender' });
    await h.emit('history');
    assert.equal((await h.repo.getIntent('spa-only'))!.targetDocumentId, null);
    assert.equal((await h.repo.getSnapshot()).conversations[0]!.activity, null);
  } finally { await h.close(); }
});

test('M0-B exact Project SPA route rebinds and notifies collector without becoming a conversation', async () => {
  const h = await harness();
  try {
    await h.issue('leave-for-project'); await h.emit('committed');
    const old = (await session()).bindings['8']!;
    const projectUrl = 'https://chatgpt.com/g/g-p-1234567890abcdef1234567890abcdef/project';
    h.setFrame({ url: projectUrl }); await h.emit('history');
    const next = (await session()).bindings['8']!;
    assert.equal(next.documentId, old.documentId); assert.equal(next.href, projectUrl);
    assert.equal(next.routeEpoch, old.routeEpoch + 1); assert.notEqual(next.id, old.id);
    assert.equal((await h.repo.getIntent('leave-for-project'))!.rejectionCode, 'target-mismatch');
    assert.deepEqual(h.messages.at(-1), { tabId: 8, message: { protocol: 'vaiwl-start-collector/1', command: 'ROUTE' }, options: { documentId: next.documentId } });
    const snapshot = await h.repo.getSnapshot();
    assert.equal(snapshot.conversations.length, 1); assert.equal(snapshot.conversations[0]!.activity, null); assert.equal(snapshot.projects.length, 0);
  } finally { await h.close(); }
});

test('M0-D open-chain inspection rejects the same document with a different persisted route epoch', async () => {
  const h = await harness();
  try {
    await h.issue('inspect-route'); await h.emit('committed');
    const previous = (await session()).bindings['8']!;
    await changeSession(s => { s.bindings['8'] = { ...s.bindings['8']!, id: crypto.randomUUID(), routeEpoch: previous.routeEpoch + 1 }; });
    const current = (await session()).bindings['8']!;
    assert.deepEqual(await inspectStartOpenChain(h.repo, current), { state: 'stale-binding', intentId: null });
    assert.equal((await h.repo.getIntent('inspect-route'))!.state, 'navigation-dispatched');
  } finally { await h.close(); }
});

test('M0-D queued C to Q to C departure invalidates the bound gesture despite the final live URL matching C', async () => {
  const h = await harness();
  try {
    await h.issue('route-detour'); await h.emit('committed');
    await h.emit('history', { documentId: 'unrelated-old-doc', url: other });
    assert.equal((await h.repo.getIntent('route-detour'))!.state, 'navigation-dispatched');
    // The browser has already returned to C before the queued Q event is handled.
    await h.emit('history', { url: other }); await h.emit('history');
    assert.equal((await h.repo.getIntent('route-detour'))!.rejectionCode, 'target-mismatch');
    assert.equal((await inspectStartOpenChain(h.repo, (await session()).bindings['8']!)).state, 'no-matching-intent');
    assert.equal((await h.repo.getSnapshot()).conversations[0]!.activity, null);
  } finally { await h.close(); }
});

test('M0-D delayed unrelated navigation cleanup cannot erase a newer HELLO document binding', async () => {
  const h = await harness();
  const list = h.repo.listIntents.bind(h.repo);
  try {
    await h.emit('committed');
    let release!: () => void, waiting!: () => void;
    const hold = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { waiting = resolve; });
    h.repo.listIntents = async () => { waiting(); await hold; return list(); };
    h.setFrame({ documentId: 'login-doc', url: 'https://chatgpt.com/auth/login' });
    const delayed = h.emit('committed'); await started;
    h.setFrame({ documentId: 'newer-doc', url: target });
    const replacement = await bindCurrentDocument({ documentId: 'newer-doc', tab: { id: 8 } } as chrome.runtime.MessageSender, target);
    release(); await delayed;
    assert.equal((await session()).bindings['8']!.id, replacement.id);
  } finally { h.repo.listIntents = list; await h.close(); }
});

test('O15/O16 injected verified arrival preserves issue date through both New York DST transitions', async () => {
  for (const [issuedAt, arrivedAt, localDate] of [
    ['2026-03-08T06:59:59.000Z', '2026-03-08T07:00:02.000Z', '2026-03-08'],
    ['2026-11-01T05:59:59.000Z', '2026-11-01T06:00:02.000Z', '2026-11-01'],
  ]) {
    const factory = new IDBFactory(), name = crypto.randomUUID(); let clock = issuedAt!;
    const repo = await createRepository({ indexedDB: factory, name, timeZone: 'America/New_York', now: () => clock });
    try {
      await repo.discoverCandidates([{ url: target }]); const record = (await repo.getSnapshot()).conversations[0]!;
      for (let count = 0; count < 2; count++) {
        const intent = await repo.issueIntent({ browserSessionId: 'synthetic-dst-session', targetRecordKey: record.key, evidence: { kind: 'start-gesture', sourceDocumentId: 'synthetic-start-doc', gesture: 'click' }, disposition: 'same-tab', sourceTabId: 1, sourceScopeEpoch: 0 });
        await repo.dispatchIntent(intent.id, intent.browserSessionId, { targetTabId: 1 });
        await repo.bindIntentTarget(intent.id, intent.browserSessionId, { targetTabId: 1, targetDocumentId: 'synthetic-dst-doc', routeEpoch: 1, scopeEpoch: 0 });
        clock = arrivedAt!;
        const result = await repo.commitArrival({ intentId: intent.id, browserSessionId: intent.browserSessionId, targetTabId: 1, targetDocumentId: 'synthetic-dst-doc', routeEpoch: 1, scopeEpoch: 0, conversationId: cid, canonicalUrl: target, scopeKey: null, arrivalConfirmed: true });
        assert.equal(result.state, 'committed');
      }
      const db = await request(factory.open(name, 1));
      const tx = db.transaction('openDays', 'readonly'), done = transactionDone(tx);
      const days = await request<any[]>(tx.objectStore('openDays').getAll()); await done; db.close();
      assert.equal(days.length, 1); assert.equal(days[0].localDate, localDate); assert.equal(days[0].timeZone, 'America/New_York');
      assert.equal(days[0].activityUnit, 1); assert.equal(days[0].firstOpenedAt, issuedAt); assert.equal(days[0].lastOpenedAt, arrivedAt);
    } finally { repo.close(); }
  }
});
