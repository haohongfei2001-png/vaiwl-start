/** Optional native display metadata. Missing semantics never block membership.
 * Only explicit time elements and an explicitly chronological, complete list
 * can provide time evidence; plain DOM order has no temporal authority. */
import { parseConversationUrl } from '../../domain/ids.js';
import { instant } from '../../domain/time.js';
import type { ProjectCandidate } from './project-candidate.js';

export interface NativeMemberTime {
  kind: 'native-updated';
  semantic: 'conversation-last-activity';
  at: string;
}
export interface NativeProjectTimeOrder {
  semantic: 'conversation-last-activity';
  direction: 'descending';
  coverage: 'complete';
  pinned: false;
  manual: false;
  memberIds: string[];
}
export const NATIVE_TIME_ADAPTER = { id: 'explicit-native-time', version: '1' } as const;
const EXCLUDED = '[contenteditable],dialog,[role="dialog"],article,[data-preview],[data-message-author-role],[data-testid^="conversation-turn"],.markdown,[data-va-owned],[data-vaiwl-owned]';
const UPDATED = /^(?:last updated|updated|last activity|最近更新|最后更新|上次活动)$/iu;
const ORDER = /^(?:recently updated|last activity, newest first|conversations sorted by last activity, newest first|最近更新|按最近活动降序排列)$/iu;
function visible(document: Document, node: Element): boolean {
  if (!node.isConnected || !node.getClientRects().length || node.closest(EXCLUDED) || !document.defaultView) return false;
  for (let parent: Element | null = node; parent; parent = parent.parentElement) {
    const style = document.defaultView.getComputedStyle(parent);
    if (parent.hasAttribute('hidden') || parent.getAttribute('aria-hidden') === 'true' || style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
  }
  return true;
}
function label(node: Element): string {
  // Labels only: never consume a row's aggregate text or conversation preview.
  return (node.getAttribute('aria-label') ?? node.getAttribute('title') ?? '').trim();
}
function nativeAnchor(document: Document, anchor: Element): string | null {
  const raw = anchor.getAttribute('href');
  if (!raw || /[\u0000-\u0020\u007f\\]/u.test(raw) || raw.startsWith('//')) return null;
  const value = raw.startsWith('/') ? document.location.origin + raw : raw;
  return parseConversationUrl(value)?.conversationId ?? null;
}
/** This adapter is deliberately capability-detected. It does not assume that
 * every live ChatGPT variant exposes time labels, ordering or list coverage. */
export function withNativeProjectTime(document: Document, panel: Element, candidate: ProjectCandidate): ProjectCandidate {
  if (document.location.origin !== 'https://chatgpt.com' || candidate.relationBasis !== 'linked-native-panel' || !visible(document, panel)) return candidate;
  const anchors = [...panel.querySelectorAll('a[href]')].filter(node => visible(document, node));
  if (anchors.length > 256) return candidate;
  const indexed = new Map<string, Element[]>();
  for (const anchor of anchors) {
    const id = nativeAnchor(document, anchor); if (!id) continue;
    indexed.set(id, [...indexed.get(id) ?? [], anchor]);
  }
  const members = candidate.members.map(member => {
    const matches = indexed.get(member.conversationId);
    if (matches?.length !== 1) return member;
    const anchor = matches[0]!, row = anchor.closest('li,[role="listitem"],[role="row"]');
    if (!row || !panel.contains(row)) return member;
    const rowIds = [...row.querySelectorAll('a[href]')].map(node => nativeAnchor(document, node)).filter(Boolean);
    if (rowIds.length !== 1 || rowIds[0] !== member.conversationId) return member;
    const times = [...row.querySelectorAll('time[datetime]')].filter(node => visible(document, node) && UPDATED.test(label(node)));
    if (times.length !== 1) return member;
    const at = times[0]!.getAttribute('datetime');
    if (instant(at) === null) return member;
    return { ...member, time: { kind: 'native-updated' as const, semantic: 'conversation-last-activity' as const, at: at! } };
  });
  const out: ProjectCandidate = { ...candidate, members };
  if (members.length < 2 || members.length > 200) return out;
  const lists = [...panel.querySelectorAll('ol,[role="list"],[role="grid"]')].filter(node => visible(document, node) && ORDER.test(label(node)) && node.getAttribute('aria-sort') === 'descending');
  if (lists.length !== 1) return out;
  const list = lists[0]!;
  if (list.closest('[aria-busy="true"],[draggable="true"],[aria-grabbed]') || list.querySelector('[aria-busy="true"],[role="progressbar"],[draggable="true"],[aria-grabbed]')) return out;
  if ([...panel.querySelectorAll('[aria-label],[title]')].some(node => visible(document, node) && /(?:\bpinned\b|\bunpin\b|\bmanual(?:ly)?\b|\bload more\b|置顶|手动排序|加载更多)/iu.test(label(node)))) return out;
  const rows = [...list.querySelectorAll(':scope > li,:scope > [role="listitem"],:scope > [role="row"]')];
  // Explicit count/position metadata rules out a partial or virtualized slice.
  if (rows.length !== members.length || rows.some((row, i) => !visible(document, row) || row.getAttribute('aria-setsize') !== String(rows.length) || row.getAttribute('aria-posinset') !== String(i + 1))) return out;
  const ids = rows.map(row => {
    const links = [...row.querySelectorAll('a[href]')].filter(node => visible(document, node) && nativeAnchor(document, node));
    return links.length === 1 ? nativeAnchor(document, links[0]!) : null;
  });
  if (ids.some(id => !id || !members.some(member => member.conversationId === id)) || new Set(ids).size !== members.length) return out;
  out.timeOrder = { semantic: 'conversation-last-activity', direction: 'descending', coverage: 'complete', pinned: false, manual: false, memberIds: ids as string[] };
  return out;
}
