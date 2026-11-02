import type { ConversationRecord, ProjectRecord } from '../../contracts/free-v1.js';
import type { CatalogSnapshot } from '../storage/repository.js';
import { dayLabel, freeSegmentFor, instant, localDay } from './time.js';
export interface ProjectionView { H: 30; T: number; Z: string; k: number; selectedScope: string }
export interface ProjectCard { project: ProjectRecord; recent: ConversationRecord[]; older: ConversationRecord[]; undated: ConversationRecord[]; latestActiveAt: string | null; segment: number | null }
export type LocalProjectCandidate = NonNullable<ConversationRecord['localProjectCandidate']>;
export interface CandidateProjectCard { candidate: LocalProjectCandidate; recent: ConversationRecord[]; older: ConversationRecord[]; undated: ConversationRecord[]; latestDisplayAt: string | null; segment: number | null; stableRank: number }
export interface DateGroup { date: string; records: ConversationRecord[] }
export interface PendingDateGroup extends DateGroup { basis: 'browser-history' | 'confirmed-open' }
export interface CatalogProjection { projects: ProjectCard[]; candidateProjects: CandidateProjectCard[]; undatedCandidateProjects: CandidateProjectCard[]; dates: DateGroup[]; pendingDates: PendingDateGroup[]; unknown: ConversationRecord[]; undatedNone: ConversationRecord[]; undatedProjects: ProjectCard[] }
export function compareRecords(a: ConversationRecord, b: ConversationRecord): number {
  const aTime = instant(a.activity?.lastConfirmedOpenAt), bTime = instant(b.activity?.lastConfirmedOpenAt);
  return (bTime ?? -Infinity) - (aTime ?? -Infinity) || a.stableRank - b.stableRank || a.key.localeCompare(b.key);
}
function scoped(snapshot: CatalogSnapshot, selectedScope: string): ConversationRecord[] {
  const removed = new Set(snapshot.tombstones.map(t => t.key));
  return snapshot.conversations.filter(r => !removed.has(r.key) && (selectedScope === 'unassigned' ? r.owner.kind === 'unassigned' && r.owner.localProfileKey === snapshot.localProfileKey : r.owner.kind === 'scoped' && r.owner.scopeKey === selectedScope));
}
function localCandidate(record: ConversationRecord): LocalProjectCandidate | null {
  return record.owner.kind === 'unassigned' && record.membership.state === 'UNKNOWN'
    && record.membership.reason !== 'conflicting-evidence' && record.membership.reason !== 'source-revoked'
    ? record.localProjectCandidate ?? null : null;
}
function pendingPlacement(record: ConversationRecord, view: ProjectionView): { at: string | null; segment: number | null; basis: PendingDateGroup['basis'] } {
  const activeSegment = freeSegmentFor(record.activity?.lastConfirmedOpenAt, view);
  const basis = activeSegment === null ? 'browser-history' : 'confirmed-open';
  const at = basis === 'confirmed-open' ? record.activity!.lastConfirmedOpenAt : record.browserLastVisitAt;
  return { at, basis, segment: activeSegment ?? freeSegmentFor(at, view) };
}
export function projectCatalog(snapshot: CatalogSnapshot, view: ProjectionView): CatalogProjection {
  if (view.H !== 30 || !Number.isSafeInteger(view.k) || view.k < 0) throw Error('invalid-view');
  const records = scoped(snapshot, view.selectedScope).sort(compareRecords);
  const out: CatalogProjection = { projects: [], candidateProjects: [], undatedCandidateProjects: [], dates: [], pendingDates: [], unknown: [], undatedNone: [], undatedProjects: [] };
  const projects = snapshot.projects.filter(p => p.scopeKey === view.selectedScope);
  const projectIds = new Set(projects.map(p => p.projectId));
  for (const project of projects) {
    const members = records.filter(r => r.membership.state === 'PROJECT' && r.membership.projectId === project.projectId);
    // Future/invalid activities are not treated as fresh. Undated children remain with the parent.
    const dated = members.filter(r => freeSegmentFor(r.activity?.lastConfirmedOpenAt, view) !== null);
    const latestActiveAt = dated[0]?.activity?.lastConfirmedOpenAt ?? null;
    const segment = freeSegmentFor(latestActiveAt, view);
    const card: ProjectCard = { project, latestActiveAt, segment, recent: [], older: [], undated: [] };
    for (const record of members) {
      const own = freeSegmentFor(record.activity?.lastConfirmedOpenAt, view);
      if (own === null || segment === null) card.undated.push(record);
      else if (own === segment) card.recent.push(record);
      else card.older.push(record);
    }
    if (segment === null) out.undatedProjects.push(card);
    else if (segment === view.k) out.projects.push(card);
  }
  // Candidate keys include their local observation boundary. They are never
  // keyed by title or joined with the formally scoped native Project table.
  const candidateGroups = new Map<string, { candidate: LocalProjectCandidate; members: ConversationRecord[] }>();
  const candidateMemberKeys = new Set<string>();
  for (const record of records) {
    const candidate = localCandidate(record); if (!candidate) continue;
    const group = candidateGroups.get(candidate.key) ?? { candidate, members: [] };
    if ((instant(candidate.observedAt) ?? -Infinity) > (instant(group.candidate.observedAt) ?? -Infinity)) group.candidate = candidate;
    group.members.push(record); candidateMemberKeys.add(record.key); candidateGroups.set(candidate.key, group);
  }
  for (const { candidate, members } of candidateGroups.values()) {
    const rows = members.map(record => ({ record, ...pendingPlacement(record, view) })).sort((a, b) =>
      (a.segment === null ? Infinity : a.segment) - (b.segment === null ? Infinity : b.segment)
      || (instant(b.at) ?? -Infinity) - (instant(a.at) ?? -Infinity) || a.record.stableRank - b.record.stableRank || a.record.key.localeCompare(b.record.key));
    const latest = rows.find(row => row.segment !== null);
    const card: CandidateProjectCard = { candidate, latestDisplayAt: latest?.at ?? null, segment: latest?.segment ?? null,
      recent: [], older: [], undated: [], stableRank: Math.min(...members.map(record => record.stableRank)) };
    for (const row of rows) {
      if (row.segment === null) card.undated.push(row.record);
      else if (row.segment === card.segment) card.recent.push(row.record);
      else card.older.push(row.record);
    }
    if (card.segment === null) out.undatedCandidateProjects.push(card);
    else if (card.segment === view.k) out.candidateProjects.push(card);
  }
  out.candidateProjects.sort((a, b) => instant(b.latestDisplayAt)! - instant(a.latestDisplayAt)! || a.stableRank - b.stableRank || a.candidate.key.localeCompare(b.candidate.key));
  out.undatedCandidateProjects.sort((a, b) => a.stableRank - b.stableRank || a.candidate.key.localeCompare(b.candidate.key));
  const dates = new Map<string, ConversationRecord[]>();
  const pendingDates = new Map<string, PendingDateGroup>();
  for (const record of records) {
    if (candidateMemberKeys.has(record.key)) continue;
    if (record.membership.state === 'UNKNOWN' || record.membership.state === 'PROJECT' && !projectIds.has(record.membership.projectId)) {
      // Time browsing does not assert account ownership or native membership. A
      // confirmed local open replaces this record's history-only placement, but
      // neither this projection nor browserLastVisitAt creates an OpenDay.
      const { at, basis, segment } = pendingPlacement(record, view);
      if (segment === null) out.unknown.push(record);
      else if (segment === view.k) {
        const date = dayLabel(localDay(at!, view.Z)), key = `${basis}:${date}`;
        const group = pendingDates.get(key) ?? { date, basis, records: [] };
        group.records.push(record); pendingDates.set(key, group);
      }
      continue;
    }
    if (record.membership.state !== 'NONE') continue;
    const segment = freeSegmentFor(record.activity?.lastConfirmedOpenAt, view);
    if (segment === null) out.undatedNone.push(record);
    else if (segment === view.k) { const date = dayLabel(localDay(record.activity!.lastConfirmedOpenAt, view.Z)); const items = dates.get(date) ?? []; items.push(record); dates.set(date, items); }
  }
  out.projects.sort((a, b) => instant(b.latestActiveAt)! - instant(a.latestActiveAt)! || a.project.stableRank - b.project.stableRank || a.project.key.localeCompare(b.project.key));
  out.undatedProjects.sort((a, b) => a.project.stableRank - b.project.stableRank || a.project.key.localeCompare(b.project.key));
  out.dates = [...dates.entries()].sort(([a], [b]) => b.localeCompare(a)).map(([date, rows]) => ({ date, records: rows }));
  out.pendingDates = [...pendingDates.values()].sort((a, b) => b.date.localeCompare(a.date) || a.basis.localeCompare(b.basis));
  for (const group of out.pendingDates) if (group.basis === 'browser-history') group.records.sort((a, b) =>
    instant(b.browserLastVisitAt)! - instant(a.browserLastVisitAt)! || a.stableRank - b.stableRank || a.key.localeCompare(b.key));
  return out;
}
export interface SearchResult { record: ConversationRecord; project: ProjectRecord | null; candidateProject: LocalProjectCandidate | null; path: string }
export function searchCatalog(snapshot: CatalogSnapshot, query: string, selectedScope: string): SearchResult[] {
  const q = query.normalize('NFKC').trim().toLocaleLowerCase();
  const projects = new Map(snapshot.projects.filter(p => p.scopeKey === selectedScope).map(p => [p.projectId, p]));
  return scoped(snapshot, selectedScope).sort(compareRecords).flatMap(record => {
    const project = record.membership.state === 'PROJECT' ? projects.get(record.membership.projectId) ?? null : null;
    const candidateProject = localCandidate(record);
    if (![record.nativeTitle ?? '', project?.nativeTitle ?? '', candidateProject?.nativeTitle ?? '', record.canonicalUrl].some(value => value.normalize('NFKC').toLocaleLowerCase().includes(q))) return [];
    const path = project ? `${project.nativeTitle ?? '未命名项目'} · 原生项目` : candidateProject ? `${candidateProject.nativeTitle} · 本地候选项目／原生归属待确认` : record.membership.state === 'NONE' ? '无项目' : record.owner.kind === 'unassigned' ? '本地历史 · 账号未绑定／归属待确认' : '归属待确认';
    return [{ record, project, candidateProject, path }];
  });
}
