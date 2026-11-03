import type { Repository } from '../storage/repository.js';
import { CHATGPT_METADATA_PROFILE } from '../collectors/chatgpt/profile.js';
import { parseConversationUrl, parseProjectUrl } from '../domain/ids.js';
import { COLLECTOR_PROTOCOL, exact } from '../shared/protocol.js';
import { CHECK_STEPS, SOURCE_CHECK_PROTOCOL, checkStep, correlation, trustedCheckSender, validateCollectorProbe, type CheckStep, type CollectorProbe } from '../shared/source-check.js';
import { CONNECTION } from './permissions.js';
import { bindCurrentDocument, inspectStartOpenChain, requireCurrentBinding } from './navigation.js';
import { session } from './session.js';

type Entry = { step: CheckStep; captureId: string; capturedAt: string; state: 'running' | 'captured' | 'blocked'; code: string; sample?: CollectorProbe; openChain?: { state: string; hasIntent: boolean }; documentBound?: boolean };
interface Run { id: string; buildSha: string; saltHex: string; browserSessionId: string; scopeEpoch: number; startedAt: string; expiresAt: string; ended: boolean; browser: { family: string; version: string }; entries: Entry[] }
const KEY = 'sourceCheckRun';
const active = new Map<string, { tabId: number; documentId: string } | null>();
let writes: Promise<unknown> = Promise.resolve();
function mutation<T>(work: () => Promise<T>): Promise<T> { const job = writes.catch(() => {}).then(work); writes = job; return job; }
async function readRun(): Promise<Run | null> { return (await chrome.storage.session.get(KEY))[KEY] as Run || null; }
async function save(run: Run) { await chrome.storage.session.set({ [KEY]: run }); }
async function reconciledRun(sha: string) {
  return mutation(async () => {
    const run = await readRun(); if (!run) return null;
    const current = await session(), now = Date.now();
    if (now >= Date.parse(run.expiresAt) || now < Date.parse(run.startedAt) || run.buildSha !== sha || run.browserSessionId !== current.id || run.scopeEpoch !== current.scopeEpoch) { run.ended = true; run.saltHex = ''; }
    for (const entry of run.entries) if (entry.state === 'running' && (run.ended || !active.has(entry.captureId) || now - Date.parse(entry.capturedAt) >= 65000)) { entry.state = 'blocked'; entry.code = run.ended ? 'PROBE_EXPIRED' : 'PROBE_INTERRUPTED'; run.ended = true; run.saltHex = ''; }
    await save(run); return run;
  });
}
function usable(run: Run, sha: string, browserSession: Awaited<ReturnType<typeof session>>) {
  const now = Date.now();
  if (run.ended || !run.saltHex || run.buildSha !== sha || run.browserSessionId !== browserSession.id || run.scopeEpoch !== browserSession.scopeEpoch || now < Date.parse(run.startedAt) || now >= Date.parse(run.expiresAt)) throw Error('PROBE_EXPIRED');
}
/** Explicit projection: salts, real IDs, URLs, tab/document IDs and frame handles are never exported. */
export function exportSourceCheck(run: Run) {
  correlation(run.id);
  const iso = (value: unknown) => { if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw Error('INVALID_MESSAGE'); };
  iso(run.startedAt); iso(run.expiresAt);
  if (!/^[a-f0-9]{40}$/.test(run.buildSha) || typeof run.ended !== 'boolean' || !['Chrome', 'Edge', 'Chromium', 'Unknown'].includes(run.browser.family) || !/^(?:[0-9]{1,4}\.){1,3}[0-9]{1,5}$/.test(run.browser.version) || !Array.isArray(run.entries) || run.entries.length > CHECK_STEPS.length || new Set(run.entries.map(e => e.step)).size !== run.entries.length) throw Error('INVALID_MESSAGE');
  for (const entry of run.entries) {
    checkStep(entry.step); correlation(entry.captureId); iso(entry.capturedAt);
    if (!['running', 'captured', 'blocked'].includes(entry.state) || !['PROBE_RUNNING', 'CANDIDATE_ONLY', 'STALE_DOCUMENT', 'PERMISSION_REQUIRED', 'PROBE_EXPIRED', 'PROBE_TIMEOUT', 'PROBE_CANCELLED', 'INVALID_MESSAGE', 'PROBE_UNAVAILABLE', 'PROBE_INTERRUPTED'].includes(entry.code) || entry.documentBound !== undefined && typeof entry.documentBound !== 'boolean') throw Error('INVALID_MESSAGE');
    if (entry.sample) { validateCollectorProbe(entry.sample); if (entry.sample.runId !== run.id || entry.sample.captureId !== entry.captureId || entry.sample.step !== entry.step) throw Error('INVALID_MESSAGE'); }
    if (entry.openChain && (!['no-matching-intent', 'navigation-pending', 'navigation-bound-arrival-unproven', 'ambiguous-intent', 'stale-binding'].includes(entry.openChain.state) || typeof entry.openChain.hasIntent !== 'boolean')) throw Error('INVALID_MESSAGE');
  }
  return { format: SOURCE_CHECK_PROTOCOL, runId: run.id, buildSha: run.buildSha, profileId: CHATGPT_METADATA_PROFILE.id,
    startedAt: run.startedAt, expiresAt: run.expiresAt, ended: run.ended, browser: { family: run.browser.family, version: run.browser.version },
    sourceGate: 'SOURCE_GATE_BLOCKED', authority: false, sourceStates: { A: 'BLOCKED', B: 'BLOCKED', C: 'BLOCKED', D: 'BLOCKED' },
    limitations: ['Structure and per-run aliases are diagnostic candidates, not semantic authority.', 'No current-workspace, positive-NONE or loaded-conversation identity source has been validated.', 'Start navigation binding does not create OpenDay; native and address-bar entry points remain unverified.'],
    entries: run.entries.map(entry => ({ step: entry.step, captureId: entry.captureId, capturedAt: entry.capturedAt, state: entry.state, code: entry.code,
      ...(entry.sample ? { sample: entry.sample } : {}), ...(entry.openChain ? { openChain: { state: entry.openChain.state, hasIntent: entry.openChain.hasIntent } } : {}), ...(entry.documentBound === undefined ? {} : { documentBound: entry.documentBound }) })) };
}
export async function stopSourceCheck() {
  await mutation(async () => { const run = await readRun(); if (run) { run.ended = true; run.saltHex = ''; for (const e of run.entries) if (e.state === 'running') { e.state = 'blocked'; e.code = 'PROBE_CANCELLED'; } await save(run); } });
  await Promise.allSettled([...active].filter(([, target]) => target).map(([captureId, target]) => chrome.tabs.sendMessage(target!.tabId, { protocol: COLLECTOR_PROTOCOL, command: 'CANCEL_PROBE', captureId }, { documentId: target!.documentId })));
}
async function permitted(repo: Repository) {
  if (!await chrome.permissions.contains(CONNECTION) || !(await repo.getSnapshot()).settings.captureEnabled) throw Error('PERMISSION_REQUIRED');
}
export async function sourceCheckCommand(message: unknown, sender: chrome.runtime.MessageSender, repo: Repository, build: { sha: string }) {
  if (!trustedCheckSender(sender, chrome.runtime.id)) throw Error('UNAUTHORIZED_SENDER');
  exact(message, ['protocol', 'command', 'payload']); if (message.protocol !== SOURCE_CHECK_PROTOCOL) throw Error('INVALID_MESSAGE');
  const p = message.payload;
  if (message.command === 'STATUS') {
    exact(p, []);
    const run = await reconciledRun(build.sha);
    const connected = await chrome.permissions.contains(CONNECTION), captureEnabled = (await repo.getSnapshot()).settings.captureEnabled;
    const tabs = connected ? (await chrome.tabs.query({ url: 'https://chatgpt.com/*' })).filter(t => Number.isInteger(t.id)).map(t => ({ tabId: t.id!, routeKind: parseProjectUrl(t.url || '') ? 'project' : parseConversationUrl(t.url || '') ? 'conversation' : 'unsupported' })) : [];
    return { report: run ? exportSourceCheck(run) : null, connected, captureEnabled, tabs, buildSha: build.sha };
  }
  if (message.command === 'EXPORT') { exact(p, []); const run = await reconciledRun(build.sha); if (!run) throw Error('PROBE_NOT_STARTED'); return exportSourceCheck(run); }
  if (message.command === 'END') { exact(p, []); await stopSourceCheck(); return { ended: true }; }
  if (message.command === 'BEGIN') {
    exact(p, ['browser']); exact(p.browser, ['family', 'version']);
    if (!['Chrome', 'Edge', 'Chromium', 'Unknown'].includes(p.browser.family) || !/^(?:[0-9]{1,4}\.){1,3}[0-9]{1,5}$/.test(p.browser.version)) throw Error('INVALID_MESSAGE');
    await permitted(repo);
    return mutation(async () => {
      const old = await readRun(); if (old) throw Error('PROBE_ALREADY_STARTED');
      const current = await session(), now = Date.now();
      const run: Run = { id: crypto.randomUUID(), buildSha: build.sha, saltHex: [...crypto.getRandomValues(new Uint8Array(32))].map(x => x.toString(16).padStart(2, '0')).join(''), browserSessionId: current.id, scopeEpoch: current.scopeEpoch,
        startedAt: new Date(now).toISOString(), expiresAt: new Date(now + 30 * 60000).toISOString(), ended: false, browser: p.browser, entries: [] };
      await save(run); return exportSourceCheck(run);
    });
  }
  if (message.command !== 'CAPTURE') throw Error('INVALID_MESSAGE');
  exact(p, ['step', 'tabId', 'pickStructure']); checkStep(p.step);
  if (!Number.isSafeInteger(p.tabId) || p.tabId < 0 || typeof p.pickStructure !== 'boolean') throw Error('INVALID_MESSAGE');
  await permitted(repo);
  const reserved = await mutation(async () => {
    const run = await readRun(); if (!run) throw Error('PROBE_NOT_STARTED'); usable(run, build.sha, await session());
    if (run.entries.some(e => e.step === p.step || e.state === 'running') || run.entries.length >= CHECK_STEPS.length) throw Error('PROBE_BUDGET_USED');
    const entry: Entry = { step: p.step, captureId: crypto.randomUUID(), capturedAt: new Date().toISOString(), state: 'running', code: 'PROBE_RUNNING' };
    active.set(entry.captureId, null);
    run.entries.push(entry); await save(run); return { run, entry };
  });
  let targetDocument: string | null = null;
  try {
    const frame = await chrome.webNavigation.getFrame({ tabId: p.tabId, frameId: 0 });
    if (!frame?.documentId || frame.documentLifecycle !== 'active' || new URL(frame.url).origin !== 'https://chatgpt.com') throw Error('STALE_DOCUMENT');
    targetDocument = frame.documentId;
    active.set(reserved.entry.captureId, { tabId: p.tabId, documentId: frame.documentId });
    const source = { id: chrome.runtime.id, documentId: frame.documentId, documentLifecycle: 'active', frameId: 0, tab: { id: p.tabId }, url: frame.url } as chrome.runtime.MessageSender;
    const binding = await bindCurrentDocument(source, frame.url);
    const dispatched = await mutation(async () => {
      const run = await readRun(); if (!run || run.id !== reserved.run.id) throw Error('PROBE_EXPIRED'); usable(run, build.sha, await session());
      if (run.entries.find(e => e.captureId === reserved.entry.captureId)?.state !== 'running') throw Error('PROBE_CANCELLED');
      await permitted(repo); await requireCurrentBinding(source, binding);
      // Dispatch inside the short reservation lock. END can cancel this work but
      // cannot finish first and then accidentally start a new page-side probe.
      return { work: chrome.tabs.sendMessage(p.tabId, { protocol: COLLECTOR_PROTOCOL, command: 'PROBE', payload: { runId: reserved.run.id, captureId: reserved.entry.captureId, step: p.step, saltHex: reserved.run.saltHex, bindingId: binding.id, routeEpoch: binding.routeEpoch, pickStructure: p.pickStructure } }, { documentId: frame.documentId }) };
    });
    let timer: ReturnType<typeof setTimeout>;
    const response = await Promise.race([
      dispatched.work,
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error('PROBE_TIMEOUT')), 60000); }),
    ]).finally(() => clearTimeout(timer));
    if (!response?.ok) throw Error('PROBE_CANCELLED');
    validateCollectorProbe(response.data);
    if (response.data.runId !== reserved.run.id || response.data.captureId !== reserved.entry.captureId || response.data.step !== p.step) throw Error('INVALID_MESSAGE');
    await permitted(repo); await requireCurrentBinding(source, binding);
    const chain = await inspectStartOpenChain(repo, binding);
    await mutation(async () => {
      const run = await readRun(); if (!run || run.id !== reserved.run.id) throw Error('PROBE_EXPIRED'); usable(run, build.sha, await session());
      await permitted(repo); await requireCurrentBinding(source, binding);
      const entry = run.entries.find(e => e.captureId === reserved.entry.captureId); if (!entry || entry.state !== 'running') throw Error('PROBE_CANCELLED');
      Object.assign(entry, { state: 'captured', code: 'CANDIDATE_ONLY', sample: response.data, documentBound: true, openChain: { state: chain.state, hasIntent: chain.intentId !== null } });
      await save(run);
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const code = ['STALE_DOCUMENT', 'PERMISSION_REQUIRED', 'PROBE_EXPIRED', 'PROBE_TIMEOUT', 'PROBE_CANCELLED', 'INVALID_MESSAGE'].includes(message) ? message : 'PROBE_UNAVAILABLE';
    await mutation(async () => { const run = await readRun(); if (run?.id === reserved.run.id) { const entry = run.entries.find(e => e.captureId === reserved.entry.captureId); if (entry && entry.state === 'running') Object.assign(entry, { state: 'blocked', code }); await save(run); } });
  } finally {
    if (targetDocument) try { await chrome.tabs.sendMessage(p.tabId, { protocol: COLLECTOR_PROTOCOL, command: 'CANCEL_PROBE', captureId: reserved.entry.captureId }, { documentId: targetDocument }); } catch { /* document is gone */ }
    active.delete(reserved.entry.captureId);
  }
  const result = await readRun(); return result ? exportSourceCheck(result) : null;
}
