import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { createRepository, type ArrivalInput, type Repository, type RuntimeImportJob } from '../../src/storage/repository.js';
import { conversationKey, scopeKey, stagingKey } from '../../src/domain/ids.js';
import { openDatabase, request, transactionDone } from '../../src/storage/db.js';
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
test('D10 injected mid-transaction quota failure rolls back the partial batch and preserves the old directory', async () => {
  const { repo } = await setup(); await candidate(repo); const before = await repo.getSnapshot();
  const original = IDBObjectStore.prototype.put; let calls = 0;
  IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore['put']>) { if (this.name === 'conversations' && ++calls === 2) throw new DOMException('synthetic quota boundary', 'QuotaExceededError'); return original.apply(this, args); };
  try { await assert.rejects(repo.discoverCandidates([{ url: 'https://chatgpt.com/c/00000001-abcd-1234-abcd-123456789abc' }, { url: 'https://chatgpt.com/c/00000002-abcd-1234-abcd-123456789abc' }]), { name: 'QuotaExceededError' }); }
  finally { IDBObjectStore.prototype.put = original; }
  const after = await repo.getSnapshot(); assert.equal(after.revision, before.revision); assert.deepEqual(after.conversations, before.conversations); repo.close();
});
