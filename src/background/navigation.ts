import { parseConversationUrl, parseProjectUrl } from '../domain/ids.js';
import type { IntentBinding, Repository } from '../storage/repository.js';
import { changeSession, session, type DocumentBinding } from './session.js';
import { CONNECTION } from './permissions.js';
import { matchingIntents } from './open-broker.js';

type NavigationEvent = { tabId: number; frameId: number; documentId?: string; documentLifecycle?: string; url: string; transitionType?: string; transitionQualifiers?: string[] };
function sameBinding(a: DocumentBinding | undefined, b: DocumentBinding): boolean {
  return !!a && a.id === b.id && a.documentId === b.documentId && a.href === b.href && a.routeEpoch === b.routeEpoch && a.scopeEpoch === b.scopeEpoch;
}
async function liveDocument(tabId: number, documentId: string, href: string): Promise<void> {
  const frame = await chrome.webNavigation.getFrame({ tabId, frameId: 0 });
  if (!frame || frame.documentId !== documentId || frame.documentLifecycle !== 'active' || frame.url !== href || new URL(href).origin !== 'https://chatgpt.com') throw new Error('STALE_DOCUMENT');
}
export async function bindCurrentDocument(sender: chrome.runtime.MessageSender, href: string): Promise<DocumentBinding> {
  const initial = await session(), sessionId = initial.id, scopeEpoch = initial.scopeEpoch;
  return changeSession(async current => {
    // Validate inside the serialized mutation. A pre-queue frame sample could otherwise
    // restore a document which a newer route or permission revocation already invalidated.
    if (current.id !== sessionId || current.scopeEpoch !== scopeEpoch || !await chrome.permissions.contains(CONNECTION)) throw new Error('STALE_DOCUMENT');
    await liveDocument(sender.tab!.id!, sender.documentId!, href);
    const existing = current.bindings[String(sender.tab!.id!)];
    if (existing?.documentId === sender.documentId && existing.href === href && existing.scopeEpoch === current.scopeEpoch) return existing;
    const binding: DocumentBinding = { id: crypto.randomUUID(), tabId: sender.tab!.id!, documentId: sender.documentId!, href,
      routeEpoch: existing?.documentId === sender.documentId ? existing.routeEpoch + 1 : 0, scopeEpoch: current.scopeEpoch, scopeKey: null, lifecycle: 'active' };
    current.bindings[String(binding.tabId)] = binding; return binding;
  });
}

/** Recheck immediately before a collector result is used; page-supplied IDs are not authority. */
export async function requireCurrentBinding(sender: chrome.runtime.MessageSender, expected: { id: string; routeEpoch: number }): Promise<DocumentBinding> {
  const current = await session(), binding = current.bindings[String(sender.tab!.id!)];
  if (!binding || binding.id !== expected.id || binding.documentId !== sender.documentId || binding.routeEpoch !== expected.routeEpoch || binding.scopeEpoch !== current.scopeEpoch) throw new Error('STALE_DOCUMENT');
  const checked = { ...binding }, sessionId = current.id, scopeEpoch = current.scopeEpoch;
  if (!await chrome.permissions.contains(CONNECTION)) throw new Error('STALE_DOCUMENT');
  await liveDocument(checked.tabId, checked.documentId, checked.href);
  const latest = await session();
  if (latest.id !== sessionId || latest.scopeEpoch !== scopeEpoch || !sameBinding(latest.bindings[String(checked.tabId)], checked)) throw new Error('STALE_DOCUMENT');
  return checked;
}

/** A bounded, read-only legacy diagnostic. A binding alone is not navigation completion. */
export async function inspectStartOpenChain(repository: Repository, binding: DocumentBinding): Promise<{ state: 'no-matching-intent' | 'navigation-pending' | 'navigation-bound-arrival-unproven' | 'ambiguous-intent' | 'stale-binding'; intentId: string | null }> {
  const current = await session();
  if (binding.scopeEpoch !== current.scopeEpoch || !sameBinding(current.bindings[String(binding.tabId)], binding)) return { state: 'stale-binding', intentId: null };
  const target = parseConversationUrl(binding.href);
  if (!target) return { state: 'no-matching-intent', intentId: null };
  const matches = matchingIntents(await repository.listIntents(), { sessionId: current.id, tabId: binding.tabId, conversationId: target.conversationId, scopeEpoch: current.scopeEpoch, now: Date.now() }).filter(intent => intent.evidence.kind === 'start-gesture');
  if (matches.length > 1) return { state: 'ambiguous-intent', intentId: null };
  const intent = matches[0];
  if (!intent) return { state: 'no-matching-intent', intentId: null };
  const latest = await session();
  if (latest.id !== current.id || latest.scopeEpoch !== current.scopeEpoch || !sameBinding(latest.bindings[String(binding.tabId)], binding)) return { state: 'stale-binding', intentId: null };
  if (intent.targetDocumentId !== null) {
    // listIntents returns the stored intent (including its internal immutable binding).
    // Inspect that existing tuple; do not invent a new route field or modify the row.
    const persisted = (intent as typeof intent & { binding?: IntentBinding }).binding;
    if (!persisted || intent.targetDocumentId !== binding.documentId || persisted.targetDocumentId !== binding.documentId || persisted.targetTabId !== binding.tabId || persisted.routeEpoch !== binding.routeEpoch || persisted.scopeEpoch !== binding.scopeEpoch) return { state: 'stale-binding', intentId: null };
  }
  return { state: intent.targetDocumentId === null ? 'navigation-pending' : 'navigation-bound-arrival-unproven', intentId: intent.id };
}

export function registerNavigation(getRepository: () => Promise<Repository>, changed: () => Promise<void>) {
  const complete = async (details: NavigationEvent) => {
    if (details.frameId !== 0 || !details.documentId || details.documentLifecycle !== 'active') return;
    const target = parseConversationUrl(details.url);
    if (!target || new URL(details.url).origin !== 'https://chatgpt.com' || !await chrome.permissions.contains(CONNECTION)) return;
    const repository = await getRepository();
    if (!(await repository.getSnapshot()).settings.captureEnabled) return;
    const current = await session(), binding = current.bindings[String(details.tabId)];
    if (!binding || binding.documentId !== details.documentId || binding.href !== details.url || binding.scopeEpoch !== current.scopeEpoch) return;
    const matched = matchingIntents(await repository.listIntents(), { sessionId: current.id, tabId: details.tabId, conversationId: target.conversationId, scopeEpoch: current.scopeEpoch, now: Date.now() }).filter(i => i.evidence.kind === 'start-gesture');
    if (matched.length !== 1) {
      for (const intent of matched) await repository.rejectIntent(intent.id, 'ambiguous-arrival');
      return;
    }
    const intent = matched[0]!;
    const persisted = (intent as typeof intent & { binding?: IntentBinding }).binding;
    if (!persisted || intent.targetDocumentId !== binding.documentId || persisted.targetDocumentId !== binding.documentId || persisted.routeEpoch !== binding.routeEpoch || persisted.scopeEpoch !== binding.scopeEpoch || persisted.targetTabId !== binding.tabId) return;
    // Browser onCompleted proves this exact user-directed navigation completed. It
    // does not prove account ownership, membership, body rendering or reading.
    // A scoped record still requires a current account witness; unknown records
    // commit only to their original, unassigned local library.
    if (intent.expectedScopeKey !== null) return;
    await requireCurrentBinding({ tab: { id: binding.tabId }, documentId: binding.documentId } as chrome.runtime.MessageSender, binding);
    // Serialize final admission with scope/permission invalidation. Capture is
    // also checked inside the IDB write transaction, not just before an await.
    await changeSession(async latest => {
      if (latest.id !== current.id || latest.scopeEpoch !== current.scopeEpoch || !sameBinding(latest.bindings[String(binding.tabId)], binding) || !await chrome.permissions.contains(CONNECTION)) return;
      await liveDocument(binding.tabId, binding.documentId, binding.href);
      await repository.commitArrival({ intentId: intent.id, browserSessionId: current.id, targetTabId: binding.tabId, targetDocumentId: binding.documentId, routeEpoch: binding.routeEpoch, scopeEpoch: binding.scopeEpoch, conversationId: target.conversationId, canonicalUrl: target.canonicalUrl, scopeKey: null, arrivalConfirmed: true, confirmationBasis: 'browser-navigation' });
    });
    await changed();
  };
  const process = async (details: NavigationEvent, kind: 'committed' | 'history' | 'completed') => {
    if (kind === 'completed') return complete(details);
    if (details.frameId !== 0 || !details.documentId || details.documentLifecycle !== 'active') return;
    if (!await chrome.permissions.contains(CONNECTION)) return;
    const repository = await getRepository(), snapshot = await repository.getSnapshot();
    if (!snapshot.settings.captureEnabled) return;
    const current = await session();
    await repository.expireIntents(current.id);
    if (kind === 'history') {
      // Browser navigation events preserve departures even when their async handler
      // runs after a fast C -> Q -> C detour. The old document must lose its intent;
      // checking only the latest frame would silently erase that intervening route.
      const active = current.bindings[String(details.tabId)];
      for (const intent of await repository.listIntents()) {
        if (intent.browserSessionId !== current.id || intent.sourceScopeEpoch !== current.scopeEpoch || intent.evidence.kind !== 'start-gesture' || intent.state !== 'navigation-dispatched' || intent.targetTabId !== details.tabId || intent.targetDocumentId !== details.documentId) continue;
        const persisted = (intent as typeof intent & { binding?: IntentBinding }).binding;
        const sameRoute = active && persisted && active.documentId === persisted.targetDocumentId && active.routeEpoch === persisted.routeEpoch && active.scopeEpoch === persisted.scopeEpoch;
        if (!sameRoute || details.url !== active.href) await repository.rejectIntent(intent.id, parseConversationUrl(details.url)?.conversationId === intent.targetConversationId ? 'stale-document' : 'target-mismatch');
      }
    }
    // Only the latest live event may bind a target or discover metadata candidates.
    const liveFrame = await chrome.webNavigation.getFrame({ tabId: details.tabId, frameId: 0 });
    if (liveFrame?.documentId !== details.documentId || liveFrame.url !== details.url || liveFrame.documentLifecycle !== 'active') return;
    const parsed = parseConversationUrl(details.url);
    if (!parsed) {
      // Unrelated URLs may end the navigation chain; they are never persisted.
      for (const intent of await repository.listIntents()) if (intent.targetTabId === details.tabId && intent.state === 'navigation-dispatched') {
        // New tabs/windows deliberately start blank so targetTabId is durable before
        // tabs.update. A delayed blank commit is not the requested navigation failing.
        if (details.url === 'about:blank' && intent.evidence.kind === 'start-gesture' && intent.disposition !== 'same-tab' && intent.targetDocumentId === null) continue;
        await repository.rejectIntent(intent.id, 'target-mismatch');
      }
      if (parseProjectUrl(details.url)) {
        // A Project SPA route still needs a fresh collector binding. It cannot be
        // treated as a conversation or prove any member's activity/ownership.
        const binding = await bindCurrentDocument({ documentId: details.documentId, tab: { id: details.tabId } } as chrome.runtime.MessageSender, details.url);
        const latest = await session();
        if (latest.id !== current.id || latest.scopeEpoch !== current.scopeEpoch || !sameBinding(latest.bindings[String(details.tabId)], binding)) return;
        try { await chrome.tabs.sendMessage(details.tabId, { protocol: 'vaiwl-start-collector/1', command: 'ROUTE' }, { documentId: details.documentId }); } catch { /* content not yet injected */ }
        await changed();
        return;
      }
      const captured = current.bindings[String(details.tabId)];
      await changeSession(async s => {
        // HELLO is outside this tab's navigation queue. A delayed unrelated event
        // must never erase the replacement binding it installed while IDB awaited.
        if (!captured || s.id !== current.id || s.scopeEpoch !== current.scopeEpoch || !sameBinding(s.bindings[String(details.tabId)], captured)) return;
        const frame = await chrome.webNavigation.getFrame({ tabId: details.tabId, frameId: 0 });
        if (!frame || frame.documentId !== details.documentId || frame.url !== details.url || frame.documentLifecycle !== 'active') return;
        if (captured.documentId !== details.documentId || captured.href !== details.url) delete s.bindings[String(details.tabId)];
      });
      return;
    }
    const binding = await bindCurrentDocument({ documentId: details.documentId, tab: { id: details.tabId } } as chrome.runtime.MessageSender, details.url);
    const latest = await session();
    if (latest.id !== current.id || latest.scopeEpoch !== current.scopeEpoch || !sameBinding(latest.bindings[String(details.tabId)], binding)) return;
    await repository.discoverCandidates([{ url: details.url, title: null, source: 'unknown', titleBasis: 'unknown' }]);
    const intents = await repository.listIntents();
    const matched = matchingIntents(intents, { sessionId: current.id, tabId: details.tabId, conversationId: parsed.conversationId, scopeEpoch: current.scopeEpoch, now: Date.now() });
    if (matched.length > 1) for (const intent of matched) await repository.rejectIntent(intent.id, 'ambiguous-arrival');
    for (const intent of intents) if (intent.targetTabId === details.tabId && intent.state === 'navigation-dispatched' && intent.targetConversationId !== parsed.conversationId) await repository.rejectIntent(intent.id, 'target-mismatch');
    if (matched.length === 1) {
      const intent = matched[0]!;
      if (intent.evidence.kind === 'start-gesture') {
        const restore = kind === 'committed' && (!details.transitionType || details.transitionType === 'reload' || details.transitionQualifiers?.includes('forward_back') || details.transitionQualifiers?.includes('start_page'));
        if (restore || intent.targetDocumentId !== null && intent.targetDocumentId !== binding.documentId) await repository.rejectIntent(intent.id, 'stale-document');
        else if (kind === 'committed' || intent.targetDocumentId === binding.documentId) {
          // One persisted document/route binding; a later refresh or SPA replacement
          // cannot recycle the original user gesture. This is not commitArrival.
          try { await repository.bindIntentTarget(intent.id, current.id, { targetTabId: binding.tabId, targetDocumentId: binding.documentId, routeEpoch: binding.routeEpoch, scopeEpoch: binding.scopeEpoch }); }
          catch { await repository.rejectIntent(intent.id, 'stale-document'); }
        }
      }
    }
    // onCommitted freezes the attempt; onCompleted confirms navigation without body reads.
    try { await chrome.tabs.sendMessage(details.tabId, { protocol: 'vaiwl-start-collector/1', command: 'ROUTE' }, { documentId: details.documentId }); } catch { /* content not yet injected */ }
    await changed();
  };
  const pending = new Map<number, Promise<void>>();
  const enqueue = (details: NavigationEvent, kind: 'committed' | 'history' | 'completed') => {
    const work = (pending.get(details.tabId) ?? Promise.resolve()).then(() => process(details, kind)).catch(() => {}).finally(() => { if (pending.get(details.tabId) === work) pending.delete(details.tabId); });
    pending.set(details.tabId, work);
    return work;
  };
  chrome.webNavigation?.onCommitted.addListener(details => enqueue(details, 'committed'));
  chrome.webNavigation?.onHistoryStateUpdated.addListener(details => enqueue(details, 'history'));
  chrome.webNavigation?.onCompleted.addListener(details => enqueue(details, 'completed'));
  chrome.webNavigation?.onErrorOccurred.addListener(details => {
    if (details.frameId !== 0) return;
    return getRepository().then(async repository => {
      // Once bound, a late error from an earlier document cannot cancel this intent.
      // Before binding, a same-target failure is ambiguous and must fail closed: a
      // later automatic retry must not consume the original failed user gesture.
      const current = await session();
      for (const intent of await repository.listIntents()) if (intent.browserSessionId === current.id && intent.targetTabId === details.tabId && intent.state === 'navigation-dispatched' && parseConversationUrl(details.url)?.conversationId === intent.targetConversationId && (intent.targetDocumentId === null || !!details.documentId && intent.targetDocumentId === details.documentId)) await repository.rejectIntent(intent.id, 'navigation-failed');
    }).catch(() => {});
  });
  chrome.tabs.onRemoved.addListener(tabId => {
    return (async () => {
      const current = await session();
      await changeSession(s => { delete s.bindings[String(tabId)]; });
      const repository = await getRepository();
      for (const intent of await repository.listIntents()) if (intent.browserSessionId === current.id && intent.targetTabId === tabId && intent.state === 'navigation-dispatched') await repository.rejectIntent(intent.id, 'navigation-failed');
      await changed();
    })().catch(() => {});
  });
}
