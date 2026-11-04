import { SOURCE_ERRORS } from './failures.js';
import type { NativeTask, NativeResult, SourcePacket } from './types.js';
const record = (x: unknown): x is Record<string, any> => !!x && typeof x === 'object' && !Array.isArray(x);
export const id = (x: unknown): x is string => typeof x === 'string' && /^[a-zA-Z0-9_-]{1,160}$/.test(x);
export const uuid = (x: unknown): x is string => typeof x === 'string' && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(x);
export function iso(x: unknown): string | null {
  if (typeof x !== 'string' || !/^\d{4}-\d\d-\d\dT/.test(x)) return null;
  const time = Date.parse(x); return Number.isFinite(time) ? new Date(time).toISOString() : null;
}
const text = (x: unknown, max: number) => typeof x === 'string' && x.length <= max ? x : null;
export function normalizeTask(x: unknown): NativeTask {
  if (!record(x) || !id(x.id) || text(x.title, 2048) === null || !(x.team_id === null || x.team_id === undefined || id(x.team_id))) throw Error('SOURCE_CHANGED');
  const times = Array.isArray(x.next_run_times) ? x.next_run_times.map(iso).filter((v): v is string => !!v).sort() : [];
  return { id: x.id, title: x.title, is_enabled: typeof x.is_enabled === 'boolean' ? x.is_enabled : null,
    schedule: text(x.schedule, 8192), default_timezone: text(x.default_timezone, 128),
    next_run_time: iso(x.next_run_time) || times[0] || null, last_run_time: iso(x.last_run_time),
    conversation_id: uuid(x.conversation_id) ? x.conversation_id : null, team_id: x.team_id || null };
}
/** Only final, explicitly task-tagged messages on the active branch leave the page.
 * No user text, tools, reasoning, prompts, headers or authentication material is emitted. */
export function taskResults(data: unknown, taskId: string, conversationId: string): NativeResult[] {
  if (!record(data) || data.conversation_id !== conversationId || !record(data.mapping) || !id(data.current_node)) throw Error('SOURCE_CHANGED');
  const seen = new Set<string>(), results = new Map<string, NativeResult>();
  let nodeId: string | null = data.current_node;
  while (nodeId && !seen.has(nodeId) && seen.size < 20000) {
    seen.add(nodeId);
    const node: any = data.mapping[nodeId]; if (!record(node)) break;
    const m = node.message, meta = m?.metadata;
    if (record(m) && record(meta) && meta.automation_id === taskId && m.author?.role === 'assistant'
      && m.channel === 'final' && m.recipient === 'all' && m.end_turn === true && meta.is_complete === true
      && m.status === 'finished_successfully' && meta.is_visually_hidden_from_conversation !== true
      && m.content?.content_type === 'text' && Array.isArray(m.content.parts)
      && m.content.parts.every((p: unknown) => typeof p === 'string') && id(m.id)
      && typeof m.create_time === 'number' && Number.isFinite(m.create_time)) {
      const body = m.content.parts.join('\n\n');
      const createdAt = new Date(m.create_time * 1000).toISOString();
      const turnId = id(meta.working_turn_id) ? meta.working_turn_id : null;
      const key = turnId || m.id;
      if (body.trim() && body.length <= 1_000_000 && !results.has(key)) results.set(key, {
        taskId, conversationId, messageId: m.id, turnId, createdAt, body, complete: true,
      });
    }
    nodeId = id(node.parent) ? node.parent : null;
  }
  return [...results.values()].sort((a,b) => a.createdAt.localeCompare(b.createdAt)).slice(-20);
}
export function sourceKind(responseUrl: string, pageHref: string): 'list' | 'results' | null {
  try {
    const u = new URL(responseUrl), p = new URL(pageHref);
    if (u.origin !== 'https://chatgpt.com' || p.origin !== u.origin) return null;
    if (u.pathname === '/backend-api/automations' && ['scheduled', 'paused', 'finished'].includes(u.searchParams.get('filter') || '')) return 'list';
    const c = /^\/c\/([a-f0-9-]+)$/i.exec(p.pathname), task = p.searchParams.get('automationId');
    if (c && uuid(c[1]) && id(task) && u.pathname === '/backend-api/conversation/' + c[1]) return 'results';
  } catch { /* unsupported source */ }
  return null;
}
export function sourceTarget(responseUrl: string, pageHref: string): string | null {
  const kind = sourceKind(responseUrl, pageHref);
  if (kind === 'list') return 'list:' + new URL(responseUrl).searchParams.get('filter');
  if (kind === 'results') { const p = new URL(pageHref); return 'results:' + p.pathname.slice(3) + ':' + p.searchParams.get('automationId'); }
  return null;
}
export function extractPacket(responseUrl: string, pageHref: string, observedAt: string, data: unknown): SourcePacket | null {
  const kind = sourceKind(responseUrl, pageHref); if (!kind) return null;
  const u = new URL(responseUrl), p = new URL(pageHref);
  if (kind === 'list') {
    if (!record(data) || !Array.isArray(data.items) || data.items.length > 100 || !(data.cursor === null || text(data.cursor, 4096))) throw Error('SOURCE_CHANGED');
    const firstPage=[...u.searchParams.keys()].every(key=>['filter','limit'].includes(key));
    return {kind, pageHref, observedAt, filter: u.searchParams.get('filter') as 'scheduled' | 'paused' | 'finished', cursor: data.cursor, firstPage, tasks: data.items.map(normalizeTask)};
  }
  const taskId = p.searchParams.get('automationId')!, conversationId = p.pathname.slice(3);
  return {kind, pageHref, observedAt, taskId, conversationId, results: taskResults(data, taskId, conversationId)};
}
/** Revalidate the small bridge envelope in the isolated world and again in the worker. */
export function validatePacket(value: unknown): SourcePacket {
  if (!record(value) || !iso(value.observedAt) || typeof value.pageHref !== 'string' || value.pageHref.length > 2048
    || new URL(value.pageHref).origin !== 'https://chatgpt.com' || JSON.stringify(value).length > 4_000_000) throw Error('SOURCE_CHANGED');
  if (value.kind === 'list' && typeof value.firstPage==='boolean' && ['scheduled','paused','finished'].includes(value.filter) && Array.isArray(value.tasks) && value.tasks.length <= 100
    && (value.cursor === null || typeof value.cursor === 'string' && value.cursor.length <= 4096)) {
    return {kind:'list',filter:value.filter,cursor:value.cursor,firstPage:value.firstPage,pageHref:value.pageHref,observedAt:value.observedAt,tasks:value.tasks.map(normalizeTask)};
  }
  if (value.kind === 'results' && id(value.taskId) && uuid(value.conversationId) && Array.isArray(value.results) && value.results.length <= 20) {
    const p = new URL(value.pageHref);
    if (p.pathname !== '/c/' + value.conversationId || p.searchParams.get('automationId') !== value.taskId) throw Error('SOURCE_CHANGED');
    const results: NativeResult[] = value.results.map((r: any) => {
      if (!record(r) || r.taskId !== value.taskId || r.conversationId !== value.conversationId || !id(r.messageId)
        || !(r.turnId === null || id(r.turnId)) || !iso(r.createdAt) || !text(r.body, 1_000_000)?.trim() || r.complete !== true) throw Error('SOURCE_CHANGED');
      return {taskId:r.taskId,conversationId:r.conversationId,messageId:r.messageId,turnId:r.turnId,createdAt:r.createdAt,body:r.body,complete:true};
    });
    return {kind:'results',taskId:value.taskId,conversationId:value.conversationId,pageHref:value.pageHref,observedAt:value.observedAt,results};
  }
  if (value.kind === 'error' && (SOURCE_ERRORS as readonly string[]).includes(value.code)) {
    const p = new URL(value.pageHref), target = value.target;
    if (target !== undefined && (typeof target!=='string' || !['list:scheduled','list:paused','list:finished',uuid(p.pathname.slice(3)) && id(p.searchParams.get('automationId')) ? 'results:'+p.pathname.slice(3)+':'+p.searchParams.get('automationId') : null].includes(target))) throw Error('SOURCE_CHANGED');
    return {kind:'error',code:value.code,target,pageHref:value.pageHref,observedAt:value.observedAt};
  }
  throw Error('SOURCE_CHANGED');
}
