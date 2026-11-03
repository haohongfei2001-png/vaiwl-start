import { createSessionStatusReader } from './identity.js';
import { observeProjectCandidate, readProjectProbe } from './metadata.js';
import { startProjectObservation, type ProjectObservationMemory } from './project-observer.js';
import { inspectMetadataStructure, type MetadataStructureSummary } from './structure-probe.js';
import { CHATGPT_METADATA_PROFILE } from './profile.js';
import { parseProjectUrl } from '../../domain/ids.js';
import { COLLECTOR_PROTOCOL, exact } from '../../shared/protocol.js';
import { checkStep, correlation, type CollectorProbe } from '../../shared/source-check.js';

// This marker and all transient raw source data stay in the extension's ISOLATED world.
const runtime = globalThis as typeof globalThis & { __vaiwlStartCollector?: { stop: () => void } };
if (!runtime.__vaiwlStartCollector && location.origin === 'https://chatgpt.com' && window.top === window) {
  let stopped = false, suspended = false, sequence = 0;
  let controller: AbortController | null = null;
  let pending: Promise<unknown> = Promise.resolve();
  let activeProbe: string | null = null;
  const identity = createSessionStatusReader();
  const projectMemory: ProjectObservationMemory = {};
  const send = (command: string, payload: unknown) => chrome.runtime.sendMessage({ protocol: COLLECTOR_PROTOCOL, operationId: crypto.randomUUID(), command, payload });
  function invalidate() { sequence++; controller?.abort(); controller = null; }
  function enqueue<T>(work: (signal: AbortSignal, current: () => boolean) => Promise<T>): Promise<T> {
    invalidate(); const own = sequence, href = location.href, ownController = new AbortController(); controller = ownController;
    const current = () => !stopped && !suspended && own === sequence && !ownController.signal.aborted && href === location.href && !(document as Document & { prerendering?: boolean }).prerendering;
    const task = pending.catch(() => {}).then(async () => { if (!current()) throw Error('STALE_DOCUMENT'); return work(ownController.signal, current); });
    pending = task; return task;
  }
  function wait(ms: number, signal: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
      if (signal.aborted) return reject(Error('STALE_DOCUMENT'));
      const abort = () => { clearTimeout(timer); reject(Error('STALE_DOCUMENT')); };
      const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
      signal.addEventListener('abort', abort, { once: true });
    });
  }
  async function knownProject(signal: AbortSignal, current: () => boolean) {
    if (!parseProjectUrl(location.href)) return null;
    // Finite hydration wait for the frozen parser, not selector discovery.
    for (const delay of [0, 120, 300, 600, 1200]) {
      if (delay) await wait(delay, signal);
      if (!current()) throw Error('STALE_DOCUMENT');
      const candidate = observeProjectCandidate(document); if (candidate) return candidate;
    }
    return null;
  }
  function observe() {
    return enqueue(async (signal, current) => {
      const response = await send('HELLO', { href: location.href }); if (!response?.ok || !current()) return;
      const binding = response.data;
      if (parseProjectUrl(location.href)) {
        startProjectObservation(document, { signal, current, memory: projectMemory, deliver: async projectCandidate => {
          if (!current()) return false;
          const candidates = projectCandidate.members.map(m => ({ url: m.canonicalUrl, title: m.nativeTitle }));
          const result = await send('OBSERVE', { bindingId: binding.id, routeEpoch: binding.routeEpoch, candidates, projectCandidate });
          return result?.ok === true && current();
        } });
      } else {
        await send('OBSERVE', { bindingId: binding.id, routeEpoch: binding.routeEpoch, candidates: [] });
      }
      const statusTask = identity.readStatus(signal).then(async status => {
        if (current()) await send('SOURCE_STATUS', { bindingId: binding.id, routeEpoch: binding.routeEpoch, code: status.code, profileId: CHATGPT_METADATA_PROFILE.id });
      });
      await Promise.allSettled([statusTask]);
    });
  }
  function pickStructure(signal: AbortSignal, current: () => boolean): Promise<MetadataStructureSummary> {
    return new Promise((resolve, reject) => {
      const panel = document.createElement('div'); panel.setAttribute('data-vaiwl-owned', 'source-check'); panel.setAttribute('role', 'status');
      Object.assign(panel.style, { position: 'fixed', top: '12px', right: '12px', zIndex: '2147483647', maxWidth: '330px', padding: '14px', border: '1px solid #999', borderRadius: '12px', background: '#fff', color: '#222', font: '14px/1.5 system-ui', boxShadow: '0 4px 20px #0002' });
      const text = document.createElement('p'); text.textContent = '核验已就绪。自然打开原生菜单，把鼠标停在要核验的元数据控件上，按 Option / Alt + Shift + M。只读取结构，无需点击该控件。没有明确状态时请跳过。';
      const skip = document.createElement('button'); skip.type = 'button'; skip.textContent = '跳过：没有明确状态'; panel.append(text, skip); document.documentElement.append(panel);
      const cleanup = () => { clearTimeout(timer); panel.remove(); window.removeEventListener('keydown', select, true); document.removeEventListener('pointermove', point, true); signal.removeEventListener('abort', abort); };
      const finish = (value: MetadataStructureSummary) => { cleanup(); resolve(value); };
      const abort = () => { cleanup(); reject(Error('STALE_DOCUMENT')); };
      const unavailable = () => inspectMetadataStructure(document, panel);
      let x = -1, y = -1;
      const point = (event: PointerEvent) => { if (event.isTrusted) { x = event.clientX; y = event.clientY; } };
      const select = (event: KeyboardEvent) => {
        // Only this explicit diagnostic chord is inspected; no key data is retained.
        if (!event.isTrusted || !event.altKey || !event.shiftKey || event.code !== 'KeyM') return;
        event.preventDefault(); event.stopImmediatePropagation();
        if (!current()) return abort();
        const target = document.elementFromPoint(x, y);
        finish(target ? inspectMetadataStructure(document, target) : unavailable());
      };
      skip.addEventListener('click', event => { if (event.isTrusted) finish(unavailable()); });
      const timer = setTimeout(() => finish(unavailable()), 45000);
      signal.addEventListener('abort', abort, { once: true }); window.addEventListener('keydown', select, true); document.addEventListener('pointermove', point, true);
      if (signal.aborted || !current()) abort();
    });
  }
  function probe(p: any): Promise<CollectorProbe> {
    exact(p, ['runId', 'captureId', 'step', 'saltHex', 'bindingId', 'routeEpoch', 'pickStructure']);
    correlation(p.runId); correlation(p.captureId); checkStep(p.step); correlation(p.bindingId);
    if (!/^[a-f0-9]{64}$/.test(p.saltHex) || !Number.isSafeInteger(p.routeEpoch) || p.routeEpoch < 0 || typeof p.pickStructure !== 'boolean') throw Error('INVALID_MESSAGE');
    return enqueue(async (signal, current) => {
      const hello = await send('HELLO', { href: location.href });
      if (!hello?.ok || !current() || hello.data.id !== p.bindingId || hello.data.routeEpoch !== p.routeEpoch) throw Error('STALE_DOCUMENT');
      await knownProject(signal, current);
      const identityProbe = await identity.readProbe(p.saltHex, signal); if (!current()) throw Error('STALE_DOCUMENT');
      const project = await readProjectProbe(document, p.saltHex);
      const structure = p.pickStructure ? await pickStructure(signal, current) : { state: 'not-requested' as const, code: 'not-requested' as const, authority: false as const };
      if (!current()) throw Error('STALE_DOCUMENT');
      // Same-URL account actions can invalidate the sampled identity; never guess scope.
      const finalIdentity = p.pickStructure ? await identity.readProbe(p.saltHex, signal) : identityProbe;
      if (!current() || finalIdentity.principalAlias !== identityProbe.principalAlias) throw Error('STALE_DOCUMENT');
      return { runId: p.runId, captureId: p.captureId, step: p.step, authority: false, identity: finalIdentity, project, structure };
    });
  }
  const listener = (message: any, sender: chrome.runtime.MessageSender, respond: (value: unknown) => void) => {
    if (sender.id !== chrome.runtime.id || sender.tab || message?.protocol !== COLLECTOR_PROTOCOL) return;
    if (message.command === 'STOP') stop();
    if (message.command === 'CANCEL_PROBE' && activeProbe !== null && message.captureId === activeProbe) { activeProbe = null; invalidate(); if (!stopped && !suspended) void observe().catch(() => {}); }
    if (message.command === 'ROUTE' && !stopped && !suspended) { activeProbe = null; void observe().catch(() => {}); }
    if (message.command === 'PROBE' && !stopped && !suspended) {
      const captureId = message.payload?.captureId;
      let ownsCollector = false;
      void Promise.resolve().then(() => {
        correlation(captureId);
        // probe validates the full schema synchronously before enqueue can
        // suspend normal observation. Malformed requests own no lifecycle and
        // must not restart collection or trigger extra identity requests.
        const task = probe(message.payload); activeProbe = captureId; ownsCollector = true; return task;
      })
        .then(data => respond({ ok: true, data })).catch(() => respond({ ok: false, code: 'PROBE_CANCELLED' }))
        .finally(() => {
          if (ownsCollector && activeProbe === captureId) {
            activeProbe = null;
            // A bounded diagnostic temporarily owns the collector. Return to
            // normal observation afterwards without requiring another route.
            if (!stopped && !suspended) void observe().catch(() => {});
          }
        }); return true;
    }
  };
  function hide(event: PageTransitionEvent) { suspended = true; activeProbe = null; invalidate(); if (!event.persisted) stop(); }
  function show(event: PageTransitionEvent) { if (event.persisted && !stopped) { suspended = false; void observe().catch(() => {}); } }
  function stop() {
    if (stopped) return; stopped = true; activeProbe = null; invalidate(); delete projectMemory.last;
    chrome.runtime.onMessage.removeListener(listener); window.removeEventListener('pagehide', hide); window.removeEventListener('pageshow', show); runtime.__vaiwlStartCollector = undefined;
  }
  runtime.__vaiwlStartCollector = { stop };
  chrome.runtime.onMessage.addListener(listener); window.addEventListener('pagehide', hide); window.addEventListener('pageshow', show);
  void observe().catch(() => {});
}
