import test from 'node:test';
import assert from 'node:assert/strict';
import type { ConversationRecord } from '../../contracts/free-v1.js';
import { projectCatalog } from '../../src/domain/projection.js';
import { createFreeViewSession } from '../../src/domain/time.js';
import type { CatalogSnapshot } from '../../src/storage/repository.js';
import { recentDisplayGroups } from '../../src/ui/recent-groups.js';

const row = (key: string, stableRank = 0) => ({ key, stableRank }) as ConversationRecord;
test('最近 inserts a relatively newer row before its precise-date anchor without fabricating a date', () => {
  const inferred = row('inferred'), anchor = row('anchor');
  const dates = [{ date: '2026-11-01', records: [anchor] }], interval = [inferred];
  const before = JSON.stringify({ dates, interval });
  const groups = recentDisplayGroups(dates, interval, new Map([['inferred', { rank: 0 }], ['anchor', { rank: 1 }]]), 0);
  assert.deepEqual(groups.map(group => [group.date, group.records.map(record => record.key)]), [[null, ['inferred']], ['2026-11-01', ['anchor']]]);
  assert.equal(JSON.stringify({ dates, interval }), before);
});

test('an interval between same-day anchors preserves relative order and distinct expansion keys', () => {
  const newer = row('newer'), between = row('between'), older = row('older');
  const groups = recentDisplayGroups([{ date: '2026-11-01', records: [older, newer] }], [between],
    new Map([['newer', { rank: 0 }], ['between', { rank: 1 }], ['older', { rank: 2 }]]), 0);
  assert.deepEqual(groups.flatMap(group => group.records.map(record => record.key)), ['newer', 'between', 'older']);
  assert.deepEqual(groups.map(group => group.date), ['2026-11-01', null, '2026-11-01']);
  assert.equal(new Set(groups.map(group => group.key)).size, 3);
});

test('incomparable interval rows use stable fallback and no duplicate conversation', () => {
  const a = row('a', 1), b = row('b', 2);
  const groups = recentDisplayGroups([], [b, a, a], new Map(), 2);
  assert.deepEqual(groups[0]!.records.map(record => record.key), ['a', 'b']);
  assert.equal(groups[0]!.date, null);
});

for (const now of ['2026-11-03T12:00:00.000Z', '2026-11-04T00:00:01.200Z']) {
  test(`564 interleaved history records retain 94 calendar groups and every record across four windows at ${now}`, () => {
    const at = Date.parse(now) - 1000;
    const conversations: ConversationRecord[] = Array.from({ length: 564 }, (_, n) => ({
      key: `staging:ui-history-${n}`, provider: 'chatgpt', conversationId: String(n), canonicalUrl: `https://chatgpt.com/c/${n}`,
      nativeTitle: `合成历史 ${n + 1}`, titleBasis: 'browser-history', titleObservedAt: now, availability: 'unverified',
      firstSeenAt: now, lastSeenAt: now, browserLastVisitAt: new Date(at - (n % 94) * 86400000).toISOString(),
      activity: null, stableRank: 50000 + n, revision: 1,
      owner: { kind: 'unassigned', localProfileKey: 'profile', accountKey: null },
      membership: { state: 'UNKNOWN', projectId: null, reason: 'scope-unverified' },
    }));
    const snapshot = { conversations, projects: [], tombstones: [], localProfileKey: 'profile' } as unknown as CatalogSnapshot;
    const before = JSON.stringify(snapshot);
    const view = { ...createFreeViewSession({ now, timeZone: 'UTC' }), selectedScope: 'unassigned', now };
    const displayed: string[] = [], displayedDates: string[] = [];
    for (let k = 0; k < 4; k++) {
      const projected = projectCatalog(snapshot, { ...view, k });
      const groups = recentDisplayGroups([...projected.dates, ...projected.pendingDates], projected.segmentOnly, projected.displayTimes, k);
      assert.equal(groups.length, k === 3 ? 4 : 30);
      assert.ok(groups.every(group => group.date !== null && group.records.length === 6));
      const dates = groups.map(group => group.date!);
      assert.deepEqual(dates, [...dates].sort().reverse());
      assert.equal(new Set(groups.map(group => group.key)).size, groups.length);
      const expected = conversations.filter((_, n) => Math.floor((n % 94) / 30) === k)
        .sort((a, b) => Date.parse(b.browserLastVisitAt!) - Date.parse(a.browserLastVisitAt!) || a.stableRank - b.stableRank)
        .map(record => record.key);
      assert.deepEqual(groups.flatMap(group => group.records.map(record => record.key)), expected);
      displayed.push(...expected); displayedDates.push(...dates);
    }
    assert.equal(new Set(displayed).size, 564);
    assert.equal(new Set(displayedDates).size, 94);
    assert.equal(JSON.stringify(snapshot), before);
  });
}
