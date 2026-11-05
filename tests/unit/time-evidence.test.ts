import test from 'node:test';
import assert from 'node:assert/strict';
import type { ConversationRecord, NativeTimeOrderEvidence, ProjectRecord, VerifiedDisplayTimeFact } from '../../contracts/free-v1.js';
import type { CatalogSnapshot } from '../../src/storage/repository.js';
import { projectCatalog, searchCatalog, searchProjects } from '../../src/domain/projection.js';
import { deriveDisplayTimes } from '../../src/domain/time-evidence.js';
import { createFreeViewSession, PERIOD_DAYS } from '../../src/domain/time.js';
import { selectRecentPresentation } from '../../src/domain/recent-presentation.js';
import { recentDisplayGroups } from '../../src/ui/recent-groups.js';

const NOW = '2026-11-03T12:00:00.000Z';
const view = { ...createFreeViewSession({ now: NOW, timeZone: 'UTC' }), selectedScope: 'a', k: 0, now: NOW };
const date = (days: number) => new Date(Date.parse(NOW) - days * 86400000).toISOString();
const membership = { state: 'PROJECT' as const, projectId: 'project-a', evidenceId: 'member', confirmedAt: NOW };
function row(key: string, days: number | null, project = false): ConversationRecord {
  return { key, provider: 'chatgpt', conversationId: key, canonicalUrl: `https://chatgpt.com/c/${key}`, owner: { kind: 'scoped', scopeKey: 'a' },
    membership: project ? membership : { state: 'UNKNOWN', projectId: null, reason: 'no-membership-source' }, nativeTitle: key, titleBasis: 'native-label', titleObservedAt: NOW,
    availability: 'unverified', firstSeenAt: NOW, lastSeenAt: NOW, browserLastVisitAt: days === null ? null : date(days), activity: null, stableRank: 0, revision: 1 };
}
const project = (key = 'project-a'): ProjectRecord => ({ key, scopeKey: 'a', projectId: key, nativeTitle: 'Research', canonicalUrl: `https://chatgpt.com/g/${key}/project`, evidenceId: 'member',
  observedAt: NOW, membershipCoverage: 'observed-only', stableRank: 0, revision: 1 });
function snapshot(conversations: ConversationRecord[], projects: ProjectRecord[] = [], timeOrders: NativeTimeOrderEvidence[] = []): CatalogSnapshot & { timeOrders: NativeTimeOrderEvidence[] } {
  return { localProfileKey: 'profile', conversations, projects, tombstones: [], timeOrders } as unknown as CatalogSnapshot & { timeOrders: NativeTimeOrderEvidence[] };
}
function fact(record: ConversationRecord, days: number): VerifiedDisplayTimeFact {
  return { id: `fact:${record.key}`, kind: 'native-updated', semantic: 'conversation-last-activity', at: date(days), observedAt: NOW,
    localProfileKey: 'profile', owner: record.owner, boundaryKey: record.owner.kind === 'scoped' ? record.owner.scopeKey : record.displayTimeBoundaryKey!,
    source: { adapterId: 'verified-native-list', adapterVersion: '1', field: 'updated_at' } };
}
function anchor(record: ConversationRecord, days: number): ConversationRecord { record.displayTimeFacts = [fact(record, days)]; return record; }
function order(keys: string[], overrides: Partial<NativeTimeOrderEvidence> = {}): NativeTimeOrderEvidence {
  return { id: 'order:a', localProfileKey: 'profile', owner: { kind: 'scoped', scopeKey: 'a' }, boundaryKey: 'a', recordKeys: keys, semantic: 'conversation-last-activity', direction: 'descending',
    verified: true, coverage: 'complete', pinned: false, manual: false, observedAt: NOW, expiresAt: '2026-11-04T12:00:00.000Z',
    source: { adapterId: 'verified-native-list', adapterVersion: '1', documentKey: 'document', routeEpoch: 1, sourceRevision: 3 }, ...overrides };
}
const visible = (data: ReturnType<typeof projectCatalog>) => [...data.dates.flatMap(x => x.records), ...data.pendingDates.flatMap(x => x.records), ...data.segmentOnly];
const keys = (rows: ConversationRecord[]) => rows.map(row => row.key);

test('active Project retains every undated member in 更早 without fabricating activity', () => {
  const data = snapshot([row('recent', 2, true), row('old', 65, true), row('unknown-a', null, true), row('unknown-b', null, true)], [project()]);
  const before = JSON.stringify(data), result = projectCatalog(data, view);
  assert.deepEqual(keys(result.projects[0]!.recent), ['recent']);
  assert.deepEqual(keys(result.projects[0]!.older), ['old', 'unknown-a', 'unknown-b']);
  assert.equal(result.projects[0]!.undated.length, 0); assert.equal(JSON.stringify(data), before);
});
test('historical Project stays whole in its only interval including undated members', () => {
  const data = snapshot([row('latest', 35, true), row('old', 90, true), row('unknown', null, true)], [project()]);
  assert.equal(projectCatalog(data, view).projects.length, 0);
  const result = projectCatalog(data, { ...view, k: 1 });
  assert.deepEqual(keys(result.projects[0]!.recent), ['latest']); assert.deepEqual(keys(result.projects[0]!.older), ['old', 'unknown']);
  assert.equal(projectCatalog(data, { ...view, k: 3 }).projects.length, 0);
});
test('all-undated and empty real Projects remain reachable globally exactly once and searchable', () => {
  const data = snapshot([row('undated', null, true)], [project(), project('empty')]);
  const result = projectCatalog(data, view);
  assert.equal(result.projects.length, 0); assert.equal(result.undatedProjects.length, 2);
  assert.deepEqual(keys(result.undatedProjects.find(card => card.project.key === 'project-a')!.older), ['undated']);
  assert.equal(result.undatedProjects.find(card => card.project.key === 'empty')!.older.length, 0);
  assert.equal(projectCatalog(data, { ...view, k: 1 }).undatedProjects.length, 0);
  assert.equal(searchProjects(data, 'Research', 'a').length, 2); assert.equal(data.conversations.length, 1);
});
test('UNKNOWN and NONE have natural 最近 placement but remain distinct stored states', () => {
  const unknown = row('unknown', 2), none = row('none', 5); none.membership = { state: 'NONE', projectId: null, evidenceId: 'none', confirmedAt: NOW };
  const data = snapshot([unknown, none]), result = projectCatalog(data, view);
  assert.deepEqual(new Set(keys(visible(result))), new Set(['unknown', 'none']));
  assert.equal(unknown.membership.state, 'UNKNOWN'); assert.equal(none.membership.state, 'NONE');
  assert.ok(searchCatalog(data, '', 'a').every(result => result.path === '最近'));
});
test('undated ungrouped stays out of homepage yet search can open and then place it', () => {
  const record = row('undated', null), data = snapshot([record]);
  assert.equal(visible(projectCatalog(data, view)).length, 0); assert.equal(searchCatalog(data, 'undated', 'a').length, 1);
  record.activity = { firstConfirmedOpenAt: NOW, lastConfirmedOpenAt: NOW, lastActiveDate: '2026-11-03', timeZone: 'UTC' };
  assert.deepEqual(keys(visible(projectCatalog(data, view))), ['undated']);
});
test('verified chronological order plus a compatible two-day anchor proves current interval only', () => {
  const a = row('a', null), b = anchor(row('b', null), 2), c = anchor(row('c', null), 5);
  const data = snapshot([c, b, a], [], [order(['a', 'b', 'c'])]), before = JSON.stringify(data);
  const result = projectCatalog(data, view), inferred = result.displayTimes.get('a')!;
  assert.equal(inferred.segment, 0); assert.equal(inferred.lowerBound, date(2)); assert.equal(inferred.upperBound, NOW);
  assert.equal(inferred.at, null); assert.equal(inferred.date, null); assert.deepEqual(keys(result.segmentOnly), ['a']);
  assert.equal(a.activity, null); assert.equal(JSON.stringify(data), before);
});
test('35-day lower anchor alone cannot place its newer unknown in current interval', () => {
  const a = row('a', null), b = anchor(row('b', null), 35), result = projectCatalog(snapshot([a, b], [], [order(['a', 'b'])]), view);
  assert.equal(result.displayTimes.get('a')!.segment, null); assert.equal(result.displayTimes.get('a')!.at, null);
  assert.equal(visible(result).length, 0); assert.equal(searchCatalog(snapshot([a, b]), 'a', 'a').some(result => result.record.key === 'a'), true);
});
test('two compatible historical anchors prove an interval without a fabricated day', () => {
  const newer = anchor(row('newer', null), 35), a = row('a', null), older = anchor(row('older', null), 40);
  const data = snapshot([older, a, newer], [], [order(['newer', 'a', 'older'])]);
  const result = projectCatalog(data, { ...view, k: 1 });
  assert.deepEqual(keys(result.segmentOnly), ['a']); assert.equal(result.displayTimes.get('a')!.at, null);
  assert.equal(result.displayTimes.get('a')!.lowerBound, date(40)); assert.equal(result.displayTimes.get('a')!.upperBound, date(35));
});
test('browser visits and Start opens never masquerade as native chronological anchors', () => {
  const a = row('a', null), b = row('b', 2); b.activity = { firstConfirmedOpenAt: date(1), lastConfirmedOpenAt: date(1), lastActiveDate: '2026-11-02', timeZone: 'UTC' };
  const result = projectCatalog(snapshot([a, b], [], [order(['a', 'b'])]), view);
  assert.equal(result.displayTimes.get('a')!.segment, null); assert.equal(result.displayTimes.get('a')!.lowerBound, null);
  assert.deepEqual(keys(visible(result)), ['b']);
});
test('pinning, manual order, partial lists and unverified order cannot infer dates or relative rank', () => {
  for (const invalid of [{ pinned: true }, { manual: true }, { coverage: 'partial' }, { verified: false }, { direction: 'ascending' }]) {
    const a = row('z', null), b = anchor(row('a', null), 2);
    const result = deriveDisplayTimes([a, b], view, [order(['z', 'a'], invalid as any)], 'profile');
    assert.equal(result.get('z')!.segment, null); assert.equal(result.get('z')!.lowerBound, null);
    assert.ok(result.get('z')!.rank > result.get('a')!.rank);
  }
});
test('conflicting native time anchors invalidate ordering while keeping direct facts', () => {
  const a = anchor(row('a', null), 10), unknown = row('unknown', null), b = anchor(row('b', null), 2);
  const result = deriveDisplayTimes([a, unknown, b], view, [order(['a', 'unknown', 'b'])], 'profile');
  assert.equal(result.get('unknown')!.segment, null); assert.equal(result.get('a')!.at, date(10)); assert.equal(result.get('b')!.at, date(2));
  assert.deepEqual(result.get('unknown')!.invalidEvidenceIds, ['order:a']);
});
test('cross-profile, account and observed identity boundary anchors are rejected', () => {
  const a = row('a', null), b = anchor(row('b', null), 2);
  for (const invalid of [{ localProfileKey: 'other-profile' }, { owner: { kind: 'scoped', scopeKey: 'other' } }, { boundaryKey: 'other' }]) {
    assert.equal(deriveDisplayTimes([a, b], view, [order(['a', 'b'], invalid as any)], 'profile').get('a')!.segment, null);
  }
  a.owner = b.owner = { kind: 'unassigned', localProfileKey: 'profile', accountKey: null };
  a.displayTimeBoundaryKey = 'account-a'; b.displayTimeBoundaryKey = 'account-b'; b.displayTimeFacts = [fact(b, 2)];
  const localOrder = order(['a', 'b'], { owner: a.owner, boundaryKey: 'account-a' });
  assert.equal(deriveDisplayTimes([a, b], view, [localOrder], 'profile').get('a')!.segment, null);
});
test('expired, revoked, missing-member and post-snapshot activity invalidate old ordering', () => {
  const a = row('a', null), b = anchor(row('b', null), 2);
  for (const invalid of [{ expiresAt: date(1) }, { invalidated: true }, { recordKeys: ['a', 'b', 'missing'] }, { observedAt: date(3) }]) {
    assert.equal(deriveDisplayTimes([a, b], view, [order(['a', 'b'], invalid)], 'profile').get('a')!.segment, null);
  }
});
test('relative order with no usable date sorts project 更早 and never invents activity', () => {
  const a = row('z-newer', null, true), b = row('a-older', null, true);
  const data = snapshot([b, a], [project()], [order(['z-newer', 'a-older'])]), result = projectCatalog(data, view);
  assert.deepEqual(keys(result.undatedProjects[0]!.older), ['z-newer', 'a-older']);
  assert.equal(result.displayTimes.get(a.key)!.segment, null); assert.equal(result.displayTimes.get(b.key)!.segment, null);
  assert.ok(data.conversations.every(record => record.activity === null));
});
test('multi-list intersections combine compatible bounds and reject conflicting cycles', () => {
  const newer = anchor(row('newer', null), 35), a = row('a', null), older = anchor(row('older', null), 40);
  const orders = [order(['newer', 'a']), order(['a', 'older'], { id: 'order:b' })];
  assert.equal(deriveDisplayTimes([newer, a, older], view, orders, 'profile').get('a')!.segment, 1);
  const cycle = [...orders, order(['older', 'newer'], { id: 'cycle' })];
  // This list is independently inconsistent with exact anchors, so it cannot
  // destroy valid lists; a true unknown-only cycle instead invalidates its component.
  assert.equal(deriveDisplayTimes([newer, a, older], view, cycle, 'profile').get('a')!.segment, 1);
  const b = row('b', null), c = row('c', null);
  const actualCycle = [order(['a', 'b']), order(['b', 'c'], { id: 'b' }), order(['c', 'a'], { id: 'c' })];
  const projected = deriveDisplayTimes([c, b, a], view, actualCycle, 'profile');
  assert.ok([...projected.values()].every(time => time.evidenceIds.length === 0 && time.segment === null));
});
test('stronger time or Project evidence relocates the same record once with no source mutation', () => {
  const a = row('a', null), b = anchor(row('b', null), 35), data = snapshot([a, b], [project()], [order(['a', 'b'])]);
  assert.equal(visible(projectCatalog(data, view)).length, 0);
  a.browserLastVisitAt = date(1);
  assert.deepEqual(keys(visible(projectCatalog(data, view))), ['a']);
  a.membership = membership;
  const result = projectCatalog(data, view);
  assert.equal(visible(result).length, 0); assert.deepEqual(keys(result.projects[0]!.recent), ['a']);
  assert.equal(data.conversations.length, 2); assert.equal(a.activity, null);
});
test('relative interval respects exact 30-day calendar boundary and does not round across it', () => {
  const newer = anchor(row('newer', null), 29), a = row('a', null), older = anchor(row('older', null), 30);
  const result = deriveDisplayTimes([newer, a, older], view, [order(['newer', 'a', 'older'])], 'profile');
  assert.equal(result.get('newer')!.segment, 0); assert.equal(result.get('older')!.segment, 1); assert.equal(result.get('a')!.segment, null);
});
test('same-name Projects remain separate and a tombstoned child cannot be resurrected by inference', () => {
  const first = row('first', 1, true), second = row('second', 1, true); second.membership = { ...membership, projectId: 'other' };
  const data = snapshot([first, second], [project(), project('other')], [order(['first', 'second'])]); data.tombstones = [{ key: 'second', removedAt: NOW, reason: 'user-removed' }];
  const result = projectCatalog(data, view);
  assert.equal(result.projects.length, 1); assert.equal(result.undatedProjects.length, 1);
  assert.equal(searchProjects(data, 'Research', 'a').length, 2); assert.equal(searchCatalog(data, 'second', 'a').length, 0);
});

for (const H of PERIOD_DAYS) {
  test(`${H}-day interval inference requires both bounds within the same period and preserves source facts`, () => {
    const newer = anchor(row('newer', null), H + 1), unknown = row('unknown', null), older = anchor(row('older', null), H + 3);
    const data = snapshot([newer, unknown, older], [], [order(['newer', 'unknown', 'older'])]);
    const before = JSON.stringify(data);
    const result = projectCatalog(data, { ...view, H, k: 1 });
    assert.deepEqual(keys(result.segmentOnly), ['unknown']);
    assert.equal(result.displayTimes.get('unknown')!.at, null);
    assert.equal(result.displayTimes.get('unknown')!.date, null);
    assert.equal(JSON.stringify(data), before);
    const boundaryNewer = anchor(row('boundary-newer', null), H - 1), boundaryOlder = anchor(row('boundary-older', null), H);
    const crossing = deriveDisplayTimes([boundaryNewer, unknown, boundaryOlder], { ...view, H }, [order(['boundary-newer', 'unknown', 'boundary-older'])], 'profile');
    assert.equal(crossing.get('unknown')!.segment, null);
    assert.equal(crossing.get('unknown')!.date, null);
  });

  test(`${H}-day Recent pins cannot borrow prior-period, other-scope, or Project members`, () => {
    const current = row('current', 1), old = row('old', H), member = row('member', 0, true), otherScope = row('other-scope', 0);
    otherScope.owner = { kind: 'scoped', scopeKey: 'other' };
    const data = snapshot([current, old, member, otherScope], [project()]);
    const before = JSON.stringify(data), projection = projectCatalog(data, { ...view, H });
    const groups = recentDisplayGroups([...projection.dates, ...projection.pendingDates], projection.segmentOnly, projection.displayTimes, 0);
    const result = selectRecentPresentation(groups, ['current', 'old', 'member', 'other-scope'], '2026-11-03');
    assert.deepEqual(result.primary.map(group => [group.kind, keys(group.records)]), [['pinned', ['current']]]);
    assert.deepEqual(result.remaining, []);
    assert.deepEqual(result.neutral, []);
    assert.deepEqual(keys(projection.projects[0]!.recent), ['member']);
    assert.equal(JSON.stringify(data), before);
  });
}
test('raw discovery, refresh and project observation timestamps never become activity', () => {
  const record = row('discovered-today', null, true); record.firstSeenAt = record.lastSeenAt = record.titleObservedAt = NOW;
  const data = snapshot([record], [project()]), result = projectCatalog(data, view);
  assert.equal(result.projects.length, 0); assert.equal(result.undatedProjects.length, 1); assert.equal(result.displayTimes.get(record.key)!.segment, null);
  assert.equal(record.activity, null);
});
test('old source facts provide lower bounds, not unjustified historical upper bounds', () => {
  const a = row('a', null), b = anchor(row('b', null), 40), c = anchor(row('c', null), 45);
  b.displayTimeFacts![0]!.observedAt = date(35);
  const result = deriveDisplayTimes([a, b, c], view, [order(['b', 'a', 'c'])], 'profile');
  assert.equal(result.get('a')!.lowerBound, date(45)); assert.equal(result.get('a')!.upperBound, NOW); assert.equal(result.get('a')!.segment, null);
});


test('insufficient native order never removes an existing historical visit from its interval', () => {
  const visited = row('visited', 35), unknown = row('unknown', null);
  const data = snapshot([unknown, visited], [], [order(['visited', 'unknown'])]);
  const result = projectCatalog(data, { ...view, k: 1 });
  assert.deepEqual(keys(visible(result)), ['visited']);
  assert.equal(result.displayTimes.get('visited')!.at, date(35));
  assert.equal(result.displayTimes.get('unknown')!.segment, null);
});


test('later Start or browser activity outranks native chronological order for display', () => {
  for (const useStart of [false, true]) {
    const nativeNewer = anchor(row('native-newer', null, true), 2), opened = anchor(row('opened-now', null, true), 5);
    if (useStart) opened.activity = { firstConfirmedOpenAt: NOW, lastConfirmedOpenAt: NOW, lastActiveDate: '2026-11-03', timeZone: 'UTC' };
    else opened.browserLastVisitAt = NOW;
    const data = snapshot([nativeNewer, opened], [project()], [order(['native-newer', 'opened-now'])]);
    const result = projectCatalog(data, view);
    assert.deepEqual(keys(result.projects[0]!.recent), ['opened-now', 'native-newer']);
    assert.equal(result.displayTimes.get('opened-now')!.at, NOW);
  }
});
