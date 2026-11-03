import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createFreeViewSession, freeSegmentFor, freeWindowFor, instant, localDay } from '../../src/domain/time.js';
import { parseConversationUrl, parseProjectUrl, scopeKey, tupleHash, validateWebsiteUrl } from '../../src/domain/ids.js';
import { projectCatalog, searchCatalog } from '../../src/domain/projection.js';
import { reduceMembership } from '../../src/domain/membership.js';
import type { ConversationRecord, EvidenceWitness, ProjectRecord } from '../../contracts/free-v1.js';
import type { CatalogSnapshot } from '../../src/storage/repository.js';
const CID = '12345678-abcd-1234-abcd-123456789abc';
const PID = 'g-p-1234567890abcdef1234567890abcdef';
test('T01 inherited calendar vectors cover Shanghai, leap year and DST, with disjoint 30-day ranges', async () => {
  const data = JSON.parse(await readFile(new URL('../../contracts/time-vectors.json', import.meta.url), 'utf8'));
  for (const vector of data.vectors) { const session = createFreeViewSession({ now: vector.now, timeZone: vector.zone }); assert.equal(freeSegmentFor(vector.value, session), vector.segment, vector.id); if (vector.window) assert.deepEqual(freeWindowFor(vector.segment, session), vector.window, vector.id); }
  const session = createFreeViewSession({ now: '2026-11-02T04:00:00Z', timeZone: 'America/New_York' });
  for (let k = 0; k < 24; k++) { const window = freeWindowFor(k, session); assert.equal((Date.parse(window.endExclusive) - Date.parse(window.start)) / 86_400_000, 30); assert.equal(freeWindowFor(k + 1, session).endExclusive, window.start); }
  assert.equal(instant('2026-02-30T00:00:00Z'), null); assert.equal(instant('2026-01-01'), null); assert.equal(localDay('0099-01-01T00:00:00Z', 'UTC'), -683368);
});
test('D04 URL policy rejects normalization attacks and does not infer container membership', () => {
  const canonical = `https://chatgpt.com/c/${CID}`;
  for (const bad of [`https://chatgpt.com:443/c/${CID}`, `https://evil.chatgpt.com/c/${CID}`, `https://chatgpt.com@evil.test/c/${CID}`, `https://chatgpt.com/../c/${CID}`, `https://chatgpt.com/%2e%2e/c/${CID}`, `${canonical}?temporary-chat=true`, `${canonical}#message`, `${canonical}/`, `https://chatgpt.com/share/${CID}`, `https://chatgpt.com/g/__proto__/c/${CID}`, `https://chatgpt.com/c/%31${CID.slice(1)}`]) assert.equal(parseConversationUrl(bad), null, bad);
  assert.equal(parseConversationUrl(`https://chat.openai.com/c/${CID}`)?.canonicalUrl, canonical);
  assert.equal(parseConversationUrl(`https://chatgpt.com/g/abc-container/c/${CID}`)?.containerHint, 'abc-container');
  assert.equal(parseProjectUrl(`https://chatgpt.com/g/${PID}/project`)?.projectId, PID);
  assert.equal(parseProjectUrl(`https://chatgpt.com/g/${PID}`), null);
  assert.equal(parseProjectUrl('https://chatgpt.com/g/g-p-123/project'), null);
  for (const bad of ['javascript:alert(1)', 'data:text/plain,x', 'https://user:pass@example.com', 'https://example.com\\@evil.test']) assert.throws(() => validateWebsiteUrl(bad));
  assert.equal(validateWebsiteUrl('http://localhost:3000/test'), 'http://localhost:3000/test');
});
test('D03 length-delimited identities resist tuple ambiguities and scope collisions', async () => {
  assert.notEqual(await tupleHash('test', 'ab', 'c'), await tupleHash('test', 'a', 'bc'));
  assert.notEqual(await scopeKey('principal-a', 'workspace'), await scopeKey('principal-b', 'workspace'));
  assert.equal(await scopeKey('principal-a', 'workspace'), await scopeKey('principal-a', 'workspace'));
});
const witness = (overrides: Partial<EvidenceWitness> = {}): EvidenceWitness => ({ id: 'proof', kind: 'native-project-member-region', adapterId: 'candidate', adapterVersion: '1', scopeKey: 'a', documentId: 'doc', routeEpoch: 2, scopeEpoch: 3, observedAt: '2026-11-02T00:00:00.000Z', sourceRevision: 4, sourceDomain: 'project-members', fields: ['membership'], revoked: false, ...overrides });
test('S02/S05 membership keeps weak observations, rejects stale epochs and makes incomparable conflict UNKNOWN', () => {
  const previous = { state: 'PROJECT' as const, projectId: PID, evidenceId: 'old', confirmedAt: '2026-11-01T00:00:00.000Z' };
  const context = { scopeKey: 'a', documentId: 'doc', routeEpoch: 2, scopeEpoch: 3 };
  assert.deepEqual(reduceMembership(previous, { membership: { state: 'UNKNOWN', projectId: null, reason: 'no-membership-source' }, witness: witness() }, context), previous);
  const none = { state: 'NONE' as const, projectId: null, evidenceId: 'proof', confirmedAt: witness().observedAt };
  assert.throws(() => reduceMembership(previous, { membership: none, witness: witness() }, context), /membership-source-mismatch/);
  assert.deepEqual(reduceMembership(previous, { membership: none, witness: witness({ kind: 'native-explicit-none', scopeEpoch: 2 }) }, context), previous);
  assert.equal(reduceMembership(previous, { membership: none, witness: witness({ kind: 'native-explicit-none', sourceDomain: 'move-menu' }) }, context, witness({ id: 'old', sourceRevision: 3 })).state, 'UNKNOWN');
  assert.equal(reduceMembership(previous, { membership: none, witness: witness({ kind: 'allowlisted-metadata' }) }, context, witness({ id: 'old', sourceRevision: 3 })).state, 'NONE');
});
test('membership conflict stays UNKNOWN under replay and clears only at a newer comparable revision', () => {
  const context = { scopeKey: 'a', documentId: 'doc', routeEpoch: 2, scopeEpoch: 3 };
  const p = { state: 'PROJECT' as const, projectId: PID, evidenceId: 'p', confirmedAt: witness().observedAt };
  const q = { state: 'PROJECT' as const, projectId: 'g-p-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', evidenceId: 'q', confirmedAt: witness().observedAt };
  const old = witness({ id: 'p', sourceRevision: 1 });
  const conflict = reduceMembership(p, { membership: q, witness: witness({ id: 'q', sourceRevision: 1 }) }, context, old);
  assert.equal(conflict.state, 'UNKNOWN');
  assert.deepEqual(reduceMembership(conflict, { membership: q, witness: witness({ id: 'q', sourceRevision: 1 }) }, context, old), conflict);
  assert.deepEqual(reduceMembership(conflict, { membership: p, witness: old }, context, old), conflict);
  assert.deepEqual(reduceMembership(conflict, { membership: q, witness: witness({ id: 'q', sourceRevision: 2, sourceDomain: 'incomparable' }) }, context, old), conflict);
  assert.equal(reduceMembership(conflict, { membership: q, witness: witness({ id: 'q', sourceRevision: 2 }) }, context, old).state, 'PROJECT');
});
test('membership union rejects extra fields, invalid Project IDs and explicit-NONE proof used for PROJECT', () => {
  const context = { scopeKey: 'a', documentId: 'doc', routeEpoch: 2, scopeEpoch: 3 }, unknown = { state: 'UNKNOWN' as const, projectId: null, reason: 'no-membership-source' as const };
  const p = { state: 'PROJECT' as const, projectId: PID, evidenceId: 'proof', confirmedAt: witness().observedAt };
  assert.throws(() => reduceMembership(unknown, { membership: p, witness: witness({ kind: 'native-explicit-none' }) }, context), /membership-source-mismatch/);
  for (const malformed of [{ ...p, body: 'forbidden' }, { ...p, projectId: 'fake' }, { state: 'NONE', projectId: PID, evidenceId: 'proof', confirmedAt: witness().observedAt }, { ...unknown, verified: true }]) assert.throws(() => reduceMembership(unknown, { membership: malformed as any, witness: witness() }, context));
});
function record(key: string, date: string | null, membership: ConversationRecord['membership'], rank: number, scope = 'a'): ConversationRecord {
  return { key, provider: 'chatgpt', conversationId: CID, canonicalUrl: `https://chatgpt.com/c/${CID}`, owner: { kind: 'scoped', scopeKey: scope }, membership, nativeTitle: key, titleBasis: 'native-label', titleObservedAt: date, availability: 'reachable', firstSeenAt: '2026-01-01T00:00:00Z', lastSeenAt: '2026-11-02T00:00:00Z', browserLastVisitAt: null, stableRank: rank, revision: 1, activity: date ? { firstConfirmedOpenAt: date, lastConfirmedOpenAt: date, lastActiveDate: date.slice(0, 10), timeZone: 'UTC' } : null };
}
test('T02/T03/T04/T06 projects occupy one segment; old children stay with parent; NONE has one date; undated history stays undated', () => {
  const m = { state: 'PROJECT' as const, projectId: PID, evidenceId: 'proof', confirmedAt: '2026-11-02T00:00:00Z' }, none = { state: 'NONE' as const, projectId: null, evidenceId: 'none', confirmedAt: '2026-11-02T00:00:00Z' };
  const project: ProjectRecord = { key: 'p', scopeKey: 'a', projectId: PID, nativeTitle: 'Same name', canonicalUrl: `https://chatgpt.com/g/${PID}/project`, evidenceId: 'proof', observedAt: m.confirmedAt, membershipCoverage: 'observed-only', stableRank: 0, revision: 1 };
  const records = [record('current', '2026-11-02T00:00:00Z', m, 2), record('old-child', '2026-08-01T00:00:00Z', m, 1), record('date-one', '2026-11-02T00:00:00Z', none, 3), record('no-activity', null, none, 4), record('foreign', '2026-11-02T00:00:00Z', none, 5, 'b')];
  const snapshot = { conversations: records, projects: [project], tombstones: [] } as unknown as CatalogSnapshot;
  const view = { ...createFreeViewSession({ now: '2026-11-02T01:00:00Z', timeZone: 'UTC' }), k: 0, selectedScope: 'a' };
  const p = projectCatalog(snapshot, view); assert.equal(p.projects.length, 1); assert.deepEqual(p.projects[0]!.recent.map(r => r.key), ['current']); assert.deepEqual(p.projects[0]!.older.map(r => r.key), ['old-child']); assert.equal(p.dates.length, 1); assert.equal(p.dates[0]!.records[0]!.key, 'date-one'); assert.equal(p.undatedNone[0]!.key, 'no-activity');
  assert.equal(projectCatalog(snapshot, { ...view, k: 3 }).projects.length, 0);
  assert.deepEqual(searchCatalog(snapshot, 'old-child', 'a').map(r => r.record.key), ['old-child']); assert.equal(searchCatalog(snapshot, 'foreign', 'a').length, 0);
});
test('T06 ten equal-millisecond records and ten undated records keep declared rank/ID order across repeated input permutations', () => {
  const at = '2026-11-02T00:00:00.123Z';
  const none = { state: 'NONE' as const, projectId: null, evidenceId: 'ordering-proof', confirmedAt: at };
  // The acceptance oracle is written explicitly from the contract: rank first,
  // then stable ID for ties. These fixtures deliberately arrive in another order.
  const entries = [
    ['g', 3], ['b', 0], ['e', 2], ['j', 5], ['a', 0],
    ['h', 4], ['d', 1], ['i', 5], ['c', 1], ['f', 2],
  ] as const;
  const records = entries.flatMap(([id, rank]) => [record(`d-${id}`, at, none, rank), record(`u-${id}`, null, none, rank)]);
  const expectedDated = ['d-a', 'd-b', 'd-c', 'd-d', 'd-e', 'd-f', 'd-g', 'd-h', 'd-i', 'd-j'];
  const expectedUndated = ['u-a', 'u-b', 'u-c', 'u-d', 'u-e', 'u-f', 'u-g', 'u-h', 'u-i', 'u-j'];
  const permutations = [
    records,
    [...records].reverse(),
    [...records.slice(7), ...records.slice(0, 7)],
    [...records.filter((_, i) => i % 2 === 0), ...records.filter((_, i) => i % 2 === 1)],
    [19, 2, 11, 0, 17, 6, 15, 4, 13, 8, 1, 18, 3, 16, 5, 14, 7, 12, 9, 10].map(i => records[i]!),
  ];
  const view = { ...createFreeViewSession({ now: '2026-11-02T01:00:00Z', timeZone: 'UTC' }), k: 0, selectedScope: 'a' };
  for (let round = 0; round < 3; round++) for (const [index, input] of permutations.entries()) {
    const snapshot = { conversations: input, projects: [], tombstones: [] } as unknown as CatalogSnapshot;
    const projection = projectCatalog(snapshot, view), label = `round ${round}, permutation ${index}`;
    assert.equal(projection.dates.length, 1, label);
    assert.equal(projection.dates[0]!.date, '2026-11-02', label);
    assert.deepEqual(projection.dates[0]!.records.map(r => r.key), expectedDated, label);
    assert.deepEqual(projection.undatedNone.map(r => r.key), expectedUndated, label);
    assert.deepEqual(searchCatalog(snapshot, '', 'a').map(r => r.record.key), [...expectedDated, ...expectedUndated], label);
  }
});
