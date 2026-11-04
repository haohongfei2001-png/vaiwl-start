import type { ConversationRecord } from '../../contracts/free-v1.js';
import { dayLabel, instant } from './time.js';

/** Structural counterpart of the pure UI date/interval grouping input. */
export interface RecentPresentationInputGroup {
  key: string;
  date: string | null;
  records: ConversationRecord[];
}

export interface RecentPresentationGroup extends RecentPresentationInputGroup {
  kind: 'pinned' | 'today' | 'yesterday' | 'date';
}

export interface RecentPresentation {
  primary: RecentPresentationGroup[];
  remaining: RecentPresentationInputGroup[];
  /** Interval-only evidence has a period, but no known date. Always render under a neutral period label. */
  neutral: RecentPresentationInputGroup[];
}

/** Select presentation buckets only from the already scoped, eligible Recent projection. */
export function selectRecentPresentation(
  groups: readonly RecentPresentationInputGroup[],
  pinnedKeys: ReadonlySet<string> | readonly string[],
  today: string,
): RecentPresentation {
  const todayInstant = /^\d{4}-\d{2}-\d{2}$/.test(today) ? instant(`${today}T00:00:00Z`) : null;
  if (todayInstant === null) throw Error('invalid-day');
  const yesterday = dayLabel(todayInstant / 86_400_000 - 1);
  const pins = new Set(pinnedKeys);
  const seen = new Set<string>();
  const eligible = groups.map(group => ({
    ...group,
    records: group.records.filter(record => {
      if (seen.has(record.key)) return false;
      seen.add(record.key);
      return true;
    }),
  })).filter(group => group.records.length > 0);
  const used = new Set<string>();
  const primary: RecentPresentationGroup[] = [];
  const take = (kind: RecentPresentationGroup['kind'], date: string | null, matches: (record: ConversationRecord, group: RecentPresentationInputGroup) => boolean) => {
    const records: ConversationRecord[] = [];
    for (const group of eligible) for (const record of group.records) {
      if (!used.has(record.key) && matches(record, group)) {
        used.add(record.key);
        records.push(record);
      }
    }
    if (records.length) primary.push({ key: `primary:${kind}${kind === 'date' ? `:${date}` : ''}`, kind, date, records });
  };
  take('pinned', null, record => pins.has(record.key));
  take('today', today, (_record, group) => group.date === today);
  take('yesterday', yesterday, (_record, group) => group.date === yesterday);
  if (!primary.length) {
    const latestDate = eligible.reduce<string | null>((latest, group) => group.date !== null && (latest === null || group.date > latest) ? group.date : latest, null);
    if (latestDate !== null) take('date', latestDate, (_record, group) => group.date === latestDate);
  }
  const remaining: RecentPresentationInputGroup[] = [];
  const neutral: RecentPresentationInputGroup[] = [];
  for (const group of eligible) {
    const records = group.records.filter(record => !used.has(record.key));
    if (!records.length) continue;
    const destination = group.date === null ? neutral : remaining;
    destination.push({ ...group, records });
  }
  return { primary, remaining, neutral };
}
