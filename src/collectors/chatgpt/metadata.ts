/** Candidate-only Project title/member extraction adapted from upstream
 * native-surface-boundary.mjs at 1903b00f. No scope or NONE is inferred. */
import { parseConversationUrl, parseProjectUrl } from '../../domain/ids.js';
import { CHATGPT_METADATA_PROFILE } from './profile.js';

const EXCLUDED = '[contenteditable],dialog,[data-thread-scroll-footer],[data-app-action-timeline-scroll],[data-va-owned],[data-vaiwl-owned]';
function visible(document: Document, node: Element | null): node is Element {
  if (!node?.isConnected || node.ownerDocument !== document || !document.defaultView || !node.getClientRects().length) return false;
  if (typeof node.checkVisibility === 'function' && node.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true, contentVisibilityAuto: true }) === false) return false;
  let depth = 0;
  for (let parent: Element | null = node; parent; parent = parent.parentElement) {
    if (++depth > 64 || parent.hasAttribute('hidden') || parent.getAttribute('aria-hidden') === 'true') return false;
    const style = document.defaultView.getComputedStyle(parent);
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || style.opacity === '0') return false;
  }
  return true;
}
function oneVisible(document: Document, root: ParentNode, selector: string): Element | null {
  const nodes = root.querySelectorAll(selector);
  if (nodes.length > 8) return null;
  const found = [...nodes].filter(node => visible(document, node) && !node.closest(EXCLUDED));
  return found.length === 1 ? found[0]! : null;
}
function nativeURL(document: Document, href: string | null): string | null {
  if (!href || !(href.startsWith('/') && !href.startsWith('//') || /^https:\/\//i.test(href)) || /[\u0000-\u0020\u007f\\]/.test(href)) return null;
  // Preserve the raw path for the domain URL policy; new URL would erase ../.
  const value = href.startsWith('/') ? 'https://chatgpt.com' + href : href;
  if (document.location.origin !== 'https://chatgpt.com') return null;
  try { return new URL(value).origin === 'https://chatgpt.com' ? value : null; } catch { return null; }
}

export interface ProjectCandidate {
  state: 'candidate';
  projectId: string;
  nativeTitle: string;
  canonicalUrl: string;
  members: Array<{ conversationId: string; nativeTitle: string; canonicalUrl: string }>;
}

/** The second DIV is a preview. It is never read, including on failure. */
export function readProjectMemberTitle(document: Document, anchor: Element, panel: Element): string | null {
  try {
    if (anchor.closest(EXCLUDED) || anchor.tagName !== 'A' || anchor.parentElement?.tagName !== 'LI' || anchor.parentElement.parentElement?.tagName !== 'OL' || anchor.parentElement.parentElement.parentElement?.tagName !== 'SECTION' || anchor.parentElement.parentElement.parentElement.parentElement !== panel || anchor.children.length !== 1) return null;
    const wrapper = anchor.firstElementChild;
    if (wrapper?.tagName !== 'DIV' || wrapper.children.length !== 2) return null;
    const leaf = wrapper.firstElementChild;
    if (!leaf || leaf.closest(EXCLUDED) || leaf.tagName !== 'DIV' || wrapper.lastElementChild?.tagName !== 'DIV' || leaf.children.length || !visible(document, leaf)) return null;
    const text = (leaf.textContent ?? '').trim();
    return text && text.length <= 200 ? text : null;
  } catch { return null; }
}

/** A matching proposal is still not a verified native fact or arrival proof. */
export function observeProjectCandidate(document: Document): ProjectCandidate | null {
  try {
    if (document.location.origin !== 'https://chatgpt.com') return null;
    const route = parseProjectUrl(document.location.href);
    if (!route) return null;
    const main = oneVisible(document, document, CHATGPT_METADATA_PROFILE.projectBoundary);
    if (!main) return null;
    const panel = oneVisible(document, main, CHATGPT_METADATA_PROFILE.projectMembers);
    if (!panel) return null;
    const titles = main.querySelectorAll('h1 > button');
    if (titles.length !== 1) return null;
    const title = titles[0]!;
    if (!visible(document, title) || title.closest(EXCLUDED)) return null;
    const child = title.firstElementChild;
    const leaf = title.children.length === 0 ? title : title.children.length === 1 && child?.tagName === 'SPAN' && child.children.length === 0 && !child.matches('[role],[tabindex],[contenteditable]') && ![...title.childNodes].some(node => node.nodeType === 3 && (node.textContent ?? '').trim()) ? child : null;
    if (!leaf || !visible(document, leaf)) return null;
    const nativeTitle = (leaf.textContent ?? '').trim();
    if (!nativeTitle || nativeTitle.length > 200) return null;
    const list = panel.parentElement, tabs = list?.querySelectorAll('[role="tablist"]');
    if (list?.children.length !== 2 || list.lastElementChild !== panel || tabs?.length !== 1 || !visible(document, tabs[0]!)) return null;
    const selected = tabs[0]!.querySelectorAll('[role="tab"][aria-selected="true"]');
    if (selected.length !== 1 || !visible(document, selected[0]!)) return null;
    const tab = selected[0]!, panelId = panel.id, tabId = tab.id;
    const escape = document.defaultView?.CSS?.escape;
    if (typeof escape !== 'function' || [panelId, tabId].some(id => !id || id.length > 256 || /\s|[\u0000-\u001f\u007f]/u.test(id)) || tab.getAttribute('aria-controls') !== panelId || panel.getAttribute('aria-labelledby') !== tabId) return null;
    const panels = document.querySelectorAll('#' + escape(panelId)), labels = document.querySelectorAll('#' + escape(tabId));
    if (panels.length !== 1 || panels[0] !== panel || labels.length !== 1 || labels[0] !== tab) return null;
    const section = panel.firstElementChild, ol = section?.firstElementChild;
    if (panel.children.length !== 1 || section?.tagName !== 'SECTION' || section.children.length !== 1 || ol?.tagName !== 'OL' || ol.children.length > 256) return null;
    let linked = false;
    const members: ProjectCandidate['members'] = [];
    const ids = new Set<string>();
    for (const li of ol.children) {
      if (li.tagName !== 'LI') return null;
      const anchors = li.querySelectorAll(':scope > a[href]');
      if (anchors.length !== 1) return null;
      const anchor = anchors[0]!, url = nativeURL(document, anchor.getAttribute('href'));
      const member = url ? parseConversationUrl(url) : null;
      const memberTitle = member ? readProjectMemberTitle(document, anchor, panel) : null;
      if (!member || !memberTitle || ids.has(member.conversationId)) return null;
      ids.add(member.conversationId);
      if (member.containerHint !== null) { if (member.containerHint !== route.projectId) return null; linked = true; }
      members.push({ conversationId: member.conversationId, nativeTitle: memberTitle, canonicalUrl: member.canonicalUrl });
    }
    return linked ? { state: 'candidate', projectId: route.projectId, nativeTitle, canonicalUrl: route.canonicalUrl, members } : null;
  } catch { return null; }
}
