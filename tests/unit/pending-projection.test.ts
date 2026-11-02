import test from 'node:test';
import assert from 'node:assert/strict';
import type { ConversationRecord, ProjectRecord } from '../../contracts/free-v1.js';
import type { CatalogSnapshot } from '../../src/storage/repository.js';
import { projectCatalog, searchCatalog } from '../../src/domain/projection.js';
import { createFreeViewSession } from '../../src/domain/time.js';

const now = '2026-11-02T06:00:00.000Z';
const view = { ...createFreeViewSession({ now, timeZone: 'Asia/Shanghai' }), k: 0, selectedScope: 'unassigned' };
function candidate(key: string, browserLastVisitAt: string | null, rank = 0): ConversationRecord {
  return { key, provider: 'chatgpt', conversationId: key, canonicalUrl: `https://chatgpt.com/c/${key}`, nativeTitle: key,
    titleBasis: 'browser-history', titleObservedAt: now, availability: 'unverified', firstSeenAt: now, lastSeenAt: now,
    browserLastVisitAt, activity: null, stableRank: rank, revision: 1,
    owner: { kind: 'unassigned', localProfileKey: 'profile', accountKey: null },
    membership: { state: 'UNKNOWN', projectId: null, reason: 'scope-unverified' } };
}
function catalog(conversations: ConversationRecord[]): CatalogSnapshot {
  return { localProfileKey: 'profile', conversations, projects: [], tombstones: [] } as unknown as CatalogSnapshot;
}
function keys(projection: ReturnType<typeof projectCatalog>): string[] {
  return [...projection.pendingDates.flatMap(group => group.records), ...projection.unknown].map(record => record.key);
}

test('contract correction: 564 synthetic history records become dated local windows without any activity mutation', () => {
  const records = Array.from({ length: 564 }, (_, index) => candidate(`history-${index}`, new Date(Date.parse(now) - (index % 94) * 86_400_000).toISOString(), index));
  const snapshot = catalog(records), before = JSON.stringify(snapshot), seen: string[] = [];
  for (let k = 0; k < 4; k++) {
    const projection = projectCatalog(snapshot, { ...view, k });
    assert.ok(projection.pendingDates.length > 0);
    assert.ok(projection.pendingDates.every(group => group.basis === 'browser-history'));
    assert.equal(projection.unknown.length, 0);
    assert.equal(projection.dates.length, 0);
    assert.equal(projection.projects.length, 0);
    seen.push(...keys(projection));
  }
  assert.equal(seen.length, 564);
  assert.equal(new Set(seen).size, 564);
  assert.equal(JSON.stringify(snapshot), before);
  assert.ok(snapshot.conversations.every(record => record.activity === null));
  assert.equal(searchCatalog(snapshot, '', 'unassigned').length, 564);
});

test('confirmed local opening replaces only its history placement and remains distinct from formal NONE', () => {
  const row = candidate('opened-locally', '2026-08-01T05:00:00.000Z');
  row.activity = { firstConfirmedOpenAt: now, lastConfirmedOpenAt: now, lastActiveDate: '2026-11-02', timeZone: 'Asia/Shanghai' };
  const snapshot = catalog([row, candidate('history-today', now)]), projection = projectCatalog(snapshot, view);
  assert.deepEqual(projection.pendingDates.map(group => [group.basis, group.date, group.records.map(record => record.key)]), [
    ['browser-history', '2026-11-02', ['history-today']], ['confirmed-open', '2026-11-02', ['opened-locally']],
  ]);
  assert.equal(projection.dates.length, 0);
  assert.equal(keys(projectCatalog(snapshot, { ...view, k: 3 })).length, 0);
  assert.equal(row.browserLastVisitAt, '2026-08-01T05:00:00.000Z');
});

test('history windows retain local-calendar boundaries, including exact 30-day boundary and DST', () => {
  const rows = [candidate('last-current', '2026-10-03T16:00:00.000Z'), candidate('first-older', '2026-10-03T15:59:59.999Z')];
  assert.deepEqual(keys(projectCatalog(catalog(rows), view)), ['last-current']);
  assert.deepEqual(keys(projectCatalog(catalog(rows), { ...view, k: 1 })), ['first-older']);
  const dstView = { ...createFreeViewSession({ now: '2026-11-02T05:30:00.000Z', timeZone: 'America/New_York' }), k: 0, selectedScope: 'unassigned' };
  const dstRows = [candidate('first-hour', '2026-11-01T05:30:00.000Z'), candidate('repeated-hour', '2026-11-01T06:30:00.000Z')];
  const dstProjection = projectCatalog(catalog(dstRows), dstView);
  assert.equal(dstProjection.pendingDates.length, 1);
  assert.equal(dstProjection.pendingDates[0]!.date, '2026-11-01');
  assert.deepEqual(keys(dstProjection), ['repeated-hour', 'first-hour']);
});

test('missing, invalid and future history dates remain reachable without inventing a current date', () => {
  const rows = [candidate('missing', null), candidate('invalid', '2026-02-30T00:00:00Z'), candidate('future', '2026-11-03T01:00:00Z')];
  const projection = projectCatalog(catalog(rows), view);
  assert.equal(projection.pendingDates.length, 0);
  assert.deepEqual(projection.unknown.map(record => record.key), ['future', 'invalid', 'missing']);
  assert.equal(searchCatalog(catalog(rows), '', 'unassigned').length, 3);
});

test('local history projection and search exclude other profiles, scoped accounts and tombstones', () => {
  const local = candidate('local', now), foreignProfile = candidate('foreign-profile', now), accountA = candidate('account-a', now), accountB = candidate('account-b', now), removed = candidate('removed', now);
  foreignProfile.owner = { kind: 'unassigned', localProfileKey: 'another-profile', accountKey: null };
  accountA.owner = { kind: 'scoped', scopeKey: 'a' }; accountB.owner = { kind: 'scoped', scopeKey: 'b' };
  const snapshot = catalog([local, foreignProfile, accountA, accountB, removed]);
  snapshot.tombstones = [{ key: removed.key } as any];
  assert.deepEqual(keys(projectCatalog(snapshot, view)), ['local']);
  assert.deepEqual(keys(projectCatalog(snapshot, { ...view, selectedScope: 'a' })), ['account-a']);
  assert.deepEqual(searchCatalog(snapshot, '', 'unassigned').map(result => result.record.key), ['local']);
  assert.deepEqual(searchCatalog(snapshot, '', 'b').map(result => result.record.key), ['account-b']);
});

test('a verified membership update moves the same scoped record out of pending windows without duplication', () => {
  const row = candidate('stable-key', now); row.owner = { kind: 'scoped', scopeKey: 'a' };
  row.activity = { firstConfirmedOpenAt: now, lastConfirmedOpenAt: now, lastActiveDate: '2026-11-02', timeZone: 'Asia/Shanghai' };
  const snapshot = catalog([row]), scopedView = { ...view, selectedScope: 'a' };
  assert.deepEqual(keys(projectCatalog(snapshot, scopedView)), [row.key]);
  row.membership = { state: 'NONE', projectId: null, evidenceId: 'none', confirmedAt: now };
  let projection = projectCatalog(snapshot, scopedView);
  assert.equal(keys(projection).length, 0);
  assert.deepEqual(projection.dates.flatMap(group => group.records).map(record => record.key), [row.key]);
  const projectId = 'g-p-1234567890abcdef1234567890abcdef';
  row.membership = { state: 'PROJECT', projectId, evidenceId: 'project', confirmedAt: now };
  snapshot.projects = [{ key: 'project', scopeKey: 'a', projectId, nativeTitle: 'Native project', canonicalUrl: `https://chatgpt.com/g/${projectId}/project`, evidenceId: 'project', observedAt: now, membershipCoverage: 'observed-only', stableRank: 0, revision: 1 } satisfies ProjectRecord];
  projection = projectCatalog(snapshot, scopedView);
  assert.equal(keys(projection).length, 0); assert.equal(projection.dates.length, 0);
  assert.deepEqual(projection.projects.flatMap(project => project.recent).map(record => record.key), [row.key]);
});

test('history ordering uses visit time then stable rank and key consistently across input order', () => {
  const rows = [candidate('later', now, 9), candidate('b', '2026-11-02T01:00:00Z', 2), candidate('a', '2026-11-02T01:00:00Z', 2), candidate('first-rank', '2026-11-02T01:00:00Z', 0)];
  for (const input of [rows, [...rows].reverse(), [rows[2]!, rows[0]!, rows[3]!, rows[1]!]]) {
    assert.deepEqual(keys(projectCatalog(catalog(input), view)), ['later', 'first-rank', 'a', 'b']);
  }
});

const projectCandidate = (key: string, nativeTitle = 'Same native title') => ({ key, projectId: 'g-p-1234567890abcdef1234567890abcdef', nativeTitle,
  canonicalUrl: 'https://chatgpt.com/g/g-p-1234567890abcdef1234567890abcdef/project', observedAt: now, basis: 'local-project-observation' as const });

test('local candidate project keeps historical children in one window without claiming confirmed membership', () => {
  const recent = candidate('recent-member', now, 2), older = candidate('old-member', '2026-08-01T00:00:00Z', 1), undated = candidate('undated-member', null, 3);
  for (const row of [recent, older, undated]) row.localProjectCandidate = projectCandidate('observation-boundary-a');
  const snapshot = catalog([older, undated, recent]), before = JSON.stringify(snapshot), projection = projectCatalog(snapshot, view);
  assert.equal(projection.projects.length, 0); assert.equal(projection.pendingDates.length, 0); assert.equal(projection.unknown.length, 0);
  assert.equal(projection.candidateProjects.length, 1);
  const card = projection.candidateProjects[0]!;
  assert.equal(card.latestDisplayAt, now);
  assert.deepEqual(card.recent.map(row => row.key), ['recent-member']);
  assert.deepEqual(card.older.map(row => row.key), ['old-member']);
  assert.deepEqual(card.undated.map(row => row.key), ['undated-member']);
  assert.equal(projectCatalog(snapshot, { ...view, k: 3 }).candidateProjects.length, 0);
  assert.equal(JSON.stringify(snapshot), before);
  assert.ok(snapshot.conversations.every(row => row.membership.state === 'UNKNOWN' && row.activity === null));
  const result = searchCatalog(snapshot, 'Same native title', 'unassigned');
  assert.equal(result.length, 3); assert.ok(result.every(item => item.project === null && item.path.includes('本地候选项目／原生归属待确认')));
});

test('candidate keys separate observation boundaries even for the same Project ID and title', () => {
  const first = candidate('first-boundary', now), second = candidate('second-boundary', now);
  first.localProjectCandidate = projectCandidate('binding-a'); second.localProjectCandidate = projectCandidate('binding-b');
  const projection = projectCatalog(catalog([first, second]), view);
  assert.equal(projection.candidateProjects.length, 2);
  assert.deepEqual(projection.candidateProjects.map(card => card.candidate.key), ['binding-a', 'binding-b']);
  assert.equal(new Set(projection.candidateProjects.flatMap(card => card.recent).map(row => row.key)).size, 2);
});

test('candidate metadata cannot take precedence over confirmed membership or cross into a scoped account', () => {
  const row = candidate('later-confirmed', now); row.localProjectCandidate = projectCandidate('local-boundary');
  row.owner = { kind: 'scoped', scopeKey: 'a' };
  row.membership = { state: 'NONE', projectId: null, evidenceId: 'native-none', confirmedAt: now };
  row.activity = { firstConfirmedOpenAt: now, lastConfirmedOpenAt: now, lastActiveDate: '2026-11-02', timeZone: 'Asia/Shanghai' };
  const snapshot = catalog([row]), projection = projectCatalog(snapshot, { ...view, selectedScope: 'a' });
  assert.equal(projection.candidateProjects.length, 0); assert.equal(projection.undatedCandidateProjects.length, 0);
  assert.deepEqual(projection.dates.flatMap(group => group.records).map(item => item.key), ['later-confirmed']);
  assert.equal(searchCatalog(snapshot, 'Same native title', 'a').length, 0);
  assert.equal(projectCatalog(snapshot, view).candidateProjects.length, 0);
});

test('conflicted or revoked candidate evidence falls back to explicit pending dates; undated candidates stay reachable', () => {
  const conflict = candidate('conflicted', now), revoked = candidate('revoked', now), undated = candidate('undated-candidate', null);
  for (const row of [conflict, revoked, undated]) row.localProjectCandidate = projectCandidate(row.key);
  conflict.membership = { state: 'UNKNOWN', projectId: null, reason: 'conflicting-evidence' };
  revoked.membership = { state: 'UNKNOWN', projectId: null, reason: 'source-revoked' };
  const snapshot = catalog([conflict, revoked, undated]), projection = projectCatalog(snapshot, view);
  assert.equal(projection.candidateProjects.length, 0);
  assert.deepEqual(keys(projection), ['conflicted', 'revoked']);
  assert.deepEqual(projection.undatedCandidateProjects[0]!.undated.map(row => row.key), ['undated-candidate']);
  assert.equal(searchCatalog(snapshot, 'Same native title', 'unassigned').length, 1);
});
