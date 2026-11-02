import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createSessionStatusReader } from '../../src/collectors/chatgpt/identity.js';
import { observeProjectCandidate, readProjectProbe, PROJECT_PROBE_CODES } from '../../src/collectors/chatgpt/metadata.js';
import { createProbeAliaser, PROBE_ALIAS_PATTERN } from '../../src/collectors/chatgpt/probe.js';
import { CHATGPT_METADATA_PROFILE } from '../../src/collectors/chatgpt/profile.js';

const ORIGIN = 'https://chatgpt.com';
const SALT = 'ab'.repeat(32), OTHER_SALT = 'cd'.repeat(32);
const NOW = Date.parse('2026-11-02T10:00:00Z');
const PRINCIPAL = 'user-private-sentinel', CONTEXT = 'workspace-private-sentinel';
const TOKEN = 'token-private-sentinel', EMAIL = 'email-private-sentinel@example.invalid';
function response(url: string, body: unknown): Response {
  const result = new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  Object.defineProperty(result, 'url', { value: url }); return result;
}
const accounts = () => ({ accounts: { [CONTEXT]: { account: { account_id: CONTEXT, structure: 'personal', is_deactivated: false }, can_access_with_session: true } } });
function transport({ principal = PRINCIPAL, roster = accounts(), calls = [] }: { principal?: string; roster?: unknown; calls?: string[] } = {}): typeof fetch {
  return async input => {
    const url = String(input); calls.push(url);
    assert.ok(url === ORIGIN + '/api/auth/session' || url === ORIGIN + '/backend-api/accounts/check/v4-2023-04-27');
    return response(url, url.endsWith('/api/auth/session') ? { user: { id: principal, email: EMAIL }, accessToken: TOKEN, expires: '2026-11-02T11:00:00Z' } : roster);
  };
}
async function atOrigin<T>(origin: string, action: () => Promise<T>): Promise<T> {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'location');
  Object.defineProperty(globalThis, 'location', { configurable: true, value: { origin } });
  try { return await action(); } finally {
    if (previous) Object.defineProperty(globalThis, 'location', previous); else Reflect.deleteProperty(globalThis, 'location');
  }
}
const keys = (value: object) => Object.keys(value).sort();

test('M0 probe aliases correlate only within a run and preserve typed separation', async () => {
  const first = await createProbeAliaser(SALT), other = await createProbeAliaser(OTHER_SALT);
  const alias = await first('conversation-title', 'same title');
  assert.match(alias, PROBE_ALIAS_PATTERN);
  assert.equal(await first('conversation-title', 'same title'), alias);
  assert.notEqual(await first('conversation', 'same title'), alias);
  assert.notEqual(await other('conversation-title', 'same title'), alias);
  await assert.rejects(createProbeAliaser('short'), /^Error: invalid-probe-salt$/);
  await assert.rejects(first('principal', ''), /^Error: invalid-probe-value$/);
});

test('M0 identity probe emits only the exact pseudonym schema and never promotes roster to current context', async () => atOrigin(ORIGIN, async () => {
  const reader = createSessionStatusReader({ fetch: transport(), now: () => NOW });
  const first = await reader.readProbe(SALT), repeated = await reader.readProbe(SALT), differentRun = await reader.readProbe(OTHER_SALT);
  assert.deepEqual(keys(first), ['code', 'contexts', 'currentContext', 'principalAlias', 'principalPresent', 'profileId', 'rosterCount', 'state']);
  assert.deepEqual(keys(first.contexts[0]!), ['alias', 'kind']);
  assert.equal(first.state, 'candidate'); assert.equal(first.code, 'current-context-unproven');
  assert.equal(first.currentContext, 'unproven'); assert.equal(first.principalPresent, true); assert.equal(first.rosterCount, 1);
  assert.match(first.principalAlias!, PROBE_ALIAS_PATTERN); assert.match(first.contexts[0]!.alias, PROBE_ALIAS_PATTERN);
  assert.equal(repeated.principalAlias, first.principalAlias); assert.notEqual(differentRun.principalAlias, first.principalAlias);
  const differentAccount = await createSessionStatusReader({ fetch: transport({ principal: 'other-private-principal' }), now: () => NOW }).readProbe(SALT);
  assert.notEqual(differentAccount.principalAlias, first.principalAlias);
  const encoded = JSON.stringify([first, repeated, differentRun, differentAccount]);
  for (const secret of [PRINCIPAL, CONTEXT, EMAIL, TOKEN, SALT, OTHER_SALT, 'other-private-principal']) assert.equal(encoded.includes(secret), false, secret);
  assert.deepEqual(Object.values(CHATGPT_METADATA_PROFILE.capabilities), [false, false, false, false, false]);
}));

test('M0 principal candidate is separately observable when default-null roster remains blocked', async () => atOrigin(ORIGIN, async () => {
  const roster = { accounts: { default: { account: { account_id: null, structure: 'personal', is_deactivated: false }, can_access_with_session: true } } };
  const reader = createSessionStatusReader({ fetch: transport({ roster }), now: () => NOW });
  const result = await reader.readProbe(SALT);
  assert.equal(result.state, 'blocked'); assert.equal(result.code, 'default-null-context-id');
  assert.equal(result.principalPresent, true); assert.match(result.principalAlias!, PROBE_ALIAS_PATTERN);
  assert.equal(result.currentContext, 'unproven'); assert.equal(result.rosterCount, 0); assert.deepEqual(result.contexts, []);
  assert.deepEqual(await reader.readStatus(), { state: 'blocked', code: 'default-null-context-id', profileId: CHATGPT_METADATA_PROFILE.id });
}));

test('M0 status and diagnostic requests share one reader; origin and salt rejection make no network requests', async () => {
  const calls: string[] = [];
  await atOrigin('https://example.invalid', async () => {
    const reader = createSessionStatusReader({ fetch: transport({ calls }), now: () => NOW });
    assert.equal((await reader.readProbe(SALT)).code, 'source-origin-rejected');
    assert.equal((await reader.readStatus()).code, 'source-origin-rejected');
    assert.equal(calls.length, 0);
  });
  await atOrigin(ORIGIN, async () => {
    const invalid = createSessionStatusReader({ fetch: transport({ calls }), now: () => NOW });
    await assert.rejects(invalid.readProbe('invalid'), /^Error: invalid-probe-salt$/); assert.equal(calls.length, 0);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const fetch = transport({ calls });
    const reader = createSessionStatusReader({ fetch: async (input, init) => { await gate; return fetch(input, init); }, now: () => NOW });
    const first = reader.readStatus();
    assert.equal((await reader.readProbe(SALT)).code, 'session-read-busy');
    release(); assert.equal((await first).code, 'current-context-unproven');
    const aborted = new AbortController(); aborted.abort();
    assert.equal((await reader.readProbe(SALT, aborted.signal)).code, 'session-aborted');
  });
});

const P = 'g-p-11111111111111111111111111111111', Q = 'g-p-22222222222222222222222222222222';
const C = '12345678-1234-1234-1234-123456789abc', D = '22345678-1234-1234-1234-123456789abc';
const TITLE = 'Conversation-private-title-sentinel', PROJECT_TITLE = 'Project-private-title-sentinel';
function fixture(): JSDOM {
  const dom = new JSDOM(`<main data-app-shell-main-surface><div data-app-shell-main-content-layout><div role="main"><h1><button><span>${PROJECT_TITLE}</span></button></h1><div><div role="tablist"><button role="tab" aria-selected="true" id="tab" aria-controls="panel">Chats</button></div><div role="tabpanel" id="panel" aria-labelledby="tab"><section><ol><li><a href="/g/${P}/c/${C}"><div><div>${TITLE}</div><div data-preview>Forbidden preview</div></div></a></li><li><a href="/g/${P}/c/${D}"><div><div>${TITLE}</div><div data-preview>Forbidden preview</div></div></a></li></ol></section></div></div></div></div></main>`, { url: `${ORIGIN}/g/${P}/project`, pretendToBeVisual: true });
  Object.defineProperty(dom.window.Element.prototype, 'getClientRects', { value() { return [{ x: 0, y: 0, width: 100, height: 24 }]; } });
  Object.defineProperty(dom.window, 'CSS', { value: { escape: (id: string) => id.replace(/[^a-zA-Z0-9_-]/g, value => '\\' + value) } });
  for (const node of [...dom.window.document.querySelectorAll('[data-preview]'), dom.window.document.body, dom.window.document.documentElement]) {
    Object.defineProperty(node, 'textContent', { get() { throw Error('forbidden text getter'); } });
    Object.defineProperty(node, 'outerHTML', { get() { throw Error('forbidden snapshot getter'); } });
  }
  return dom;
}
test('M0 Project diagnostics use the production parser and correlate same titles without disclosing text or IDs', async () => {
  const dom = fixture();
  try {
    const candidate = observeProjectCandidate(dom.window.document), result = await readProjectProbe(dom.window.document, SALT);
    assert.equal(candidate?.members.length, 2); assert.equal(result.code, 'project-candidate-only');
    assert.deepEqual(keys(result), ['assertions', 'code', 'memberCount', 'members', 'projectAlias', 'projectTitleAlias', 'routeKind']);
    assert.deepEqual(keys(result.assertions), ['boundaryUnique', 'containerLinked', 'membersStructure', 'panelUnique', 'tabPanelLinked', 'titleLeaf']);
    assert.deepEqual(Object.values(result.assertions), [true, true, true, true, true, true]);
    assert.deepEqual(keys(result.members[0]!), ['conversationAlias', 'titleAlias']);
    assert.equal(result.memberCount, 2); assert.equal(result.members[0]!.titleAlias, result.members[1]!.titleAlias);
    assert.notEqual(result.members[0]!.conversationAlias, result.members[1]!.conversationAlias);
    for (const secret of [TITLE, PROJECT_TITLE, P, C, D, SALT, 'Forbidden preview']) assert.equal(JSON.stringify(result).includes(secret), false, secret);
  } finally { dom.window.close(); }
});

test('M0 Project diagnostic stages retain strict production rejection and never assert NONE', async () => {
  const mutations: Array<[(document: Document) => void, string]> = [
    [document => document.querySelector('[role="tab"]')!.setAttribute('aria-controls', 'wrong'), 'project-tab-panel-unproven'],
    [document => document.querySelector('ol a')!.setAttribute('href', `/g/${Q}/c/${C}`), 'project-container-unproven'],
    [document => document.querySelector('ol a > div > div')!.replaceChildren(document.createElement('span')), 'project-members-unproven'],
    [document => document.querySelector('[role="tabpanel"]')!.setAttribute('hidden', ''), 'project-panel-unproven'],
  ];
  for (const [mutate, code] of mutations) {
    const dom = fixture();
    try {
      mutate(dom.window.document);
      assert.equal(observeProjectCandidate(dom.window.document), null);
      const result = await readProjectProbe(dom.window.document, SALT);
      assert.equal(result.code, code); assert.ok(PROJECT_PROBE_CODES.includes(result.code));
      assert.equal(result.projectAlias, null); assert.equal(result.projectTitleAlias, null); assert.deepEqual(result.members, []);
    } finally { dom.window.close(); }
  }
  const dom = fixture();
  try {
    dom.reconfigure({ url: `${ORIGIN}/c/${C}` });
    const result = await readProjectProbe(dom.window.document, SALT);
    assert.equal(result.routeKind, 'conversation'); assert.equal(result.code, 'not-project-route');
    assert.equal(Object.hasOwn(result, 'membership'), false); assert.equal(Object.hasOwn(result, 'none'), false);
  } finally { dom.window.close(); }
});
