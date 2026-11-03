import type { ConversationRecord } from '../../contracts/free-v1.js';
import type { DateGroup } from '../domain/projection.js';

export interface RecentDisplayGroup { key: string; date: string | null; records: ConversationRecord[] }

/** Keep the domain's order across exact-date and interval-only rows. An interval
 * can interrupt a date group without acquiring that group's precise date. */
export function recentDisplayGroups(dates: DateGroup[], intervalRecords: ConversationRecord[], times: ReadonlyMap<string, { rank: number }>, period: number): RecentDisplayGroup[] {
  const rows = [...dates.flatMap(group => group.records.map(record => ({ date: group.date as string | null, record }))),
    ...intervalRecords.map(record => ({ date: null, record }))];
  rows.sort((a, b) => (times.get(a.record.key)?.rank ?? Infinity) - (times.get(b.record.key)?.rank ?? Infinity)
    || a.record.stableRank - b.record.stableRank || a.record.key.localeCompare(b.record.key));
  const groups: RecentDisplayGroup[] = [], seen = new Set<string>(), usedDates = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.record.key)) continue;
    seen.add(row.record.key);
    const previous = groups.at(-1);
    if (previous && previous.date === row.date) { previous.records.push(row.record); continue; }
    const key = row.date === null ? `period-${period}:${row.record.key}`
      : usedDates.has(row.date) ? `${row.date}:${row.record.key}` : row.date;
    if (row.date !== null) usedDates.add(row.date);
    groups.push({ key, date: row.date, records: [row.record] });
  }
  return groups;
}
