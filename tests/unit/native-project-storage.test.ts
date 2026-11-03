import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { createRepository, type Repository } from '../../src/storage/repository.js';
import { request, STORE_NAMES, transactionDone } from '../../src/storage/db.js';
import { projectCatalog, searchCatalog } from '../../src/domain/projection.js';
import { createFreeViewSession } from '../../src/domain/time.js';

const NOW = '2026-11-03T06:00:00.000Z';
const P = 'g-p-1234567890abcdef1234567890abcdef';
const Q = 'g-p-abcdef1234567890abcdef1234567890';
const PRINCIPAL_A = `principal:${'a'.repeat(64)}`;
const PRINCIPAL_B = `principal:${'b'.repeat(64)}`;
const cid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const url = (n: number) => `https://chatgpt.com/c/${cid(n)}`;
const projectUrl = (id = P) => `https://chatgpt.com/g/${id}/project`;
const observation = (members: number[], id = P, nativeTitle = 'Native research project') => ({
  state: 'candidate', relationBasis: 'linked-native-panel', projectId: id, nativeTitle, canonicalUrl: projectUrl(id),
  members: members.map(n => ({ conversationId: cid(n), nativeTitle: `Conversation ${n}`, canonicalUrl: url(n) })),
});
const context = (overrides: Partial<Parameters<Repository['observeLocalProject']>[1]> = {}) => ({
  browserSessionId: 'browser-session-a', documentId: 'native-document-a', identityGeneration: 0,
  principalKey: PRINCIPAL_A, sourceHref: projectUrl(), routeEpoch: 0, ...overrides,
});
async function setup(factory = new IDBFactory()) {
  const name = crypto.randomUUID(); let now = NOW;
  const repo = await createRepository({ indexedDB: factory, name, now: () => now, timeZone: 'Asia/Shanghai' });
  await repo.setSettings({ captureEnabled: true });
  return { factory, name, repo, setNow: (next: string) => { now = next; } };
}
async function rows(env: { factory: IDBFactory; name: string }, store: string): Promise<any[]> {
  const db = await request(env.factory.open(env.name, 1));
  try {
    const tx = db.transaction(store, 'readonly'), done = transactionDone(tx);
    const values = await request(tx.objectStore(store).getAll()); await done; return values;
  } finally { db.close(); }
}
async function openFromStart(repo: Repository, recordKey: string, n = 1) {
  const intent = await repo.issueIntent({ browserSessionId: 'open-session', targetRecordKey: recordKey,
    evidence: { kind: 'start-gesture', sourceDocumentId: 'start-document', gesture: 'click' },
    disposition: 'same-tab', sourceTabId: 1, sourceScopeEpoch: 0 });
  await repo.dispatchIntent(intent.id, intent.browserSessionId, { targetTabId: 1 });
  await repo.bindIntentTarget(intent.id, intent.browserSessionId, { targetTabId: 1, targetDocumentId: 'arrival-document', routeEpoch: 1, scopeEpoch: 0 });
  const result = await repo.commitArrival({ intentId: intent.id, browserSessionId: intent.browserSessionId,
    targetTabId: 1, targetDocumentId: 'arrival-document', routeEpoch: 1, scopeEpoch: 0,
    conversationId: cid(n), canonicalUrl: url(n), scopeKey: null, arrivalConfirmed: true, confirmationBasis: 'browser-navigation' });
  assert.equal(result.state, 'committed');
}

test('native local Project survives repeated visits, rename, empty observations and reopening without workspace certification', async () => {
  const env = await setup(); let repo = env.repo;
  try {
    await repo.observeLocalProject(observation([]), context());
    const empty = await repo.getSnapshot();
    assert.equal(empty.localProjects!.length, 1); assert.equal(empty.conversations.length, 0);
    const key = empty.localProjects![0]!.key;
    await repo.observeLocalProject(observation([1, 2]), context());
    await repo.observeLocalProject(observation([2, 1]), context({ documentId: 'reloaded-document', routeEpoch: 8 }));
    await repo.observeLocalProject(observation([2], P, 'Renamed project'), context({ browserSessionId: 'new-browser-session', documentId: 'another-document' }));
    await repo.observeLocalProject(observation([], P, 'Renamed project'), context());
    const after = await repo.getSnapshot();
    assert.equal(after.localProjects!.length, 1); assert.equal(after.localProjects![0]!.key, key);
    assert.equal(after.localProjects![0]!.nativeTitle, 'Renamed project');
    assert.equal(after.conversations.length, 2, 'An empty/partial list does not remove previously observed members.');
    assert.ok(after.conversations.every(r => r.localProject?.projectKey === key && r.membership.state === 'UNKNOWN' && r.owner.kind === 'unassigned'));
    assert.equal(after.projects.length, 0); assert.equal(after.scopes.length, 0);
    for (const store of ['witnesses', 'openDays', 'candidateLinks']) assert.deepEqual(await rows(env, store), []);
    repo.close(); repo = await createRepository({ indexedDB: env.factory, name: env.name, now: () => NOW });
    const reopened = await repo.getSnapshot();
    assert.deepEqual(reopened.localProjects, after.localProjects); assert.deepEqual(reopened.conversations, after.conversations);
  } finally { repo.close(); }
});

test('local grouping reuses history identity without transferring its visits, activity, title protection or tombstones', async () => {
  const env = await setup(); const { repo } = env;
  try {
    await repo.discoverCandidates([{ url: url(1), title: 'Original specific history title', titleBasis: 'browser-history', lastVisitAt: '2026-10-20T01:00:00.000Z' },
      { url: url(9), title: 'Removed history', lastVisitAt: '2026-09-01T01:00:00.000Z' }]);
    const initial = await repo.getSnapshot();
    const imported = initial.conversations.find(r => r.conversationId === cid(1))!;
    await openFromStart(repo, imported.key);
    await repo.removeConversation(initial.conversations.find(r => r.conversationId === cid(9))!.key);
    const before = (await repo.getSnapshot()).conversations[0]!, days = await rows(env, 'openDays'), tombstones = await rows(env, 'tombstones');
    const incoming = observation([1, 9]); incoming.members[0]!.nativeTitle = 'ChatGPT';
    await repo.observeLocalProject(incoming, context());
    let after = await repo.getSnapshot(), row = after.conversations.find(r => r.key === before.key)!;
    assert.equal(after.conversations.length, 1, 'Native observation does not resurrect an explicitly removed history row.');
    assert.equal(row.nativeTitle, before.nativeTitle); assert.equal(row.key, before.key);
    assert.equal(row.firstSeenAt, before.firstSeenAt); assert.equal(row.browserLastVisitAt, before.browserLastVisitAt);
    assert.deepEqual(row.owner, before.owner); assert.deepEqual(row.activity, before.activity);
    assert.deepEqual(await rows(env, 'openDays'), days); assert.deepEqual(await rows(env, 'tombstones'), tombstones);
    const relation = row.localProject;
    await repo.discoverCandidates([{ url: url(1), title: 'ChatGPT', titleBasis: 'browser-history', lastVisitAt: '2026-10-21T01:00:00.000Z' }]);
    after = await repo.getSnapshot(); row = after.conversations.find(r => r.key === before.key)!;
    assert.deepEqual(row.localProject, relation); assert.equal(row.nativeTitle, before.nativeTitle);
    assert.deepEqual(row.activity, before.activity); assert.deepEqual(await rows(env, 'openDays'), days);
  } finally { repo.close(); }
});

test('same native IDs under two principals do not share titles, visits, activity or local Project identity', async () => {
  const env = await setup(); const { repo } = env;
  try {
    await repo.discoverCandidates([{ url: url(1), title: 'A history', lastVisitAt: '2026-10-20T01:00:00.000Z' }]);
    await repo.observeLocalProject(observation([1], P, 'Shared display name'), context());
    const first = (await repo.getSnapshot()).conversations[0]!; await openFromStart(repo, first.key);
    const a = (await repo.getSnapshot()).conversations[0]!;
    const other = observation([1], P, 'Shared display name'); other.members[0]!.nativeTitle = 'B conversation title';
    await repo.observeLocalProject(other, context({ principalKey: PRINCIPAL_B, documentId: 'document-b' }));
    const snapshot = await repo.getSnapshot(), b = snapshot.conversations.find(r => r.key !== a.key)!;
    assert.equal(snapshot.localProjects!.length, 2); assert.equal(snapshot.conversations.length, 2);
    assert.deepEqual(snapshot.conversations.find(r => r.key === a.key), a);
    assert.notEqual(b.localProject!.projectKey, a.localProject!.projectKey); assert.notEqual(b.localProject!.boundaryKey, a.localProject!.boundaryKey);
    assert.equal(b.nativeTitle, 'B conversation title'); assert.equal(b.activity, null); assert.equal(b.browserLastVisitAt, null);
    assert.equal(b.membership.state, 'UNKNOWN'); assert.equal(b.owner.kind, 'unassigned');
    assert.equal((await rows(env, 'openDays')).length, 1);
    await repo.observeLocalProject(observation([1], P, 'A renamed project'), context({ documentId: 'a-third-document' }));
    assert.equal((await repo.getSnapshot()).localProjects!.length, 2);
    assert.equal((await repo.getSnapshot()).conversations.find(r => r.key === b.key)!.nativeTitle, 'B conversation title');
  } finally { repo.close(); }
});

test('concurrent first observations from different principals cannot claim the same unassigned row', async () => {
  const env = await setup(); const { repo } = env;
  try {
    await repo.discoverCandidates([{ url: url(1), title: 'Unassigned history', lastVisitAt: '2026-10-20T01:00:00.000Z' }]);
    const historyKey = (await repo.getSnapshot()).conversations[0]!.key;
    await Promise.all([
      repo.observeLocalProject(observation([1]), context()),
      repo.observeLocalProject(observation([1]), context({ principalKey: PRINCIPAL_B, documentId: 'simultaneous-b' })),
    ]);
    const snapshot = await repo.getSnapshot();
    assert.equal(snapshot.conversations.length, 2); assert.equal(snapshot.localProjects!.length, 2);
    assert.equal(snapshot.conversations.filter(r => r.key === historyKey).length, 1);
    assert.equal(snapshot.conversations.filter(r => r.browserLastVisitAt !== null).length, 1);
    assert.equal(new Set(snapshot.conversations.map(r => r.localProject!.boundaryKey)).size, 2);
  } finally { repo.close(); }
});

test('removing a relation already isolated to principal A does not suppress principal B or resurrect A', async () => {
  const env = await setup(); const { repo } = env;
  try {
    await repo.observeLocalProject(observation([1]), context());
    const a = (await repo.getSnapshot()).conversations[0]!;
    await repo.removeConversation(a.key);
    await repo.observeLocalProject(observation([1]), context());
    assert.equal((await repo.getSnapshot()).conversations.length, 0);
    await repo.observeLocalProject(observation([1]), context({ principalKey: PRINCIPAL_B, documentId: 'b-document' }));
    const snapshot = await repo.getSnapshot();
    assert.equal(snapshot.conversations.length, 1, 'A boundary-specific removal must not silently suppress a different principal.');
    const b = snapshot.conversations[0]!;
    assert.notEqual(b.key, a.key); assert.notEqual(b.localProject!.boundaryKey, a.localProject!.boundaryKey);
    assert.equal(b.activity, null); assert.equal(b.browserLastVisitAt, null);
    assert.ok(snapshot.tombstones.some(t => t.key === a.key));
    await repo.restoreConversation(a.key);
    const restored = await repo.getSnapshot();
    assert.equal(restored.conversations.length, 2); assert.deepEqual(restored.conversations.find(r => r.key === b.key), b);
  } finally { repo.close(); }
});

test('unknown identity is stable inside one document generation and isolated across documents, generations and Profiles', async () => {
  const env = await setup(), other = await setup();
  try {
    const unknown = context({ principalKey: null });
    await env.repo.observeLocalProject(observation([1]), unknown);
    const first = (await env.repo.getSnapshot()).localProjects![0]!;
    await env.repo.observeLocalProject(observation([1, 2]), { ...unknown, routeEpoch: 4 });
    assert.equal((await env.repo.getSnapshot()).localProjects!.length, 1);
    assert.equal((await env.repo.getSnapshot()).localProjects![0]!.key, first.key);
    await env.repo.observeLocalProject(observation([1]), { ...unknown, documentId: 'new-unknown-document' });
    await env.repo.observeLocalProject(observation([1]), { ...unknown, identityGeneration: 1 });
    assert.equal((await env.repo.getSnapshot()).localProjects!.length, 3);
    await other.repo.observeLocalProject(observation([1]), unknown);
    assert.notEqual((await other.repo.getSnapshot()).localProjects![0]!.key, first.key);
    assert.notEqual((await other.repo.getSnapshot()).conversations[0]!.key, (await env.repo.getSnapshot()).conversations[0]!.key);
  } finally { env.repo.close(); other.repo.close(); }
});

test('equal Project titles do not merge IDs and conflicting relation replay cannot silently move a conversation', async () => {
  const env = await setup(); const { repo } = env;
  try {
    await repo.observeLocalProject(observation([1], P, 'Same project name'), context());
    await repo.observeLocalProject(observation([2], Q, 'Same project name'), context({ sourceHref: projectUrl(Q), documentId: 'project-q' }));
    const first = await repo.getSnapshot();
    assert.equal(first.localProjects!.length, 2); assert.equal(new Set(first.localProjects!.map(p => p.key)).size, 2);
    const originalKey = first.conversations.find(r => r.conversationId === cid(1))!.key;
    await repo.observeLocalProject(observation([1], Q, 'Same project name'), context({ sourceHref: projectUrl(Q), documentId: 'project-q' }));
    let conflict = (await repo.getSnapshot()).conversations.find(r => r.key === originalKey)!;
    assert.equal(conflict.localProject!.state, 'conflicting'); assert.equal(conflict.membership.state, 'UNKNOWN');
    assert.equal(new Set(conflict.localProject!.conflictingProjectKeys).size, 2);
    await repo.observeLocalProject(observation([1], P, 'Same project name'), context());
    conflict = (await repo.getSnapshot()).conversations.find(r => r.key === originalKey)!;
    assert.equal(conflict.localProject!.state, 'conflicting', 'Replaying an old panel cannot settle an unresolved cross-project conflict.');
    assert.equal((await repo.getSnapshot()).conversations.length, 2);
  } finally { repo.close(); }
});

test('local Project writes are atomic on quota failure and capture revocation, with no partial empty card or member data', async () => {
  const env = await setup(); const { repo } = env;
  try {
    await repo.observeLocalProject(observation([1]), context());
    const before = await repo.getSnapshot(), original = IDBObjectStore.prototype.put;
    let calls = 0;
    IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore['put']>) {
      if (this.name === 'conversations' && ++calls === 2) throw new DOMException('synthetic quota failure', 'QuotaExceededError');
      return original.apply(this, args);
    };
    try { await assert.rejects(repo.observeLocalProject(observation([2, 3], Q, 'New interrupted project'), context({ sourceHref: projectUrl(Q) })), { name: 'QuotaExceededError' }); }
    finally { IDBObjectStore.prototype.put = original; }
    assert.deepEqual(await repo.getSnapshot(), before);
    await repo.setSettings({ captureEnabled: false }); const disabled = await repo.getSnapshot();
    await assert.rejects(repo.observeLocalProject(observation([4]), context()), /PERMISSION_REQUIRED/);
    assert.deepEqual(await repo.getSnapshot(), disabled);
    await repo.setSettings({ captureEnabled: true });
    await repo.observeLocalProject(observation([2, 3], Q), context({ sourceHref: projectUrl(Q) }));
    const after = await repo.getSnapshot(); assert.equal(after.localProjects!.length, 2); assert.equal(after.conversations.length, 3);
  } finally { repo.close(); }
});

test('local Project extension leaves the v1 database readable and existing unrelated stores unchanged', async () => {
  const env = await setup(); const { repo } = env;
  try {
    await repo.discoverCandidates([{ url: url(99), title: 'Unrelated saved history', lastVisitAt: '2026-01-01T01:00:00.000Z' }]);
    await repo.saveShortcut({ label: 'Unrelated saved shortcut', url: 'https://example.org/' });
    const before = await repo.getSnapshot();
    const keepStores = ['scopes', 'projects', 'witnesses', 'candidateLinks', 'openDays', 'openIntents', 'shortcuts', 'tombstones', 'importJobs'];
    const kept = await Promise.all(keepStores.map(store => rows(env, store)));
    const main = (await rows(env, 'settings')).find(row => row.key === 'main');
    await repo.observeLocalProject(observation([]), context());
    const db = await request(env.factory.open(env.name, 1));
    try { assert.equal(db.version, 1); assert.deepEqual([...db.objectStoreNames].sort(), [...STORE_NAMES].sort()); }
    finally { db.close(); }
    assert.deepEqual((await rows(env, 'settings')).find(row => row.key === 'main'), main);
    assert.deepEqual((await repo.getSnapshot()).conversations, before.conversations);
    for (let i = 0; i < keepStores.length; i++) assert.deepEqual(await rows(env, keepStores[i]!), kept[i], keepStores[i]);
    const oldReader = await createRepository({ indexedDB: env.factory, name: env.name });
    try { assert.equal((await oldReader.getSnapshot()).localProfileKey, before.localProfileKey); }
    finally { oldReader.close(); }
  } finally { repo.close(); }
});

test('native local grouping keeps old children with the Project and global search without changing formal membership or activity', async () => {
  const env = await setup(); const { repo } = env;
  try {
    await repo.discoverCandidates([{ url: url(1), title: 'Recent history', lastVisitAt: '2026-11-02T01:00:00.000Z' },
      { url: url(2), title: 'Older history', lastVisitAt: '2026-08-01T01:00:00.000Z' }, { url: url(3), title: 'Undated history' }]);
    await repo.observeLocalProject(observation([1, 2, 3]), context());
    const snapshot = await repo.getSnapshot(), saved = JSON.stringify(snapshot);
    const view = { ...createFreeViewSession({ now: NOW, timeZone: 'Asia/Shanghai' }), selectedScope: 'unassigned', k: 0, now: NOW };
    const projection = projectCatalog(snapshot, view);
    const local = projection.localProjects[0]!;
    assert.equal(projection.localProjects.length, 1); assert.equal(projection.projects.length, 0);
    assert.deepEqual(local.recent.map(r => r.conversationId), [cid(1)]);
    assert.deepEqual(local.older.map(r => r.conversationId), [cid(2)]);
    assert.deepEqual(local.undated.map(r => r.conversationId), [cid(3)]);
    assert.equal(projection.pendingDates.length, 0); assert.equal(projection.unknown.length, 0);
    assert.equal(projectCatalog(snapshot, { ...view, k: 3 }).localProjects.length, 0);
    const found = searchCatalog(snapshot, 'Native research project', 'unassigned');
    assert.equal(found.length, 3); assert.ok(found.every(r => r.project === null));
    assert.equal(JSON.stringify(snapshot), saved); assert.ok(snapshot.conversations.every(r => r.membership.state === 'UNKNOWN' && r.activity === null));
  } finally { repo.close(); }
});
