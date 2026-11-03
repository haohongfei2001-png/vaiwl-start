import test from 'node:test';
import assert from 'node:assert/strict';
import type { ConversationRecord } from '../../contracts/free-v1.js';
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
