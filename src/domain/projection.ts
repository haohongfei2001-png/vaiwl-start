import type { ConversationRecord, LocalObservedProject, ProjectRecord } from '../../contracts/free-v1.js';
import type { CatalogSnapshot } from '../storage/repository.js';
import { instant } from './time.js';
import { deriveDisplayTimes, directDisplayAt } from './time-evidence.js';
import type { DisplayTimeProjection } from './time-evidence.js';
export interface ProjectionView { H: 30; T: number; Z: string; k: number; selectedScope: string; now?: string }
export interface ProjectCard { project: ProjectRecord; recent: ConversationRecord[]; older: ConversationRecord[]; undated: ConversationRecord[]; latestActiveAt: string | null; latestDisplayAt: string | null; segment: number | null; sortTime: number | null }
export type LocalProjectCandidate = NonNullable<ConversationRecord['localProjectCandidate']>;
export interface CandidateProjectCard { candidate: LocalProjectCandidate; recent: ConversationRecord[]; older: ConversationRecord[]; undated: ConversationRecord[]; latestDisplayAt: string | null; segment: number | null; sortTime: number | null; stableRank: number }
export interface LocalObservedProjectCard { project: LocalObservedProject; recent: ConversationRecord[]; older: ConversationRecord[]; undated: ConversationRecord[]; latestDisplayAt: string | null; segment: number | null; sortTime: number | null }
export interface DateGroup { date: string; records: ConversationRecord[] }
export type PendingDateGroup = DateGroup;
export interface CatalogProjection { projects: ProjectCard[]; localProjects: LocalObservedProjectCard[]; undatedLocalProjects: LocalObservedProjectCard[]; candidateProjects: CandidateProjectCard[]; undatedCandidateProjects: CandidateProjectCard[]; dates: DateGroup[]; pendingDates: PendingDateGroup[]; unknown: ConversationRecord[]; undatedNone: ConversationRecord[]; undatedProjects: ProjectCard[]; segmentOnly: ConversationRecord[]; displayTimes: Map<string, DisplayTimeProjection> }
/** Display metadata only: never writes activity/OpenDay or transfers visits across owners. */
export function lastDisplayAt(record: ConversationRecord, now = new Date().toISOString()): string | null {
  return directDisplayAt(record, now);
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
/** The arrays retain internal provenance; all use the same user-facing card. */
export function projectCatalog(snapshot: CatalogSnapshot, view: ProjectionView): CatalogProjection {
  if (view.H !== 30 || !Number.isSafeInteger(view.k) || view.k < 0) throw Error('invalid-view');
  view = { ...view, now: view.now ?? new Date().toISOString() };
  const records = scoped(snapshot, view.selectedScope);
  const orders = snapshot.timeOrders ?? [];
  const times = deriveDisplayTimes(records, view, orders, snapshot.localProfileKey);
  records.sort((a, b) => times.get(a.key)!.rank - times.get(b.key)!.rank);
  const out: CatalogProjection = { projects: [], localProjects: [], undatedLocalProjects: [], candidateProjects: [], undatedCandidateProjects: [], dates: [], pendingDates: [], unknown: [], undatedNone: [], undatedProjects: [], segmentOnly: [], displayTimes: times };
  const projects = [...new Map(snapshot.projects.filter(p => p.scopeKey === view.selectedScope).sort((a, b) => a.revision - b.revision || a.key.localeCompare(b.key)).map(p => [p.projectId, p])).values()];
  const projectIds = new Set(projects.map(p => p.projectId));
  const placement = (members: ConversationRecord[]) => {
    const dated = members.filter(record => times.get(record.key)!.segment !== null);
    const segment = dated.length ? Math.min(...dated.map(record => times.get(record.key)!.segment!)) : null;
    const recent = segment === null ? [] : members.filter(record => times.get(record.key)!.segment === segment);
    // “更早” is a collection area, including records without usable time evidence.
    const older = members.filter(record => segment === null || times.get(record.key)!.segment !== segment);
    const precise = recent.map(record => times.get(record.key)!.at).filter((at): at is string => at !== null).sort((a, b) => instant(b)! - instant(a)!);
    const sortValues = recent.map(record => times.get(record.key)!.sortTime).filter((value): value is number => value !== null);
    return { segment, recent, older, undated: [] as ConversationRecord[], latestDisplayAt: precise[0] ?? null, sortTime: sortValues.length ? Math.max(...sortValues) : null };
  };
  for (const project of projects) {
    const members = records.filter(record => record.membership.state === 'PROJECT' && record.membership.projectId === project.projectId);
    const active = members.map(record => record.activity?.lastConfirmedOpenAt).filter((at): at is string => instant(at) !== null && instant(at)! <= instant(view.now)!).sort((a, b) => instant(b)! - instant(a)!);
    const card: ProjectCard = { project, latestActiveAt: active[0] ?? null, ...placement(members) };
    if (card.segment === null && view.k === 0) out.undatedProjects.push(card);
    else if (card.segment === view.k) out.projects.push(card);
  }
  const localProjects = new Map((view.selectedScope === 'unassigned' ? snapshot.localProjects ?? [] : [])
    .filter(project => project.localProfileKey === snapshot.localProfileKey).map(project => [project.key, project]));
  const localMemberKeys = new Set<string>();
  for (const project of localProjects.values()) {
    const members = records.filter(record => observedProject(record, localProjects)?.key === project.key);
    for (const record of members) localMemberKeys.add(record.key);
    const card: LocalObservedProjectCard = { project, ...placement(members) };
    if (card.segment === null && view.k === 0) out.undatedLocalProjects.push(card);
    else if (card.segment === view.k) out.localProjects.push(card);
  }
  // Legacy observations keep their exact identity boundary; names never merge cards.
  const candidateGroups = new Map<string, { candidate: LocalProjectCandidate; members: ConversationRecord[] }>();
  const candidateMemberKeys = new Set<string>();
  for (const record of records) {
    const candidate = localCandidate(record); if (!candidate) continue;
    const group = candidateGroups.get(candidate.key) ?? { candidate, members: [] };
    if ((instant(candidate.observedAt) ?? -Infinity) > (instant(group.candidate.observedAt) ?? -Infinity)) group.candidate = candidate;
    group.members.push(record); candidateMemberKeys.add(record.key); candidateGroups.set(candidate.key, group);
  }
  for (const { candidate, members } of candidateGroups.values()) {
    const card: CandidateProjectCard = { candidate, ...placement(members), stableRank: Math.min(...members.map(record => record.stableRank)) };
    if (card.segment === null && view.k === 0) out.undatedCandidateProjects.push(card);
    else if (card.segment === view.k) out.candidateProjects.push(card);
  }
  const dates = new Map<string, ConversationRecord[]>(), pendingDates = new Map<string, ConversationRecord[]>();
  for (const record of records) {
    if (candidateMemberKeys.has(record.key) || localMemberKeys.has(record.key)) continue;
    if (record.membership.state === 'PROJECT' && projectIds.has(record.membership.projectId)) continue;
    const time = times.get(record.key)!;
    if (time.segment === null) {
      // Internal fallback arrays are retained for compatibility, never homepage sections.
      if (record.membership.state === 'NONE') out.undatedNone.push(record); else out.unknown.push(record);
    } else if (time.segment === view.k) {
      if (time.date === null) { out.segmentOnly.push(record); continue; }
      const target = record.membership.state === 'NONE' ? dates : pendingDates;
      const rows = target.get(time.date) ?? []; rows.push(record); target.set(time.date, rows);
    }
  }
  const projectOrder = (a: ProjectCard | LocalObservedProjectCard, b: ProjectCard | LocalObservedProjectCard) =>
    (b.sortTime ?? -Infinity) - (a.sortTime ?? -Infinity) || a.project.stableRank - b.project.stableRank || a.project.key.localeCompare(b.project.key);
  out.projects.sort(projectOrder); out.localProjects.sort(projectOrder); out.undatedProjects.sort(projectOrder); out.undatedLocalProjects.sort(projectOrder);
  const candidateOrder = (a: CandidateProjectCard, b: CandidateProjectCard) => (b.sortTime ?? -Infinity) - (a.sortTime ?? -Infinity) || a.stableRank - b.stableRank || a.candidate.key.localeCompare(b.candidate.key);
  out.candidateProjects.sort(candidateOrder); out.undatedCandidateProjects.sort(candidateOrder);
  out.dates = [...dates.entries()].sort(([a], [b]) => b.localeCompare(a)).map(([date, rows]) => ({ date, records: rows }));
  out.pendingDates = [...pendingDates.entries()].sort(([a], [b]) => b.localeCompare(a)).map(([date, rows]) => ({ date, records: rows }));
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
    const path = project?.nativeTitle ?? localProject?.nativeTitle ?? candidateProject?.nativeTitle ?? '最近';
    return [{ record, project, localProject, candidateProject, path }];
  });
}

export interface ProjectSearchResult {
  key: string; nativeTitle: string | null; canonicalUrl: string;
  project: ProjectRecord | null; localProject: LocalObservedProject | null; candidateProject: LocalProjectCandidate | null;
}
/** Includes empty native projects; a real project does not require a fake conversation. */
export function searchProjects(snapshot: CatalogSnapshot, query: string, selectedScope: string): ProjectSearchResult[] {
  const q = query.normalize('NFKC').trim().toLocaleLowerCase();
  const rows: ProjectSearchResult[] = snapshot.projects.filter(project => project.scopeKey === selectedScope).map(project => ({
    key: project.key, nativeTitle: project.nativeTitle, canonicalUrl: project.canonicalUrl, project, localProject: null, candidateProject: null,
  }));
  if (selectedScope === 'unassigned') for (const project of snapshot.localProjects ?? []) if (project.localProfileKey === snapshot.localProfileKey) rows.push({
    key: project.key, nativeTitle: project.nativeTitle, canonicalUrl: project.canonicalUrl, project: null, localProject: project, candidateProject: null,
  });
  const candidates = new Map<string, LocalProjectCandidate>();
  for (const record of scoped(snapshot, selectedScope)) { const candidate = localCandidate(record); if (candidate) candidates.set(candidate.key, candidate); }
  for (const candidate of candidates.values()) rows.push({ key: `candidate:${candidate.key}`, nativeTitle: candidate.nativeTitle, canonicalUrl: candidate.canonicalUrl,
    project: null, localProject: null, candidateProject: candidate });
  return rows.filter(row => [row.nativeTitle ?? '', row.canonicalUrl].some(value => value.normalize('NFKC').toLocaleLowerCase().includes(q)))
    .sort((a, b) => (a.nativeTitle ?? '').localeCompare(b.nativeTitle ?? '') || a.key.localeCompare(b.key));
}
