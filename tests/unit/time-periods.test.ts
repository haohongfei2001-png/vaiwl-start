import test from 'node:test';
import assert from 'node:assert/strict';
import { createFreeViewSession, dayLabel, freeSegmentFor, freeWindowFor, isPeriodDays, localDay, normalizePeriodDays, PERIOD_DAYS, reanchorFreeSegment } from '../../src/domain/time.js';
import type { PeriodDays } from '../../src/domain/time.js';

const NOW = '2026-11-03T12:00:00.000Z';
const before = (days: number) => new Date(Date.parse(NOW) - days * 86_400_000).toISOString();

test('period policy accepts only 7/30/90 and retains the 30-day default', () => {
  assert.deepEqual(PERIOD_DAYS, [7, 30, 90]);
  assert.equal(createFreeViewSession({ now: NOW, timeZone: 'UTC' }).H, 30);
  for (const invalid of [0, 1, 29, 31, 91, '7', null, undefined, NaN]) {
    assert.equal(isPeriodDays(invalid), false);
    assert.equal(normalizePeriodDays(invalid), 30);
  }
  for (const H of PERIOD_DAYS) {
    assert.equal(isPeriodDays(H), true);
    assert.equal(normalizePeriodDays(H), H);
    assert.equal(createFreeViewSession({ now: NOW, timeZone: 'UTC', H }).H, H);
  }
  assert.throws(() => createFreeViewSession({ now: NOW, timeZone: 'UTC', H: 8 as PeriodDays }), /invalid-free-policy/);
});

for (const H of PERIOD_DAYS) {
  test(`${H}-day periods use inclusive local days, contiguous boundaries, and no future segment`, () => {
    const session = createFreeViewSession({ now: NOW, timeZone: 'UTC', H });
    assert.equal(freeSegmentFor(before(0), session), 0);
    assert.equal(freeSegmentFor(before(H - 1), session), 0);
    assert.equal(freeSegmentFor(before(H), session), 1);
    assert.equal(freeSegmentFor(before(H * 2 - 1), session), 1);
    assert.equal(freeSegmentFor(before(H * 2), session), 2);
    assert.equal(freeSegmentFor(before(-1), session), null);
    assert.deepEqual(freeWindowFor(0, session), { start: dayLabel(session.T - H + 1), endExclusive: '2026-11-04' });
    assert.equal(freeWindowFor(1, session).endExclusive, freeWindowFor(0, session).start);
  });
}

test('local-calendar periods survive both New York DST transitions and local midnight', () => {
  for (const [now, start, beforeStart, firstInPeriod] of [
    ['2026-03-09T04:30:00Z', '2026-03-03', '2026-03-03T04:59:59Z', '2026-03-03T05:00:00Z'],
    ['2026-11-02T05:30:00Z', '2026-10-27', '2026-10-27T03:59:59Z', '2026-10-27T04:00:00Z'],
  ] as const) {
    const session = createFreeViewSession({ now, timeZone: 'America/New_York', H: 7 });
    assert.equal(freeWindowFor(0, session).start, start);
    assert.equal(freeSegmentFor(beforeStart, session), 1);
    assert.equal(freeSegmentFor(firstInPeriod, session), 0);
  }
  assert.equal(localDay('2026-03-08T06:59:59Z', 'America/New_York'), localDay('2026-03-08T07:00:00Z', 'America/New_York'));
  assert.equal(localDay('2026-11-01T05:59:59Z', 'America/New_York'), localDay('2026-11-01T06:00:00Z', 'America/New_York'));
  assert.equal(localDay('2026-11-02T05:00:00Z', 'America/New_York') - localDay('2026-11-02T04:59:59Z', 'America/New_York'), 1);
  assert.equal(dayLabel(localDay('2026-11-03T23:59:59Z', 'Asia/Shanghai')), '2026-11-04');
});

test('period changes preserve the historical end-day anchor and keep the current segment current', () => {
  const initial = createFreeViewSession({ now: NOW, timeZone: 'UTC' });
  for (const oldH of PERIOD_DAYS) for (const H of PERIOD_DAYS) {
    const previous = { H: oldH, T: initial.T };
    const next = { H, T: initial.T + 1 };
    assert.equal(reanchorFreeSegment(0, previous, next), 0);
    for (const k of [1, 2, 9]) {
      const anchor = previous.T - previous.H * k;
      const result = reanchorFreeSegment(k, previous, next);
      assert.ok(anchor <= next.T - H * result);
      assert.ok(anchor >= next.T - H * (result + 1) + 1);
    }
  }
  assert.equal(reanchorFreeSegment(1, initial, { ...initial, H: 7 }), 4);
  assert.equal(reanchorFreeSegment(1, initial, { ...initial, H: 90 }), 0);
  assert.throws(() => reanchorFreeSegment(-1, initial, initial), /invalid-segment/);
  assert.throws(() => reanchorFreeSegment(0.5, initial, initial), /invalid-segment/);
});
