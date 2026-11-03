import { parseProjectUrl } from '../../domain/ids.js';
import { observeProjectSnapshot } from './metadata.js';
import type { ProjectCandidate } from './project-candidate.js';

/** Per-document memory only: never an account, scope, or membership proof. */
export interface ProjectObservationMemory {
  last?: { projectId: string; panel: Element };
}
interface ObservationOptions {
  signal: AbortSignal;
  current: () => boolean;
  memory: ProjectObservationMemory;
  deliver: (candidate: ProjectCandidate) => Promise<boolean>;
}

const EXCLUDED = '[contenteditable],dialog,[role="dialog"],aside,[data-sidebar-navigation-root],[data-thread-scroll-footer],[data-app-action-timeline-scroll],[data-va-owned],[data-vaiwl-owned]';
const ATTRIBUTES = ['href', 'id', 'role', 'aria-controls', 'aria-labelledby', 'aria-selected', 'aria-hidden', 'hidden', 'class', 'style', 'data-app-shell-main-surface', 'data-app-shell-main-content-layout'];

/** Inspect only node positions, never mutation oldValue, preview/body text or
 * HTML. A parent/structure change may require the strict parser to run again. */
function relevant(record: MutationRecord): boolean {
  const node = record.target.nodeType === 1 ? record.target as Element : record.target.parentElement;
  if (!node || node.closest(EXCLUDED)) return false;
  const anchor = node.closest('li > a[href]'), wrapper = anchor?.firstElementChild;
  if (wrapper?.children.length === 2 && wrapper.lastElementChild?.contains(node)) return false;
  if (record.type !== 'characterData') return true;
  if (node.closest('h1 > button')) return true;
  return !!wrapper?.firstElementChild?.contains(node);
}

/** Observe incrementally for this exact Project route, with one coalescing
 * timer and one in-flight delivery. No network reads, polling, database access,
 * identity inference or selector fallback is introduced here. */
export function startProjectObservation(document: Document, options: ObservationOptions): () => void {
  const href = document.location.href, route = parseProjectUrl(href), view = document.defaultView;
  if (!route || !view || !document.documentElement || options.signal.aborted || !options.current()) return () => {};
  const projectId = route.projectId;
  let stopped = false, running = false, dirty = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let acknowledged: string | null = null, attempted: string | null = null, failures = 0;
  const current = () => !stopped && !options.signal.aborted && options.current() && document.location.href === href;
  const observer = new view.MutationObserver(records => {
    if (!current()) return stop();
    if (records.some(relevant)) schedule(120);
  });
  function stop() {
    if (stopped) return;
    stopped = true; observer.disconnect(); clearTimeout(timer); timer = undefined;
    options.signal.removeEventListener('abort', stop);
  }
  function schedule(delay: number) {
    if (!current()) return stop();
    dirty = true;
    // A fixed coalescing window (not continually postponed) cannot starve when
    // the page keeps rendering. Changes during a send get one follow-up scan.
    if (running || timer !== undefined) return;
    timer = setTimeout(() => { timer = undefined; void sample(); }, delay);
  }
  async function sample() {
    if (!current()) return stop();
    running = true; dirty = false;
    try {
      const snapshot = observeProjectSnapshot(document);
      if (!current()) return;
      if (!snapshot) { acknowledged = null; attempted = null; failures = 0; return; }
      // DOM order has no authority over Start's activity/date order. Normalize
      // before the existing bounded IPC cap so pure reordering is a no-op.
      const candidate: ProjectCandidate = { ...snapshot.candidate, members: [...snapshot.candidate.members]
        .sort((a, b) => a.conversationId.localeCompare(b.conversationId)).slice(0, 200) };
      const metadata = JSON.stringify([candidate.nativeTitle, candidate.members]);
      const previous = options.memory.last;
      if (previous && previous.projectId !== projectId && previous.panel === snapshot.panel && !snapshot.allMembersContainerLinked) {
        // Browser route B may arrive before React replaces A's panel. The exact
        // known inherited panel is not a new B observation, even if its title
        // changes first. Require a replacement panel or explicit matching
        // container links for EVERY member, checked by the strict parser. One
        // changed link cannot certify the remaining inherited plain /c/ links.
        // This guard does
        // not certify other transitions or same-URL account changes.
        acknowledged = null; return;
      }
      options.memory.last = { projectId, panel: snapshot.panel };
      const signature = JSON.stringify([candidate.projectId, candidate.canonicalUrl, metadata]);
      if (signature === acknowledged) return;
      if (signature !== attempted) { attempted = signature; failures = 0; }
      let accepted = false;
      try { if (current()) accepted = await options.deliver(candidate); } catch { /* One bounded retry below. */ }
      if (!current()) return;
      if (accepted) { acknowledged = signature; failures = 0; }
      else if (++failures === 1) {
        // A transient worker/IPC failure must not suppress this snapshot for
        // the rest of the route. Do not create an unbounded retry loop.
        timer = setTimeout(() => { timer = undefined; void sample(); }, 500);
      }
    } finally {
      running = false;
      if (!current()) stop();
      else if (dirty) schedule(120);
    }
  }
  options.signal.addEventListener('abort', stop, { once: true });
  observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRIBUTES });
  schedule(0);
  return stop;
}
