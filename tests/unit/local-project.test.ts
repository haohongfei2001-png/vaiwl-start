/** Synthetic DOM/ports test the bounded candidate contract, never real ChatGPT. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { buildSync } from 'esbuild';
import { webcrypto, randomUUID } from 'node:crypto';
import { observeProjectCandidate, readProjectProbe } from '../../src/collectors/chatgpt/metadata.js';
import { parseLocalProjectCandidate } from '../../src/collectors/chatgpt/project-candidate.js';

const ORIGIN = 'https://chatgpt.com';
const P = 'g-p-11111111111111111111111111111111';
const Q = 'g-p-22222222222222222222222222222222';
const C = '12345678-1234-1234-1234-123456789abc';
const D = '22345678-1234-1234-1234-123456789abc';
const PROJECT_URL = `${ORIGIN}/g/${P}/project`;
const CONVERSATION_URL = `${ORIGIN}/c/${C}`;
const HTML = `<main data-app-shell-main-surface><div data-app-shell-main-content-layout><div role="main"><h1><button><span>Observed project</span></button></h1><div><div role="tablist"><button role="tab" aria-selected="true" id="t" aria-controls="p">Chats</button></div><div role="tabpanel" id="p" aria-labelledby="t"><section><ol><li><a href="/c/${C}"><div><div>Observed member</div><div data-preview>PRIVATE PREVIEW</div></div></a></li></ol></section></div></div></div></div></main><aside><a href="/c/${D}">Unrelated history</a></aside>`;
function fixture(html = HTML) {
  const dom = new JSDOM(html, { url: PROJECT_URL, runScripts: 'outside-only', pretendToBeVisual: true });
  Object.defineProperty(dom.window.Element.prototype, 'getClientRects', { value() { return [{ x: 0, y: 0, width: 80, height: 20 }]; } });
  Object.defineProperty(dom.window, 'CSS', { value: { escape: (id: string) => id } });
  for (const node of [dom.window.document.body, ...dom.window.document.querySelectorAll('[data-preview]')]) {
    Object.defineProperty(node, 'textContent', { get() { throw Error('private text must not be read'); } });
    Object.defineProperty(node, 'outerHTML', { get() { throw Error('private snapshot must not be read'); } });
  }
  return dom;
}

test('a unique linked native panel with plain conversation URLs produces only local candidate relationships', async () => {
  const dom = fixture();
  try {
    const project = observeProjectCandidate(dom.window.document)!;
    assert.equal(project.state, 'candidate'); assert.equal(project.relationBasis, 'linked-native-panel');
    assert.equal(project.projectId, P); assert.equal(project.members.length, 1);
    assert.equal(project.members[0]!.conversationId, C, 'unrelated sidebar history is not a member');
    assert.equal(Object.hasOwn(project, 'scopeKey'), false); assert.equal(Object.hasOwn(project, 'verified'), false);
    assert.deepEqual(parseLocalProjectCandidate(project, PROJECT_URL), project);
    const probe = await readProjectProbe(dom.window.document, 'ab'.repeat(32));
    assert.equal(probe.code, 'project-candidate-only');
    assert.equal(probe.assertions.containerLinked, false, 'diagnostics must not claim an explicit child URL container');
    assert.equal(probe.assertions.tabPanelLinked, true);
    assert.equal(JSON.stringify(project).includes('PRIVATE PREVIEW'), false);
    dom.window.document.querySelector('ol a')!.setAttribute('href', `/g/${Q}/c/${C}`);
    assert.equal(observeProjectCandidate(dom.window.document), null, 'an explicit contradictory container invalidates the observation');
  } finally { dom.window.close(); }
});

test('candidate IPC rejects wrong routes, forged ownership, duplicate members and unexpected private fields', () => {
  const dom = fixture();
  try {
    const project = observeProjectCandidate(dom.window.document)!;
    const mutate = (fn: (value: any) => void) => { const value = structuredClone(project); fn(value); return value; };
    const bad = [
      mutate(v => { v.state = 'verified'; }),
      mutate(v => { v.scopeKey = 'forged-scope'; }),
      mutate(v => { v.key = 'forged-partition-key'; }),
      mutate(v => { v.observedAt = '2026-11-02T00:00:00Z'; }),
      mutate(v => { v.relationBasis = 'title-similarity'; }),
      mutate(v => { v.projectId = Q; }),
      mutate(v => { v.canonicalUrl = `${ORIGIN}/g/${Q}/project`; }),
      mutate(v => { v.nativeTitle = ' '; }),
      mutate(v => { v.members.push(v.members[0]); }),
      mutate(v => { v.members[0].conversationId = D; }),
      mutate(v => { v.members[0].canonicalUrl = `${ORIGIN}/g/${P}/c/${C}`; }),
      mutate(v => { v.members[0].body = 'PRIVATE BODY'; }),
      mutate(v => { v.members[0].nativeTitle = 'bad\nlabel'; }),
      mutate(v => { v.members = Array(201).fill(v.members[0]); }),
    ];
    for (const value of bad) assert.throws(() => parseLocalProjectCandidate(value, PROJECT_URL), /INVALID_MESSAGE/);
    for (const route of [CONVERSATION_URL, `${ORIGIN}/g/${Q}/project`, 'https://example.invalid/']) {
      assert.throws(() => parseLocalProjectCandidate(project, route), /INVALID_MESSAGE/);
    }
  } finally { dom.window.close(); }
});

const bundle = buildSync({ entryPoints: ['src/collectors/chatgpt/content-entry.ts'], bundle: true, write: false, format: 'iife', platform: 'browser', target: 'chrome120' }).outputFiles[0]!.text;
const tick = () => new Promise<void>(resolve => setTimeout(resolve, 5));
async function eventually(predicate: () => boolean) { for (let i = 0; i < 200; i++) { if (predicate()) return; await tick(); } assert.fail('collector observation did not settle'); }
function collectorHarness(html = HTML) {
  const dom = fixture(html), messages: any[] = [], listeners = new Set<any>(), requests: string[] = [];
  let routeEpoch = 0, persona: string | null = 'synthetic-principal', previousPrincipal: string | null | undefined, identityGeneration = 0, sessionStatus = 200;
  Object.assign(dom.window, { TextDecoder, TextEncoder, Uint8Array, Response, fetch: async (input: unknown) => {
    const url = String(input); requests.push(url);
    assert.equal(url, ORIGIN + '/api/auth/session', 'normal local grouping never requests a workspace roster');
    const data = persona === null ? {} : { user: { id: persona }, accessToken: 'private-token', expires: '2099-01-01T00:00:00Z' };
    const response = new Response(JSON.stringify(data), { status: persona === null ? 401 : sessionStatus, headers: { 'content-type': 'application/json' } });
    Object.defineProperty(response, 'url', { value: url }); return response;
  } });
  Object.defineProperty(dom.window, 'crypto', { value: webcrypto });
  Object.defineProperty(dom.window, 'chrome', { value: { runtime: { id: 'test-extension',
    onMessage: { addListener: (fn: any) => listeners.add(fn), removeListener: (fn: any) => listeners.delete(fn) },
    sendMessage: async (message: any) => {
      messages.push(JSON.parse(JSON.stringify(message)));
      if (message.command === 'LOCAL_IDENTITY') {
        const changed = previousPrincipal !== undefined && previousPrincipal !== message.payload.principalKey;
        previousPrincipal = message.payload.principalKey;
        return { ok: true, data: { identityToken: randomUUID(), identityGeneration: ++identityGeneration, changed } };
      }
      return { ok: true, data: { id: 'test-binding', routeEpoch } };
    },
  } } });
  const command = (name: string) => { for (const listener of [...listeners]) listener({ protocol: 'vaiwl-start-collector/1', command: name }, { id: 'test-extension' }, () => {}); };
  dom.window.eval(bundle);
  return { dom, messages, requests, setPersona: (value: string | null) => { persona = value; }, setSessionStatus: (status: number) => { sessionStatus = status; }, close: () => { command('STOP'); dom.window.close(); }, route: (url: string) => { routeEpoch++; dom.reconfigure({ url }); command('ROUTE'); } };
}

test('production collector sends bounded Project metadata even when current workspace cannot be certified', async () => {
  const h = collectorHarness();
  try {
    await eventually(() => h.messages.some(m => m.command === 'OBSERVE') && h.messages.some(m => m.command === 'SOURCE_STATUS'));
    const observed = h.messages.find(m => m.command === 'OBSERVE').payload;
    assert.equal(observed.projectCandidate.projectId, P);
    assert.deepEqual(observed.candidates, observed.projectCandidate.members.map((m: any) => ({ url: m.canonicalUrl, title: m.nativeTitle })));
    assert.equal(h.messages.find(m => m.command === 'SOURCE_STATUS').payload.code, 'current-context-unproven');
    assert.match(observed.identityToken, /^[0-9a-f-]{36}$/);
    assert.equal(h.messages.filter(m => m.command === 'LOCAL_IDENTITY').length, 2, 'initial binding and accepted metadata each sample the session principal');
    assert.deepEqual(h.requests, [ORIGIN + '/api/auth/session', ORIGIN + '/api/auth/session']);
    assert.equal(parseLocalProjectCandidate(observed.projectCandidate, PROJECT_URL).members.length, 1);
    assert.equal(JSON.stringify(h.messages).includes('private-token'), false);
    assert.equal(h.messages.some(m => /ARRIVAL|OPEN_DAY|MEMBERSHIP/.test(m.command)), false);
    h.route(CONVERSATION_URL);
    await eventually(() => h.messages.some(m => m.command === 'SOURCE_STATUS' && m.payload.routeEpoch === 1));
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.equal(h.messages.some(m => m.command === 'OBSERVE' && m.payload.routeEpoch === 1), false, 'ordinary /c with retained Project-looking markup provides no native relation and sends no empty observation');
  } finally { h.close(); }
});

test('route changes cancel Project hydration before a late candidate can attach to the new route', async () => {
  const h = collectorHarness('<main></main>');
  try {
    await eventually(() => h.messages.some(m => m.command === 'HELLO'));
    h.route(CONVERSATION_URL);
    await eventually(() => h.messages.some(m => m.command === 'SOURCE_STATUS' && m.payload.routeEpoch === 1));
    h.dom.window.document.body.innerHTML = HTML;
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.equal(h.messages.some(m => m.command === 'OBSERVE' && m.payload.routeEpoch === 0), false);
    assert.equal(h.messages.some(m => m.command === 'OBSERVE' && m.payload.routeEpoch === 1), false, 'late old Project markup on an ordinary /c route cannot create a relation');
  } finally { h.close(); }
});

test('same-document principal change rejects the retained old surface and resumes with a replacement native panel', async () => {
  const h = collectorHarness();
  try {
    await eventually(() => h.messages.some(m => m.command === 'OBSERVE'));
    const count = () => h.messages.filter(m => m.command === 'OBSERVE').length;
    const initial = count(), principalA = h.messages.find(m => m.command === 'LOCAL_IDENTITY').payload.principalKey;
    h.setPersona('synthetic-principal-b');
    h.dom.window.document.querySelector('h1 span')!.textContent = 'Old surface updated during account switch';
    await eventually(() => h.messages.some(m => m.command === 'LOCAL_IDENTITY' && m.payload.principalKey !== principalA));
    await new Promise(resolve => setTimeout(resolve, 550));
    assert.equal(count(), initial, 'old retained panel must not be admitted under a newly observed principal');
    h.dom.window.document.body.innerHTML = HTML.replace('Observed project', 'B fresh native Project').replace('Observed member', 'B fresh member');
    await eventually(() => count() === initial + 1);
    assert.equal(h.messages.filter(m => m.command === 'OBSERVE').at(-1).payload.projectCandidate.nativeTitle, 'B fresh native Project');
    h.setPersona('synthetic-principal');
    h.dom.window.document.body.innerHTML = HTML.replace('Observed project', 'A replacement directly during switch');
    await eventually(() => count() === initial + 2);
    assert.equal(h.messages.filter(m => m.command === 'OBSERVE').at(-1).payload.projectCandidate.nativeTitle, 'A replacement directly during switch', 'a newly replaced valid surface must not be permanently invalidated just because identity changed in its pre-send check');
    assert.equal(h.messages.filter(m => m.command === 'OBSERVE').every(m => m.payload.routeEpoch === 0), true);
    assert.equal(JSON.stringify(h.messages).includes('synthetic-principal'), false, 'only the session principal digest crosses collector IPC');
  } finally { h.close(); }
});

test('transient session failure rejects the batch without rebinding identity and retries the same native surface', async () => {
  const h = collectorHarness();
  try {
    const observations = () => h.messages.filter(m => m.command === 'OBSERVE');
    const identities = () => h.messages.filter(m => m.command === 'LOCAL_IDENTITY');
    await eventually(() => observations().length === 1);
    const initial = observations()[0]!, identityCount = identities().length, reads = h.requests.length;
    const panel = h.dom.window.document.querySelector('[role="tabpanel"]');
    h.setSessionStatus(500);
    h.dom.window.document.querySelector('h1 span')!.textContent = 'Rename during transient session failure';
    await eventually(() => h.requests.length === reads + 1); await tick();
    assert.equal(observations().length, 1, 'a failed current session read cannot reuse the previous accepted identity proof');
    assert.equal(identities().length, identityCount, 'transient HTTP failure cannot rotate to an unknown identity boundary');
    h.setSessionStatus(200);
    await eventually(() => observations().length === 2);
    const recovered = observations()[1]!;
    assert.equal(h.dom.window.document.querySelector('[role="tabpanel"]'), panel, 'recovery requires neither a new route nor replacement metadata nodes');
    assert.equal(recovered.payload.projectCandidate.nativeTitle, 'Rename during transient session failure');
    assert.equal(recovered.payload.routeEpoch, 0); assert.equal(h.messages.filter(m => m.command === 'HELLO').length, 1);
    assert.notEqual(recovered.payload.identityToken, initial.payload.identityToken, 'the successful retry must obtain a new proof');
    assert.equal(identities().length, identityCount + 1); assert.equal(h.requests.length, reads + 2, 'one failed read and one bounded successful retry');
    assert.equal(new Set(identities().map(m => m.payload.principalKey)).size, 1, 'the original principal remains the only observed identity');
  } finally { h.close(); }
});
