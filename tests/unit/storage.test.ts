import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { createRepository, type ArrivalInput, type Repository, type RuntimeImportJob } from '../../src/storage/repository.js';
import { conversationKey, scopeKey, stagingKey } from '../../src/domain/ids.js';
import { searchCatalog } from '../../src/domain/projection.js';
import { createHistoryJob, stepHistoryImport, type HistoryPort } from '../../src/background/import-history.js';
import { openDatabase, request, STORE_NAMES, transactionDone } from '../../src/storage/db.js';
import type { AccountScope, EvidenceWitness, OpenIntent } from '../../contracts/free-v1.js';
const CID = '12345678-abcd-1234-abcd-123456789abc';
const URL = `https://chatgpt.com/c/${CID}`;
async function setup(start = '2026-11-02T00:00:00.000Z') {
  const factory = new IDBFactory(); let now = start;
  const repo = await createRepository({ indexedDB: factory, now: () => now, timeZone: 'Asia/Shanghai' });
  return { factory, repo, setNow: (value: string) => { now = value; }, clock: () => now };
}
async function candidate(repo: Repository, url = URL) { await repo.discoverCandidates([{ url, title: '<b>A title</b>', lastVisitAt: '2025-06-01T00:00:00Z', source: 'local' }]); const snap = await repo.getSnapshot('unassigned'); return snap.conversations.find(r => r.canonicalUrl === url)!; }
async function issue(repo: Repository, key: string, overrides: Partial<Parameters<Repository['issueIntent']>[0]> = {}): Promise<OpenIntent> {
  return repo.issueIntent({ browserSessionId: 'session-1', targetRecordKey: key, evidence: { kind: 'start-gesture', sourceDocumentId: 'start-doc', gesture: 'click' }, disposition: 'same-tab', sourceTabId: 1, sourceScopeEpoch: 0, ...overrides });
}
async function binding(repo: Repository, intent: OpenIntent, tab = 1, doc = 'arrival-doc') { await repo.dispatchIntent(intent.id, intent.browserSessionId, { targetTabId: tab }); await repo.bindIntentTarget(intent.id, intent.browserSessionId, { targetTabId: tab, targetDocumentId: doc, routeEpoch: 1, scopeEpoch: 0 }); }
const arrive = (intent: OpenIntent, overrides: Partial<ArrivalInput> = {}): ArrivalInput => ({ intentId: intent.id, browserSessionId: intent.browserSessionId, targetTabId: 1, targetDocumentId: 'arrival-doc', routeEpoch: 1, scopeEpoch: 0, conversationId: CID, canonicalUrl: URL, scopeKey: null, arrivalConfirmed: true, ...overrides });
async function identity(repo: Repository, principal = 'principal-a', cid = CID, doc = 'arrival-doc') {
  const key = await scopeKey(principal, 'context-a'), now = '2026-11-02T00:00:00.000Z';
  const witness: EvidenceWitness = { id: `identity-${principal}`, kind: 'verified-session-context', adapterId: 'test-only-fixture', adapterVersion: '1', scopeKey: key, documentId: doc, routeEpoch: 1, scopeEpoch: 0, observedAt: now, sourceRevision: 1, sourceDomain: 'verified-context', fields: ['identity'], revoked: false };
  const scope: AccountScope = { key, provider: 'chatgpt', principalKey: principal, contextKey: 'context-a', identity: 'verified', label: 'Fixture library', verifiedAt: now, identityAdapterVersion: '1', contextWitnessId: witness.id, state: 'ready' };
  await repo.confirmObservation({ scope, witness, documentId: doc, routeEpoch: 1, scopeEpoch: 0, conversationUrl: `https://chatgpt.com/c/${cid}`, nativeTitle: 'Scoped title', membership: { state: 'UNKNOWN', projectId: null, reason: 'no-membership-source' } });
  return { scope, witness };
}
async function rows(factory: IDBFactory, store: string): Promise<any[]> { const db = await openDatabase(factory); const tx = db.transaction(store, 'readonly'), done = transactionDone(tx); const value = await request(tx.objectStore(store).getAll()); await done; db.close(); return value; }
test('D03/D06/D12 catalog persists across owner close/reopen, title is plain data, aliases dedupe and history never becomes activity', async () => {
  const env = await setup(); const record = await candidate(env.repo); assert.equal(record.nativeTitle, '<b>A title</b>'); assert.equal(record.activity, null); assert.equal(record.membership.state, 'UNKNOWN');
  await env.repo.discoverCandidates([{ url: `https://chatgpt.com/g/g-p-1234567890abcdef1234567890abcdef/c/${CID}`, source: 'unknown' }]);
  assert.equal((await env.repo.getSnapshot()).conversations.length, 1);
  env.repo.close(); const reopened = await createRepository({ indexedDB: env.factory, now: env.clock });
  assert.equal((await reopened.getSnapshot()).conversations[0]!.key, record.key);
  assert.equal((await rows(env.factory, 'openDays')).length, 0); reopened.close();
});
test('CAS serializes two browser pages and shortcuts keep user order when pinned or collapsed', async () => {
  const { repo } = await setup(); const revision = (await repo.getSnapshot()).revision;
  const attempts = await Promise.allSettled([repo.saveShortcut({ label: 'A', url: 'https://example.com/a' }, revision), repo.saveShortcut({ label: 'B', url: 'https://example.com/b' }, revision)]);
  assert.equal(attempts.filter(r => r.status === 'fulfilled').length, 1); assert.equal(attempts.filter(r => r.status === 'rejected').length, 1);
  const a = (await repo.getSnapshot()).shortcuts[0]!; const b = await repo.saveShortcut({ label: 'B', url: 'https://example.com/b' });
  await repo.saveShortcut({ id: b.id, label: b.label, url: b.url, pinned: true }); await repo.setSettings({ shortcutSectionCollapsed: true });
  assert.deepEqual((await repo.getSnapshot()).shortcuts.map(x => x.id), [a.id, b.id]);
  await repo.moveShortcut(b.id, 0); assert.deepEqual((await repo.getSnapshot()).shortcuts.map(x => x.id), [b.id, a.id]); repo.close();
});
test('O06/O11 two-tab same-day commits are atomic and replay after worker restart stays one unit', async () => {
  const env = await setup(); const record = await candidate(env.repo), first = await issue(env.repo, record.key); await binding(env.repo, first, 1);
  env.setNow('2026-11-02T00:00:05.000Z'); const second = await issue(env.repo, record.key, { sourceTabId: 2 }); await binding(env.repo, second, 2, 'second-doc');
  env.repo.close(); const repo = await createRepository({ indexedDB: env.factory, now: env.clock });
  await Promise.all([repo.commitArrival(arrive(first)), repo.commitArrival(arrive(second, { targetTabId: 2, targetDocumentId: 'second-doc' }))]);
  await repo.commitArrival(arrive(first)); const days = await rows(env.factory, 'openDays'); assert.equal(days.length, 1); assert.equal(days[0].activityUnit, 1); assert.equal(days[0].lastOpenedAt, second.issuedAt); assert.equal(days[0].firstOpenedAt, first.issuedAt); repo.close();
});
test('O12/O14 invalid session, document, scope and expired navigation do not commit activity', async () => {
  const env = await setup(); const c = await candidate(env.repo);
  for (const bad of [{ browserSessionId: 'other-session' }, { targetDocumentId: 'stale-doc' }, { routeEpoch: 2 }, { scopeEpoch: 2 }]) {
    const intent = await issue(env.repo, c.key); await binding(env.repo, intent); assert.equal((await env.repo.commitArrival(arrive(intent, bad))).state, 'rejected');
  }
  const { scope } = await identity(env.repo); const aKey = await conversationKey(scope.key, CID), scoped = await issue(env.repo, aKey); await binding(env.repo, scoped);
  assert.equal((await env.repo.commitArrival(arrive(scoped, { scopeKey: await scopeKey('b', 'context-a') }))).state, 'rejected');
  const expired = await issue(env.repo, c.key); await binding(env.repo, expired); env.setNow('2026-11-02T00:02:00.000Z'); assert.equal((await env.repo.commitArrival(arrive(expired))).state, 'expired');
  assert.equal((await rows(env.factory, 'openDays')).length, 0); env.repo.close();
});
test('O15/O16 crossing midnight and timezone changes preserve issue-day key; clock rollback rejects', async () => {
  const env = await setup('2026-11-01T15:59:59.000Z'); const c = await candidate(env.repo), intent = await issue(env.repo, c.key); await binding(env.repo, intent);
  await env.repo.setSettings({ libraryTimeZone: 'America/New_York' }); env.setNow('2026-11-01T16:00:02.000Z'); await env.repo.commitArrival(arrive(intent));
  const days = await rows(env.factory, 'openDays'); assert.equal(days[0].timeZone, 'Asia/Shanghai'); assert.equal(days[0].localDate, '2026-11-01');
  const bad = await issue(env.repo, c.key); await binding(env.repo, bad); env.setNow('2026-11-01T15:59:58.000Z'); assert.equal((await env.repo.commitArrival(arrive(bad))).state, 'rejected'); assert.equal((await rows(env.factory, 'openDays')).length, 1); env.repo.close();
});
test('S07/O13/D07 one of 500 candidates resolves; old staging activity never transfers; scoped tombstone does not prevent B', async () => {
  const env = await setup(); const inputs = Array.from({ length: 500 }, (_, i) => ({ url: `https://chatgpt.com/c/${i.toString(16).padStart(8, '0')}-abcd-1234-abcd-123456789abc`, title: `Fixture ${i}` }));
  for (let i = 0; i < inputs.length; i += 200) await env.repo.discoverCandidates(inputs.slice(i, i + 200));
  const snapshot = await env.repo.getSnapshot('unassigned'); assert.equal(snapshot.conversations.length, 500); const target = snapshot.conversations[0]!, cid = target.conversationId;
  const old = await issue(env.repo, target.key); await binding(env.repo, old); await env.repo.commitArrival(arrive(old, { conversationId: cid, canonicalUrl: target.canonicalUrl }));
  env.setNow('2026-11-02T00:00:10.000Z'); const { scope: a, witness: aw } = await identity(env.repo, 'principal-a', cid);
  const newIntent = await issue(env.repo, target.key); await binding(env.repo, newIntent); const result = await env.repo.commitArrival(arrive(newIntent, { conversationId: cid, canonicalUrl: target.canonicalUrl, scopeKey: a.key, evidenceId: aw.id }));
  assert.equal(result.recordKey, await conversationKey(a.key, cid)); assert.equal((await env.repo.getSnapshot('unassigned')).conversations.length, 499);
  const aRecord = (await env.repo.getSnapshot(a.key)).conversations[0]!; assert.equal(aRecord.activity!.firstConfirmedOpenAt, newIntent.issuedAt); assert.equal(aRecord.browserLastVisitAt, null);
  const oldStaging = (await rows(env.factory, 'conversations')).find(r => r.key === target.key); assert.equal(oldStaging.activity.lastConfirmedOpenAt, old.issuedAt);
  await env.repo.removeConversation(aRecord.key); await env.repo.discoverCandidates([{ url: target.canonicalUrl, title: 'Re-import' }]); assert.equal((await env.repo.getSnapshot(a.key)).conversations.length, 0); assert.equal((await env.repo.getSnapshot('unassigned')).conversations.length, 499);
  const { scope: b, witness: bw } = await identity(env.repo, 'principal-b', cid); const bIntent = await issue(env.repo, target.key); await binding(env.repo, bIntent);
  assert.equal((await env.repo.commitArrival(arrive(bIntent, { conversationId: cid, canonicalUrl: target.canonicalUrl, scopeKey: b.key, evidenceId: bw.id }))).state, 'committed'); assert.equal((await env.repo.getSnapshot(b.key)).conversations.length, 1); assert.equal((await env.repo.getSnapshot(b.key)).tombstones.length, 0);
  await env.repo.restoreConversation(aRecord.key); assert.equal((await env.repo.getSnapshot(a.key)).conversations.length, 1); assert.equal((await rows(env.factory, 'candidateLinks')).length, 2); env.repo.close();
});
test('D02 import candidate batch and checkpoint commit together; failed batch leaves both untouched', async () => {
  const { repo } = await setup();
  const checkpoint: RuntimeImportJob = { id: 'job', provider: 'browser-history', state: 'paused', startTimeMs: 0, endTimeMs: Date.parse('2026-11-02T00:00:00Z'), pendingIntervals: [], processedUniqueUrls: 1, acceptedCandidates: 1, rejectedUrls: 0, saturatedIntervals: [], sourceCoverage: 'browser-available-history', completedAt: null, includeSynced: false, seenKeys: [CID], pendingCandidates: [] };
  await repo.discoverCandidates([{ url: URL }], undefined, checkpoint); const before = await repo.getSnapshot(); assert.equal(before.importJobs[0]!.acceptedCandidates, 1); assert.equal(before.conversations.length, 1);
  await assert.rejects(repo.discoverCandidates([{ url: URL }, { url: 'https://not-chatgpt.com/c/foo' }], undefined, { ...checkpoint, acceptedCandidates: 2 }));
  const after = await repo.getSnapshot(); assert.equal(after.revision, before.revision); assert.equal(after.importJobs[0]!.acceptedCandidates, 1); repo.close();
});
test('D12 unknown payload fields and fake membership authority are rejected without storing forbidden data', async () => {
  const { repo, factory } = await setup();
  await assert.rejects(repo.discoverCandidates([{ url: URL, body: 'forbidden' } as any]), /invalid-fields/);
  await assert.rejects(repo.setSettings({ verified: true } as any), /invalid-fields/);
  const { scope, witness } = await identity(repo); await assert.rejects(repo.confirmObservation({ scope, witness: { ...witness, token: 'forbidden' } as any, documentId: 'arrival-doc', routeEpoch: 1, scopeEpoch: 0, conversationUrl: URL, nativeTitle: 'test', membership: { state: 'UNKNOWN', projectId: null, reason: 'no-membership-source' } }), /invalid-fields/);
  await assert.rejects(repo.confirmObservation({ scope, witness, documentId: 'arrival-doc', routeEpoch: 1, scopeEpoch: 0, conversationUrl: URL, nativeTitle: 'test', membership: { state: 'UNKNOWN', projectId: null, reason: 'no-membership-source' }, verified: true } as any), /invalid-fields/);
  await assert.rejects(repo.confirmObservation({ scope: { ...scope, state: 'signed-out' }, witness, documentId: 'arrival-doc', routeEpoch: 1, scopeEpoch: 0, conversationUrl: URL, nativeTitle: 'test', membership: { state: 'UNKNOWN', projectId: null, reason: 'no-membership-source' } }), /scope-not-ready/);
  assert.equal(JSON.stringify(await rows(factory, 'witnesses')).includes('forbidden'), false); repo.close();
});
test('D10 injected mid-transaction quota failure rolls back, then actual retry and replay preserve one entity per ID', async () => {
  const { repo } = await setup(); await candidate(repo); const before = await repo.getSnapshot();
  const inputs = [{ url: 'https://chatgpt.com/c/00000001-abcd-1234-abcd-123456789abc' }, { url: 'https://chatgpt.com/c/00000002-abcd-1234-abcd-123456789abc' }];
  const original = IDBObjectStore.prototype.put; let calls = 0;
  IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore['put']>) { if (this.name === 'conversations' && ++calls === 2) throw new DOMException('synthetic quota boundary', 'QuotaExceededError'); return original.apply(this, args); };
  try { await assert.rejects(repo.discoverCandidates(inputs), { name: 'QuotaExceededError' }); }
  finally { IDBObjectStore.prototype.put = original; }
  const after = await repo.getSnapshot(); assert.equal(after.revision, before.revision); assert.deepEqual(after.conversations, before.conversations);
  const retry = await repo.discoverCandidates(inputs); assert.deepEqual(retry, { accepted: 2, inserted: 2 });
  const retried = await repo.getSnapshot(); assert.equal(retried.conversations.length, 3); assert.equal(retried.revision, before.revision + 1);
  assert.equal(retried.conversations.find(record => record.key === before.conversations[0]!.key)?.nativeTitle, before.conversations[0]!.nativeTitle);
  const replay = await repo.discoverCandidates(inputs); assert.deepEqual(replay, { accepted: 2, inserted: 0 });
  const replayed = await repo.getSnapshot(); assert.equal(replayed.conversations.length, 3); assert.equal(new Set(replayed.conversations.map(record => record.conversationId)).size, 3);
  assert.deepEqual(replayed.conversations.map(record => [record.key, record.stableRank]), retried.conversations.map(record => [record.key, record.stableRank])); repo.close();
});
test('D10 aborting the initial v1 schema upgrade leaves no partial schema and a subsequent normal open recovers', async () => {
  const factory = new IDBFactory(), originalOpen = factory.open.bind(factory);
  let interrupted = false;
  factory.open = (name: string, version?: number) => {
    const open = originalOpen(name, version);
    open.addEventListener('upgradeneeded', () => {
      // Abort after the production onupgradeneeded handler creates its stores,
      // but before that versionchange transaction can commit.
      queueMicrotask(() => { interrupted = true; open.transaction!.abort(); });
    }, { once: true });
    return open;
  };
  await assert.rejects(createRepository({ indexedDB: factory, timeZone: 'UTC' }), { name: 'AbortError' });
  assert.equal(interrupted, true);
  let recoveredOldVersion: number | null = null;
  factory.open = (name: string, version?: number) => { const open = originalOpen(name, version); open.addEventListener('upgradeneeded', event => { recoveredOldVersion = (event as IDBVersionChangeEvent).oldVersion; }, { once: true }); return open; };
  const recovered = await createRepository({ indexedDB: factory, timeZone: 'UTC' });
  assert.equal(recoveredOldVersion, 0, 'The aborted v1 schema did not become an installed version.');
  const db = await openDatabase(factory); assert.equal(db.version, 1); assert.deepEqual([...db.objectStoreNames].sort(), [...STORE_NAMES].sort()); db.close();
  const empty = await recovered.getSnapshot(); assert.equal(empty.revision, 0); assert.equal(empty.conversations.length, 0);
  const record = await candidate(recovered); assert.equal((await recovered.getSnapshot()).conversations.length, 1); recovered.close();
  const reopened = await createRepository({ indexedDB: factory, timeZone: 'UTC' });
  assert.equal((await reopened.getSnapshot()).conversations[0]!.key, record.key); reopened.close();
});
test('D10 concurrent and repeated requests for existing v1 perform only one schema upgrade and preserve unique entities', async () => {
  const factory = new IDBFactory(), originalOpen = factory.open.bind(factory); let upgrades = 0;
  factory.open = (name: string, version?: number) => { const open = originalOpen(name, version); open.addEventListener('upgradeneeded', () => { upgrades++; }); return open; };
  const [first, second] = await Promise.all([createRepository({ indexedDB: factory, timeZone: 'UTC' }), createRepository({ indexedDB: factory, timeZone: 'UTC' })]);
  assert.equal(upgrades, 1);
  const initialProfile = (await first.getSnapshot()).localProfileKey;
  assert.equal((await second.getSnapshot()).localProfileKey, initialProfile);
  await first.discoverCandidates([{ url: URL, title: 'Persistent unique entry' }]);
  await second.discoverCandidates([{ url: `https://chat.openai.com/c/${CID}`, title: 'Persistent unique entry' }]);
  const original = (await first.getSnapshot()).conversations[0]!;
  assert.equal((await second.getSnapshot()).conversations.length, 1); first.close(); second.close();
  for (let attempt = 0; attempt < 3; attempt++) {
    const repo = await createRepository({ indexedDB: factory, timeZone: 'UTC' });
    await repo.discoverCandidates([{ url: URL, title: 'Persistent unique entry' }]);
    const snapshot = await repo.getSnapshot(); assert.equal(snapshot.localProfileKey, initialProfile); assert.equal(snapshot.conversations.length, 1);
    assert.equal(snapshot.conversations[0]!.key, original.key); assert.equal(snapshot.conversations[0]!.stableRank, original.stableRank); repo.close();
  }
  assert.equal(upgrades, 1, 'Repeated open(name, 1) calls do not rerun a committed schema upgrade.');
});


test('D1 generic browser-history titles never replace useful titles; same-ID specific updates and search remain stable', async () => {
  const env = await setup();
  const original = await env.repo.discoverCandidates([{ url: URL, title: 'Original research title', source: 'local', titleBasis: 'browser-history' }]);
  assert.deepEqual(original, { accepted: 1, inserted: 1 });
  const initial = (await env.repo.getSnapshot('unassigned')).conversations[0]!;
  const opened = await issue(env.repo, initial.key); await binding(env.repo, opened);
  await env.repo.commitArrival(arrive(opened));
  const before = (await env.repo.getSnapshot('unassigned')).conversations[0]!;
  assert.equal(searchCatalog(await env.repo.getSnapshot('unassigned'), 'Original research title', 'unassigned').length, 1);
  for (const generic of ['ChatGPT', '   ', '', 'ChatGPT - OpenAI', 'New Chat']) {
    await env.repo.discoverCandidates([{ url: URL, title: generic, source: 'local', titleBasis: 'browser-history' }]);
    const after = (await env.repo.getSnapshot('unassigned')).conversations[0]!;
    assert.equal(after.nativeTitle, 'Original research title', JSON.stringify(generic));
    assert.equal(after.key, before.key);
    assert.equal(after.conversationId, before.conversationId);
    assert.equal(after.canonicalUrl, before.canonicalUrl);
    assert.equal(after.stableRank, before.stableRank);
    assert.deepEqual(after.owner, before.owner);
    assert.deepEqual(after.membership, before.membership);
    assert.deepEqual(after.activity, before.activity);
    assert.equal(searchCatalog(await env.repo.getSnapshot('unassigned'), 'Original research title', 'unassigned').length, 1);
  }
  await env.repo.discoverCandidates([{ url: URL, title: 'Updated specific browser title', source: 'local', titleBasis: 'browser-history' }]);
  let after = (await env.repo.getSnapshot('unassigned')).conversations[0]!;
  assert.equal(after.nativeTitle, 'Updated specific browser title');
  assert.equal(after.key, before.key);
  assert.equal(searchCatalog(await env.repo.getSnapshot('unassigned'), 'Updated specific browser title', 'unassigned').length, 1);
  await env.repo.discoverCandidates([{ url: URL, title: 'Native member title', titleBasis: 'native-label' }]);
  after = (await env.repo.getSnapshot('unassigned')).conversations[0]!;
  assert.equal(after.nativeTitle, 'Native member title');
  await env.repo.discoverCandidates([{ url: URL, title: 'Lower-trust history rename', titleBasis: 'browser-history' }]);
  after = (await env.repo.getSnapshot('unassigned')).conversations[0]!;
  assert.equal(after.nativeTitle, 'Native member title');
  const alias = 'https://chat.openai.com/c/' + CID;
  await env.repo.discoverCandidates([{ url: alias, title: 'Alias generic title', titleBasis: 'browser-history' }]);
  const snapshot = await env.repo.getSnapshot('unassigned');
  assert.equal(snapshot.conversations.length, 1);
  assert.equal(snapshot.conversations[0]!.key, before.key);
  assert.equal(snapshot.conversations[0]!.nativeTitle, 'Native member title');
  assert.equal(snapshot.conversations[0]!.canonicalUrl, before.canonicalUrl);
  env.repo.close();
});

test('D1 a missing title can be filled by a valid browser-history title without changing the conversation identity', async () => {
  const { repo } = await setup();
  const other = '00000000-abcd-1234-abcd-123456789abc';
  const url = 'https://chatgpt.com/c/' + other;
  await repo.discoverCandidates([{ url }]);
  const before = (await repo.getSnapshot('unassigned')).conversations[0]!;
  assert.equal(before.nativeTitle, null);
  await repo.discoverCandidates([{ url, title: 'Recovered meaningful title', titleBasis: 'browser-history' }]);
  const after = (await repo.getSnapshot('unassigned')).conversations[0]!;
  assert.equal(after.nativeTitle, 'Recovered meaningful title');
  assert.equal(after.key, before.key);
  assert.equal(after.conversationId, before.conversationId);
  assert.equal(after.stableRank, before.stableRank);
  repo.close();
});

test('D1 title reconciliation survives repeated visit/import interleaving and preserves Project member titles', async () => {
  const env = await setup();
  await env.repo.discoverCandidates([{ url: URL, title: 'Original imported title', titleBasis: 'browser-history' }]);
  await env.repo.discoverCandidates([{ url: URL, title: 'ChatGPT', titleBasis: 'browser-history' }]);
  const history: HistoryPort = {
    async search() { return [{ url: URL, title: 'ChatGPT', lastVisitTime: Date.parse('2026-11-02T00:00:00Z') }]; },
    async getVisits() { return [{ isLocal: true }]; },
  };
  const job = createHistoryJob('all', false, Date.parse('2026-11-02T00:00:00Z'));
  await env.repo.saveImportJob(job);
  await stepHistoryImport(env.repo, history, job.id);
  let record = (await env.repo.getSnapshot('unassigned')).conversations[0]!;
  assert.equal(record.nativeTitle, 'Original imported title');
  await env.repo.setSettings({ captureEnabled: true });
  const projectId = 'g-p-1234567890abcdef1234567890abcdef';
  await env.repo.observeLocalProjectCandidate({
    state: 'candidate', relationBasis: 'linked-native-panel', projectId, nativeTitle: 'Synthetic project',
    canonicalUrl: 'https://chatgpt.com/g/' + projectId + '/project',
    members: [{ conversationId: CID, nativeTitle: 'Native Project member title', canonicalUrl: URL }],
  }, { browserSessionId: 's', bindingId: 'b', observationId: 'o', sourceHref: 'https://chatgpt.com/g/' + projectId + '/project' });
  await env.repo.discoverCandidates([{ url: URL, title: 'ChatGPT', titleBasis: 'browser-history' }]);
  record = (await env.repo.getSnapshot('unassigned')).conversations[0]!;
  assert.equal(record.nativeTitle, 'Native Project member title');
  assert.equal(record.membership.state, 'UNKNOWN');
  env.repo.close();
});

test('D1 title write transaction abort and retry preserve the previous title and one stable conversation', async () => {
  const { repo } = await setup();
  await repo.discoverCandidates([{ url: URL, title: 'Original title survives abort' }]);
  const before = (await repo.getSnapshot('unassigned')).conversations[0]!;
  const originalPut = IDBObjectStore.prototype.put; let calls = 0;
  IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore['put']>) {
    if (this.name === 'conversations' && ++calls === 1) throw new DOMException('synthetic transaction interruption', 'AbortError');
    return originalPut.apply(this, args);
  };
  try { await assert.rejects(repo.discoverCandidates([{ url: URL, title: 'ChatGPT' }]), { name: 'AbortError' }); }
  finally { IDBObjectStore.prototype.put = originalPut; }
  const afterAbort = (await repo.getSnapshot('unassigned')).conversations[0]!;
  assert.equal(afterAbort.nativeTitle, before.nativeTitle);
  assert.equal(afterAbort.key, before.key);
  await repo.discoverCandidates([{ url: URL, title: 'ChatGPT' }]);
  const afterRetry = (await repo.getSnapshot('unassigned')).conversations;
  assert.equal(afterRetry.length, 1);
  assert.equal(afterRetry[0]!.nativeTitle, 'Original title survives abort');
  assert.equal(afterRetry[0]!.key, before.key);
  repo.close();
});
