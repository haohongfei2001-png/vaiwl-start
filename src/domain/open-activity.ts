import type { ActivitySummary, ConfirmedOpenDay, OpenIntent } from '../../contracts/free-v1.js';
import { instant } from './time.js';
export function upsertOpenDay(previous: ConfirmedOpenDay | undefined, intent: OpenIntent, recordKey: string): ConfirmedOpenDay {
  const base: ConfirmedOpenDay = { recordKey, timeZone: intent.issuedTimeZone, localDate: intent.issuedLocalDate, firstOpenedAt: intent.issuedAt, lastOpenedAt: intent.issuedAt, activityUnit: 1, firstIntentId: intent.id, lastIntentId: intent.id };
  if (!previous) return base;
  if (previous.recordKey !== recordKey || previous.timeZone !== base.timeZone || previous.localDate !== base.localDate) throw Error('activity-day-key-mismatch');
  const first = instant(intent.issuedAt)! < instant(previous.firstOpenedAt)!;
  const last = instant(intent.issuedAt)! > instant(previous.lastOpenedAt)!;
  return { ...previous, activityUnit: 1, ...(first ? { firstOpenedAt: intent.issuedAt, firstIntentId: intent.id } : {}), ...(last ? { lastOpenedAt: intent.issuedAt, lastIntentId: intent.id } : {}) };
}
export function activitySummary(previous: ActivitySummary | null, intent: OpenIntent): ActivitySummary {
  if (!previous) return { firstConfirmedOpenAt: intent.issuedAt, lastConfirmedOpenAt: intent.issuedAt, lastActiveDate: intent.issuedLocalDate, timeZone: intent.issuedTimeZone };
  return {
    firstConfirmedOpenAt: instant(previous.firstConfirmedOpenAt)! <= instant(intent.issuedAt)! ? previous.firstConfirmedOpenAt : intent.issuedAt,
    ...(instant(previous.lastConfirmedOpenAt)! >= instant(intent.issuedAt)! ? { lastConfirmedOpenAt: previous.lastConfirmedOpenAt, lastActiveDate: previous.lastActiveDate, timeZone: previous.timeZone } : { lastConfirmedOpenAt: intent.issuedAt, lastActiveDate: intent.issuedLocalDate, timeZone: intent.issuedTimeZone }),
  };
}
