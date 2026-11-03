import { boundedString } from './validation.js';
export interface ConversationIdentity { conversationId: string; canonicalUrl: string; containerHint: string | null }
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const CONVERSATION = new RegExp(`^/c/(${UUID})$`, 'i');
const CONTAINER_CONVERSATION = new RegExp(`^/g/([a-zA-Z0-9_-]{1,128})/c/(${UUID})$`, 'i');
/** Native Project URLs may append a presentation slug. The fixed ID, never
 * that slug or a title, is the identity. A generic GPT container is not one. */
export function projectIdFromContainer(value: string | null): string | null {
  return value?.match(/^(g-p-[0-9a-f]{32})(?:-[a-zA-Z0-9_-]{1,91})?$/)?.[1] ?? null;
}
function safeURL(value: unknown): URL | null {
  if (typeof value !== 'string' || new TextEncoder().encode(value).byteLength > 8192 || /[\u0000-\u0020\u007f\\]/.test(value) || /%(?:2f|5c|2e|00|25)/i.test(value)) return null;
  const authority = value.match(/^https:\/\/([^/?#]*)/i)?.[1];
  const rawPath = value.replace(/^https?:\/\/[^/?#]*/i, '').split(/[?#]/, 1)[0]!;
  if (!authority || authority.includes(':') || rawPath.split('/').some(p => p === '.' || p === '..')) return null;
  try { const url = new URL(value); if (url.username || url.password || url.hash || url.port) return null; return url; } catch { return null; }
}
export function parseConversationUrl(value: unknown): ConversationIdentity | null {
  const url = safeURL(value);
  if (!url || url.protocol !== 'https:' || !['chatgpt.com', 'chat.openai.com'].includes(url.hostname) || url.search || url.pathname.includes('%')) return null;
  const direct = CONVERSATION.exec(url.pathname);
  const contained = url.hostname === 'chatgpt.com' ? CONTAINER_CONVERSATION.exec(url.pathname) : null;
  const conversationId = (direct?.[1] ?? contained?.[2])?.toLowerCase();
  if (contained && ['__proto__', 'constructor', 'prototype'].includes(contained[1]!)) return null;
  if (!conversationId) return null;
  const container = contained?.[1] ?? null;
  return { conversationId, canonicalUrl: `https://chatgpt.com/c/${conversationId}`, containerHint: projectIdFromContainer(container) ?? container };
}
export function parseProjectUrl(value: unknown): { projectId: string; canonicalUrl: string } | null {
  const url = safeURL(value);
  if (!url || url.protocol !== 'https:' || url.hostname !== 'chatgpt.com' || url.search || url.pathname.includes('%')) return null;
  const container = /^\/g\/([a-zA-Z0-9_-]{1,128})\/project$/.exec(url.pathname)?.[1] ?? null;
  const projectId = projectIdFromContainer(container);
  if (!projectId) return null;
  return { projectId, canonicalUrl: `https://chatgpt.com/g/${projectId}/project` };
}
export function validateWebsiteUrl(value: unknown): string {
  boundedString(value, 8192);
  if (/[\u0000-\u0020\u007f\\]/.test(value as string)) throw Error('invalid-website-url');
  let url: URL; try { url = new URL(value as string); } catch { throw Error('invalid-website-url'); }
  if (!['https:', 'http:'].includes(url.protocol) || !url.hostname || url.username || url.password) throw Error('invalid-website-url');
  return url.href;
}
export async function tupleHash(namespace: string, ...parts: string[]): Promise<string> {
  const encoder = new TextEncoder(); const entries = [namespace, ...parts].map(s => encoder.encode(boundedString(s, 1024)));
  const buffer = new Uint8Array(entries.reduce((n, entry) => n + 4 + entry.byteLength, 0));
  const view = new DataView(buffer.buffer); let offset = 0;
  for (const entry of entries) { view.setUint32(offset, entry.byteLength); offset += 4; buffer.set(entry, offset); offset += entry.byteLength; }
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', buffer));
  return `${namespace}:${Array.from(hash, n => n.toString(16).padStart(2, '0')).join('')}`;
}
export const scopeKey = (principal: string, context: string) => tupleHash('scope', 'chatgpt', principal, context);
export const conversationKey = (scope: string, conversationId: string) => tupleHash('conversation', 'chatgpt', scope, conversationId);
export const stagingKey = (profile: string, conversationId: string) => tupleHash('candidate', profile, 'chatgpt', conversationId);
export const projectKey = (scope: string, projectId: string) => tupleHash('project', 'chatgpt', scope, projectId);
