import { readSessionStatus } from './identity.js';
import { observeProjectCandidate } from './metadata.js';
import { CHATGPT_METADATA_PROFILE } from './profile.js';
import { COLLECTOR_PROTOCOL } from '../../shared/protocol.js';

// The marker exists only in this extension's ISOLATED world, never window messaging.
const runtime = globalThis as typeof globalThis & { __vaiwlStartCollector?: { stop: () => void } };
if (!runtime.__vaiwlStartCollector && location.origin === 'https://chatgpt.com' && window.top === window) {
  let stopped = false, sequence = 0;
  const controller = new AbortController();
  let identityStatus: Awaited<ReturnType<typeof readSessionStatus>> | null = null;
  const send = (command: string, payload: unknown) => chrome.runtime.sendMessage({ protocol: COLLECTOR_PROTOCOL, operationId: crypto.randomUUID(), command, payload });
  async function observe() {
    const ownSequence = ++sequence;
    if (stopped || (document as Document & { prerendering?: boolean }).prerendering) return;
    const href = location.href;
    try {
      const response = await send('HELLO', { href });
      if (!response?.ok || stopped || ownSequence !== sequence || href !== location.href) return;
      const binding = response.data;
      const project = observeProjectCandidate(document);
      const candidates = project ? project.members.slice(0, 200).map(m => ({ url: m.canonicalUrl, title: m.nativeTitle })) : [];
      await send('OBSERVE', { bindingId: binding.id, routeEpoch: binding.routeEpoch, candidates });
      if (!identityStatus) identityStatus = await readSessionStatus(controller.signal);
      if (stopped || ownSequence !== sequence || href !== location.href) return;
      await send('SOURCE_STATUS', { bindingId: binding.id, routeEpoch: binding.routeEpoch, code: identityStatus.code, profileId: CHATGPT_METADATA_PROFILE.id });
    } catch { /* No page text, raw response, or arbitrary errors enter diagnostics. */ }
  }
  const listener = (message: any, sender: chrome.runtime.MessageSender) => {
    if (sender.id !== chrome.runtime.id || message?.protocol !== COLLECTOR_PROTOCOL) return;
    if (message.command === 'STOP') stop();
    if (message.command === 'ROUTE' && !stopped) void observe();
  };
  function stop() { stopped = true; sequence++; controller.abort(); chrome.runtime.onMessage.removeListener(listener); runtime.__vaiwlStartCollector = undefined; }
  runtime.__vaiwlStartCollector = { stop };
  chrome.runtime.onMessage.addListener(listener);
  window.addEventListener('pagehide', stop, { once: true });
  void observe();
}
