import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { createRepository, type Repository } from '../../src/storage/repository.js';
import { request, STORE_NAMES, transactionDone } from '../../src/storage/db.js';

const NOW = '2026-11-03T12:00:00.000Z';
const visit = (n: number) => ({ url: `https://chatgpt.com/c/93000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  title: `Automatic visit ${n}`, lastVisitAt: NOW, titleBasis: 'browser-history' as const, source: 'local' as const });

async function setup(enabled = true) {
  const factory = new IDBFactory(), name = crypto.randomUUID();
  const repo = await createRepository({ indexedDB: factory, name, now: () => NOW, timeZone: 'Asia/Shanghai' });
  if (enabled) await repo.setSettings({ captureEnabled: true });
  return { factory, name, repo };
}
async function rows(env: { factory: IDBFactory; name: string }, store: string): Promise<any[]> {
  const db = await request(env.factory.open(env.name, 1));
  try {
    const tx = db.transaction(store, 'readonly'), done = transactionDone(tx);
    const result = await request(tx.objectStore(store).getAll()); await done; return result;
  } finally { db.close(); }
}
async function grant(repo: Repository, workerId = 'worker-a') {
  const authorization = await repo.beginAutomaticHistory(workerId);
  assert.ok(authorization); return authorization;
}

test('automatic history: an idle worker preserves the existing v1 stores and explicit import works while capture is off', async () => {
  const env = await setup(false), { repo } = env;
  try {
    const before = await rows(env, 'settings'), snapshot = await repo.getSnapshot();
    await repo.startAutomaticHistorySession('worker-a');
    assert.equal(await repo.beginAutomaticHistory('worker-a'), null);
    await repo.invalidateAutomaticHistory();
    assert.deepEqual(await rows(env, 'settings'), before);
    assert.equal((await repo.getSnapshot()).revision, snapshot.revision);
    const db = await request(env.factory.open(env.name, 1));
    assert.equal(db.version, 1); assert.deepEqual([...db.objectStoreNames].sort(), [...STORE_NAMES].sort()); db.close();
    assert.deepEqual(await repo.discoverCandidates([visit(1)], snapshot.revision), { accepted: 1, inserted: 1 });
    assert.equal((await repo.getSnapshot()).conversations.length, 1);
  } finally { repo.close(); }
});

test('automatic history: authorization is private, rotates without catalog revision churn, and rejects an old batch', async () => {
  const env = await setup(), { repo } = env;
  try {
    const initial = await repo.getSnapshot();
    await repo.startAutomaticHistorySession('worker-a');
    const first = await grant(repo);
    assert.deepEqual(await grant(repo), first);
    assert.equal((await repo.getSnapshot()).revision, initial.revision);
    assert.equal(JSON.stringify(await repo.getSnapshot()).includes(first.generation), false);
    assert.deepEqual(await repo.commitAutomaticHistory([visit(1)], first, () => true), { accepted: 1, inserted: 1 });
    const before = await repo.getSnapshot();
    await repo.invalidateAutomaticHistory();
    const second = await grant(repo);
    assert.notEqual(second.generation, first.generation);
    assert.equal((await repo.getSnapshot()).revision, before.revision);
    await assert.rejects(repo.commitAutomaticHistory([visit(2)], first, () => true), /AUTOMATIC_HISTORY_STALE/);
    assert.deepEqual(await repo.getSnapshot(), before);
    assert.deepEqual(await repo.commitAutomaticHistory([visit(2)], second, () => true), { accepted: 1, inserted: 1 });
  } finally { repo.close(); }
});

test('automatic history: pause then resume cannot lend the new capture authorization to an old read', async () => {
  const { repo } = await setup();
  try {
    await repo.startAutomaticHistorySession('worker-a'); const old = await grant(repo);
    await repo.setSettings({ captureEnabled: false });
    assert.equal(await repo.beginAutomaticHistory('worker-a'), null);
    await repo.setSettings({ captureEnabled: true });
    await assert.rejects(repo.commitAutomaticHistory([visit(1)], old, () => true), /AUTOMATIC_HISTORY_STALE/);
    assert.equal((await repo.getSnapshot()).conversations.length, 0);
    const current = await grant(repo); assert.notEqual(current.generation, old.generation);
    await repo.commitAutomaticHistory([visit(2)], current, () => true);
    assert.equal((await repo.getSnapshot()).conversations[0]!.nativeTitle, 'Automatic visit 2');
  } finally { repo.close(); }
});

test('automatic history: a replacement worker invalidates old authorizations and the old worker cannot reacquire them', async () => {
  const env = await setup(), { repo } = env;
  const replacement = await createRepository({ indexedDB: env.factory, name: env.name, now: () => NOW });
  try {
    await repo.startAutomaticHistorySession('worker-a'); const old = await grant(repo);
    const revision = (await repo.getSnapshot()).revision;
    await replacement.startAutomaticHistorySession('worker-b');
    assert.equal((await replacement.getSnapshot()).revision, revision);
    assert.equal(await repo.beginAutomaticHistory('worker-a'), null);
    await assert.rejects(repo.commitAutomaticHistory([visit(1)], old, () => true), /AUTOMATIC_HISTORY_STALE/);
    await replacement.commitAutomaticHistory([visit(2)], await grant(replacement, 'worker-b'), () => true);
    assert.equal((await repo.getSnapshot()).conversations.length, 1);
  } finally { repo.close(); replacement.close(); }
});

test('automatic history: clearing and re-enabling cannot write a previous Profile batch into the new catalog', async () => {
  const { repo } = await setup();
  try {
    await repo.startAutomaticHistorySession('worker-a'); const old = await grant(repo);
    await repo.clearLocalData(); await repo.setSettings({ captureEnabled: true });
    const current = await grant(repo);
    assert.notEqual(current.localProfileKey, old.localProfileKey);
    await assert.rejects(repo.commitAutomaticHistory([visit(1)], old, () => true), /AUTOMATIC_HISTORY_STALE/);
    assert.equal((await repo.getSnapshot()).conversations.length, 0);
    await repo.commitAutomaticHistory([visit(2)], current, () => true);
  } finally { repo.close(); }
});

test('automatic history: a permission epoch changed while hashing prevents the prepared batch from opening a write transaction', async () => {
  const { repo } = await setup();
  const originalDigest = crypto.subtle.digest;
  let release!: () => void, entered!: () => void, current = true;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  try {
    await repo.startAutomaticHistorySession('worker-a'); const authorization = await grant(repo);
    crypto.subtle.digest = async function (...args: Parameters<SubtleCrypto['digest']>) {
      const result = await originalDigest.apply(this, args); entered(); await gate; return result;
    };
    const work = repo.commitAutomaticHistory([visit(1)], authorization, () => current);
    const rejected = assert.rejects(work, /AUTOMATIC_HISTORY_STALE/);
    await started; current = false; release(); await rejected;
    assert.equal((await repo.getSnapshot()).conversations.length, 0);
  } finally { release(); crypto.subtle.digest = originalDigest; repo.close(); }
});

for (const lastStore of ['conversations', 'revisions']) {
  test(`automatic history: revoke after a successful ${lastStore} write synchronously aborts the whole transaction`, async () => {
    const env = await setup(), { repo } = env;
    const originalPut = IDBObjectStore.prototype.put;
    let invalidation: Promise<void> | undefined, once = false;
    try {
      await repo.startAutomaticHistorySession('worker-a'); const authorization = await grant(repo);
      const before = await repo.getSnapshot(), ranks = await rows(env, 'revisions');
      IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore['put']>) {
        const result = originalPut.apply(this, args);
        if (this.name === lastStore && !once) {
          once = true;
          result.addEventListener('success', () => { invalidation = repo.invalidateAutomaticHistory(); }, { once: true });
        }
        return result;
      };
      await assert.rejects(repo.commitAutomaticHistory([visit(1)], authorization, () => true));
      assert.ok(invalidation); await invalidation;
      assert.deepEqual(await repo.getSnapshot(), before);
      assert.deepEqual(await rows(env, 'revisions'), ranks, 'Neither rank allocation nor the last revision write may survive abort.');
      await assert.rejects(repo.commitAutomaticHistory([visit(1)], authorization, () => true), /AUTOMATIC_HISTORY_STALE/);
    } finally { IDBObjectStore.prototype.put = originalPut; repo.close(); }
  });
}

test('automatic history: pausing inside an active write aborts it before the settings transaction can wait on its lock', async () => {
  const { repo } = await setup();
  const originalPut = IDBObjectStore.prototype.put;
  let pause: Promise<void> | undefined, once = false;
  try {
    await repo.startAutomaticHistorySession('worker-a'); const authorization = await grant(repo);
    IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore['put']>) {
      const result = originalPut.apply(this, args);
      if (this.name === 'conversations' && !once) {
        once = true;
        result.addEventListener('success', () => { pause = repo.setSettings({ captureEnabled: false }); }, { once: true });
      }
      return result;
    };
    await assert.rejects(repo.commitAutomaticHistory([visit(1)], authorization, () => true));
    assert.ok(pause); await pause;
    assert.equal((await repo.getSnapshot()).conversations.length, 0);
    assert.equal((await repo.getSnapshot()).settings.captureEnabled, false);
    await repo.setSettings({ captureEnabled: true });
    await assert.rejects(repo.commitAutomaticHistory([visit(1)], authorization, () => true), /AUTOMATIC_HISTORY_STALE/);
  } finally { IDBObjectStore.prototype.put = originalPut; repo.close(); }
});
