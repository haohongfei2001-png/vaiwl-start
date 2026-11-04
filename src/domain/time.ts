/** Pure calendar functions adapted from VAIWL at 1903b00f; see UPSTREAM.md. */
const DAY = 86_400_000;
export const PERIOD_DAYS = [7, 30, 90] as const;
export type PeriodDays = (typeof PERIOD_DAYS)[number];
export function isPeriodDays(value: unknown): value is PeriodDays {
  return value === 7 || value === 30 || value === 90;
}
export function normalizePeriodDays(value: unknown, fallback: PeriodDays = 30): PeriodDays {
  return isPeriodDays(value) ? value : fallback;
}
const dayFormatters = new Map<string, Intl.DateTimeFormat>();
const instantCache = new Map<string, number | null>();
export function instant(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  if (instantCache.has(value)) return instantCache.get(value)!;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  let parsed: number | null = null;
  if (m) {
    const [year, month, day, hour, minute, second] = m.slice(1, 7).map(Number);
    const check = new Date(0); check.setUTCFullYear(year!, month! - 1, day);
    const offsetOK = m[7] === 'Z' || (Number(m[7]!.slice(1, 3)) <= 23 && Number(m[7]!.slice(4)) <= 59);
    if (check.getUTCFullYear() === year && check.getUTCMonth() === month! - 1 && check.getUTCDate() === day && hour! <= 23 && minute! <= 59 && second! <= 59 && offsetOK) {
      const n = Date.parse(value); if (Number.isFinite(n)) parsed = n;
    }
  }
  if (value.length <= 32) {
    if (instantCache.size >= 256) instantCache.delete(instantCache.keys().next().value!);
    instantCache.set(value, parsed);
  }
  return parsed;
}
export function validateTimeZone(zone: unknown): string {
  if (typeof zone !== 'string' || zone.length > 100 || !zone || /^[+-]/.test(zone)) throw Error('invalid-time-zone');
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: zone }).resolvedOptions().timeZone; }
  catch { throw Error('invalid-time-zone'); }
}
export function localDay(value: string | number, timeZone: string): number {
  const n = typeof value === 'number' ? value : instant(value);
  if (n === null || !Number.isFinite(n)) throw Error('invalid-instant');
  let formatter = dayFormatters.get(timeZone);
  if (!formatter) {
    validateTimeZone(timeZone);
    formatter = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
    if (dayFormatters.size >= 16) dayFormatters.delete(dayFormatters.keys().next().value!);
    dayFormatters.set(timeZone, formatter);
  }
  const parts = formatter.formatToParts(n);
  const get = (key: string) => Number(parts.find(p => p.type === key)!.value);
  // Date.UTC treats 00–99 as 1900–1999; explicit year preserves valid Gregorian dates.
  const date = new Date(0); date.setUTCFullYear(get('year'), get('month') - 1, get('day')); date.setUTCHours(0, 0, 0, 0);
  return date.getTime() / DAY;
}
export interface TimeSession { H: PeriodDays; T: number; Z: string; policyRevision: number }
export function createFreeViewSession({ now, timeZone, H = 30, policyRevision = 0 }: { now: string; timeZone: string; H?: PeriodDays; policyRevision?: number }): TimeSession {
  if (!isPeriodDays(H) || !Number.isSafeInteger(policyRevision) || policyRevision < 0) throw Error('invalid-free-policy');
  return Object.freeze({ H, T: localDay(now, timeZone), Z: timeZone, policyRevision });
}
export function freeSegmentFor(value: unknown, session: Pick<TimeSession, 'H' | 'T' | 'Z'>): number | null {
  const n = instant(value); if (n === null) return null;
  const day = localDay(n, session.Z); return day > session.T ? null : Math.floor((session.T - day) / session.H);
}
export function dayLabel(day: number): string {
  if (!Number.isSafeInteger(day)) throw Error('invalid-day');
  return new Date(day * DAY).toISOString().slice(0, 10);
}
export function freeWindowFor(k: number, session: Pick<TimeSession, 'H' | 'T'>): { start: string; endExclusive: string } {
  if (!Number.isSafeInteger(k) || k < 0) throw Error('invalid-segment');
  const end = session.T + 1 - session.H * k;
  return { start: dayLabel(end - session.H), endExclusive: dayLabel(end) };
}
export function relocateFreeSegment({ candidateDay }: { candidateDay: number | null }, session: Pick<TimeSession, 'H' | 'T'>): number {
  return candidateDay === null ? 0 : Math.max(0, Math.floor((session.T - candidateDay) / session.H));
}

/** Keep the current period current; otherwise retain the old period's inclusive end-day as the anchor. */
export function reanchorFreeSegment(k: number, previous: Pick<TimeSession, 'H' | 'T'>, next: Pick<TimeSession, 'H' | 'T'>): number {
  if (!Number.isSafeInteger(k) || k < 0) throw Error('invalid-segment');
  if (!isPeriodDays(previous.H) || !isPeriodDays(next.H) || !Number.isSafeInteger(previous.T) || !Number.isSafeInteger(next.T)) throw Error('invalid-free-policy');
  if (k === 0) return 0;
  return relocateFreeSegment({ candidateDay: previous.T - previous.H * k }, next);
}
