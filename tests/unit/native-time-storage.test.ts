import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { IDBFactory } from 'fake-indexeddb';
import { observeNativeProjectSnapshots } from '../../src/collectors/chatgpt/native-projects.js';
import { parseLocalProjectCandidate } from '../../src/collectors/chatgpt/project-candidate.js';
import { createRepository } from '../../src/storage/repository.js';
import { request, STORE_NAMES } from '../../src/storage/db.js';
import { projectCatalog } from '../../src/domain/projection.js';
import { localDay } from '../../src/domain/time.js';
import { scopeKey } from '../../src/domain/ids.js';
import type { AccountScope, EvidenceWitness } from '../../contracts/free-v1.js';

const NOW = '2026-11-03T12:00:00.000Z', AT = '2026-11-01T09:00:00.000Z';
const PID = 'g-p-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const url = `https://chatgpt.com/g/${PID}/project`;
const cid = (n: number) => `96000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const context = (principal = 'a') => ({ browserSessionId: 'time-session', documentId: 'time-document', identityGeneration: 0, principalKey: `principal:${principal.repeat(64)}`, sourceHref: url, routeEpoch: 0 });
const view = { H: 30 as const, T: localDay(NOW, 'UTC'), Z: 'UTC', k: 0, selectedScope: 'unassigned', now: NOW };
function fixture() {
  const dom = new JSDOM(`<main><h1><button aria-label="Edit the title of Time project"><span>Time project</span></button></h1><div role="tablist"><button role="tab" id="t" aria-selected="true" aria-controls="p">Chats</button></div><div role="tabpanel" id="p" aria-labelledby="t"><ol aria-label="Recently updated" aria-sort="descending">${[1, 2].map(n => `<li aria-setsize="2" aria-posinset="${n}"><a href="/c/${cid(n)}" aria-label="Member ${n}"><span>Member ${n}</span></a>${n === 2 ? `<time datetime="${AT}" aria-label="Last updated"></time>` : ''}<p data-preview>FORBIDDEN PREVIEW</p></li>`).join('')}</ol></div></main>`, { url, pretendToBeVisual: true });
  Object.defineProperty(dom.window.Element.prototype, 'getClientRects', { value() { return [{ x: 0, y: 0, width: 100, height: 20 }]; } });
  let privateReads = 0;
  for (const node of [dom.window.document.body, ...dom.window.document.querySelectorAll('[data-preview]')]) {
    for (const field of ['textContent', 'innerHTML', 'outerHTML']) Object.defineProperty(node, field, { get() { privateReads++; throw Error('private read'); } });
  }
  return { document: dom.window.document, read: () => observeNativeProjectSnapshots(dom.window.document)[0]!.candidate,
    close() { dom.window.close(); assert.equal(privateReads, 0); } };
}
async function setup() {
  const factory = new IDBFactory(), name = crypto.randomUUID();
  const repo = await createRepository({ indexedDB: factory, name, timeZone: 'UTC', now: () => NOW });
  await repo.setSettings({ captureEnabled: true }); return { factory, name, repo };
}
async function stores(factory: IDBFactory, name: string) {
  const db = await request(factory.open(name, 1));
  try { return { names: [...db.objectStoreNames], version: db.version,
    days: await request(db.transaction('openDays').objectStore('openDays').getAll()),
    intents: await request(db.transaction('openIntents').objectStore('openIntents').getAll()) }; }
  finally { db.close(); }
}
test('native time production pipeline preserves explicit timestamp semantics and infers a bounded member without activity writes', async () => {
  const h = fixture(), env = await setup();
  try {
    const input = h.read(); assert.deepEqual(input.timeOrder!.memberIds, [cid(1), cid(2)]);
    assert.equal(input.members[0]!.time, undefined); assert.equal(input.members[1]!.time!.at, AT);
    assert.deepEqual(parseLocalProjectCandidate(input, url), input);
    await env.repo.observeLocalProject(input, context());
    const snapshot = await env.repo.getSnapshot(), projection = projectCatalog(snapshot, view);
    assert.equal(snapshot.timeOrders!.length, 1); assert.equal(projection.localProjects.length, 1);
    assert.equal(projection.localProjects[0]!.recent.length, 2);
    assert.ok(snapshot.conversations.every(r => r.activity === null && r.browserLastVisitAt === null && r.membership.state === 'UNKNOWN'));
    const inferred = projection.displayTimes.get(snapshot.conversations.find(r => r.conversationId === cid(1))!.key)!;
    assert.equal(inferred.segment, 0); assert.equal(inferred.at, null); assert.equal(inferred.date, null); assert.equal(inferred.lowerBound, AT);
    const stored = await stores(env.factory, env.name);
    assert.deepEqual(stored.names, [...STORE_NAMES].sort()); assert.equal(stored.version, 1); assert.equal(stored.names.length, 12);
    assert.deepEqual(stored.days, []); assert.deepEqual(stored.intents, []);
  } finally { h.close(); env.repo.close(); }
});
test('native chronological metadata rejects pinned, manual, incomplete, busy and unlabelled order without discarding membership', () => {
  for (const kind of ['pinned', 'manual', 'manual-root', 'partial', 'busy', 'unsorted', 'missing-coverage', 'preview-time']) {
    const h = fixture();
    try {
      const list = h.document.querySelector('ol')!, row = h.document.querySelector('li')!;
      if (kind === 'pinned') row.setAttribute('aria-label', 'Pinned chat');
      if (kind === 'manual') row.setAttribute('draggable', 'true');
      if (kind === 'manual-root') list.setAttribute('draggable', 'true');
      if (kind === 'partial') row.setAttribute('aria-setsize', '3');
      if (kind === 'busy') list.setAttribute('aria-busy', 'true');
      if (kind === 'unsorted') list.setAttribute('aria-sort', 'none');
      if (kind === 'missing-coverage') row.removeAttribute('aria-posinset');
      if (kind === 'preview-time') { h.document.querySelector('[data-preview]')!.append(h.document.querySelector('time')!); list.removeAttribute('aria-label'); }
      const candidate = h.read(); assert.equal(candidate.members.length, 2, kind); assert.equal(candidate.timeOrder, undefined, kind);
      if (kind === 'preview-time') assert.ok(candidate.members.every(member => !member.time));
    } finally { h.close(); }
  }
});
test('native time IPC rejects invented exact dates, partial orders, duplicate members and fields', () => {
  const h = fixture();
  try {
    const input = h.read();
    for (const mutate of [
      (x: any) => { x.members[1].time.at = 'yesterday'; },
      (x: any) => { x.members[1].time.source = 'forged'; },
      (x: any) => { x.timeOrder.coverage = 'partial'; },
      (x: any) => { x.timeOrder.pinned = true; },
      (x: any) => { x.timeOrder.memberIds = [cid(1), cid(1)]; },
      (x: any) => { x.timeOrder.observedAt = NOW; },
    ]) { const bad = structuredClone(input); mutate(bad); assert.throws(() => parseLocalProjectCandidate(bad, url), /INVALID_MESSAGE/); }
  } finally { h.close(); }
});
test('native display facts survive history merge and same-version reopen, and never cross a principal boundary', async () => {
  const h = fixture(), env = await setup(); let repo = env.repo;
  try {
    await repo.observeLocalProject(h.read(), context());
    const before = await repo.getSnapshot(), anchor = before.conversations.find(r => r.conversationId === cid(2))!;
    await repo.discoverCandidates([{ url: anchor.canonicalUrl, title: 'ChatGPT', lastVisitAt: '2026-11-02T09:00:00.000Z' }]);
    let after = await repo.getSnapshot();
    assert.deepEqual(after.conversations.find(r => r.key === anchor.key)!.displayTimeFacts, anchor.displayTimeFacts);
    assert.deepEqual(after.timeOrders, before.timeOrders);
    repo.close(); repo = await createRepository({ indexedDB: env.factory, name: env.name, now: () => NOW });
    after = await repo.getSnapshot(); assert.deepEqual(after.timeOrders, before.timeOrders);
    const other = h.read(); delete other.timeOrder; for (const member of other.members) delete member.time;
    await repo.observeLocalProject(other, context('b'));
    after = await repo.getSnapshot(); const aBoundary = anchor.localProject!.boundaryKey;
    const b = after.conversations.filter(r => r.localProject!.boundaryKey !== aBoundary);
    assert.equal(b.length, 2); assert.ok(b.every(r => !r.displayTimeFacts && !r.activity && !r.browserLastVisitAt));
    assert.equal(after.timeOrders!.length, 1); assert.equal(after.localProjects!.length, 2);
  } finally { h.close(); repo.close(); }
});
test('a later unsupported ordering invalidates only the relative snapshot, keeping members and direct time facts', async () => {
  const h = fixture(), env = await setup();
  try {
    await env.repo.observeLocalProject(h.read(), context());
    h.document.querySelector('ol')!.removeAttribute('aria-sort');
    await env.repo.observeLocalProject(h.read(), context());
    const snapshot = await env.repo.getSnapshot(), p = projectCatalog(snapshot, view);
    assert.equal(snapshot.timeOrders, undefined); assert.equal(snapshot.conversations.length, 2);
    assert.equal(p.localProjects[0]!.recent.length, 1); assert.equal(p.localProjects[0]!.older.length, 1);
    assert.equal(snapshot.conversations.find(r => r.conversationId === cid(2))!.displayTimeFacts![0]!.at, AT);
  } finally { h.close(); env.repo.close(); }
});
test('time metadata respects capture pause, tombstones and future timestamp rejection', async () => {
  const h = fixture(), env = await setup();
  try {
    const input = h.read(); input.members[1]!.time!.at = '2027-01-01T00:00:00.000Z';
    await env.repo.observeLocalProject(input, context());
    let snapshot = await env.repo.getSnapshot(); assert.ok(snapshot.conversations.every(r => !r.displayTimeFacts));
    assert.equal(projectCatalog(snapshot, view).undatedLocalProjects.length, 1);
    await env.repo.removeConversation(snapshot.conversations[0]!.key);
    await env.repo.observeLocalProject(h.read(), context()); snapshot = await env.repo.getSnapshot();
    assert.equal(snapshot.conversations.length, 1); assert.equal(snapshot.tombstones.length, 1); assert.equal(snapshot.timeOrders, undefined);
    await env.repo.setSettings({ captureEnabled: false });
    const before = await env.repo.getSnapshot(); await assert.rejects(env.repo.observeLocalProject(h.read(), context()), /PERMISSION_REQUIRED/);
    assert.deepEqual(await env.repo.getSnapshot(), before);
  } finally { h.close(); env.repo.close(); }
});
test('future or regressing native time cannot borrow an older fact to certify a newer ordering snapshot', async () => {
  for (const invalidAt of ['2027-01-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z']) {
    const h = fixture(), env = await setup();
    try {
      await env.repo.observeLocalProject(h.read(), context());
      const before = await env.repo.getSnapshot(); assert.equal(before.timeOrders!.length, 1);
      const changed = h.read(); changed.members[1]!.time!.at = invalidAt;
      await env.repo.observeLocalProject(changed, context());
      const after = await env.repo.getSnapshot(); assert.equal(after.timeOrders, undefined);
      assert.deepEqual(after.conversations.find(r => r.conversationId === cid(2))!.displayTimeFacts, before.conversations.find(r => r.conversationId === cid(2))!.displayTimeFacts);
      const card = projectCatalog(after, view).localProjects[0]!;
      assert.equal(card.recent.length, 1); assert.equal(card.older.length, 1);
      assert.ok(after.conversations.every(r => r.activity === null && r.browserLastVisitAt === null));
    } finally { h.close(); env.repo.close(); }
  }
});
test('new certified arrival creates its own activity without copying staging native time facts or boundaries', async () => {
  const h = fixture(), env = await setup();
  try {
    await env.repo.observeLocalProject(h.read(), context());
    const original = (await env.repo.getSnapshot()).conversations.find(r => r.conversationId === cid(2))!;
    const key = await scopeKey('time-certified-principal', 'time-certified-context');
    const witness: EvidenceWitness = { id: 'time-certified-witness', kind: 'verified-session-context', adapterId: 'test-only-fixture', adapterVersion: '1', scopeKey: key, documentId: 'time-arrival', routeEpoch: 1, scopeEpoch: 0, observedAt: NOW, sourceRevision: 1, sourceDomain: 'verified-context', fields: ['identity'], revoked: false };
    const scope: AccountScope = { key, provider: 'chatgpt', principalKey: 'time-certified-principal', contextKey: 'time-certified-context', identity: 'verified', label: 'Time certified fixture', verifiedAt: NOW, identityAdapterVersion: '1', contextWitnessId: witness.id, state: 'ready' };
    // Establish scope/witness with a different conversation so arrival must
    // create the target scoped record instead of updating an existing one.
    await env.repo.confirmObservation({ scope, witness, documentId: 'time-arrival', routeEpoch: 1, scopeEpoch: 0, conversationUrl: `https://chatgpt.com/c/${cid(99)}`, nativeTitle: 'Different scoped row', membership: { state: 'UNKNOWN', projectId: null, reason: 'no-membership-source' } });
    const intent = await env.repo.issueIntent({ browserSessionId: 'time-session', targetRecordKey: original.key, evidence: { kind: 'start-gesture', sourceDocumentId: 'start-document', gesture: 'click' }, disposition: 'same-tab', sourceTabId: 1, sourceScopeEpoch: 0 });
    await env.repo.dispatchIntent(intent.id, intent.browserSessionId, { targetTabId: 1 });
    await env.repo.bindIntentTarget(intent.id, intent.browserSessionId, { targetTabId: 1, targetDocumentId: 'time-arrival', routeEpoch: 1, scopeEpoch: 0 });
    const result = await env.repo.commitArrival({ intentId: intent.id, browserSessionId: intent.browserSessionId, targetTabId: 1, targetDocumentId: 'time-arrival', routeEpoch: 1, scopeEpoch: 0, conversationId: original.conversationId, canonicalUrl: original.canonicalUrl, scopeKey: key, evidenceId: witness.id, arrivalConfirmed: true });
    assert.equal(result.state, 'committed');
    const scoped = (await env.repo.getSnapshot(key)).conversations.find(r => r.conversationId === original.conversationId)!;
    assert.equal(scoped.displayTimeFacts, undefined); assert.equal(scoped.displayTimeBoundaryKey, undefined);
    assert.equal(scoped.localProject, undefined); assert.equal(scoped.browserLastVisitAt, null); assert.equal(scoped.activity!.lastConfirmedOpenAt, NOW);
    const db = await request(env.factory.open(env.name, 1));
    try { const retained = await request<any>(db.transaction('conversations').objectStore('conversations').get(original.key)); assert.deepEqual(retained.displayTimeFacts, original.displayTimeFacts); }
    finally { db.close(); }
  } finally { h.close(); env.repo.close(); }
});
