/** Session-only adaptation; source byte hashes and boundary are in UPSTREAM.md.
 * No conversation endpoint, DOM data, token IPC, persistence or log transport. */
import { instant } from '../../domain/time.js';
import { CHATGPT_METADATA_PROFILE, normalizeSourceFailure } from './profile.js';
import type { SourceStatus } from './profile.js';

const ORIGIN = 'https://chatgpt.com';
const SESSION = '/api/auth/session';
const ACCOUNTS = '/backend-api/accounts/check/v4-2023-04-27';
const TIMEOUT = 6000;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const identifier = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\s\u0000-\u001f\u007f]/u.test(value) && !['__proto__', 'constructor', 'prototype'].includes(value);

export interface IdentityCandidate {
  readonly principalId: string;
  readonly expiresAt: string;
  readonly contexts: ReadonlyArray<Readonly<{ id: string; kind: 'personal' | 'organization' | 'unknown' }>>;
  readonly providerProfile: string;
  readonly transport: 'isolated-fixed-fetch';
}
interface ReaderDependencies { fetch?: typeof globalThis.fetch; now?: () => number; elapsedNow?: () => number }

async function readJSON(response: Response, target: string, limit: number, check: () => void): Promise<unknown> {
  try {
    check();
    if (response.redirected || response.url !== target) throw Error('invalid-session-response');
    if (response.headers.get('cf-mitigated') === 'challenge') throw Error('session-challenged');
    if (response.status === 401 || response.status === 403) throw Error('session-unauthorized');
    if (response.status !== 200) throw Error('invalid-session-response');
    if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) throw Error('invalid-session-mime');
    const length = response.headers.get('content-length');
    if (length !== null && (!/^\d+$/.test(length) || Number(length) > limit)) throw Error('session-response-too-large');
    if (!response.body?.getReader) throw Error('missing-session-body');
  } catch (error) { try { await response.body?.cancel(); } catch { /* disposal only */ } throw error; }
  const reader = response.body!.getReader(), decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0, text = '';
  try {
    for (;;) {
      check(); const chunk = await reader.read(); check();
      if (chunk.done) break;
      if (!(chunk.value instanceof Uint8Array)) throw Error('invalid-session-body');
      bytes += chunk.value.byteLength;
      if (bytes > limit) throw Error('session-response-too-large');
      try { text += decoder.decode(chunk.value, { stream: true }); } catch { throw Error('invalid-session-body'); }
    }
    try { text += decoder.decode(); } catch { throw Error('invalid-session-body'); }
    check();
    try { return JSON.parse(text) as unknown; } catch { throw Error('invalid-session-json'); }
  } finally { text = ''; try { await reader.cancel(); } catch { /* disposal only */ } reader.releaseLock(); }
}

function canonical(value: unknown, depth = 0, count = { value: 0 }): string {
  if (depth > 16 || ++count.value > 10000) throw Error('invalid-accounts-schema');
  if (Array.isArray(value)) return '[' + value.map(item => canonical(item, depth + 1, count)).join(',') + ']';
  if (record(value)) return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key], depth + 1, count)).join(',') + '}';
  return JSON.stringify(value);
}
function contextsFrom(value: unknown): IdentityCandidate['contexts'] {
  if (!record(value) || !record(value.accounts)) throw Error('invalid-accounts-schema');
  const entries = Object.entries(value.accounts);
  if (entries.length > 1000) throw Error('invalid-accounts-schema');
  const contexts: Array<IdentityCandidate['contexts'][number]> = [];
  const seen = new Set<string>();
  for (const [key, entry] of entries) {
    if (!identifier(key) || !record(entry) || !record(entry.account)) throw Error('invalid-accounts-schema');
    const account = entry.account;
    if (!identifier(account.account_id)) {
      if (entries.length === 1 && key === 'default' && account.account_id === null && !Object.hasOwn(account, 'id') && account.structure === 'personal' && account.is_deactivated === false && entry.can_access_with_session === true) throw Error('default-null-context-id');
      throw Error('invalid-accounts-schema');
    }
    if (typeof account.structure !== 'string' || account.structure.length > 128 || (Object.hasOwn(account, 'is_deactivated') && typeof account.is_deactivated !== 'boolean') || (Object.hasOwn(entry, 'can_access_with_session') && typeof entry.can_access_with_session !== 'boolean')) throw Error('invalid-accounts-schema');
    if (key !== account.account_id) {
      const original = Object.hasOwn(value.accounts, account.account_id) ? value.accounts[account.account_id] : null;
      if (key !== 'default' || !original || canonical(entry) !== canonical(original)) throw Error('invalid-accounts-schema');
      continue;
    }
    if (seen.has(account.account_id)) throw Error('invalid-accounts-schema');
    seen.add(account.account_id);
    if (account.is_deactivated === true || entry.can_access_with_session === false) continue;
    const kind = account.structure === 'personal' ? 'personal' : ['team', 'enterprise'].includes(account.structure) ? 'organization' : 'unknown';
    contexts.push(Object.freeze({ id: account.account_id, kind }));
  }
  return Object.freeze(contexts);
}

/** Internal/test dependency injection changes transport only, never authority.
 * Production calls readSessionStatus(), which checks the isolated page origin. */
export function createSessionCandidateReader({ fetch = globalThis.fetch, now = Date.now, elapsedNow = () => performance.now() }: ReaderDependencies = {}) {
  let rawReads = 0;
  async function read({ signal }: { signal?: AbortSignal } = {}): Promise<IdentityCandidate> {
    if (rawReads !== 0) throw Error('session-read-busy');
    const controller = new AbortController();
    const started = elapsedNow(); let last = started, token: string | null = null, timedOut = false;
    const check = () => {
      const elapsed = elapsedNow();
      if (timedOut || !Number.isFinite(started) || !Number.isFinite(elapsed) || elapsed < last || elapsed - started >= TIMEOUT) throw Error('request-timeout');
      last = elapsed;
      if (controller.signal.aborted) throw Error('session-aborted');
    };
    let rejectAbort: (error: Error) => void = () => {};
    const cancelled = new Promise<never>((_, reject) => { rejectAbort = reject; });
    const abort = () => { controller.abort(); rejectAbort(Error('session-aborted')); };
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const timer = setTimeout(() => { timedOut = true; controller.abort(); rejectAbort(Error('request-timeout')); }, TIMEOUT);
    const json = async (path: typeof SESSION | typeof ACCOUNTS, limit: number): Promise<unknown> => {
      check();
      const target = ORIGIN + path;
      const response = await fetch(target, { method: 'GET', credentials: 'include', cache: 'no-store', redirect: 'error', signal: controller.signal, headers: { Accept: 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) } });
      return readJSON(response, target, limit, check);
    };
    rawReads++;
    const work = (async (): Promise<IdentityCandidate> => {
      try {
        check(); const session = await json(SESSION, 256 * 1024); check();
        const time = now();
        if (!Number.isFinite(time) || !record(session) || !record(session.user) || !identifier(session.user.id) || typeof session.expires !== 'string' || instant(session.expires) === null || instant(session.expires)! <= time || typeof session.accessToken !== 'string' || !session.accessToken || session.accessToken.length > 16384 || !/^[\x21-\x7e]+$/.test(session.accessToken)) throw Error('invalid-session-schema');
        const principalId = session.user.id, expiresAt = session.expires;
        token = session.accessToken; delete session.accessToken;
        const accounts = await json(ACCOUNTS, 1024 * 1024); check();
        const contexts = contextsFrom(accounts), returnedAt = now();
        if (!Number.isFinite(returnedAt) || instant(expiresAt)! <= returnedAt) throw Error('session-expired');
        return Object.freeze({ principalId, expiresAt, contexts, providerProfile: CHATGPT_METADATA_PROFILE.id, transport: 'isolated-fixed-fetch' });
      } finally { token = null; rawReads--; }
    })();
    try { const candidate = await Promise.race([work, cancelled]); check(); return candidate; }
    catch (error) { throw Error(normalizeSourceFailure(error)); }
    finally { token = null; clearTimeout(timer); signal?.removeEventListener('abort', abort); controller.abort(); }
  }
  return Object.freeze({ read });
}

/** Call only after explicit ChatGPT connection; only this enum may enter IPC. */
export async function readSessionStatus(signal?: AbortSignal): Promise<SourceStatus> {
  if (globalThis.location?.origin !== ORIGIN) return { state: 'blocked', code: 'source-origin-rejected', profileId: CHATGPT_METADATA_PROFILE.id };
  try {
    await createSessionCandidateReader().read({ signal });
    return { state: 'candidate', code: 'current-context-unproven', profileId: CHATGPT_METADATA_PROFILE.id };
  } catch (error) { return { state: 'blocked', code: normalizeSourceFailure(error), profileId: CHATGPT_METADATA_PROFILE.id }; }
}
