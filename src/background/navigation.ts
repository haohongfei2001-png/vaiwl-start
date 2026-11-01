import { parseConversationUrl } from '../domain/ids.js';
import type { Repository } from '../storage/repository.js';
import { changeSession, session, type DocumentBinding } from './session.js';
import { CONNECTION } from './permissions.js';
import { matchingIntents } from './open-broker.js';

type NavigationEvent = { tabId: number; frameId: number; documentId?: string; documentLifecycle?: string; url: string };
export async function bindCurrentDocument(sender: chrome.runtime.MessageSender, href: string): Promise<DocumentBinding> {
  const frame = await chrome.webNavigation.getFrame({ tabId: sender.tab!.id!, frameId: 0 });
  if (!frame || frame.documentId !== sender.documentId || frame.documentLifecycle !== 'active' || frame.url !== href || new URL(href).origin !== 'https://chatgpt.com') throw new Error('STALE_DOCUMENT');
  return changeSession(current => {
    const existing = current.bindings[String(sender.tab!.id!)];
    if (existing?.documentId === sender.documentId && existing.href === href) return existing;
    const binding: DocumentBinding = { id: crypto.randomUUID(), tabId: sender.tab!.id!, documentId: sender.documentId!, href,
      routeEpoch: existing?.documentId === sender.documentId ? existing.routeEpoch + 1 : 0, scopeEpoch: current.scopeEpoch, scopeKey: null, lifecycle: 'active' };
    current.bindings[String(binding.tabId)] = binding; return binding;
  });
}

export function registerNavigation(getRepository: () => Promise<Repository>, changed: () => Promise<void>) {
  const process = async (details: NavigationEvent) => {
    if (details.frameId !== 0 || !details.documentId || details.documentLifecycle !== 'active') return;
    if (!await chrome.permissions.contains(CONNECTION)) return;
    const repository = await getRepository(), snapshot = await repository.getSnapshot();
    if (!snapshot.settings.captureEnabled) return;
    const liveFrame = await chrome.webNavigation.getFrame({ tabId: details.tabId, frameId: 0 });
    if (liveFrame?.documentId !== details.documentId || liveFrame.url !== details.url || liveFrame.documentLifecycle !== 'active') return;
    const current = await session();
    await repository.expireIntents(current.id);
    const parsed = parseConversationUrl(details.url);
    if (!parsed) {
      // Unrelated URLs may end the navigation chain; they are never persisted.
      for (const intent of await repository.listIntents()) if (intent.targetTabId === details.tabId && intent.state === 'navigation-dispatched') await repository.rejectIntent(intent.id, 'target-mismatch');
      await changeSession(s => { if (s.bindings[String(details.tabId)]?.documentId === details.documentId) delete s.bindings[String(details.tabId)]; });
      return;
    }
    await repository.discoverCandidates([{ url: details.url, title: null, source: 'unknown', titleBasis: 'unknown' }]);
    const intents = await repository.listIntents();
    const matched = matchingIntents(intents, { sessionId: current.id, tabId: details.tabId, conversationId: parsed.conversationId, scopeEpoch: current.scopeEpoch, now: Date.now() });
    if (matched.length > 1) for (const intent of matched) await repository.rejectIntent(intent.id, 'ambiguous-arrival');
    for (const intent of intents) if (intent.targetTabId === details.tabId && intent.state === 'navigation-dispatched' && intent.targetConversationId !== parsed.conversationId) await repository.rejectIntent(intent.id, 'target-mismatch');
    // No commitArrival here: route arrival is insufficient without the M0 source proof.
    try { await chrome.tabs.sendMessage(details.tabId, { protocol: 'vaiwl-start-collector/1', command: 'ROUTE' }, { documentId: details.documentId }); } catch { /* content not yet injected */ }
    await changed();
  };
  const boundedProcess = (details: NavigationEvent) => { void process(details).catch(() => {}); };
  chrome.webNavigation?.onCommitted.addListener(boundedProcess);
  chrome.webNavigation?.onHistoryStateUpdated.addListener(boundedProcess);
  chrome.webNavigation?.onErrorOccurred.addListener(details => {
    if (details.frameId !== 0) return;
    void getRepository().then(async repository => {
      for (const intent of await repository.listIntents()) if (intent.targetTabId === details.tabId && intent.state === 'navigation-dispatched') await repository.rejectIntent(intent.id, 'navigation-failed');
    }).catch(() => {});
  });
  chrome.tabs.onRemoved.addListener(tabId => { void changeSession(s => { delete s.bindings[String(tabId)]; }); });
}
