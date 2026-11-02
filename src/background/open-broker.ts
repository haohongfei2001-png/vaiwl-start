import type { OpenDisposition, OpenIntent } from '../../contracts/free-v1.js';
import type { Repository } from '../storage/repository.js';
import { session } from './session.js';

type OpenRequest = { recordKey: string; disposition: OpenDisposition; gesture: 'click' | 'keyboard' | 'auxclick' };
const opening = new Map<string, { signature: string; work: Promise<{ intentId: string; state: string; activity: string }> }>();
/** Coalesce browser side effects; the persisted intent also rejects replay after worker exit. */
export function openFromStart(repository: Repository, sender: chrome.runtime.MessageSender, operationId: string, payload: OpenRequest) {
  const signature = JSON.stringify([sender.tab?.id, sender.documentId, payload.recordKey, payload.disposition, payload.gesture]);
  const running = opening.get(operationId);
  if (running) return running.signature === signature ? running.work : Promise.reject(new Error('INVALID_MESSAGE'));
  const work = openOnce(repository, sender, operationId, payload).finally(() => opening.delete(operationId));
  opening.set(operationId, { signature, work });
  return work;
}
/** Only Start's packaged, trusted event listener may request navigation. */
async function openOnce(repository: Repository, sender: chrome.runtime.MessageSender, operationId: string, payload: OpenRequest) {
  const state = await session();
  await repository.expireIntents(state.id);
  const previous = await repository.getIntent(operationId);
  if (previous) {
    if (previous.browserSessionId !== state.id || previous.sourceTabId !== sender.tab!.id || previous.targetRecordKey !== payload.recordKey || previous.disposition !== payload.disposition || previous.evidence.kind !== 'start-gesture' || previous.evidence.sourceDocumentId !== sender.documentId || previous.evidence.gesture !== payload.gesture) throw new Error('INVALID_MESSAGE');
    return { intentId: previous.id, state: previous.state, activity: previous.state === 'committed' ? 'confirmed-open' : previous.expectedScopeKey ? 'account-confirmation-required' : 'navigation-pending' };
  }
  const intent = await repository.issueIntent({ id: operationId, browserSessionId: state.id, targetRecordKey: payload.recordKey,
    evidence: { kind: 'start-gesture', sourceDocumentId: sender.documentId!, gesture: payload.gesture }, disposition: payload.disposition,
    sourceTabId: sender.tab!.id!, sourceScopeEpoch: state.scopeEpoch });
  try {
    if (payload.disposition === 'same-tab') {
      // Persist the target binding before issuing the irreversible browser navigation.
      await repository.dispatchIntent(intent.id, state.id, { targetTabId: sender.tab!.id! });
      await chrome.tabs.update(sender.tab!.id!, { url: intent.targetUrl });
    } else if (payload.disposition === 'new-window') {
      const window = await chrome.windows.create({ url: 'about:blank', focused: true });
      const tab = window?.tabs?.[0];
      if (tab?.id === undefined) throw new Error('NAVIGATION_FAILED');
      await repository.dispatchIntent(intent.id, state.id, { targetTabId: tab.id });
      await chrome.tabs.update(tab.id, { url: intent.targetUrl });
    } else {
      const tab = await chrome.tabs.create({ url: 'about:blank', active: payload.disposition === 'new-foreground-tab' });
      if (tab.id === undefined) throw new Error('NAVIGATION_FAILED');
      await repository.dispatchIntent(intent.id, state.id, { targetTabId: tab.id });
      await chrome.tabs.update(tab.id, { url: intent.targetUrl });
    }
    return { intentId: intent.id, state: 'navigation-dispatched', activity: intent.expectedScopeKey ? 'account-confirmation-required' : 'navigation-pending' };
  } catch {
    await repository.rejectIntent(intent.id, 'navigation-failed');
    throw new Error('NAVIGATION_FAILED');
  }
}

export function matchingIntents(intents: OpenIntent[], state: { sessionId: string; tabId: number; conversationId: string; scopeEpoch: number; now: number }): OpenIntent[] {
  return intents.filter(intent => intent.browserSessionId === state.sessionId && intent.targetTabId === state.tabId && intent.targetConversationId === state.conversationId && intent.sourceScopeEpoch === state.scopeEpoch && intent.state === 'navigation-dispatched' && Date.parse(intent.issuedAt) <= state.now && Date.parse(intent.expiresAt) >= state.now);
}
