import type { ConversationRecord, LocalObservedProject, ProjectRecord } from '../../contracts/free-v1.js';
import type { CatalogSnapshot } from '../storage/repository.js';
import { dayLabel, freeSegmentFor, instant, localDay } from './time.js';
export interface ProjectionView { H: 30; T: number; Z: string; k: number; selectedScope: string; now?: string }
export interface ProjectCard { project: ProjectRecord; recent: ConversationRecord[]; older: ConversationRecord[]; undated: ConversationRecord[]; latestActiveAt: string | null; latestDisplayAt: string | null; segment: number | null }
export type LocalProjectCandidate = NonNullable<ConversationRecord['localProjectCandidate']>;
export interface CandidateProjectCard { candidate: LocalProjectCandidate; recent: ConversationRecord[]; older: ConversationRecord[]; undated: ConversationRecord[]; latestDisplayAt: string | null; segment: number | null; stableRank: number }
export interface LocalObservedProjectCard { project: LocalObservedProject; recent: ConversationRecord[]; older: ConversationRecord[]; undated: ConversationRecord[]; latestDisplayAt: string | null; segment: number | null }
export interface DateGroup { date: string; records: ConversationRecord[] }
export type PendingDateGroup = DateGroup;
export interface CatalogProjection { projects: ProjectCard[]; localProjects: LocalObservedProjectCard[]; undatedLocalProjects: LocalObservedProjectCard[]; candidateProjects: CandidateProjectCard[]; undatedCandidateProjects: CandidateProjectCard[]; dates: DateGroup[]; pendingDates: PendingDateGroup[]; unknown: ConversationRecord[]; undatedNone: ConversationRecord[]; undatedProjects: ProjectCard[] }
/** Display metadata only: never writes activity/OpenDay or transfers visits across owners. */
export function lastDisplayAt(record: ConversationRecord, now = new Date().toISOString()): string | null {
  const cutoff = instant(now); if (cutoff === null) return null;
  let latest: number | null = null;
  for (const value of [record.activity?.lastConfirmedOpenAt, record.browserLastVisitAt]) {
    const time = instant(value);
    if (time !== null && time <= cutoff && (latest === null || time > latest)) latest = time;
  }
  return latest === null ? null : new Date(latest).toISOString();
}
export function compareRecords(a: ConversationRecord, b: ConversationRecord, now = new Date().toISOString()): number {
  const aTime = instant(lastDisplayAt(a, now)), bTime = instant(lastDisplayAt(b, now));
  return (bTime ?? -Infinity) - (aTime ?? -Infinity) || a.stableRank - b.stableRank || a.key.localeCompare(b.key);
}
function scoped(snapshot: CatalogSnapshot, selectedScope: string): ConversationRecord[] {
  const removed = new Set(snapshot.tombstones.map(t => t.key));
  return snapshot.conversations.filter(r => !removed.has(r.key) && (selectedScope === 'unassigned' ? r.owner.kind === 'unassigned' && r.owner.localProfileKey === snapshot.localProfileKey : r.owner.kind === 'scoped' && r.owner.scopeKey === selectedScope));
}
function localCandidate(record: ConversationRecord): LocalProjectCandidate | null {
  return !record.localProject && record.owner.kind === 'unassigned' && record.membership.state === 'UNKNOWN'
    && record.membership.reason !== 'conflicting-evidence' && record.membership.reason !== 'source-revoked'
    ? record.localProjectCandidate ?? null : null;
}
function observedProject(record: ConversationRecord, projects: Map<string, LocalObservedProject>): LocalObservedProject | null {
  if (record.owner.kind !== 'unassigned' || record.membership.state !== 'UNKNOWN'
    || record.membership.reason === 'conflicting-evidence' || record.membership.reason === 'source-revoked' || record.localProject?.state !== 'observed') return null;
  const project = projects.get(record.localProject.projectKey);
  return project && project.localProfileKey === record.owner.localProfileKey && project.boundaryKey === record.localProject.boundaryKey ? project : null;
}
function pendingPlacement(record: ConversationRecord, view: ProjectionView): { at: string | null; segment: number | null } {
  const at = lastDisplayAt(record, view.now);
  return { at, segment: freeSegmentFor(at, view) };
}
export function projectCatalog(snapshot: CatalogSnapshot, view: ProjectionView): CatalogProjection {
  if (view.H !== 30 || !Number.isSafeInteger(view.k) || view.k < 0) throw Error('invalid-view');
  view = { ...view, now: view.now ?? new Date().toISOString() };
  const records = scoped(snapshot, view.selectedScope);
  const times = new Map(records.map(record => [record.key, pendingPlacement(record, view)]));
  records.sort((a, b) => (instant(times.get(b.key)!.at) ?? -Infinity) - (instant(times.get(a.key)!.at) ?? -Infinity)
    || a.stableRank - b.stableRank || a.key.localeCompare(b.key));
  const out: CatalogProjection = { projects: [], localProjects: [], undatedLocalProjects: [], candidateProjects: [], undatedCandidateProjects: [], dates: [], pendingDates: [], unknown: [], undatedNone: [], undatedProjects: [] };
  const projects = snapshot.projects.filter(p => p.scopeKey === view.selectedScope);
  const projectIds = new Set(projects.map(p => p.projectId));
  for (const project of projects) {
    const members = records.filter(r => r.membership.state === 'PROJECT' && r.membership.projectId === project.projectId);
    // Future/invalid activities are not treated as fresh. Undated children remain with the parent.
    const dated = members.filter(r => times.get(r.key)!.segment !== null);
    const latestDisplayAt = dated.length ? times.get(dated[0]!.key)!.at : null;
    // Retained field keeps its original meaning; it is no longer a placement key.
    const active = members.map(r => r.activity?.lastConfirmedOpenAt).filter((at): at is string => instant(at) !== null && instant(at)! <= instant(view.now)!).sort((a, b) => instant(b)! - instant(a)!);
    const latestActiveAt = active[0] ?? null;
    const segment = freeSegmentFor(latestDisplayAt, view);
    const card: ProjectCard = { project, latestActiveAt, latestDisplayAt, segment, recent: [], older: [], undated: [] };
    for (const record of members) {
      const own = times.get(record.key)!.segment;
      if (own === null || segment === null) card.undated.push(record);
      else if (own === segment) card.recent.push(record);
      else card.older.push(record);
    }
    if (segment === null) out.undatedProjects.push(card);
    else if (segment === view.k) out.projects.push(card);
  }
  const localProjects = new Map((view.selectedScope === 'unassigned' ? snapshot.localProjects ?? [] : [])
    .filter(project => project.localProfileKey === snapshot.localProfileKey).map(project => [project.key, project]));
  const localMemberKeys = new Set<string>();
  for (const project of localProjects.values()) {
    const members = records.filter(record => observedProject(record, localProjects)?.key === project.key);
    for (const record of members) localMemberKeys.add(record.key);
    const dated = members.filter(record => times.get(record.key)!.segment !== null);
    const latestDisplayAt = dated.length ? times.get(dated[0]!.key)!.at : null;
    const segment = freeSegmentFor(latestDisplayAt, view);
    const card: LocalObservedProjectCard = { project, latestDisplayAt, segment, recent: [], older: [], undated: [] };
    for (const record of members) {
      const own = times.get(record.key)!.segment;
      if (own === null || segment === null) card.undated.push(record);
      else if (own === segment) card.recent.push(record);
      else card.older.push(record);
    }
    if (segment === null) out.undatedLocalProjects.push(card);
    else if (segment === view.k) out.localProjects.push(card);
  }
  out.localProjects.sort((a, b) => instant(b.latestDisplayAt)! - instant(a.latestDisplayAt)! || a.project.stableRank - b.project.stableRank || a.project.key.localeCompare(b.project.key));
  out.undatedLocalProjects.sort((a, b) => a.project.stableRank - b.project.stableRank || a.project.key.localeCompare(b.project.key));
  // Legacy candidate keys keep their original observation boundary. They are never
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
    const rows = members.map(record => ({ record, ...times.get(record.key)! })).sort((a, b) =>
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
    if (candidateMemberKeys.has(record.key) || localMemberKeys.has(record.key)) continue;
    if (record.membership.state === 'UNKNOWN' || record.membership.state === 'PROJECT' && !projectIds.has(record.membership.projectId)) {
      // Unified display time does not assert ownership, membership or active use.
      const { at, segment } = times.get(record.key)!;
      if (segment === null) out.unknown.push(record);
      else if (segment === view.k) {
        const date = dayLabel(localDay(at!, view.Z)), key = date;
        const group = pendingDates.get(key) ?? { date, records: [] };
        group.records.push(record); pendingDates.set(key, group);
      }
      continue;
    }
    if (record.membership.state !== 'NONE') continue;
    const { at, segment } = times.get(record.key)!;
    if (segment === null) out.undatedNone.push(record);
    else if (segment === view.k) { const date = dayLabel(localDay(at!, view.Z)); const items = dates.get(date) ?? []; items.push(record); dates.set(date, items); }
  }
  out.projects.sort((a, b) => instant(b.latestDisplayAt)! - instant(a.latestDisplayAt)! || a.project.stableRank - b.project.stableRank || a.project.key.localeCompare(b.project.key));
  out.undatedProjects.sort((a, b) => a.project.stableRank - b.project.stableRank || a.project.key.localeCompare(b.project.key));
  out.dates = [...dates.entries()].sort(([a], [b]) => b.localeCompare(a)).map(([date, rows]) => ({ date, records: rows }));
  out.pendingDates = [...pendingDates.values()].sort((a, b) => b.date.localeCompare(a.date));
  return out;
}
export interface SearchResult { record: ConversationRecord; project: ProjectRecord | null; localProject: LocalObservedProject | null; candidateProject: LocalProjectCandidate | null; path: string }
export function searchCatalog(snapshot: CatalogSnapshot, query: string, selectedScope: string): SearchResult[] {
  const q = query.normalize('NFKC').trim().toLocaleLowerCase();
  const projects = new Map(snapshot.projects.filter(p => p.scopeKey === selectedScope).map(p => [p.projectId, p]));
  const localProjects = new Map((selectedScope === 'unassigned' ? snapshot.localProjects ?? [] : [])
    .filter(p => p.localProfileKey === snapshot.localProfileKey).map(p => [p.key, p]));
  return scoped(snapshot, selectedScope).sort((a, b) => compareRecords(a, b)).flatMap(record => {
    const project = record.membership.state === 'PROJECT' ? projects.get(record.membership.projectId) ?? null : null;
    const candidateProject = localCandidate(record);
    const localProject = observedProject(record, localProjects);
    if (![record.nativeTitle ?? '', project?.nativeTitle ?? '', localProject?.nativeTitle ?? '', candidateProject?.nativeTitle ?? '', record.canonicalUrl].some(value => value.normalize('NFKC').toLocaleLowerCase().includes(q))) return [];
    const path = project ? `${project.nativeTitle ?? '未命名项目'} · 原生项目` : localProject ? `${localProject.nativeTitle ?? '未命名项目'} · 原生项目 · 本地已观察`
      : candidateProject ? `${candidateProject.nativeTitle} · 本地候选项目／原生归属待确认` : record.localProject?.state === 'conflicting' ? '原生项目关系冲突 · 待归属'
      : record.membership.state === 'NONE' ? '无项目' : record.owner.kind === 'unassigned' ? '本地历史 · 账号未绑定／归属待确认' : '归属待确认';
    return [{ record, project, localProject, candidateProject, path }];
  });
}
