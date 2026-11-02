/** Production collector bundle, synthetic ports and jsdom lifecycle only.
 * No real browser, account, visibility, user gesture or source authority claim. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { JSDOM } from 'jsdom';
import { webcrypto, randomUUID } from 'node:crypto';

const bundle = buildSync({ entryPoints: ['src/collectors/chatgpt/content-entry.ts'], bundle: true, write: false, format: 'iife', platform: 'browser', target: 'chrome120', legalComments: 'none' }).outputFiles[0]!.text;
const ORIGIN = 'https://chatgpt.com', PROTOCOL = 'vaiwl-start-collector/1', EXTENSION = 'synthetic-extension';
const URL1 = ORIGIN + '/c/12345678-1234-1234-1234-123456789abc';
const URL2 = ORIGIN + '/c/22345678-1234-1234-1234-123456789abc';
const URL3 = ORIGIN + '/c/32345678-1234-1234-1234-123456789abc';
const tick = () => new Promise<void>(resolve => setTimeout(resolve, 5));
async function eventually(predicate: () => boolean, label: string) {
  for (let attempt = 0; attempt < 200; attempt++) { if (predicate()) return; await tick(); }
  assert.fail('Synthetic collector condition did not settle: ' + label);
}
type Listener = (message: any, sender: any, respond: (response: unknown) => void) => unknown;
type Request = { url: string; signal?: AbortSignal | null; release: () => void };
function harness({ hold = false, ignoreAbort = false } = {}) {
  const dom = new JSDOM('<!doctype html><html><body><p data-private>Forbidden body sentinel</p></body></html>', { url: URL1, runScripts: 'outside-only', pretendToBeVisual: true });
  const listeners = new Set<Listener>(), messages: any[] = [], requests: Request[] = [];
  let holdSessions = hold, binding = { id: randomUUID(), routeEpoch: 0 }, href = URL1;
  const response = (url: string, body: unknown) => {
    const result = new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
    Object.defineProperty(result, 'url', { value: url }); return result;
  };
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = String(input), isSession = url === ORIGIN + '/api/auth/session';
    assert.ok(isSession || url === ORIGIN + '/backend-api/accounts/check/v4-2023-04-27', 'only the two frozen metadata sources are requested');
    let release = () => {};
    const gate = new Promise<void>(resolve => { release = resolve; });
    const request = { url, signal: init?.signal, release }; requests.push(request);
    if (isSession && holdSessions) {
      await new Promise<void>((resolve, reject) => {
        const abort = () => reject(new Error('synthetic aborted transport'));
        if (!ignoreAbort) init?.signal?.addEventListener('abort', abort, { once: true });
        void gate.then(() => { init?.signal?.removeEventListener('abort', abort); resolve(); });
        if (init?.signal?.aborted && !ignoreAbort) abort();
      });
    }
    return response(url, isSession ? { user: { id: 'synthetic-principal', email: 'forbidden@example.invalid' }, accessToken: 'never-export-this-token', expires: '2099-01-01T00:00:00Z' }
      : { accounts: { 'synthetic-context': { account: { account_id: 'synthetic-context', structure: 'personal', is_deactivated: false }, can_access_with_session: true } } });
  };
  Object.assign(dom.window, { fetch, TextDecoder, TextEncoder, Uint8Array, Response });
  Object.defineProperty(dom.window, 'crypto', { value: webcrypto });
  Object.defineProperty(dom.window, 'chrome', { value: { runtime: {
    id: EXTENSION,
    onMessage: { addListener: (listener: Listener) => listeners.add(listener), removeListener: (listener: Listener) => listeners.delete(listener) },
    sendMessage: async (message: any) => {
      messages.push(JSON.parse(JSON.stringify(message)));
      if (message.command === 'HELLO') {
        if (message.payload.href !== href) { href = message.payload.href; binding = { id: randomUUID(), routeEpoch: binding.routeEpoch + 1 }; }
        return { ok: true, data: { ...binding } };
      }
      return { ok: true };
    },
  } } });
  // Body contents and snapshots are deliberately inaccessible to collector code.
  for (const node of [dom.window.document.body, dom.window.document.querySelector('[data-private]')!]) {
    Object.defineProperty(node, 'textContent', { get() { throw Error('body text must not be read'); } });
    Object.defineProperty(node, 'outerHTML', { get() { throw Error('body snapshot must not be read'); } });
  }
  const dispatch = (message: unknown, respond: (value: unknown) => void = () => {}) => {
    const realmMessage = dom.window.JSON.parse(JSON.stringify(message));
    for (const listener of [...listeners]) listener(realmMessage, { id: EXTENSION }, value => respond(JSON.parse(JSON.stringify(value))));
  };
  const command = (name: string, extra: Record<string, unknown> = {}) => dispatch({ protocol: PROTOCOL, command: name, ...extra });
  const route = (url: string) => { dom.reconfigure({ url }); command('ROUTE'); };
  const lifecycle = (name: 'pagehide' | 'pageshow', persisted: boolean) => dom.window.dispatchEvent(new dom.window.PageTransitionEvent(name, { persisted }));
  const requestProbe = (payload: unknown) => new Promise<any>(resolve => dispatch({ protocol: PROTOCOL, command: 'PROBE', payload }, resolve));
  const probePayload = (captureId: string) => ({ runId: randomUUID(), captureId, step: 'A-baseline', saltHex: 'ab'.repeat(32), bindingId: binding.id, routeEpoch: binding.routeEpoch, pickStructure: true });
  const count = (name: string) => messages.filter(message => message.command === name).length;
  const statuses = () => messages.filter(message => message.command === 'SOURCE_STATUS');
  const sessionRequests = () => requests.filter(request => request.url.endsWith('/api/auth/session'));
  const close = async () => { command('STOP'); for (const request of requests) request.release(); await tick(); dom.window.close(); };
  dom.window.eval(bundle);
  return { dom, messages, requests, command, route, lifecycle, requestProbe, probePayload, count, statuses, sessionRequests, close, setHold: (value: boolean) => { holdSessions = value; } };
}

test('collector reroute discards stale identity status and rereads identity for each current route', async () => {
  const h = harness({ hold: true });
  try {
    await eventually(() => h.sessionRequests().length === 1, 'first held session request');
    h.setHold(false); h.route(URL2);
    await eventually(() => h.statuses().length === 1, 'new-route status');
    assert.equal(h.sessionRequests()[0]!.signal?.aborted, true);
    assert.equal(h.sessionRequests().length, 2);
    assert.equal(h.statuses()[0]!.payload.routeEpoch, 1);
    assert.equal(h.statuses()[0]!.payload.code, 'current-context-unproven');
    assert.equal(h.statuses().some(message => message.payload.routeEpoch === 0), false);
    h.route(URL3);
    await eventually(() => h.statuses().length === 2, 'third-route reread');
    assert.equal(h.sessionRequests().length, 3);
    assert.equal(h.statuses()[1]!.payload.routeEpoch, 2);
  } finally { await h.close(); }
});

test('collector reuses one reader while aborted transport drains and can recover on a later route', async () => {
  const h = harness({ hold: true, ignoreAbort: true });
  try {
    await eventually(() => h.sessionRequests().length === 1, 'held reader');
    h.route(URL2);
    await eventually(() => h.statuses().some(message => message.payload.code === 'session-read-busy'), 'single-flight refusal');
    assert.equal(h.sessionRequests().length, 1, 'a new reader must not bypass the still-draining transport');
    h.sessionRequests()[0]!.release(); await tick(); h.setHold(false); h.route(URL3);
    await eventually(() => h.statuses().some(message => message.payload.routeEpoch === 2 && message.payload.code === 'current-context-unproven'), 'subsequent authorized route recovers');
    assert.equal(h.sessionRequests().length, 2);
  } finally { await h.close(); }
});

test('collector BFCache suspension aborts work, restoration rebinds, and explicit STOP never resumes', async () => {
  const h = harness({ hold: true });
  try {
    await eventually(() => h.sessionRequests().length === 1, 'pending session before suspension');
    const helloBefore = h.count('HELLO'); h.lifecycle('pagehide', true); h.command('ROUTE'); await tick();
    assert.equal(h.sessionRequests()[0]!.signal?.aborted, true); assert.equal(h.statuses().length, 0);
    assert.equal(h.count('HELLO'), helloBefore, 'suspended document must not observe route messages');
    h.setHold(false); h.lifecycle('pageshow', true);
    await eventually(() => h.statuses().length === 1, 'restored active document status');
    assert.equal(h.count('HELLO'), helloBefore + 1); assert.equal(h.sessionRequests().length, 2);
    h.command('STOP'); const stoppedHello = h.count('HELLO'), stoppedRequests = h.requests.length;
    h.lifecycle('pageshow', true); h.route(URL2); await tick();
    assert.equal(h.count('HELLO'), stoppedHello); assert.equal(h.requests.length, stoppedRequests);
    assert.equal((h.dom.window as any).__vaiwlStartCollector, undefined);
    assert.equal(h.messages.some(message => /INTENT|ARRIVAL|OPEN_DAY/.test(message.command)), false, 'page restore does not invent an activity request');
  } finally { await h.close(); }
});

test('collector cancels only the selected capture and removes its picker without stopping normal observation', async () => {
  const h = harness();
  try {
    await eventually(() => h.statuses().length === 1, 'initial observation');
    const captureId = randomUUID(); let settled = false;
    const pending = h.requestProbe(h.probePayload(captureId)).then(value => { settled = true; return value; });
    await eventually(() => h.dom.window.document.querySelector('[data-vaiwl-owned="source-check"]') !== null, 'controlled picker');
    h.command('CANCEL_PROBE', { captureId: randomUUID() }); await tick();
    assert.equal(settled, false); assert.ok(h.dom.window.document.querySelector('[data-vaiwl-owned="source-check"]'));
    h.command('CANCEL_PROBE', { captureId });
    await eventually(() => settled, 'capture-scoped cancellation response');
    assert.deepEqual(await pending, { ok: false, code: 'PROBE_CANCELLED' });
    assert.equal(h.dom.window.document.querySelector('[data-vaiwl-owned="source-check"]'), null);
    h.route(URL2); await eventually(() => h.statuses().length === 2, 'normal collector survives cancellation');
    assert.equal(h.statuses()[1]!.payload.code, 'current-context-unproven');
  } finally { await h.close(); }
});

test('collector malformed probe requests always return a bounded response without raw payload or source reads', async () => {
  const h = harness();
  try {
    await eventually(() => h.statuses().length === 1, 'initial observation'); const reads = h.requests.length;
    for (const payload of [null, {}, { captureId: randomUUID(), secret: 'private-sentinel' }, { ...h.probePayload(randomUUID()), saltHex: 'invalid-private-sentinel' }]) {
      let answer: any;
      void h.requestProbe(payload).then(value => { answer = value; });
      await eventually(() => answer !== undefined, 'malformed request response');
      assert.deepEqual(answer, { ok: false, code: 'PROBE_CANCELLED' });
      assert.equal(JSON.stringify(answer).includes('private-sentinel'), false);
    }
    assert.equal(h.requests.length, reads); assert.equal(h.dom.window.document.querySelector('[data-vaiwl-owned="source-check"]'), null);
  } finally { await h.close(); }
});
