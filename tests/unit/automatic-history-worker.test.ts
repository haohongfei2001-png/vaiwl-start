/** Real worker entrypoint + Repository, with disposable Chrome ports and IDB.
 * These tests do not claim browser permission-prompt or live-source acceptance. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { Repository, createRepository } from '../../src/storage/repository.js';
import { changeSession } from '../../src/background/session.js';

const tick = () => new Promise<void>(resolve => setImmediate(resolve));
const cid = (n: number) => `85000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const url = (n: number) => `https://chatgpt.com/c/${cid(n)}`;
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
async function boundedWait(work: Promise<void>, label: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([work, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error('Worker did not reach ' + label)), 3000); })]);
  } finally { clearTimeout(timer); }
}
async function eventually(check: () => boolean | Promise<boolean>, label: string) {
  for (let n = 0; n < 500; n++) { if (await check()) return; await tick(); }
  assert.fail('Worker condition did not settle: ' + label);
}
type Listener = (...args: any[]) => unknown;
type Envelope = { ok: boolean; code?: string; data?: any };

async function harness() {
  const previous = { chrome: globalThis.chrome, indexedDB: globalThis.indexedDB, fetch: globalThis.fetch };
  const factory = new IDBFactory(), storedSession: Record<string, unknown> = {};
  const connections = new Set<Repository>(), originalMethods = new Map<string, Function>();
  let listeners = new Map<string, Listener[]>(), historyGranted = true, connected = true;
  let activity = 0, pendingRepository = 0, visits = 0, searches = 0;
  let visitHook: (() => Promise<void>) | null = null;
  let searchHook: (() => Promise<void>) | null = null;
  let beforeCommit: (() => Promise<void>) | null = null;
  let rows: Array<{ url: string; title: string; lastVisitTime: number }> = [];
  const releases: Array<() => void> = [];

  // Observe real asynchronous completion, and optionally delay a call before
  // invoking its original implementation. No production transaction is mocked.
  for (const name of Object.getOwnPropertyNames(Repository.prototype)) {
    if (name === 'constructor' || name === 'close') continue;
    const original = (Repository.prototype as any)[name];
    if (typeof original !== 'function') continue;
    originalMethods.set(name, original);
    (Repository.prototype as any)[name] = function(this: Repository, ...args: any[]) {
      connections.add(this); activity++; pendingRepository++;
      const invoke = () => original.apply(this, args);
      let result: any;
      try {
        const hook = name === 'commitAutomaticHistory' ? beforeCommit : null;
        result = hook ? hook().then(invoke) : invoke();
      } catch (error) { pendingRepository--; activity++; throw error; }
      if (result && typeof result.then === 'function') return result.finally(() => { pendingRepository--; activity++; });
      pendingRepository--; activity++; return result;
    };
  }

  function installPorts() {
    const currentListeners = listeners;
    const event = (name: string) => ({ addListener: (callback: Listener) => currentListeners.set(name, [...(currentListeners.get(name) ?? []), callback]) });
    Object.assign(globalThis, { indexedDB: factory,
      fetch: async () => new Response(JSON.stringify({ sha: 'synthetic-worker-harness', version: '0.1.0', dirty: false })),
      chrome: {
        runtime: { id: 'automatic-history-test', getURL: (path: string) => 'chrome-extension://automatic-history-test/' + path,
          sendMessage: async () => { activity++; }, onMessage: event('message'), onInstalled: event('installed'), onStartup: event('startup') },
        action: { onClicked: event('action') },
        permissions: { contains: async (permission: chrome.permissions.Permissions) => {
          activity++; return permission.permissions?.includes('history') ? historyGranted : connected;
        }, onAdded: event('permission-added'), onRemoved: event('permission-removed') },
        history: { onVisited: event('visited'), getVisits: async () => {
          visits++; activity++; if (visitHook) await visitHook(); activity++; return [{ isLocal: true }];
        }, search: async () => { searches++; activity++; if (searchHook) await searchHook(); activity++; return structuredClone(rows); } },
        storage: { session: {
          get: async (key: string) => { activity++; return { [key]: structuredClone(storedSession[key]) }; },
          set: async (patch: Record<string, unknown>) => { activity++; Object.assign(storedSession, structuredClone(patch)); },
          remove: async (keys: string | string[]) => { activity++; for (const key of Array.isArray(keys) ? keys : [keys]) delete storedSession[key]; },
        }, local: { remove: async () => { activity++; } } },
        scripting: { getRegisteredContentScripts: async () => [], registerContentScripts: async () => {}, unregisterContentScripts: async () => {} },
        tabs: { query: async () => [], sendMessage: async () => {}, create: async () => ({ id: 3 }) },
      },
    });
  }
  installPorts();
  const repo = await createRepository(); connections.add(repo);
  async function loadWorker() {
    await import(new URL('../../src/background/service-worker.ts?automaticHistory=' + crypto.randomUUID(), import.meta.url).href);
    assert.equal(listeners.get('visited')?.length, 1);
  }
  await loadWorker();
  async function settle() {
    let quiet = 0, last = activity;
    for (let attempt = 0; attempt < 1000; attempt++) {
      await tick();
      if (pendingRepository === 0 && activity === last) quiet++; else quiet = 0;
      if (quiet === 8) return;
      last = activity;
    }
    assert.fail('Worker operations remained pending');
  }
  async function rawCommand(command: string, payload: unknown = {}): Promise<Envelope> {
    const snapshot = await repo.getSnapshot();
    return new Promise(resolve => listeners.get('message')![0]!({ protocol: 'vaiwl-start-internal/1',
      operationId: crypto.randomUUID(), expectedRevision: snapshot.revision, command, payload }, {
      id: 'automatic-history-test', url: 'chrome-extension://automatic-history-test/newtab.html',
      frameId: 0, documentId: 'isolated-start-document', documentLifecycle: 'active', tab: { id: 1 },
    }, resolve));
  }
  async function command(name: string, payload: unknown = {}) {
    const result = await rawCommand(name, payload); assert.equal(result.ok, true, name + ': ' + result.code); return result.data;
  }
  const capture = (enabled: boolean) => command('SETTINGS_UPDATE', { patch: { captureEnabled: enabled } });
  const emit = (name: string, value: unknown) => { for (const callback of listeners.get(name) ?? []) callback(value); };
  const item = (n: number, title = 'Automatic ' + n, lastVisitTime = Date.now() - 1000) => ({ url: url(n), title, lastVisitTime });
  const visit = (n: number, title?: string, lastVisitTime?: number) => emit('visited', item(n, title, lastVisitTime));
  const permission = (kind: 'history' | 'connection', granted: boolean) => {
    if (kind === 'history') historyGranted = granted; else connected = granted;
    emit(granted ? 'permission-added' : 'permission-removed', kind === 'history' ? { permissions: ['history'] } : { origins: ['https://chatgpt.com/*'], permissions: ['scripting', 'webNavigation'] });
  };
  function hold(kind: 'visit' | 'search' | 'commit') {
    const entered = deferred(), gate = deferred(); releases.push(gate.resolve);
    const hook = async () => { entered.resolve(); await gate.promise; };
    if (kind === 'visit') visitHook = hook;
    else if (kind === 'search') searchHook = hook;
    else { assert.ok(originalMethods.has('commitAutomaticHistory'), 'Production automatic-admission path exists'); beforeCommit = hook; }
    return { get entered() { return boundedWait(entered.promise, kind + ' boundary'); }, release: () => {
      if (kind === 'visit') visitHook = null; else if (kind === 'search') searchHook = null; else beforeCommit = null;
      gate.resolve();
    } };
  }
  async function rebootWorker() {
    const previousVisit = listeners.get('visited')![0]!;
    listeners = new Map(); installPorts(); await loadWorker();
    // SNAPSHOT waits for the new worker's repository/session initialization.
    await command('SNAPSHOT'); return previousVisit;
  }
  async function close() {
    for (const release of releases) release(); visitHook = searchHook = beforeCommit = null;
    try { await settle(); await changeSession(() => {}); }
    finally {
      for (const [name, original] of originalMethods) (Repository.prototype as any)[name] = original;
      for (const connection of connections) connection.close();
      Object.assign(globalThis, previous);
    }
  }
  await command('SNAPSHOT');
  return { repo, command, rawCommand, capture, visit, permission, hold, settle, rebootWorker, close, item,
    rows: (value: typeof rows) => { rows = value; }, get visits() { return visits; }, get searches() { return searches; } };
}

test('AH-W enabled automatic history writes a real candidate without activity or formal membership', async () => {
  const h = await harness();
  try {
    await h.capture(true); h.visit(1); await h.settle();
    const rows = (await h.repo.getSnapshot()).conversations;
    assert.equal(rows.length, 1); assert.equal(rows[0]!.conversationId, cid(1));
    assert.equal(rows[0]!.nativeTitle, 'Automatic 1'); assert.equal(rows[0]!.activity, null);
    assert.equal(rows[0]!.membership.state, 'UNKNOWN'); assert.equal(h.visits, 1);
  } finally { await h.close(); }
});

test('AH-W paused continuous capture cannot be bypassed by retained history permission', async () => {
  const h = await harness();
  try {
    await h.capture(true); await h.capture(false); h.visit(2); await h.settle();
    const snapshot = await h.repo.getSnapshot();
    assert.equal(snapshot.settings.captureEnabled, false); assert.equal(snapshot.conversations.length, 0);
    assert.equal(h.visits, 0, 'Disabled automatic capture must not read visit metadata');
  } finally { await h.close(); }
});

test('AH-W disconnected ChatGPT cannot be bypassed by retained history permission', async () => {
  const h = await harness();
  try {
    await h.capture(true); h.permission('connection', false); await h.settle(); h.visit(3); await h.settle();
    assert.equal((await h.repo.getSnapshot()).conversations.length, 0); assert.equal(h.visits, 0);
  } finally { await h.close(); }
});

test('AH-W history revocation discards an already pending getVisits result', async () => {
  const h = await harness();
  try {
    await h.capture(true); const read = h.hold('visit'); h.visit(4); await read.entered;
    h.permission('history', false); read.release(); await h.settle();
    assert.equal((await h.repo.getSnapshot()).conversations.length, 0);
  } finally { await h.close(); }
});

test('AH-W pause then resume rejects old automatic work and accepts a new visit', async () => {
  const h = await harness();
  try {
    await h.capture(true); const read = h.hold('visit'); h.visit(5); await read.entered;
    await h.capture(false); await h.capture(true); read.release(); await h.settle();
    assert.equal((await h.repo.getSnapshot()).conversations.length, 0);
    h.visit(6); await h.settle();
    assert.deepEqual((await h.repo.getSnapshot()).conversations.map(row => row.conversationId), [cid(6)]);
  } finally { await h.close(); }
});

test('AH-W history revoke then regrant never revives the old automatic batch', async () => {
  const h = await harness();
  try {
    await h.capture(true); const read = h.hold('visit'); h.visit(7); await read.entered;
    h.permission('history', false); h.permission('history', true); read.release(); await h.settle();
    assert.equal((await h.repo.getSnapshot()).conversations.length, 0);
    h.visit(8); await h.settle(); assert.equal((await h.repo.getSnapshot()).conversations[0]!.conversationId, cid(8));
  } finally { await h.close(); }
});

test('AH-W connection revoke then reconnect discards a pending automatic result', async () => {
  const h = await harness();
  try {
    await h.capture(true); const read = h.hold('visit'); h.visit(9); await read.entered;
    h.permission('connection', false); h.permission('connection', true); read.release(); await h.settle();
    assert.equal((await h.repo.getSnapshot()).conversations.length, 0);
    h.visit(10); await h.settle(); assert.equal((await h.repo.getSnapshot()).conversations[0]!.conversationId, cid(10));
  } finally { await h.close(); }
});

test('AH-W consecutive permission and capture transitions preserve only newly authorized visits', async () => {
  const h = await harness();
  try {
    await h.capture(true); const read = h.hold('visit'); h.visit(11); await read.entered;
    await h.capture(false); h.permission('history', false); h.permission('connection', false);
    h.permission('history', true); h.permission('connection', true); await h.capture(true);
    read.release(); await h.settle(); assert.equal((await h.repo.getSnapshot()).conversations.length, 0);
    h.visit(12); await h.settle(); assert.equal((await h.repo.getSnapshot()).conversations[0]!.conversationId, cid(12));
  } finally { await h.close(); }
});

test('AH-W final automatic transaction rejects a pause and resume after history metadata was read', async () => {
  const h = await harness();
  try {
    await h.capture(true); const commit = h.hold('commit'); h.visit(13); await commit.entered;
    assert.equal(h.visits, 1); await h.capture(false); await h.capture(true);
    commit.release(); await h.settle(); assert.equal((await h.repo.getSnapshot()).conversations.length, 0);
    h.visit(14); await h.settle(); assert.equal((await h.repo.getSnapshot()).conversations[0]!.conversationId, cid(14));
  } finally { await h.close(); }
});

test('AH-W replacement worker invalidates both an old pending batch and its stale callback', async () => {
  const h = await harness();
  try {
    await h.capture(true); const read = h.hold('visit'); h.visit(15); await read.entered;
    const obsoleteCallback = await h.rebootWorker(); read.release(); await h.settle();
    obsoleteCallback(h.item(16)); await h.settle();
    assert.equal((await h.repo.getSnapshot()).conversations.length, 0);
    h.visit(17); await h.settle(); assert.equal((await h.repo.getSnapshot()).conversations[0]!.conversationId, cid(17));
  } finally { await h.close(); }
});

test('AH-W rejected automatic history cannot overwrite an existing title, visit date or activity', async () => {
  const h = await harness();
  try {
    await h.capture(true); h.visit(18, 'Original local title', Date.now() - 86400000); await h.settle();
    const before = (await h.repo.getSnapshot()).conversations;
    const read = h.hold('visit'); h.visit(18, 'Late replacement title', Date.now() - 100); await read.entered;
    await h.capture(false); read.release(); await h.settle();
    assert.deepEqual((await h.repo.getSnapshot()).conversations, before);
  } finally { await h.close(); }
});

test('AH-W explicit history import remains available while automatic capture and ChatGPT connection are off', async () => {
  const h = await harness();
  try {
    h.permission('connection', false); await h.settle();
    h.rows([h.item(19, 'Explicitly imported')]);
    const started = await h.command('IMPORT_START', { range: 'all', includeSynced: false });
    await h.command('IMPORT_STEP', { jobId: started.jobId });
    const snapshot = await h.repo.getSnapshot();
    assert.equal(snapshot.settings.captureEnabled, false); assert.equal(snapshot.conversations.length, 1);
    assert.equal(snapshot.conversations[0]!.nativeTitle, 'Explicitly imported'); assert.equal(h.searches, 1);
  } finally { await h.close(); }
});

for (const action of ['IMPORT_PAUSE', 'IMPORT_CANCEL', 'history-revoke'] as const) {
  test('AH-W pending explicit import cannot overwrite ' + action, async () => {
    const h = await harness();
    try {
      h.rows([h.item(20, 'Must remain uncommitted')]);
      const started = await h.command('IMPORT_START', { range: 'all', includeSynced: false });
      const query = h.hold('search'); const result = h.rawCommand('IMPORT_STEP', { jobId: started.jobId }); await query.entered;
      const expected = action === 'IMPORT_PAUSE' ? 'paused' : action === 'IMPORT_CANCEL' ? 'cancelled' : 'permission-revoked';
      if (action === 'history-revoke') {
        h.permission('history', false);
        await eventually(async () => (await h.repo.getSnapshot()).importJobs.find(job => job.id === started.jobId)?.state === expected, 'history revocation persisted');
      } else await h.command(action, { jobId: started.jobId });
      query.release(); const response = await result; await h.settle();
      assert.equal(response.ok, false); assert.equal(response.code, 'revision-conflict');
      const snapshot = await h.repo.getSnapshot();
      assert.equal(snapshot.importJobs.find(job => job.id === started.jobId)!.state, expected);
      assert.equal(snapshot.conversations.length, 0);
    } finally { await h.close(); }
  });
}
