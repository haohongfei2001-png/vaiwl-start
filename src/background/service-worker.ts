import { createRepository, type Repository } from '../storage/repository.js';
import { parseConversationUrl } from '../domain/ids.js';
import { COLLECTOR_PROTOCOL, PROTOCOL, bounded, exact, parseEnvelope, publicError, trustedCollectorSender, trustedExtensionSender } from '../shared/protocol.js';
import { CHATGPT_METADATA_PROFILE, SOURCE_FAILURE_CODES } from '../collectors/chatgpt/profile.js';
import { capabilities, CONNECTION, synchronizePermissions } from './permissions.js';
import { bindCurrentDocument, registerNavigation, requireCurrentBinding } from './navigation.js';
import { sourceCheckCommand, stopSourceCheck } from './source-check.js';
import { SOURCE_CHECK_PROTOCOL } from '../shared/source-check.js';
import { session, invalidateBindings } from './session.js';
import { openFromStart } from './open-broker.js';
import { createHistoryJob, stepHistoryImport, type HistoryJob } from './import-history.js';

let repositoryPromise: Promise<Repository> | null = null;
function repository() { return repositoryPromise ||= createRepository().catch(error => { repositoryPromise = null; throw error; }); }
let buildPromise: Promise<Record<string, unknown>> | null = null;
function build() { return buildPromise ||= fetch(chrome.runtime.getURL('build.json')).then(r => r.json()).then(({ sha, version, sourceGate, adapterVersion, dirty }) => ({ sha, version, sourceGate, adapterVersion, dirty })); }
async function broadcast() {
  const snapshot = await (await repository()).getSnapshot();
  try { await chrome.runtime.sendMessage({ protocol: PROTOCOL, event: 'revision', revision: snapshot.revision }); } catch { /* No UI is open. */ }
}
async function snapshot(selectedScope?: string) {
  const repo = await repository();
  const current = await session(); await repo.expireIntents(current.id);
  const [catalog, caps, fingerprint, source] = await Promise.all([repo.getSnapshot(selectedScope), capabilities(), build(), chrome.storage.session.get('sourceStatus')]);
  const status = source.sourceStatus as { tabId: number; browserSessionId: string; scopeEpoch: number; bindingId: string; routeEpoch: number; sampledAt: number; code: string; profileId: string } | undefined;
  const binding = status ? current.bindings[String(status.tabId)] : undefined;
  const fresh = status && caps.chatgpt && catalog.settings.captureEnabled && status.browserSessionId === current.id && status.scopeEpoch === current.scopeEpoch && binding?.id === status.bindingId && binding.routeEpoch === status.routeEpoch && Date.now() >= status.sampledAt && Date.now() - status.sampledAt < 30000;
  return { ...catalog, capabilities: { ...caps, captureEnabled: catalog.settings.captureEnabled, sourceStatus: fresh ? { code: status.code, profileId: status.profileId, sampledAt: status.sampledAt } : null }, build: fingerprint };
}
function integer(value: unknown) { if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error('INVALID_MESSAGE'); }
const imports = new Map<string, Promise<HistoryJob>>();
async function uiCommand(message: unknown, sender: chrome.runtime.MessageSender) {
  if (!trustedExtensionSender(sender, chrome.runtime.id)) throw new Error('UNAUTHORIZED_SENDER');
  const { command, operationId, expectedRevision, payload: p } = parseEnvelope(message);
  const repo = await repository();
  switch (command) {
    case 'SNAPSHOT': exact(p, [], ['selectedScope']); if (p.selectedScope !== undefined) bounded(p.selectedScope, 128); return snapshot(p.selectedScope);
    case 'OPEN': {
      exact(p, ['recordKey', 'disposition', 'gesture']); bounded(p.recordKey, 128);
      if (!['same-tab', 'new-background-tab', 'new-foreground-tab', 'new-window'].includes(p.disposition) || !['click', 'keyboard', 'auxclick'].includes(p.gesture)) throw new Error('INVALID_MESSAGE');
      const opened = await openFromStart(repo, sender, operationId, p as any);
      await broadcast();
      return { ...opened, revision: (await repo.getSnapshot()).revision };
    }
    case 'SETTINGS_UPDATE':
      exact(p, ['patch']); exact(p.patch, [], ['libraryTimeZone', 'shortcutSectionCollapsed', 'selectedScope', 'currentSegment', 'captureEnabled']);
      await repo.setSettings(p.patch, expectedRevision);
      if ('captureEnabled' in p.patch) { await synchronizePermissions(p.patch.captureEnabled); if (!p.patch.captureEnabled) await stopSourceCheck(); }
      break;
    case 'SHORTCUT_UPSERT': exact(p, ['shortcut']); exact(p.shortcut, ['label', 'url'], ['id', 'pinned']); await repo.saveShortcut(p.shortcut as any, expectedRevision); break;
    case 'SHORTCUT_MOVE': exact(p, ['id', 'toIndex']); bounded(p.id, 128); integer(p.toIndex); await repo.moveShortcut(p.id, p.toIndex, expectedRevision); break;
    case 'SHORTCUT_REMOVE': exact(p, ['id']); bounded(p.id, 128); await repo.removeShortcut(p.id, expectedRevision); break;
    case 'RECORD_REMOVE': exact(p, ['recordKey']); bounded(p.recordKey, 128); await repo.removeConversation(p.recordKey, expectedRevision); break;
    case 'RECORD_RESTORE': exact(p, ['recordKey']); bounded(p.recordKey, 128); await repo.restoreConversation(p.recordKey, expectedRevision); break;
    case 'CLEAR_LOCAL': exact(p, []); await repo.clearLocalData(expectedRevision); await synchronizePermissions(false); await stopSourceCheck(); await chrome.storage.session.remove(['sourceStatus', 'sourceCheckRun']); break;
    case 'PERMISSIONS_SYNC': {
      exact(p, [], ['enableCapture']);
      if (p.enableCapture !== undefined && typeof p.enableCapture !== 'boolean') throw new Error('INVALID_MESSAGE');
      const caps = await capabilities();
      const before = await repo.getSnapshot();
      const capture = caps.chatgpt && (p.enableCapture === true || before.settings.captureEnabled);
      if (capture && !before.settings.captureEnabled) await repo.setSettings({ captureEnabled: true }, before.revision);
      await synchronizePermissions(capture); ensureListeners(); break;
    }
    case 'IMPORT_START': {
      exact(p, ['range', 'includeSynced']);
      if (!['recent90', 'all'].includes(p.range) || typeof p.includeSynced !== 'boolean') throw new Error('INVALID_MESSAGE');
      if (!await chrome.permissions.contains({ permissions: ['history'] })) throw new Error('PERMISSION_REQUIRED');
      const job = createHistoryJob(p.range, p.includeSynced);
      await repo.saveImportJob(job); await broadcast(); return { jobId: job.id, job };
    }
    case 'IMPORT_STEP': {
      exact(p, ['jobId']); bounded(p.jobId, 128);
      if (!await chrome.permissions.contains({ permissions: ['history'] })) throw new Error('PERMISSION_REQUIRED');
      if (imports.has(p.jobId)) return { job: await imports.get(p.jobId) };
      const work = stepHistoryImport(repo, chrome.history, p.jobId);
      imports.set(p.jobId, work);
      try { const job = await work; await broadcast(); return { job }; } finally { imports.delete(p.jobId); }
    }
    case 'IMPORT_PAUSE': case 'IMPORT_RESUME': case 'IMPORT_CANCEL': {
      exact(p, ['jobId']); bounded(p.jobId, 128);
      const catalog = await repo.getSnapshot();
      const job = catalog.importJobs.find(j => j.id === p.jobId) as HistoryJob | undefined;
      if (!job) throw new Error('IMPORT_NOT_FOUND');
      if (command === 'IMPORT_RESUME' && !await chrome.permissions.contains({ permissions: ['history'] })) throw new Error('PERMISSION_REQUIRED');
      job.state = command === 'IMPORT_PAUSE' ? 'paused' : command === 'IMPORT_CANCEL' ? 'cancelled' : 'running';
      await repo.saveImportJob(job, catalog.revision); break;
    }
    default: throw new Error('INVALID_MESSAGE');
  }
  await broadcast();
  return snapshot();
}

async function collectorCommand(message: unknown, sender: chrome.runtime.MessageSender) {
  if (!trustedCollectorSender(sender, chrome.runtime.id) || !await chrome.permissions.contains(CONNECTION)) throw new Error('UNAUTHORIZED_SENDER');
  exact(message, ['protocol', 'operationId', 'command', 'payload']);
  bounded(message.operationId, 80); bounded(message.command, 40);
  const p = message.payload;
  const repo = await repository();
  if (!(await repo.getSnapshot()).settings.captureEnabled) throw new Error('PERMISSION_REQUIRED');
  if (message.command === 'HELLO') {
    exact(p, ['href']); bounded(p.href, 8192);
    const binding = await bindCurrentDocument(sender, p.href);
    if (parseConversationUrl(p.href)) { await repo.discoverCandidates([{ url: p.href, title: null, source: 'unknown', titleBasis: 'unknown' }]); await broadcast(); }
    return { id: binding.id, routeEpoch: binding.routeEpoch };
  }
  if (message.command === 'OBSERVE') exact(p, ['bindingId', 'routeEpoch', 'candidates']);
  else if (message.command === 'SOURCE_STATUS') exact(p, ['bindingId', 'routeEpoch', 'code', 'profileId']);
  else throw new Error('INVALID_MESSAGE');
  bounded(p.bindingId, 80); integer(p.routeEpoch);
  const binding = await requireCurrentBinding(sender, { id: p.bindingId, routeEpoch: p.routeEpoch });
  if (!(await repo.getSnapshot()).settings.captureEnabled) throw new Error('PERMISSION_REQUIRED');
  if (message.command === 'SOURCE_STATUS') {
    if (!SOURCE_FAILURE_CODES.includes(p.code) || p.profileId !== CHATGPT_METADATA_PROFILE.id) throw new Error('INVALID_MESSAGE');
    await requireCurrentBinding(sender, binding);
    const current = await session();
    await chrome.storage.session.set({ sourceStatus: { code: p.code, profileId: p.profileId, sampledAt: Date.now(), browserSessionId: current.id, scopeEpoch: binding.scopeEpoch, bindingId: binding.id, routeEpoch: binding.routeEpoch, tabId: binding.tabId } });
    return { accepted: true };
  }
  if (!Array.isArray(p.candidates) || p.candidates.length > 200) throw new Error('INVALID_MESSAGE');
  for (const candidate of p.candidates) { exact(candidate, ['url', 'title']); bounded(candidate.url, 8192); bounded(candidate.title, 512); if (!parseConversationUrl(candidate.url)) throw new Error('INVALID_MESSAGE'); }
  if (p.candidates.length) {
    await requireCurrentBinding(sender, binding);
    if (!(await repo.getSnapshot()).settings.captureEnabled) throw new Error('PERMISSION_REQUIRED');
    await repo.discoverCandidates(p.candidates.map((c: any) => ({ ...c, source: 'unknown', titleBasis: 'native-label' })));
    await broadcast();
  }
  return { accepted: true, membership: 'UNKNOWN', sourceGate: 'SOURCE_GATE_BLOCKED' };
}

chrome.runtime.onMessage.addListener((message: unknown, sender, respond) => {
  if ((message as any)?.protocol === PROTOCOL && (message as any)?.event === 'revision') return;
  const isCollector = (message as any)?.protocol === COLLECTOR_PROTOCOL;
  const isCheck = (message as any)?.protocol === SOURCE_CHECK_PROTOCOL;
  const protocol = isCheck ? SOURCE_CHECK_PROTOCOL : isCollector ? COLLECTOR_PROTOCOL : PROTOCOL;
  const work = isCheck ? Promise.all([repository(), build()]).then(([repo, fingerprint]) => sourceCheckCommand(message, sender, repo, { sha: String(fingerprint.sha) })) : isCollector ? collectorCommand(message, sender) : uiCommand(message, sender);
  void work.then(data => respond({ protocol, ok: true, data })).catch(error => respond({ protocol, ok: false, code: publicError(error) }));
  return true;
});

let navigationRegistered = false, historyRegistered = false;
function ensureListeners() {
  if (!navigationRegistered && chrome.webNavigation?.onCommitted) { registerNavigation(repository, broadcast); navigationRegistered = true; }
  if (!historyRegistered && chrome.history?.onVisited) {
    chrome.history.onVisited.addListener(item => {
      if (!item.url || !parseConversationUrl(item.url)) return;
      void (async () => {
        if (!await chrome.permissions.contains({ permissions: ['history'] })) return;
        const repo = await repository();
        const title = typeof item.title === 'string' ? [...item.title.replace(/[\u0000-\u001f\u007f]/g, ' ')].slice(0, 512).join('') || null : null;
        const visits = await chrome.history.getVisits({ url: item.url! });
        const source = visits.some(v => v.isLocal) ? 'local' : visits.length && visits.every(v => v.isLocal === false) ? 'synced' : 'unknown';
        if (source === 'synced') return;
        await repo.discoverCandidates([{ url: item.url!, title, source, lastVisitAt: item.lastVisitTime && Number.isFinite(item.lastVisitTime) && item.lastVisitTime <= Date.now() ? new Date(item.lastVisitTime).toISOString() : null, titleBasis: 'browser-history' }]);
        await broadcast();
      })().catch(() => {});
    }); historyRegistered = true;
  }
}
ensureListeners();
chrome.action.onClicked.addListener(() => { void chrome.tabs.create({ url: chrome.runtime.getURL('newtab.html') }); });
chrome.runtime.onInstalled.addListener(() => { void repository(); });
chrome.runtime.onStartup.addListener(() => { void session().then(s => repository().then(r => r.expireIntents(s.id))).catch(() => {}); });
chrome.permissions.onRemoved.addListener(() => {
  void (async () => {
    const repo = await repository(), caps = await capabilities();
    if (!caps.chatgpt) { await synchronizePermissions(false); await stopSourceCheck(); }
    if (!caps.history) {
      for (const job of (await repo.getSnapshot()).importJobs) if (['running', 'paused', 'partial'].includes(job.state)) { job.state = 'permission-revoked'; await repo.saveImportJob(job); }
    }
    await broadcast();
  })().catch(() => {});
});
