/** Candidate-only Project title/member extraction adapted from upstream
 * native-surface-boundary.mjs at 1903b00f. No scope or NONE is inferred. */
import { parseConversationUrl, parseProjectUrl } from '../../domain/ids.js';
import { CHATGPT_METADATA_PROFILE } from './profile.js';
import { createProbeAliaser } from './probe.js';
import type { ProjectCandidate } from './project-candidate.js';
export type { ProjectCandidate } from './project-candidate.js';

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

export const PROJECT_PROBE_CODES = Object.freeze([
  'source-origin-rejected', 'not-project-route', 'project-boundary-unproven',
  'project-panel-unproven', 'project-title-unproven', 'project-tab-panel-unproven',
  'project-members-unproven', 'project-container-unproven', 'project-candidate-only',
  'project-structure-unsupported', 'project-route-changed',
] as const);
export type ProjectProbeCode = typeof PROJECT_PROBE_CODES[number];
export interface ProjectProbeSummary {
  routeKind: 'project' | 'conversation' | 'unsupported' | 'foreign';
  code: ProjectProbeCode;
  assertions: { boundaryUnique: boolean; titleLeaf: boolean; panelUnique: boolean; tabPanelLinked: boolean; membersStructure: boolean; containerLinked: boolean };
  memberCount: number;
  projectAlias: string | null;
  projectTitleAlias: string | null;
  members: Array<{ conversationAlias: string; titleAlias: string }>;
}
function emptyProbe(): ProjectProbeSummary {
  return { routeKind: 'unsupported', code: 'project-structure-unsupported',
    assertions: { boundaryUnique: false, titleLeaf: false, panelUnique: false, tabPanelLinked: false, membersStructure: false, containerLinked: false },
    memberCount: 0, projectAlias: null, projectTitleAlias: null, members: [] };
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

/** One strict parser supplies both production candidates and diagnostic assertions. */
function inspectProjectCandidate(document: Document): { candidate: ProjectCandidate | null; summary: ProjectProbeSummary } {
  const summary = emptyProbe();
  const fail = (code: ProjectProbeCode) => { summary.code = code; return { candidate: null, summary }; };
  try {
    if (document.location.origin !== 'https://chatgpt.com') { summary.routeKind = 'foreign'; return fail('source-origin-rejected'); }
    const route = parseProjectUrl(document.location.href);
    if (!route) { summary.routeKind = parseConversationUrl(document.location.href) ? 'conversation' : 'unsupported'; return fail('not-project-route'); }
    summary.routeKind = 'project';
    const main = oneVisible(document, document, CHATGPT_METADATA_PROFILE.projectBoundary);
    if (!main) return fail('project-boundary-unproven');
    summary.assertions.boundaryUnique = true;
    const panel = oneVisible(document, main, CHATGPT_METADATA_PROFILE.projectMembers);
    if (!panel) return fail('project-panel-unproven');
    summary.assertions.panelUnique = true;
    const titles = main.querySelectorAll('h1 > button');
    if (titles.length !== 1) return fail('project-title-unproven');
    const title = titles[0]!;
    if (!visible(document, title) || title.closest(EXCLUDED)) return fail('project-title-unproven');
    const child = title.firstElementChild;
    const leaf = title.children.length === 0 ? title : title.children.length === 1 && child?.tagName === 'SPAN' && child.children.length === 0 && !child.matches('[role],[tabindex],[contenteditable]') && ![...title.childNodes].some(node => node.nodeType === 3 && (node.textContent ?? '').trim()) ? child : null;
    if (!leaf || !visible(document, leaf)) return fail('project-title-unproven');
    const nativeTitle = (leaf.textContent ?? '').trim();
    if (!nativeTitle || nativeTitle.length > 200) return fail('project-title-unproven');
    summary.assertions.titleLeaf = true;
    const list = panel.parentElement, tabs = list?.querySelectorAll('[role="tablist"]');
    if (list?.children.length !== 2 || list.lastElementChild !== panel || tabs?.length !== 1 || !visible(document, tabs[0]!)) return fail('project-tab-panel-unproven');
    const selected = tabs[0]!.querySelectorAll('[role="tab"][aria-selected="true"]');
    if (selected.length !== 1 || !visible(document, selected[0]!)) return fail('project-tab-panel-unproven');
    const tab = selected[0]!, panelId = panel.id, tabId = tab.id;
    const escape = document.defaultView?.CSS?.escape;
    if (typeof escape !== 'function' || [panelId, tabId].some(id => !id || id.length > 256 || /\s|[\u0000-\u001f\u007f]/u.test(id)) || tab.getAttribute('aria-controls') !== panelId || panel.getAttribute('aria-labelledby') !== tabId) return fail('project-tab-panel-unproven');
    const panels = document.querySelectorAll('#' + escape(panelId)), labels = document.querySelectorAll('#' + escape(tabId));
    if (panels.length !== 1 || panels[0] !== panel || labels.length !== 1 || labels[0] !== tab) return fail('project-tab-panel-unproven');
    summary.assertions.tabPanelLinked = true;
    const section = panel.firstElementChild, ol = section?.firstElementChild;
    if (panel.children.length !== 1 || section?.tagName !== 'SECTION' || section.children.length !== 1 || ol?.tagName !== 'OL' || ol.children.length > 256) return fail('project-members-unproven');
    summary.memberCount = ol.children.length;
    let linked = false;
    const members: ProjectCandidate['members'] = [];
    const ids = new Set<string>();
    for (const li of ol.children) {
      if (li.tagName !== 'LI') return fail('project-members-unproven');
      const anchors = li.querySelectorAll(':scope > a[href]');
      if (anchors.length !== 1) return fail('project-members-unproven');
      const anchor = anchors[0]!, url = nativeURL(document, anchor.getAttribute('href'));
      const member = url ? parseConversationUrl(url) : null;
      const memberTitle = member ? readProjectMemberTitle(document, anchor, panel) : null;
      if (!member || !memberTitle || ids.has(member.conversationId)) return fail('project-members-unproven');
      ids.add(member.conversationId);
      if (member.containerHint !== null) { if (member.containerHint !== route.projectId) return fail('project-container-unproven'); linked = true; }
      members.push({ conversationId: member.conversationId, nativeTitle: memberTitle, canonicalUrl: member.canonicalUrl });
    }
    summary.assertions.membersStructure = true;
    // A unique Project route, title, linked selected tab and member panel is
    // sufficient for a local candidate. Plain /c/ links are common canonical
    // member targets; requiring a redundant Project ID in a child URL used to
    // discard this entire usable observation. An explicit different container
    // is still rejected above. This never establishes account or membership.
    summary.assertions.containerLinked = linked;
    summary.code = 'project-candidate-only';
    return { candidate: { state: 'candidate', relationBasis: 'linked-native-panel', projectId: route.projectId, nativeTitle, canonicalUrl: route.canonicalUrl, members }, summary };
  } catch { return fail('project-structure-unsupported'); }
}

/** A matching proposal is still not a verified native fact or arrival proof. */
export function observeProjectCandidate(document: Document): ProjectCandidate | null {
  return inspectProjectCandidate(document).candidate;
}

/** Only this fixed, pseudonymized summary may leave the controlled probe. */
export async function readProjectProbe(document: Document, saltHex: string): Promise<ProjectProbeSummary> {
  const alias = await createProbeAliaser(saltHex), href = document.location.href;
  const { candidate, summary } = inspectProjectCandidate(document);
  if (candidate) {
    summary.projectAlias = await alias('project', candidate.projectId);
    summary.projectTitleAlias = await alias('project-title', candidate.nativeTitle);
    summary.members = await Promise.all(candidate.members.map(async member => ({ conversationAlias: await alias('conversation', member.conversationId), titleAlias: await alias('conversation-title', member.nativeTitle) })));
  }
  if (document.location.href !== href) return { ...emptyProbe(), code: 'project-route-changed' };
  return summary;
}
