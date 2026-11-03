/** Synthetic session transport tests. No current Workspace/account certification. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalPrincipalReader } from '../../src/collectors/chatgpt/identity.js';
import { tupleHash } from '../../src/domain/ids.js';

const ORIGIN = 'https://chatgpt.com', SESSION = ORIGIN + '/api/auth/session';
const NOW = Date.parse('2026-11-03T10:00:00Z'), EXPIRES = '2026-11-03T11:00:00Z';
const rawPrincipal = 'synthetic-local-principal', email = 'private@example.invalid', token = 'PRIVATE_TOKEN_SENTINEL';
function response(body: unknown, { status = 200, url = SESSION, mime = 'application/json', redirected = false }: { status?: number; url?: string; mime?: string; redirected?: boolean } = {}): Response {
  const value = new Response(JSON.stringify(body), { status, headers: { 'content-type': mime } });
  Object.defineProperties(value, { url: { value: url }, redirected: { value: redirected } }); return value;
}
const session = (id = rawPrincipal) => ({ user: { id, email }, expires: EXPIRES });
async function atOrigin<T>(origin: string, work: () => Promise<T>): Promise<T> {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'location');
  Object.defineProperty(globalThis, 'location', { configurable: true, value: { origin } });
  try { return await work(); }
  finally { if (previous) Object.defineProperty(globalThis, 'location', previous); else Reflect.deleteProperty(globalThis, 'location'); }
}
const nullIdentity = (code: string) => ({ principalKey: null, expiresAt: null, code });

test('local principal uses one read-only session GET without an access token or Workspace roster', async () => atOrigin(ORIGIN, async () => {
  const calls: Array<{ input: string; init: RequestInit | undefined }> = [];
  const reader = createLocalPrincipalReader({ now: () => NOW, fetch: async (input, init) => { calls.push({ input: String(input), init }); return response(session()); } });
  const result = await reader.read();
  assert.equal(Object.isFrozen(reader), true);
  assert.deepEqual(result, { principalKey: await tupleHash('principal', rawPrincipal), expiresAt: EXPIRES, code: 'current-context-unproven' });
  assert.equal(calls.length, 1); assert.equal(calls[0]!.input, SESSION);
  const init = calls[0]!.init!;
  assert.equal(init.method, 'GET'); assert.equal(init.credentials, 'include'); assert.equal(init.cache, 'no-store'); assert.equal(init.redirect, 'error');
  assert.deepEqual(init.headers, { Accept: 'application/json' }); assert.equal(init.body, undefined);
  assert.deepEqual(Object.keys(result).sort(), ['code', 'expiresAt', 'principalKey']);
  assert.equal(JSON.stringify(result).includes(rawPrincipal), false); assert.equal(JSON.stringify(result).includes(email), false);
  assert.equal(Object.hasOwn(result, 'workspace'), false); assert.equal(Object.hasOwn(result, 'verified'), false);
}));

test('local principal digest is stable by principal identity, with no token/email carried forward', async () => atOrigin(ORIGIN, async () => {
  let principal = rawPrincipal;
  const reader = createLocalPrincipalReader({ now: () => NOW, fetch: async () => response({ ...session(principal), accessToken: token, accounts: [{ id: 'not-current-workspace' }] }) });
  const first = await reader.read(), repeated = await reader.read();
  principal = 'different-principal'; const different = await reader.read();
  assert.equal(first.principalKey, repeated.principalKey); assert.notEqual(first.principalKey, different.principalKey);
  const text = JSON.stringify([first, repeated, different]);
  for (const secret of [rawPrincipal, principal, token, email, 'not-current-workspace']) assert.equal(text.includes(secret), false, secret);
}));

test('local principal refuses foreign origins and pre-aborted reads before any request', async () => {
  let count = 0;
  const fetch: typeof globalThis.fetch = async () => { count++; return response(session()); };
  await atOrigin('https://example.invalid', async () => assert.deepEqual(await createLocalPrincipalReader({ fetch, now: () => NOW }).read(), nullIdentity('source-origin-rejected')));
  await atOrigin(ORIGIN, async () => {
    const signal = new AbortController(); signal.abort();
    assert.deepEqual(await createLocalPrincipalReader({ fetch, now: () => NOW }).read(signal.signal), nullIdentity('session-aborted'));
  });
  assert.equal(count, 0);
});

test('local principal logout, expiry and malformed identity remain unavailable rather than reusing a cached principal', async () => atOrigin(ORIGIN, async () => {
  let body: unknown = session(), status = 200;
  const reader = createLocalPrincipalReader({ now: () => NOW, fetch: async () => response(body, { status }) });
  assert.match((await reader.read()).principalKey!, /^principal:[a-f0-9]{64}$/);
  for (const code of [401, 403]) { status = code; assert.deepEqual(await reader.read(), nullIdentity('session-unauthorized')); }
  status = 200;
  body = {}; assert.deepEqual(await reader.read(), nullIdentity('session-unauthorized'), 'the empty signed-out session shape is an explicit logout, not a retained identity');
  for (const invalid of [null, { expires: EXPIRES }, { user: { id: '' }, expires: EXPIRES }, { user: { id: 'bad id' }, expires: EXPIRES }, { user: { id: '__proto__' }, expires: EXPIRES }, { user: { id: 'a'.repeat(257) }, expires: EXPIRES }, { ...session(), expires: '2026-02-30T10:00:00Z' }, { ...session(), expires: new Date(NOW).toISOString() }]) {
    body = invalid; assert.deepEqual(await reader.read(), nullIdentity('invalid-session-schema'));
  }
  body = session(); assert.match((await reader.read()).principalKey!, /^principal:[a-f0-9]{64}$/);
}));

test('local principal validates exact response origin, redirect, MIME and finite bounded session bytes', async () => atOrigin(ORIGIN, async () => {
  const cases: Array<[() => Response, string]> = [
    [() => response(session(), { url: ORIGIN + '/other' }), 'invalid-session-response'],
    [() => response(session(), { redirected: true }), 'invalid-session-response'],
    [() => response(session(), { mime: 'text/html' }), 'invalid-session-mime'],
    [() => response({ ...session(), ignored: 'x'.repeat(256 * 1024) }), 'session-response-too-large'],
    [() => { const value = response(session()); value.headers.set('cf-mitigated', 'challenge'); return value; }, 'session-challenged'],
  ];
  for (const [makeResponse, code] of cases) assert.deepEqual(await createLocalPrincipalReader({ now: () => NOW, fetch: async () => makeResponse() }).read(), nullIdentity(code));
}));

test('local principal busy/abort retains single-flight isolation until an ignoring transport drains', async () => atOrigin(ORIGIN, async () => {
  let release!: () => void, count = 0;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const reader = createLocalPrincipalReader({ now: () => NOW, fetch: async () => { count++; await gate; return response(session()); } });
  const controller = new AbortController(), first = reader.read(controller.signal);
  assert.deepEqual(await reader.read(), nullIdentity('session-read-busy')); assert.equal(count, 1);
  controller.abort(); assert.deepEqual(await first, nullIdentity('session-aborted'));
  assert.deepEqual(await reader.read(), nullIdentity('session-read-busy')); assert.equal(count, 1, 'abort cannot create a parallel identity transport');
  release(); await new Promise(resolve => setTimeout(resolve, 0));
  assert.match((await reader.read()).principalKey!, /^principal:[a-f0-9]{64}$/); assert.equal(count, 2);
}));

test('local principal rejects non-finite/backward monotonic clocks and bounded-time overruns', async () => atOrigin(ORIGIN, async () => {
  let requests = 0;
  for (const initial of [NaN, Infinity, -Infinity]) {
    assert.deepEqual(await createLocalPrincipalReader({ now: () => NOW, elapsedNow: () => initial, fetch: async () => { requests++; return response(session()); } }).read(), nullIdentity('request-timeout'));
  }
  assert.equal(requests, 0);
  for (const bad of [-1, 6000, Infinity]) {
    let elapsed = 0;
    const reader = createLocalPrincipalReader({ now: () => NOW, elapsedNow: () => elapsed, fetch: async () => { elapsed = bad; return response(session()); } });
    assert.deepEqual(await reader.read(), nullIdentity('request-timeout'));
  }
}));

test('local principal rechecks wall time and expiry before exposing the digest', async () => atOrigin(ORIGIN, async () => {
  for (const late of [NOW - 1, Date.parse(EXPIRES), NaN, Infinity]) {
    let reads = 0;
    const reader = createLocalPrincipalReader({ now: () => ++reads === 1 ? NOW : late, fetch: async () => response(session()) });
    assert.deepEqual(await reader.read(), nullIdentity('session-expired'));
  }
  assert.deepEqual(await createLocalPrincipalReader({ now: () => NaN, fetch: async () => response(session()) }).read(), nullIdentity('invalid-session-schema'));
}));
