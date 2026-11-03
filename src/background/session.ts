export interface DocumentBinding {
  id: string;
  tabId: number;
  documentId: string;
  href: string;
  routeEpoch: number;
  scopeEpoch: number;
  scopeKey: string | null;
  lifecycle: 'active';
  localIdentity?: { token: string; generation: number; principalKey: string | null; expiresAt: string | null; sampledAt: number };
}
export interface BrowserSession {
  id: string;
  scopeEpoch: number;
  bindings: Record<string, DocumentBinding>;
  localIdentitySequence?: number;
}
let initializing: Promise<BrowserSession> | null = null;
export async function session(): Promise<BrowserSession> {
  // Deduplicate initialization; authoritative lifetime is storage.session, not this promise.
  if (initializing) return initializing;
  initializing = (async () => {
    const existing = (await chrome.storage.session.get('browserSession')).browserSession as BrowserSession | undefined;
    if (existing?.id) return existing;
    const created: BrowserSession = { id: crypto.randomUUID(), scopeEpoch: 0, bindings: {} };
    await chrome.storage.session.set({ browserSession: created });
    return created;
  })();
  try { return await initializing; } finally { initializing = null; }
}
// Serializes transient binding read/modify/write. This is never the business CAS.
let mutations: Promise<unknown> = Promise.resolve();
export function changeSession<T>(action: (value: BrowserSession) => T | Promise<T>): Promise<T> {
  const work = mutations.catch(() => {}).then(async () => {
    const current = await session(); const result = await action(current);
    await chrome.storage.session.set({ browserSession: current }); return result;
  });
  mutations = work;
  return work;
}
export async function invalidateBindings(): Promise<void> {
  await changeSession(current => { current.scopeEpoch++; current.bindings = {}; });
}
