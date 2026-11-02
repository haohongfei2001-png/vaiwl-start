import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { createRepository } from '../../src/storage/repository.js';
import { request } from '../../src/storage/db.js';

const pid = 'g-p-1234567890abcdef1234567890abcdef';
const projectUrl = `https://chatgpt.com/g/${pid}/project`;
const cid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const url = (n: number) => `https://chatgpt.com/c/${cid(n)}`;
const observation = (members: number[]) => ({ state: 'candidate', relationBasis: 'linked-native-panel', projectId: pid, nativeTitle: 'Synthetic local project', canonicalUrl: projectUrl, members: members.map(n => ({ conversationId: cid(n), nativeTitle: `Synthetic ${n}`, canonicalUrl: url(n) })) });
const binding = (observationId: string, bindingId = 'document-a') => ({ browserSessionId: 'synthetic-session', bindingId, observationId, sourceHref: projectUrl });

test('Local-first Project observation preserves imported IDs and dates, never creating ownership, membership or activity', async () => {
  const factory = new IDBFactory(), name = crypto.randomUUID();
  let repo = await createRepository({ indexedDB: factory, name, timeZone: 'Asia/Shanghai' });
  try {
    await repo.setSettings({ captureEnabled: true });
    await repo.discoverCandidates([1, 2].map(n => ({ url: url(n), title: `History ${n}`, lastVisitAt: '2026-10-20T01:00:00.000Z' })));
    const before = await repo.getSnapshot();
    assert.equal(await repo.observeLocalProjectCandidate(observation([1, 2]), binding('first')), 2);
    const after = await repo.getSnapshot();
    assert.deepEqual(after.conversations.map(r => r.key), before.conversations.map(r => r.key));
    assert.ok(after.conversations.every(r => r.owner.kind === 'unassigned' && r.membership.state === 'UNKNOWN' && !r.activity && r.browserLastVisitAt === '2026-10-20T01:00:00.000Z'));
    assert.equal(new Set(after.conversations.map(r => r.localProjectCandidate!.key)).size, 1);
    assert.equal(after.projects.length, 0); assert.equal(after.scopes.length, 0);
    await repo.discoverCandidates([{ url: url(1), title: 'Later browser history', lastVisitAt: '2026-10-21T01:00:00.000Z' }]);
    assert.equal((await repo.getSnapshot()).conversations[0]!.localProjectCandidate!.key, after.conversations[0]!.localProjectCandidate!.key);
    repo.close(); repo = await createRepository({ indexedDB: factory, name });
    assert.equal((await repo.getSnapshot()).conversations.length, 2);
    const db = await request(factory.open(name, 1));
    try { assert.equal(await request(db.transaction('openDays').objectStore('openDays').count()), 0); }
    finally { db.close(); }
  } finally { repo.close(); }
});

test('Local-first Project candidate groups cannot merge across documents, observations or Profiles', async () => {
  const factory = new IDBFactory();
  const repo = await createRepository({ indexedDB: factory, name: crypto.randomUUID() });
  const other = await createRepository({ indexedDB: factory, name: crypto.randomUUID() });
  try {
    await repo.setSettings({ captureEnabled: true }); await other.setSettings({ captureEnabled: true });
    await repo.observeLocalProjectCandidate(observation([1, 2]), binding('account-a'));
    const a = (await repo.getSnapshot()).conversations[0]!.localProjectCandidate!.key;
    await repo.observeLocalProjectCandidate(observation([3]), binding('account-b'));
    await repo.observeLocalProjectCandidate(observation([4]), binding('account-a', 'document-b'));
    await other.observeLocalProjectCandidate(observation([1]), binding('account-a'));
    const all = (await repo.getSnapshot()).conversations;
    assert.equal(new Set(all.map(r => r.localProjectCandidate!.key)).size, 3);
    assert.notEqual((await other.getSnapshot()).conversations[0]!.localProjectCandidate!.key, a);
    assert.ok(all.every(r => r.owner.kind === 'unassigned' && r.membership.state === 'UNKNOWN'));
    const deleted = all[0]!; await repo.removeConversation(deleted.key);
    await repo.observeLocalProjectCandidate(observation([1]), binding('after-delete'));
    assert.equal((await repo.getSnapshot()).conversations.some(r => r.key === deleted.key), false);
    await repo.setSettings({ captureEnabled: false });
    await assert.rejects(repo.observeLocalProjectCandidate(observation([5]), binding('disabled')), /PERMISSION_REQUIRED/);
  } finally { repo.close(); other.close(); }
});
