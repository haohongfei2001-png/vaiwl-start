export const PROTOCOL = 'vaiwl-start-internal/1';
export const COLLECTOR_PROTOCOL = 'vaiwl-start-collector/1';
export function plain(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
export function exact(value: unknown, required: string[], optional: string[] = []): asserts value is Record<string, any> {
  if (!plain(value) || required.some(k => !Object.hasOwn(value, k)) || Object.keys(value).some(k => !required.includes(k) && !optional.includes(k))) throw new Error('INVALID_MESSAGE');
}
export function bounded(value: unknown, max = 512): asserts value is string {
  if (typeof value !== 'string' || value.length === 0 || [...value].length > max || /[\u0000-\u001f\u007f]/u.test(value)) throw new Error('INVALID_MESSAGE');
}
export function parseEnvelope(message: unknown): { operationId: string; expectedRevision: number; command: string; payload: Record<string, any> } {
  exact(message, ['protocol', 'operationId', 'expectedRevision', 'command', 'payload']);
  if (message.protocol !== PROTOCOL || !Number.isSafeInteger(message.expectedRevision) || message.expectedRevision < 0 || !plain(message.payload)) throw new Error('INVALID_MESSAGE');
  bounded(message.command, 40); bounded(message.operationId, 80);
  if (!/^[a-zA-Z0-9_-]+$/.test(message.operationId)) throw new Error('INVALID_MESSAGE');
  return message as any;
}
export function trustedExtensionSender(sender: chrome.runtime.MessageSender, extensionId: string): boolean {
  if (sender.id !== extensionId || sender.frameId !== 0 || !sender.documentId || !Number.isInteger(sender.tab?.id)) return false;
  return sender.url === `chrome-extension://${extensionId}/newtab.html` && (!sender.documentLifecycle || sender.documentLifecycle === 'active');
}
export function trustedCollectorSender(sender: chrome.runtime.MessageSender, extensionId: string): boolean {
  if (sender.id !== extensionId || sender.frameId !== 0 || !sender.documentId || !Number.isInteger(sender.tab?.id) || sender.documentLifecycle !== 'active') return false;
  try { const url = new URL(sender.url!); return url.origin === 'https://chatgpt.com' && !url.username && !url.password && !url.port; } catch { return false; }
}
export function publicError(error: unknown): string {
  const code = error instanceof Error ? error.message : '';
  const safe = new Set(['INVALID_MESSAGE', 'UNAUTHORIZED_SENDER', 'PERMISSION_REQUIRED', 'STALE_DOCUMENT', 'STALE_REVISION', 'SOURCE_GATE_BLOCKED', 'RECORD_NOT_FOUND', 'INVALID_URL', 'INVALID_TIME_ZONE', 'NAVIGATION_FAILED', 'HISTORY_UNAVAILABLE', 'IMPORT_NOT_FOUND', 'IMPORT_NOT_RUNNING', 'IMPORT_BUSY', 'INVALID_SHORTCUT', 'REVISION_CONFLICT', 'record-not-found', 'revision-conflict', 'invalid-url', 'invalid-time-zone', 'invalid-website-url']);
  if (error instanceof DOMException && error.name === 'QuotaExceededError') return 'STORAGE_QUOTA';
  return safe.has(code) ? code : 'REQUEST_FAILED';
}
