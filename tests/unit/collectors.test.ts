import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createSessionCandidateReader, readSessionStatus } from '../../src/collectors/chatgpt/identity.js';
import { observeProjectCandidate } from '../../src/collectors/chatgpt/metadata.js';
import { CHATGPT_METADATA_PROFILE, normalizeSourceFailure } from '../../src/collectors/chatgpt/profile.js';

const ORIGIN = 'https://chatgpt.com';
const SESSION = ORIGIN + '/api/auth/session';
const ACCOUNTS = ORIGIN + '/backend-api/accounts/check/v4-2023-04-27';
const NOW = Date.parse('2026-11-02T10:00:00Z');
const session = () => ({ user: { id: 'user-synthetic', email: 'must-not-escape@example.invalid' }, expires: '2026-11-02T11:00:00Z', accessToken: 'synthetic-token-never-returned' });
const account = () => ({ account: { account_id: 'context-synthetic', structure: 'personal', is_deactivated: false }, can_access_with_session: true });
const roster = () => ({ accounts: { 'context-synthetic': account() } });
function response(url: string, body: unknown, init: ResponseInit = {}): Response {
  const result = new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init });
  Object.defineProperty(result, 'url', { value: url });
  return result;
}
function transport(accounts: unknown = roster(), calls: Array<{ url: string; init?: RequestInit }> = []): typeof fetch {
  return async (input, init) => {
    const url = String(input); calls.push({ url, init });
    assert.ok(url === SESSION || url === ACCOUNTS, 'reader may request only the two fixed sources');
    return response(url, url === SESSION ? session() : accounts);
  };
}

test('session-only reader makes exactly two fixed requests; credentials never escape', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const candidate = await createSessionCandidateReader({ fetch: transport(roster(), calls), now: () => NOW }).read();
  assert.deepEqual(calls.map(call => call.url), [SESSION, ACCOUNTS]);
  for (const call of calls) {
    assert.equal(call.init?.credentials, 'include'); assert.equal(call.init?.cache, 'no-store');
    assert.equal(call.init?.redirect, 'error'); assert.equal(call.init?.method, 'GET');
  }
  assert.equal(new Headers(calls[0]!.init?.headers).has('Authorization'), false);
  assert.equal(new Headers(calls[1]!.init?.headers).get('Authorization'), 'Bearer synthetic-token-never-returned');
  assert.deepEqual(Object.keys(candidate).sort(), ['contexts', 'expiresAt', 'principalId', 'providerProfile', 'transport']);
  assert.equal(JSON.stringify(candidate).includes('synthetic-token'), false);
  assert.equal(JSON.stringify(candidate).includes('@'), false);
  assert.equal(Object.hasOwn(candidate, 'currentContext'), false);
  assert.equal(candidate.contexts.length, 1);
  assert.equal(CHATGPT_METADATA_PROFILE.capabilities.currentContext, false);
});

test('default/null, mismatched default aliases and inaccessible spaces do not establish current context', async () => {
  const unresolved = { accounts: { default: { account: { account_id: null, structure: 'personal', is_deactivated: false }, can_access_with_session: true } } };
  await assert.rejects(createSessionCandidateReader({ fetch: transport(unresolved), now: () => NOW }).read(), /default-null-context-id/);
  const mismatched = { accounts: { 'context-synthetic': account(), default: { ...account(), can_access_with_session: false } } };
  await assert.rejects(createSessionCandidateReader({ fetch: transport(mismatched), now: () => NOW }).read(), /invalid-accounts-schema/);
  const aliases = { accounts: { 'context-synthetic': account(), default: account(), blocked: { account: { account_id: 'blocked', structure: 'team' }, can_access_with_session: false } } };
  const candidate = await createSessionCandidateReader({ fetch: transport(aliases), now: () => NOW }).read();
  assert.deepEqual(candidate.contexts, [{ id: 'context-synthetic', kind: 'personal' }]);
  assert.equal(Object.hasOwn(candidate, 'scope'), false);
});

test('identity transport rejects redirects, challenges, MIME and unauthorized responses', async () => {
  const cases: Array<[Response, RegExp]> = [
    [response(SESSION + '/elsewhere', session()), /invalid-session-response/],
    [response(SESSION, session(), { headers: { 'content-type': 'application/json', 'cf-mitigated': 'challenge' } }), /session-challenged/],
    [response(SESSION, 'not JSON', { headers: { 'content-type': 'text/html' } }), /invalid-session-mime/],
    [response(SESSION, {}, { status: 401 }), /session-unauthorized/],
  ];
  for (const [result, expected] of cases) {
    let calls = 0;
    await assert.rejects(createSessionCandidateReader({ fetch: async () => { calls++; return result; }, now: () => NOW }).read(), expected);
    assert.equal(calls, 1, 'a rejected session never proceeds to the roster');
  }
});

test('limits are enforced by streamed bytes as well as headers; malformed UTF-8 is rejected', async () => {
  for (const result of [
    response(SESSION, '{}', { headers: { 'content-type': 'application/json', 'content-length': '999999' } }),
    response(SESSION, ' '.repeat(256 * 1024 + 1)),
  ]) await assert.rejects(createSessionCandidateReader({ fetch: async () => result, now: () => NOW }).read(), /session-response-too-large/);
  const result = new Response(new Uint8Array([0xc3, 0x28]), { headers: { 'content-type': 'application/json' } });
  Object.defineProperty(result, 'url', { value: SESSION });
  await assert.rejects(createSessionCandidateReader({ fetch: async () => result, now: () => NOW }).read(), /invalid-session-body/);
});

test('abort, backwards monotonic time and expiry prevent candidate acceptance', async () => {
  const aborted = new AbortController(); aborted.abort(); let calls = 0;
  await assert.rejects(createSessionCandidateReader({ fetch: async () => { calls++; throw Error('should not run'); } }).read({ signal: aborted.signal }), /session-aborted/);
  assert.equal(calls, 0);
  let elapsed = 10;
  await assert.rejects(createSessionCandidateReader({ fetch: transport(), now: () => NOW, elapsedNow: () => elapsed-- }).read(), /request-timeout/);
  await assert.rejects(createSessionCandidateReader({ fetch: transport(), now: () => NOW + 7200000 }).read(), /invalid-session-schema/);
});

test('foreign execution origin and arbitrary errors expose only fixed failure codes', async () => {
  assert.deepEqual(await readSessionStatus(), { state: 'blocked', code: 'source-origin-rejected', profileId: CHATGPT_METADATA_PROFILE.id });
  assert.equal(normalizeSourceFailure(Error('private token and account content')), 'session-transport-failed');
  await assert.rejects(createSessionCandidateReader({ fetch: async () => { throw Error('private transport response'); } }).read(), /^Error: session-transport-failed$/);
  assert.deepEqual(Object.values(CHATGPT_METADATA_PROFILE.capabilities), [false, false, false, false, false]);
  assert.equal(CHATGPT_METADATA_PROFILE.noneSelector, ':not(*)');
  assert.equal(Object.isFrozen(CHATGPT_METADATA_PROFILE.capabilities), true);
});

const P = 'g-p-11111111111111111111111111111111';
const Q = 'g-p-22222222222222222222222222222222';
const C = '12345678-1234-1234-1234-123456789abc';
function fixture(): JSDOM {
  const dom = new JSDOM(`<main data-app-shell-main-surface><div data-app-shell-main-content-layout><div role="main"><h1><button><span>Project title</span></button></h1><div><div role="tablist"><button role="tab" aria-selected="true" id="tab1" aria-controls="panel1">Chats</button></div><div role="tabpanel" id="panel1" aria-labelledby="tab1"><section><ol><li><a href="/g/${P}/c/${C}"><div><div>Conversation title</div><div data-preview>Forbidden preview</div></div></a></li></ol></section></div></div></div></div></main><aside><a href="/g/${Q}/c/aaaaaaaa-1234-1234-1234-123456789abc">Unrelated Q</a></aside>`, { url: `${ORIGIN}/g/${P}/project`, pretendToBeVisual: true });
  // jsdom has no layout: controlled geometry only, never real visibility evidence.
  Object.defineProperty(dom.window.Element.prototype, 'getClientRects', { value() { return [{ x: 0, y: 0, width: 100, height: 24 }]; } });
  Object.defineProperty(dom.window, 'CSS', { value: { escape: (id: string) => id.replace(/[^a-zA-Z0-9_-]/g, value => '\\' + value) } });
  return dom;
}

test('Project candidate separates project and member title without ever reading preview/body text', () => {
  const dom = fixture(), document = dom.window.document;
  Object.defineProperty(document.querySelector('[data-preview]')!, 'textContent', { get() { throw Error('preview text must not be read'); } });
  Object.defineProperty(document.body, 'textContent', { get() { throw Error('body text must not be read'); } });
  const candidate = observeProjectCandidate(document);
  assert.equal(candidate?.state, 'candidate'); assert.equal(candidate?.nativeTitle, 'Project title');
  assert.deepEqual(candidate?.members, [{ conversationId: C, nativeTitle: 'Conversation title', canonicalUrl: `${ORIGIN}/c/${C}` }]);
  assert.equal(Object.hasOwn(candidate!, 'scope'), false);
  assert.equal(Object.hasOwn(candidate!, 'verified'), false);
  dom.window.close();
});

test('Project parser rejects stale/hidden/ambiguous panels, wrong containers and preview fallback', () => {
  const mutations: Array<(document: Document) => void> = [
    document => document.querySelector('[role="tab"]')!.setAttribute('aria-controls', 'wrong-panel'),
    document => document.querySelector('[role="tabpanel"]')!.setAttribute('aria-labelledby', 'wrong-tab'),
    document => document.querySelector('[role="tabpanel"]')!.setAttribute('hidden', ''),
    document => document.querySelector('[role="tabpanel"]')!.setAttribute('style', 'display:none'),
    document => document.querySelector('[role="tabpanel"]')!.setAttribute('aria-hidden', 'true'),
    document => document.querySelector('[role="tab"]')!.setAttribute('aria-selected', 'false'),
    document => document.querySelector('ol a')!.setAttribute('href', `/g/${Q}/c/${C}`),
    document => document.querySelector('ol a')!.setAttribute('href', `/c/${C}`),
    document => { document.querySelector('ol a > div > div')!.textContent = ''; },
    document => { document.querySelector('ol a > div > div')!.innerHTML = '<span>changed title structure</span>'; },
    document => document.querySelector('h1 button')!.append(document.createElement('svg')),
    document => { const duplicate = document.createElement('div'); duplicate.id = 'panel1'; document.body.append(duplicate); },
    document => { const main = document.querySelector('[role="main"]')!; main.parentElement!.append(main.cloneNode(true)); },
  ];
  for (let index = 0; index < mutations.length; index++) {
    const dom = fixture(); mutations[index]!(dom.window.document);
    assert.equal(observeProjectCandidate(dom.window.document), null, `negative structure ${index}`);
    dom.window.close();
  }
});

test('a plain conversation, missing project badge or unlinked member never asserts NONE or PROJECT', () => {
  const dom = fixture(); dom.reconfigure({ url: `${ORIGIN}/c/${C}` });
  assert.equal(observeProjectCandidate(dom.window.document), null);
  dom.reconfigure({ url: 'https://example.invalid/' });
  assert.equal(observeProjectCandidate(dom.window.document), null);
  dom.window.close();
});
