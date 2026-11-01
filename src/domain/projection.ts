import type { ConversationRecord, ProjectRecord } from '../../contracts/free-v1.js';
import type { CatalogSnapshot } from '../storage/repository.js';
import { dayLabel, freeSegmentFor, instant, localDay } from './time.js';
export interface ProjectionView { H: 30; T: number; Z: string; k: number; selectedScope: string }
export interface ProjectCard { project: ProjectRecord; recent: ConversationRecord[]; older: ConversationRecord[]; undated: ConversationRecord[]; latestActiveAt: string | null; segment: number | null }
export interface DateGroup { date: string; records: ConversationRecord[] }
export interface CatalogProjection { projects: ProjectCard[]; dates: DateGroup[]; unknown: ConversationRecord[]; undatedNone: ConversationRecord[]; undatedProjects: ProjectCard[] }
export function compareRecords(a: ConversationRecord, b: ConversationRecord): number {
  const aTime = instant(a.activity?.lastConfirmedOpenAt), bTime = instant(b.activity?.lastConfirmedOpenAt);
  return (bTime ?? -Infinity) - (aTime ?? -Infinity) || a.stableRank - b.stableRank || a.key.localeCompare(b.key);
}
function scoped(snapshot: CatalogSnapshot, selectedScope: string): ConversationRecord[] {
  const removed = new Set(snapshot.tombstones.map(t => t.key));
  return snapshot.conversations.filter(r => !removed.has(r.key) && (selectedScope === 'unassigned' ? r.owner.kind === 'unassigned' : r.owner.kind === 'scoped' && r.owner.scopeKey === selectedScope));
}
export function projectCatalog(snapshot: CatalogSnapshot, view: ProjectionView): CatalogProjection {
  if (view.H !== 30 || !Number.isSafeInteger(view.k) || view.k < 0) throw Error('invalid-view');
  const records = scoped(snapshot, view.selectedScope).sort(compareRecords);
  const out: CatalogProjection = { projects: [], dates: [], unknown: [], undatedNone: [], undatedProjects: [] };
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
  const dates = new Map<string, ConversationRecord[]>();
  for (const record of records) {
    if (record.membership.state === 'UNKNOWN' || record.membership.state === 'PROJECT' && !projectIds.has(record.membership.projectId)) { out.unknown.push(record); continue; }
    if (record.membership.state !== 'NONE') continue;
    const segment = freeSegmentFor(record.activity?.lastConfirmedOpenAt, view);
    if (segment === null) out.undatedNone.push(record);
    else if (segment === view.k) { const date = dayLabel(localDay(record.activity!.lastConfirmedOpenAt, view.Z)); const items = dates.get(date) ?? []; items.push(record); dates.set(date, items); }
  }
  out.projects.sort((a, b) => instant(b.latestActiveAt)! - instant(a.latestActiveAt)! || a.project.stableRank - b.project.stableRank || a.project.key.localeCompare(b.project.key));
  out.undatedProjects.sort((a, b) => a.project.stableRank - b.project.stableRank || a.project.key.localeCompare(b.project.key));
  out.dates = [...dates.entries()].sort(([a], [b]) => b.localeCompare(a)).map(([date, rows]) => ({ date, records: rows }));
  return out;
}
export interface SearchResult { record: ConversationRecord; project: ProjectRecord | null; path: string }
export function searchCatalog(snapshot: CatalogSnapshot, query: string, selectedScope: string): SearchResult[] {
  const q = query.normalize('NFKC').trim().toLocaleLowerCase();
  const projects = new Map(snapshot.projects.filter(p => p.scopeKey === selectedScope).map(p => [p.projectId, p]));
  return scoped(snapshot, selectedScope).sort(compareRecords).flatMap(record => {
    const project = record.membership.state === 'PROJECT' ? projects.get(record.membership.projectId) ?? null : null;
    if (![record.nativeTitle ?? '', project?.nativeTitle ?? '', record.canonicalUrl].some(value => value.normalize('NFKC').toLocaleLowerCase().includes(q))) return [];
    const path = project ? `${project.nativeTitle ?? '未命名项目'} · 原生项目` : record.membership.state === 'NONE' ? '无项目' : record.owner.kind === 'unassigned' ? '账号待确认' : '归属待确认';
    return [{ record, project, path }];
  });
}
