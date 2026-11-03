import type { ConversationRecord, NativeTimeOrderEvidence, RecordOwner, VerifiedDisplayTimeFact } from '../../contracts/free-v1.js';
import { dayLabel, freeSegmentFor, instant, localDay } from './time.js';

export interface TimeProjectionView { H: 30; T: number; Z: string; now?: string }
export interface DisplayTimeProjection {
  /** Exact display time only; inferred bounds must never be formatted as a day. */
  at: string | null;
  directAt: string | null;
  lowerBound: string | null;
  upperBound: string | null;
  segment: number | null;
  date: string | null;
  sortTime: number | null;
  rank: number;
  basis: 'direct' | 'relative' | 'undated';
  sources: Array<'start-open' | 'browser-history' | VerifiedDisplayTimeFact['kind']>;
  evidenceIds: string[];
  invalidEvidenceIds: string[];
}
export function sameTimeOwner(a: RecordOwner, b: RecordOwner): boolean {
  return !!a && !!b && (a.kind === 'scoped' && b.kind === 'scoped' ? a.scopeKey === b.scopeKey
    : a.kind === 'unassigned' && b.kind === 'unassigned' && a.localProfileKey === b.localProfileKey && a.accountKey === null && b.accountKey === null);
}
export function recordTimeBoundary(record: ConversationRecord): string | null {
  return record.owner.kind === 'scoped' ? record.owner.scopeKey : record.localProject?.boundaryKey ?? record.displayTimeBoundaryKey ?? null;
}
function text(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= 512; }
/** Runtime validation also protects old databases and revoked/stale metadata. */
export function verifiedDisplayFacts(record: ConversationRecord, now: string, localProfileKey?: string): VerifiedDisplayTimeFact[] {
  const cutoff = instant(now); if (cutoff === null || !Array.isArray(record.displayTimeFacts)) return [];
  return record.displayTimeFacts.slice(0, 100).filter(fact => {
    if (!fact || !text(fact.id) || fact.revoked || !['message-sent', 'native-updated'].includes(fact.kind)
      || fact.semantic !== 'conversation-last-activity' || !sameTimeOwner(record.owner, fact.owner)
      || !text(fact.boundaryKey) || fact.boundaryKey !== recordTimeBoundary(record)
      || !text(fact.localProfileKey) || localProfileKey !== undefined && fact.localProfileKey !== localProfileKey
      || record.owner.kind === 'unassigned' && record.owner.localProfileKey !== fact.localProfileKey
      || !fact.source || !text(fact.source.adapterId) || !text(fact.source.adapterVersion) || !text(fact.source.field)) return false;
    const at = instant(fact.at), observed = instant(fact.observedAt);
    return at !== null && observed !== null && at <= observed && observed <= cutoff;
  });
}
function direct(record: ConversationRecord, now: string, profile?: string) {
  const cutoff = instant(now), facts = verifiedDisplayFacts(record, now, profile);
  const values: Array<{ at: number; source: DisplayTimeProjection['sources'][number] }> = [];
  if (cutoff !== null) {
    for (const [value, source] of [[record.activity?.lastConfirmedOpenAt, 'start-open'], [record.browserLastVisitAt, 'browser-history']] as const) {
      const at = instant(value); if (at !== null && at <= cutoff) values.push({ at, source });
    }
    for (const fact of facts) values.push({ at: instant(fact.at)!, source: fact.kind });
  }
  const latest = values.length ? Math.max(...values.map(v => v.at)) : null;
  return { latest, facts, sources: [...new Set(values.map(v => v.source))] };
}
export function directDisplayAt(record: ConversationRecord, now = new Date().toISOString(), profile?: string): string | null {
  const value = direct(record, now, profile).latest;
  return value === null ? null : new Date(value).toISOString();
}
type Bounds = { lower: number | null; upper: number | null; evidenceIds: Set<string> };
type Edge = { newer: string; older: string; evidenceId: string };
function stable(a: ConversationRecord, b: ConversationRecord): number { return a.stableRank - b.stableRank || a.key.localeCompare(b.key); }

/** Pure projection: chronological evidence changes placement, never stored activity. */
export function deriveDisplayTimes(records: ConversationRecord[], view: TimeProjectionView, orders: NativeTimeOrderEvidence[] = [], localProfileKey?: string): Map<string, DisplayTimeProjection> {
  const now = view.now ?? new Date().toISOString(), cutoff = instant(now);
  const byKey = new Map(records.map(record => [record.key, record]));
  const directTimes = new Map(records.map(record => [record.key, direct(record, now, localProfileKey)]));
  const bounds = new Map<string, Bounds>();
  const rejected = new Map<string, Set<string>>();
  const edges: Edge[] = [];
  const accepted: NativeTimeOrderEvidence[] = [];
  const reject = (order: NativeTimeOrderEvidence) => {
    for (const key of Array.isArray(order?.recordKeys) ? order.recordKeys : []) if (byKey.has(key)) {
      const ids = rejected.get(key) ?? new Set(); ids.add(order.id); rejected.set(key, ids);
    }
  };
  for (const order of Array.isArray(orders) ? orders.slice(0, 500) : []) {
    const observed = instant(order?.observedAt), expires = instant(order?.expiresAt);
    if (!order || cutoff === null || !text(order.id) || order.invalidated || order.verified !== true || order.semantic !== 'conversation-last-activity'
      || order.direction !== 'descending' || order.coverage !== 'complete' || order.pinned !== false || order.manual !== false
      || !text(order.localProfileKey) || localProfileKey !== undefined && order.localProfileKey !== localProfileKey
      || !text(order.boundaryKey) || observed === null || expires === null || observed > cutoff || expires < cutoff || expires <= observed
      || !order.source || !text(order.source.adapterId) || !text(order.source.adapterVersion) || !text(order.source.documentKey)
      || !Number.isSafeInteger(order.source.routeEpoch) || order.source.routeEpoch < 0 || !Number.isSafeInteger(order.source.sourceRevision) || order.source.sourceRevision < 0
      || !Array.isArray(order.recordKeys) || order.recordKeys.length < 2 || order.recordKeys.length > 10000 || new Set(order.recordKeys).size !== order.recordKeys.length
      || order.recordKeys.some(key => { const record = byKey.get(key); return !record || !sameTimeOwner(record.owner, order.owner)
        || recordTimeBoundary(record) !== order.boundaryKey || record.owner.kind === 'unassigned' && record.owner.localProfileKey !== order.localProfileKey; })) {
      reject(order); continue;
    }
    // A later native activity invalidates this ordering snapshot. Visits and Start
    // opens deliberately do not invalidate it or become chronological anchors.
    if (order.recordKeys.some(key => directTimes.get(key)!.facts.some(fact => instant(fact.at)! > observed))) { reject(order); continue; }
    const local = new Map<string, Bounds>();
    for (const key of order.recordKeys) {
      const facts = directTimes.get(key)!.facts;
      const lower = facts.length ? Math.max(...facts.map(f => instant(f.at)!)) : null;
      const fresh = facts.filter(f => instant(f.observedAt)! >= observed);
      const upper = fresh.length ? Math.max(...fresh.map(f => instant(f.at)!)) : observed;
      local.set(key, { lower, upper, evidenceIds: new Set([order.id]) });
    }
    // Unknown newer rows inherit a lower bound; unknown older rows inherit an upper
    // bound. Never copy an anchor's exact date into the unknown row.
    let lower: number | null = null;
    for (const key of [...order.recordKeys].reverse()) { const b = local.get(key)!; if (b.lower !== null) lower = Math.max(lower ?? -Infinity, b.lower); b.lower = lower; }
    let upper = observed;
    for (const key of order.recordKeys) { const b = local.get(key)!; upper = Math.min(upper, b.upper!); b.upper = upper; }
    if ([...local.values()].some(b => b.lower !== null && b.upper !== null && b.lower > b.upper)) { reject(order); continue; }
    accepted.push(order);
    for (const [key, incoming] of local) {
      const previous = bounds.get(key);
      if (!previous) bounds.set(key, incoming);
      else { previous.lower = incoming.lower === null ? previous.lower : Math.max(previous.lower ?? -Infinity, incoming.lower);
        previous.upper = Math.min(previous.upper ?? Infinity, incoming.upper!); previous.evidenceIds.add(order.id); }
    }
    for (let index = 1; index < order.recordKeys.length; index++) edges.push({ newer: order.recordKeys[index - 1]!, older: order.recordKeys[index]!, evidenceId: order.id });
  }
  // Conflicting intersections or cycles invalidate their entire connected component;
  // no other project/account loses valid chronology as a side effect.
  const adjacent = new Map<string, Set<string>>();
  for (const edge of edges) { const a = adjacent.get(edge.newer) ?? new Set(); a.add(edge.older); adjacent.set(edge.newer, a); const b = adjacent.get(edge.older) ?? new Set(); b.add(edge.newer); adjacent.set(edge.older, b); }
  const invalid = new Set<string>(); const visited = new Set<string>();
  for (const first of adjacent.keys()) {
    if (visited.has(first)) continue;
    const component: string[] = [], stack = [first];
    while (stack.length) { const key = stack.pop()!; if (visited.has(key)) continue; visited.add(key); component.push(key); for (const neighbor of adjacent.get(key) ?? []) stack.push(neighbor); }
    const set = new Set(component), componentEdges = edges.filter(e => set.has(e.newer));
    const indegree = new Map(component.map(key => [key, 0])); const outgoing = new Map<string, Set<string>>();
    for (const edge of componentEdges) { const targets = outgoing.get(edge.newer) ?? new Set(); if (!targets.has(edge.older)) indegree.set(edge.older, indegree.get(edge.older)! + 1); targets.add(edge.older); outgoing.set(edge.newer, targets); }
    const queue = component.filter(key => indegree.get(key) === 0); let count = 0;
    while (queue.length) { const key = queue.pop()!; count++; for (const older of outgoing.get(key) ?? []) { indegree.set(older, indegree.get(older)! - 1); if (indegree.get(older) === 0) queue.push(older); } }
    if (count !== component.length || component.some(key => { const b = bounds.get(key)!; return b.lower !== null && b.upper !== null && b.lower > b.upper; })) for (const key of component) invalid.add(key);
  }
  // Propagate intersections through all accepted order edges to support multiple
  // adjacent, independently verified anchor lists.
  const usableEdges = edges.filter(e => !invalid.has(e.newer) && !invalid.has(e.older));
  for (let pass = 0; pass < records.length; pass++) {
    let changed = false;
    for (const edge of usableEdges) {
      const newer = bounds.get(edge.newer)!, older = bounds.get(edge.older)!;
      if (older.lower !== null && (newer.lower === null || newer.lower < older.lower)) { newer.lower = older.lower; changed = true; }
      if (newer.upper !== null && (older.upper === null || older.upper > newer.upper)) { older.upper = newer.upper; changed = true; }
      if (newer.lower !== null && newer.upper !== null && newer.lower > newer.upper || older.lower !== null && older.upper !== null && older.lower > older.upper) {
        const stack = [edge.newer]; while (stack.length) { const key = stack.pop()!; if (invalid.has(key)) continue; invalid.add(key); for (const neighbor of adjacent.get(key) ?? []) stack.push(neighbor); }
      }
    }
    if (!changed) break;
  }
  for (const order of accepted) if (order.recordKeys.some(key => invalid.has(key))) reject(order);
  const out = new Map<string, DisplayTimeProjection>();
  for (const record of records) {
    const value = directTimes.get(record.key)!, inferred = invalid.has(record.key) ? undefined : bounds.get(record.key);
    const directAt = value.latest === null ? null : new Date(value.latest).toISOString();
    const lower = inferred ? Math.max(inferred.lower ?? -Infinity, value.latest ?? -Infinity) : value.latest;
    const upper = inferred ? Math.max(inferred.upper ?? -Infinity, value.latest ?? -Infinity) : value.latest;
    const lowerValue = lower === null || !Number.isFinite(lower) ? null : lower;
    const upperValue = upper === null || !Number.isFinite(upper) ? null : upper;
    const lowerBound = lowerValue === null ? null : new Date(lowerValue).toISOString(), upperBound = upperValue === null ? null : new Date(upperValue).toISOString();
    const lowerSegment = freeSegmentFor(lowerBound, view), upperSegment = freeSegmentFor(upperBound, view);
    const inferredSegment = lowerSegment !== null && lowerSegment === upperSegment ? lowerSegment : null;
    // Relative order with no useful interval must not erase an already usable
    // direct event. Promote it only when a bound proves a newer placement; retain
    // the raw range separately so later evidence can revise the display choice.
    const useRelative = !!inferred && (value.latest === null || inferredSegment !== null && lowerValue !== null && lowerValue > value.latest);
    const at = useRelative ? null : directAt;
    const segment = at ? freeSegmentFor(at, view) : inferredSegment;
    out.set(record.key, { at, directAt, lowerBound, upperBound, segment, date: at && segment !== null ? dayLabel(localDay(at, view.Z)) : null,
      sortTime: useRelative ? lowerValue : value.latest, rank: 0, basis: at ? 'direct' : inferred ? 'relative' : 'undated', sources: value.sources,
      evidenceIds: [...(inferred?.evidenceIds ?? [])], invalidEvidenceIds: [...(rejected.get(record.key) ?? [])] });
  }
  const finalEdges = usableEdges.filter(edge => {
    if (invalid.has(edge.newer) || invalid.has(edge.older)) return false;
    const olderDirect = directTimes.get(edge.older)!.latest;
    const newerMinimum = Math.max(bounds.get(edge.newer)?.lower ?? -Infinity, directTimes.get(edge.newer)!.latest ?? -Infinity);
    // Native activity order does not order later browser visits or Start opens.
    // Keep an edge only when the displayed older row cannot be newer by one of
    // those independent facts. Unknown-only rows still retain native order.
    return olderDirect === null || newerMinimum >= olderDirect;
  });
  const indegree = new Map(records.map(record => [record.key, 0])), outgoing = new Map<string, Set<string>>();
  for (const edge of finalEdges) { const next = outgoing.get(edge.newer) ?? new Set(); if (!next.has(edge.older)) indegree.set(edge.older, indegree.get(edge.older)! + 1); next.add(edge.older); outgoing.set(edge.newer, next); }
  const compare = (a: ConversationRecord, b: ConversationRecord) => (out.get(b.key)!.sortTime ?? -Infinity) - (out.get(a.key)!.sortTime ?? -Infinity) || stable(a, b);
  const ready = records.filter(record => indegree.get(record.key) === 0).sort(compare); let rank = 0;
  while (ready.length) { const record = ready.shift()!; out.get(record.key)!.rank = rank++; for (const key of outgoing.get(record.key) ?? []) { indegree.set(key, indegree.get(key)! - 1); if (indegree.get(key) === 0) { ready.push(byKey.get(key)!); ready.sort(compare); } } }
  return out;
}
