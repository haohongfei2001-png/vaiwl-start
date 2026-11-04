import test from 'node:test';
import assert from 'node:assert/strict';
import type { ConversationRecord } from '../../contracts/free-v1.js';
import { selectRecentPresentation } from '../../src/domain/recent-presentation.js';
import type { RecentPresentationInputGroup } from '../../src/domain/recent-presentation.js';

const row = (key: string) => ({ key, stableRank: 0, activity: null }) as ConversationRecord;
const group = (key: string, date: string | null, keys: string[]): RecentPresentationInputGroup => ({ key, date, records: keys.map(row) });
const keys = (groups: readonly RecentPresentationInputGroup[]) => groups.flatMap(group => group.records.map(record => record.key));

test('nonempty pinned, today, and yesterday buckets dedupe records without changing facts', () => {
  const groups = [
    group('today-a', '2026-11-04', ['today', 'pin-today']),
    group('period-0:interval', null, ['interval', 'pin-interval']),
    group('today-b', '2026-11-04', ['today-later', 'today']),
    group('yesterday', '2026-11-03', ['yesterday', 'pin-yesterday']),
    group('older', '2026-11-01', ['older']),
  ];
  const before = JSON.stringify(groups);
  const result = selectRecentPresentation(groups, new Set(['pin-today', 'pin-interval', 'pin-yesterday', 'outside']), '2026-11-04');
  assert.deepEqual(result.primary.map(group => [group.kind, group.date, keys([group])]), [
    ['pinned', null, ['pin-today', 'pin-interval', 'pin-yesterday']],
    ['today', '2026-11-04', ['today', 'today-later']],
    ['yesterday', '2026-11-03', ['yesterday']],
  ]);
  assert.deepEqual(keys(result.remaining), ['older']);
  assert.deepEqual(result.neutral.map(group => [group.date, keys([group])]), [[null, ['interval']]]);
  const all = keys([...result.primary, ...result.remaining, ...result.neutral]);
  assert.equal(new Set(all).size, all.length);
  assert.equal(all.length, 8);
  assert.equal(JSON.stringify(groups), before);
});

test('historical fallback uses the nearest real date and retains neutral intervals and remaining order', () => {
  const groups = [
    group('period-2:newer', null, ['newer-interval']),
    group('latest-a', '2026-09-10', ['a']),
    group('period-2:between', null, ['between-interval']),
    group('latest-b', '2026-09-10', ['b']),
    group('older-a', '2026-09-08', ['c']),
    group('oldest', '2026-09-03', ['d']),
  ];
  const result = selectRecentPresentation(groups, ['outside-period'], '2026-11-04');
  assert.deepEqual(result.primary.map(group => [group.kind, group.date, keys([group])]), [['date', '2026-09-10', ['a', 'b']]]);
  assert.deepEqual(result.remaining.map(group => group.key), ['older-a', 'oldest']);
  assert.deepEqual(keys(result.neutral), ['newer-interval', 'between-interval']);
  assert.ok(result.neutral.every(group => group.date === null));
  assert.equal(keys([...result.primary, ...result.remaining, ...result.neutral]).length, 6);
});

test('interval-only evidence remains reachable with no fabricated date or date disclosure', () => {
  const groups = [group('period-0:a', null, ['a', 'b']), group('period-0:c', null, ['c', 'a'])];
  const result = selectRecentPresentation(groups, [], '2026-11-04');
  assert.deepEqual(result.primary, []);
  assert.deepEqual(result.remaining, []);
  assert.deepEqual(keys(result.neutral), ['a', 'b', 'c']);
  const pinned = selectRecentPresentation(groups, ['b'], '2026-11-04');
  assert.deepEqual(pinned.primary.map(group => [group.kind, group.date, keys([group])]), [['pinned', null, ['b']]]);
  assert.deepEqual(keys(pinned.neutral), ['a', 'c']);
});

test('pins suppress fallback, empty buckets stay absent, and real today handles calendar rollover', () => {
  const pinned = selectRecentPresentation([group('old', '2026-09-10', ['pin', 'other'])], ['pin'], '2026-11-04');
  assert.deepEqual(pinned.primary.map(group => group.kind), ['pinned']);
  assert.deepEqual(keys(pinned.remaining), ['other']);
  const rollover = selectRecentPresentation([group('last-year', '2025-12-31', ['year'])], [], '2026-01-01');
  assert.deepEqual(rollover.primary.map(group => group.kind), ['yesterday']);
  assert.deepEqual(selectRecentPresentation([], ['absent'], '2026-11-04'), { primary: [], remaining: [], neutral: [] });
  assert.throws(() => selectRecentPresentation([], [], '2026-02-30'), /invalid-day/);
});
