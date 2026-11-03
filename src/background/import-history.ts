import type { ImportCheckpoint } from '../../contracts/free-v1.js';
import { parseConversationUrl } from '../domain/ids.js';
import type { CandidateInput, Repository } from '../storage/repository.js';

export interface HistoryPort {
  search(query: { text: string; startTime: number; endTime: number; maxResults: number }): Promise<Array<{ url?: string; title?: string; lastVisitTime?: number }>>;
  getVisits(query: { url: string }): Promise<Array<{ isLocal?: boolean }>>;
}
export interface HistoryJob extends ImportCheckpoint {
  includeSynced: boolean;
  seenKeys: string[];
  pendingCandidates: CandidateInput[];
  failureCode: 'history-api-failed' | 'saturated-time-slice' | null;
}
export function createHistoryJob(range: 'recent90' | 'all', includeSynced: boolean, now = Date.now()): HistoryJob {
  if (!Number.isFinite(now) || now < 0 || !['recent90', 'all'].includes(range) || typeof includeSynced !== 'boolean') throw new Error('INVALID_MESSAGE');
  const startTimeMs = range === 'all' ? 0 : Math.max(0, now - 90 * 86400000);
  const endTimeMs = Math.floor(now);
  return { id: crypto.randomUUID(), provider: 'browser-history', state: 'running', startTimeMs, endTimeMs,
    pendingIntervals: ['chatgpt.com', 'chat.openai.com'].map(query => ({ startMs: startTimeMs, endMs: endTimeMs, query: query as 'chatgpt.com' | 'chat.openai.com' })),
    processedUniqueUrls: 0, acceptedCandidates: 0, rejectedUrls: 0, saturatedIntervals: [], sourceCoverage: 'browser-available-history', completedAt: null,
    includeSynced, seenKeys: [], pendingCandidates: [], failureCode: null };
}

/** One bounded batch per UI request. The worker never stays alive to crawl history. */
export async function stepHistoryImport(repository: Repository, history: HistoryPort, id: string): Promise<HistoryJob> {
  const snapshot = await repository.getSnapshot();
  const original = snapshot.importJobs.find(job => job.id === id) as HistoryJob | undefined;
  if (!original) throw new Error('IMPORT_NOT_FOUND');
  if (original.state !== 'running') return original;
  const job = structuredClone(original);
  const seen = new Set(job.seenKeys || []);
  job.pendingCandidates ||= [];
  if (job.pendingCandidates.length === 0 && job.pendingIntervals.length) {
    const interval = job.pendingIntervals.shift()!;
    let rows;
    try {
      rows = await history.search({ text: interval.query, startTime: interval.startMs, endTime: interval.endMs + 1, maxResults: 500 });
      if (!Array.isArray(rows) || rows.length > 500) throw new Error('invalid-history-result');
    } catch {
      job.pendingIntervals.unshift(interval);
      job.state = 'partial'; job.failureCode = 'history-api-failed';
      await repository.discoverCandidates([], snapshot.revision, job); return job;
    }
    if (rows.length === 500 && interval.endMs - interval.startMs > 1) {
      const middle = Math.floor((interval.startMs + interval.endMs) / 2);
      // Overlap at the boundary: lastVisitTime is not a pagination cursor.
      job.pendingIntervals.unshift({ ...interval, startMs: middle }, { ...interval, endMs: middle });
    } else {
      if (rows.length === 500) {
        job.saturatedIntervals.push({ startMs: interval.startMs, endMs: interval.endMs });
        job.failureCode = 'saturated-time-slice';
      }
      for (const item of rows) {
        // Filter before getVisits, hashing, persistence, or title processing.
        const parsed = typeof item.url === 'string' ? parseConversationUrl(item.url) : null;
        if (!parsed) { job.rejectedUrls++; continue; }
        const key = parsed.conversationId;
        if (seen.has(key)) continue;
        let visits: Array<{ isLocal?: boolean }>;
        try { visits = await history.getVisits({ url: item.url! }); }
        catch {
          job.pendingIntervals.unshift(interval); job.state = 'partial'; job.failureCode = 'history-api-failed'; break;
        }
        const source = visits.some(v => v.isLocal === true) ? 'local' : visits.length > 0 && visits.every(v => v.isLocal === false) ? 'synced' : 'unknown';
        if (source === 'synced' && !job.includeSynced) continue;
        // A skipped sync-only alias must not shadow a later local visit of the same C.
        seen.add(key);
        const title = typeof item.title === 'string' ? [...item.title.replace(/[\u0000-\u001f\u007f]/g, ' ').trim()].slice(0, 512).join('') || null : null;
        const time = item.lastVisitTime;
        job.pendingCandidates.push({ url: item.url!, title, source, lastVisitAt: typeof time === 'number' && Number.isFinite(time) && time >= 0 && time <= job.endTimeMs ? new Date(time).toISOString() : null, titleBasis: 'browser-history' });
      }
    }
  }
  const batch = job.pendingCandidates.splice(0, 200);
  job.seenKeys = [...seen];
  job.processedUniqueUrls = seen.size;
  job.acceptedCandidates += batch.length;
  if (!job.pendingCandidates.length && !job.pendingIntervals.length) {
    job.state = job.saturatedIntervals.length || job.failureCode ? 'partial' : 'complete';
    job.completedAt = new Date().toISOString();
  }
  // Candidate records and resumable progress commit together, including revision CAS.
  await repository.discoverCandidates(batch, snapshot.revision, job);
  return job;
}
