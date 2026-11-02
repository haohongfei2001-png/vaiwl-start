import test from 'node:test';
import assert from 'node:assert/strict';
import type { Repository } from '../../src/storage/repository.js';
import { sourceCheckCommand, exportSourceCheck, stopSourceCheck } from '../../src/background/source-check.js';
import { changeSession } from '../../src/background/session.js';
import { CHATGPT_METADATA_PROFILE } from '../../src/collectors/chatgpt/profile.js';
import { CHECK_STEPS, SOURCE_CHECK_PROTOCOL, trustedCheckSender, validateCollectorProbe, type CollectorProbe } from '../../src/shared/source-check.js';

const EXTENSION = 'source-check-synthetic-extension';
const BUILD = { sha: 'a'.repeat(40) };
const TARGET = 'https://chatgpt.com/c/71000000-0000-4000-8000-000000000001';
const OTHER = 'https://chatgpt.com/c/71000000-0000-4000-8000-000000000002';
const TARGET_DOC = 'private-target-document-sentinel';
const SENDER = { id: EXTENSION, frameId: 0, documentId: 'private-check-document-sentinel', documentLifecycle: 'active', tab: { id: 17 }, url: `chrome-extension://${EXTENSION}/source-check.html` } as chrome.runtime.MessageSender;
const clone = <T>(value: T): T => structuredClone(value);
function validProbe(payload: Record<string, any>): CollectorProbe {
  return {
    runId: payload.runId, captureId: payload.captureId, step: payload.step, authority: false,
    identity: { state: 'candidate', code: 'current-context-unproven', profileId: CHATGPT_METADATA_PROFILE.id, principalPresent: true,
      principalAlias: 'hmac256:' + '1'.repeat(64), rosterCount: 1, contexts: [{ alias: 'hmac256:' + '2'.repeat(64), kind: 'personal' }], currentContext: 'unproven' },
    project: { routeKind: 'conversation', code: 'not-project-route', assertions: { boundaryUnique: false, titleLeaf: false, panelUnique: false, tabPanelLinked: false, membersStructure: false, containerLinked: false }, memberCount: 0, projectAlias: null, projectTitleAlias: null, members: [] },
    structure: { state: 'not-requested', code: 'not-requested', authority: false },
  };
}
type Sent = { tabId: number; message: Record<string, any>; options: Record<string, any> };
async function harness() {
  const previous = (globalThis as any).chrome;
  const saved: Record<string, any> = {};
  const sent: Sent[] = [], pending = new Set<Promise<unknown>>(), releases: Array<() => void> = [];
  let connected = true, captureEnabled = true;
  let frame = { documentId: TARGET_DOC, documentLifecycle: 'active', url: TARGET };
  let nextFrameGate: (() => Promise<void>) | null = null;
  let responder = async (payload: Record<string, any>): Promise<any> => ({ ok: true, data: validProbe(payload) });
  const repo = { getSnapshot: async () => ({ settings: { captureEnabled } }), listIntents: async () => [] } as unknown as Repository;
  (globalThis as any).chrome = {
    runtime: { id: EXTENSION },
    storage: { session: {
      get: async (key: string) => ({ [key]: clone(saved[key]) }),
      set: async (value: Record<string, unknown>) => { Object.assign(saved, clone(value)); },
    } },
    permissions: { contains: async () => connected },
    webNavigation: { getFrame: async () => { const result = clone(frame), gate = nextFrameGate; nextFrameGate = null; if (gate) await gate(); return result; } },
    tabs: {
      query: async () => [{ id: 41, url: TARGET, title: 'PRIVATE TAB TITLE' }],
      sendMessage: async (tabId: number, message: Record<string, any>, options: Record<string, any>) => {
        sent.push(clone({ tabId, message, options }));
        return message.command === 'PROBE' ? responder(message.payload) : { ok: true };
      },
    },
  };
  const command = (command: string, payload: unknown = {}, sender: chrome.runtime.MessageSender = SENDER) => {
    const work = sourceCheckCommand({ protocol: SOURCE_CHECK_PROTOCOL, command, payload }, sender, repo, BUILD);
    pending.add(work); work.then(() => pending.delete(work), () => pending.delete(work)); return work as Promise<any>;
  };
  function deferProbe() {
    let started!: (payload: Record<string, any>) => void, finish!: (response: unknown) => void;
    let payload: Record<string, any> | null = null;
    const observed = new Promise<Record<string, any>>(resolve => { started = resolve; });
    const response = new Promise<unknown>(resolve => { finish = resolve; });
    responder = async p => { payload = p; started(p); return response; };
    const release = (mutate?: (value: CollectorProbe) => unknown) => { if (payload) finish({ ok: true, data: mutate ? mutate(validProbe(payload)) : validProbe(payload) }); else finish({ ok: false }); };
    releases.push(release); return { observed, release };
  }
  function deferNextFrame() {
    let started!: () => void, release!: () => void;
    const observed = new Promise<void>(resolve => { started = resolve; });
    const hold = new Promise<void>(resolve => { release = resolve; });
    nextFrameGate = async () => { started(); await hold; };
    releases.push(release); return { observed, release };
  }
  return { command, sent, saved, repo, deferProbe, deferNextFrame,
    begin: () => command('BEGIN', { browser: { family: 'Chrome', version: '142.0.0.0' } }),
    capture: (step = 'A-baseline') => command('CAPTURE', { step, tabId: 41, pickStructure: false }),
    setConnected: (value: boolean) => { connected = value; }, setCaptureEnabled: (value: boolean) => { captureEnabled = value; },
    setFrame: (patch: Partial<typeof frame>) => { frame = { ...frame, ...patch }; },
    response: (mutate: (value: CollectorProbe) => unknown) => { responder = async p => ({ ok: true, data: mutate(validProbe(p)) }); },
    close: async () => { await stopSourceCheck(); for (const release of releases) release(); await Promise.allSettled([...pending]); await changeSession(() => {}); (globalThis as any).chrome = previous; },
  };
}
function assertNoPrivateExport(value: unknown, secrets: string[] = []) {
  const serialized = JSON.stringify(value);
  for (const secret of [TARGET, OTHER, TARGET_DOC, SENDER.documentId!, 'PRIVATE TAB TITLE', ...secrets]) assert.equal(serialized.includes(secret), false, `private sentinel escaped: ${secret}`);
  const forbidden = new Set(['saltHex', 'browserSessionId', 'tabId', 'documentId', 'targetTabId', 'sourceTabId', 'href', 'url', 'rawSession', 'email', 'token', 'cookie', 'principalId']);
  function visit(node: unknown) {
    if (!node || typeof node !== 'object') return;
    for (const [key, child] of Object.entries(node)) { assert.equal(forbidden.has(key), false, `forbidden export key: ${key}`); visit(child); }
  }
  visit(value);
}

test('source-check coordinator admits only its own active top-frame page and rejects malformed requests', async () => {
  const h = await harness();
  try {
    assert.equal(trustedCheckSender(SENDER, EXTENSION), true);
    for (const patch of [
      { url: `chrome-extension://${EXTENSION}/newtab.html` }, { url: TARGET }, { frameId: 1 },
      { id: 'foreign-extension' }, { documentLifecycle: 'prerender' }, { documentId: undefined },
    ]) {
      const sender = { ...SENDER, ...patch } as chrome.runtime.MessageSender;
      assert.equal(trustedCheckSender(sender, EXTENSION), false);
      await assert.rejects(h.command('STATUS', {}, sender), /^Error: UNAUTHORIZED_SENDER$/);
    }
    assert.equal((await h.command('STATUS')).report, null);
    for (const message of [
      { protocol: SOURCE_CHECK_PROTOCOL, command: 'STATUS', payload: {}, verified: true },
      { protocol: 'foreign', command: 'STATUS', payload: {} },
      { protocol: SOURCE_CHECK_PROTOCOL, command: 'STATUS', payload: { rawSession: 'PRIVATE' } },
    ]) await assert.rejects(sourceCheckCommand(message, SENDER, h.repo, BUILD), /^Error: INVALID_MESSAGE$/);
    await assert.rejects(h.command('BEGIN', { browser: { family: 'Chrome', version: '142.0', email: 'PRIVATE' } }), /^Error: INVALID_MESSAGE$/);
    assert.equal(h.saved.sourceCheckRun, undefined); assert.equal(h.sent.length, 0);
  } finally { await h.close(); }
});

test('source-check reserves each comparison slot once and never overlaps captures or exports internal identity', async () => {
  const h = await harness();
  try {
    const begun = await h.begin(), salt = h.saved.sourceCheckRun.saltHex, browserSessionId = h.saved.browserSession.id;
    assert.equal(begun.authority, false); assertNoPrivateExport(begun, [salt, browserSessionId]);
    await assert.rejects(h.begin(), /^Error: PROBE_ALREADY_STARTED$/);
    const deferred = h.deferProbe(), work = h.capture(); await deferred.observed;
    await assert.rejects(h.capture(), /^Error: PROBE_BUDGET_USED$/);
    await assert.rejects(h.capture('A-switch'), /^Error: PROBE_BUDGET_USED$/);
    deferred.release(); const report = await work;
    assert.equal(report.entries.length, 1); assert.equal(report.entries[0].state, 'captured'); assert.equal(report.entries[0].code, 'CANDIDATE_ONLY');
    assert.equal(report.entries[0].documentBound, true); assert.equal(report.entries[0].openChain.hasIntent, false);
    assert.deepEqual(report.sourceStates, { A: 'BLOCKED', B: 'BLOCKED', C: 'BLOCKED', D: 'BLOCKED' });
    assertNoPrivateExport(report, [salt, browserSessionId]);
    assertNoPrivateExport(await h.command('EXPORT'), [salt, browserSessionId]);
    await assert.rejects(h.capture(), /^Error: PROBE_BUDGET_USED$/);
    assert.equal(h.sent.filter(entry => entry.message.command === 'PROBE').length, 1);
  } finally { await h.close(); }
});

test('source-check rejects extra collector data, invented authority and mismatched correlation without saving a sample', async () => {
  const h = await harness();
  const invalid: Array<(value: CollectorProbe) => unknown> = [
    value => ({ ...value, rawSession: 'PRIVATE' }),
    value => ({ ...value, authority: true }),
    value => ({ ...value, identity: { ...value.identity, email: 'PRIVATE' } }),
    value => ({ ...value, identity: { ...value.identity, principalAlias: 'private-principal-id' } }),
    value => ({ ...value, project: { ...value.project, rawUrl: TARGET } }),
    value => ({ ...value, structure: { ...value.structure, text: 'PRIVATE' } }),
    value => ({ ...value, runId: crypto.randomUUID() }),
    value => ({ ...value, captureId: crypto.randomUUID() }),
  ];
  try {
    await h.begin();
    for (let i = 0; i < invalid.length; i++) {
      h.response(invalid[i]!); const report = await h.capture(CHECK_STEPS[i]);
      const last = report.entries.at(-1); assert.equal(last.state, 'blocked'); assert.equal(last.code, 'INVALID_MESSAGE');
      assert.equal(Object.hasOwn(last, 'sample'), false); assertNoPrivateExport(report, ['PRIVATE', 'private-principal-id']);
    }
    const valid = validProbe({ runId: crypto.randomUUID(), captureId: crypto.randomUUID(), step: 'A-baseline' });
    assert.doesNotThrow(() => validateCollectorProbe(valid));
    assert.throws(() => validateCollectorProbe({ ...valid, structure: { state: 'not-requested', code: 'not-requested', authority: false, id: 'PRIVATE' } }), /^Error: INVALID_MESSAGE$/);
  } finally { await h.close(); }
});

test('source-check late responses after revoke, disable, route change or document replacement cannot append a sample', async () => {
  for (const scenario of ['revoked', 'disabled', 'route', 'document'] as const) {
    const h = await harness();
    try {
      await h.begin(); const deferred = h.deferProbe(), work = h.capture(); await deferred.observed;
      if (scenario === 'revoked') h.setConnected(false);
      if (scenario === 'disabled') h.setCaptureEnabled(false);
      if (scenario === 'route') h.setFrame({ url: OTHER });
      if (scenario === 'document') h.setFrame({ documentId: 'replacement-private-doc' });
      deferred.release(); const report = await work, entry = report.entries[0];
      assert.equal(entry.state, 'blocked', scenario); assert.equal(Object.hasOwn(entry, 'sample'), false, scenario);
      assert.equal(entry.code, scenario === 'revoked' || scenario === 'disabled' ? 'PERMISSION_REQUIRED' : 'STALE_DOCUMENT');
      assertNoPrivateExport(report, ['replacement-private-doc']);
    } finally { await h.close(); }
  }
});

test('source-check END cancels only the scoped in-flight document, erases salt and rejects its late result', async () => {
  const h = await harness();
  try {
    await h.begin(); const deferred = h.deferProbe(), work = h.capture(); const payload = await deferred.observed;
    assert.deepEqual(await h.command('END'), { ended: true });
    assert.equal(h.saved.sourceCheckRun.ended, true); assert.equal(h.saved.sourceCheckRun.saltHex, '');
    const cancels = h.sent.filter(entry => entry.message.command === 'CANCEL_PROBE');
    assert.ok(cancels.length > 0); assert.ok(cancels.every(entry => entry.tabId === 41 && entry.options.documentId === TARGET_DOC && entry.message.captureId === payload.captureId));
    deferred.release(); const report = await work;
    assert.equal(report.entries[0].state, 'blocked'); assert.equal(report.entries[0].code, 'PROBE_CANCELLED'); assert.equal(Object.hasOwn(report.entries[0], 'sample'), false);
    await assert.rejects(h.capture('A-switch'), /^Error: PROBE_EXPIRED$/);
    assertNoPrivateExport(report);
  } finally { await h.close(); }
});

test('source-check END during a pending frame lookup cannot dispatch a later diagnostic request', async () => {
  const h = await harness();
  try {
    await h.begin(); const deferred = h.deferNextFrame(), work = h.capture(); await deferred.observed;
    await h.command('END'); deferred.release();
    const report = await work;
    assert.equal(h.sent.filter(entry => entry.message.command === 'PROBE').length, 0);
    assert.equal(report.entries[0].state, 'blocked'); assert.equal(Object.hasOwn(report.entries[0], 'sample'), false);
    assert.equal(h.saved.sourceCheckRun.saltHex, '');
  } finally { await h.close(); }
});

test('source-check expiration and interrupted worker recovery terminate the run and erase secret salt', async () => {
  for (const scenario of ['expired', 'interrupted'] as const) {
    const h = await harness();
    try {
      await h.begin();
      const run = h.saved.sourceCheckRun, now = Date.now();
      if (scenario === 'expired') { run.startedAt = new Date(now - 31 * 60000).toISOString(); run.expiresAt = new Date(now - 60000).toISOString(); }
      run.entries = [{ step: 'A-baseline', captureId: crypto.randomUUID(), capturedAt: run.startedAt, state: 'running', code: 'PROBE_RUNNING' }];
      const status = await h.command('STATUS');
      assert.equal(status.report.ended, true, scenario); assert.equal(h.saved.sourceCheckRun.saltHex, '', scenario);
      assert.equal(status.report.entries[0].state, 'blocked'); assert.equal(status.report.entries[0].code, scenario === 'expired' ? 'PROBE_EXPIRED' : 'PROBE_INTERRUPTED');
      assertNoPrivateExport(status.report); await assert.rejects(h.capture('A-switch'), /^Error: PROBE_EXPIRED$/);
    } finally { await h.close(); }
  }
});

test('source-check export projects or refuses malformed nested metadata instead of leaking raw session additions', async () => {
  const h = await harness();
  try {
    await h.begin(); await h.capture();
    const malformed = clone(h.saved.sourceCheckRun);
    malformed.browser.email = 'private-browser-email@example.invalid';
    malformed.entries[0].openChain.url = TARGET;
    malformed.entries[0].documentId = TARGET_DOC;
    malformed.rawSession = 'private-session-sentinel';
    try {
      const report = exportSourceCheck(malformed);
      assertNoPrivateExport(report, ['private-browser-email@example.invalid', 'private-session-sentinel', malformed.saltHex, malformed.browserSessionId]);
    } catch (error) {
      // Exact export validation may reject corrupted storage instead of projecting it.
      assert.match(String(error), /^(?:Error: )?(?:INVALID_MESSAGE|PROBE_UNAVAILABLE)$/);
    }
  } finally { await h.close(); }
});
