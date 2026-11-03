import { parseConversationUrl, parseProjectUrl } from '../../domain/ids.js';
import { observeNativeProjectSnapshots } from './native-projects.js';
import type { ProjectCandidate } from './project-candidate.js';

/** Per-document memory only: never an account, scope, or membership proof. */
export interface ProjectObservationMemory {
  last?: { projectId: string; panel: Element; titleSurface?: Element };
  surfaces?: Set<Element>;
  pendingSurfaces?: Set<Element>;
  blockedSurfaces?: WeakSet<Element>;
  identityRevision?: number;
}
/** Called only when the collector detects an identity transition. A reused
 * old metadata surface is not evidence for the newly observed principal. */
export function invalidateNativeProjectSurfaces(memory: ProjectObservationMemory): void {
  memory.identityRevision = (memory.identityRevision ?? 0) + 1;
  memory.blockedSurfaces ??= new WeakSet();
  // Before the first acknowledgement there is no older accepted surface to
  // distinguish a new identity's render from the previous one. Keep that first
  // pending surface blocked rather than guess which identity produced it.
  const previous = memory.surfaces?.size ? memory.surfaces : memory.pendingSurfaces;
  for (const surface of previous ?? []) memory.blockedSurfaces.add(surface);
}
interface ObservationOptions {
  signal: AbortSignal;
  current: () => boolean;
  memory: ProjectObservationMemory;
  deliver: (candidate: ProjectCandidate) => Promise<boolean>;
}

const EXCLUDED = '[contenteditable],dialog,[role="dialog"],article,[data-preview],[data-message-author-role],[data-testid^="conversation-turn"],.markdown,[data-thread-scroll-footer],[data-app-action-timeline-scroll],[data-va-owned],[data-vaiwl-owned],#cgps-project-groups';
const ATTRIBUTES = ['href', 'id', 'role', 'aria-label', 'title', 'aria-controls', 'aria-labelledby', 'aria-selected', 'aria-hidden', 'hidden', 'class', 'style', 'datetime', 'aria-sort', 'aria-setsize', 'aria-posinset', 'aria-busy', 'draggable', 'aria-grabbed', 'data-sidebar-navigation-root', 'data-app-shell-main-surface', 'data-app-shell-main-content-layout'];

/** Inspect only node positions, never mutation oldValue, preview/body text or
 * HTML. A parent/structure change may require the strict parser to run again. */
function relevant(record: MutationRecord): boolean {
  const node = record.target.nodeType === 1 ? record.target as Element : record.target.parentElement;
  if (!node || node.closest(EXCLUDED)) return false;
  const anchor = node.closest('a[href]'), wrapper = anchor?.firstElementChild;
  if (wrapper?.children.length === 2 && wrapper.lastElementChild?.contains(node)) return false;
  if (record.type !== 'characterData') return true;
  if (node.closest('h1,nav[aria-label="Chat history"],[data-sidebar-navigation-root]')) return true;
  return !!anchor && (anchor === node || !!wrapper?.firstElementChild?.contains(node));
}

/** Observe incrementally for this exact native route, with one coalescing
 * timer and one in-flight delivery. No network reads, polling, database access,
 * identity inference is introduced here. Adapters validate their own surfaces. */
export function startProjectObservation(document: Document, options: ObservationOptions): () => void {
  const href = document.location.href, route = parseProjectUrl(href), view = document.defaultView;
  const supported = document.location.origin === 'https://chatgpt.com' && (route || parseConversationUrl(href) || ['https://chatgpt.com/', 'https://chatgpt.com/projects'].includes(href));
  if (!supported || !view || !document.documentElement || options.signal.aborted || !options.current()) return () => {};
  let stopped = false, running = false, dirty = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const acknowledged = new Map<string, { signature: string; surfaces: Element[] }>(), attempts = new Map<string, { signature: string; surfaces: Element[]; failures: number }>();
  const sameSurfaces = (a: Element[] | undefined, b: Element[]) => !!a && a.length === b.length && a.every(surface => b.includes(surface));
  let identityRevision = options.memory.identityRevision ?? 0;
  const identityChanged = () => {
    const revision = options.memory.identityRevision ?? 0;
    if (revision === identityRevision) return false;
    identityRevision = revision; acknowledged.clear(); attempts.clear(); return true;
  };
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
      identityChanged();
      const snapshots = observeNativeProjectSnapshots(document);
      if (!current()) return;
      if (!snapshots.length) return;
      options.memory.pendingSurfaces = new Set(snapshots.flatMap(snapshot => snapshot.identitySurfaces));
      for (const snapshot of snapshots) {
        if (!current()) return;
        if (snapshot.identitySurfaces.some(surface => options.memory.blockedSurfaces?.has(surface))) continue;
        // Plain DOM order has no authority. A separate validated chronological
        // snapshot carries its original IDs; ordinary reorder stays a no-op.
        const candidate: ProjectCandidate = { ...snapshot.candidate, members: [...snapshot.candidate.members]
          .sort((a, b) => a.conversationId.localeCompare(b.conversationId)).slice(0, 200) };
        const projectId = candidate.projectId;
        const metadata = JSON.stringify([candidate.nativeTitle, candidate.members, candidate.timeOrder ?? null]);
        const previous = options.memory.last;
        const reusedTitle = candidate.relationBasis === 'native-project-page' && !!snapshot.titleSurface && previous?.titleSurface === snapshot.titleSurface;
        if (snapshot.routeBound && previous && previous.projectId !== projectId && (previous.panel === snapshot.panel || reusedTitle) && !snapshot.allMembersContainerLinked) {
          // Browser route B may arrive before React replaces A's panel. The exact
          // known inherited panel is not a new B observation, even if its title
          // changes first. Require a replacement panel or explicit matching
          // container links for EVERY member, checked by the strict parser. One
          // changed link cannot certify the remaining inherited plain /c/ links.
          // This guard does
          // not certify other transitions or same-URL account changes.
          acknowledged.delete(projectId); continue;
        }
        if (snapshot.routeBound) options.memory.last = { projectId, panel: snapshot.panel, ...(snapshot.titleSurface ? { titleSurface: snapshot.titleSurface } : {}) };
        const signature = JSON.stringify([candidate.projectId, candidate.canonicalUrl, candidate.relationBasis, metadata]);
        const ack = acknowledged.get(projectId);
        if (signature === ack?.signature && sameSurfaces(ack.surfaces, snapshot.identitySurfaces)) continue;
        let attempt = attempts.get(projectId);
        if (attempt?.signature !== signature || !sameSurfaces(attempt.surfaces, snapshot.identitySurfaces)) { attempt = { signature, surfaces: snapshot.identitySurfaces, failures: 0 }; attempts.set(projectId, attempt); }
        if (attempt.failures >= 2) continue;
        let accepted = false;
        try { if (current()) accepted = await options.deliver(candidate); } catch { /* One bounded retry below. */ }
        if (!current()) return;
        if (identityChanged()) {
          // All snapshots in this batch predate the new identity. Resample;
          // retained old surfaces are still blocked, while a new replacement
          // with identical metadata must get its own delivery/identity check.
          if (timer === undefined) timer = setTimeout(() => { timer = undefined; void sample(); }, 500);
          return;
        }
        if (accepted) {
          acknowledged.set(projectId, { signature, surfaces: snapshot.identitySurfaces }); attempt.failures = 0;
          // Identity is checked by deliver. Only an accepted surface belongs
          // to that identity; a pending replacement must not be blacklisted
          // when deliver discovers a principal transition.
          options.memory.surfaces ??= new Set();
          for (const surface of options.memory.surfaces) if (!surface.isConnected) options.memory.surfaces.delete(surface);
          for (const surface of snapshot.identitySurfaces) options.memory.surfaces.add(surface);
        }
        else if (++attempt.failures === 1 && timer === undefined) {
          // A transient worker/IPC failure must not suppress this snapshot for
          // the rest of the route. Do not create an unbounded retry loop.
          timer = setTimeout(() => { timer = undefined; void sample(); }, 500);
        }
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
