/** Independent, metadata-only native relationship adapters. Public source
 * research: chatgpt-project-sidebar@d77de5f (native title controls, labelled
 * sidebar rows, explicit Project routes). No name-based joining or API import.
 * These observations intentionally do not certify an account or workspace. */
import { parseConversationUrl, parseProjectUrl, projectIdFromContainer } from '../../domain/ids.js';
import { observeProjectSnapshot } from './metadata.js';
import type { ProjectCandidate } from './project-candidate.js';
import { withNativeProjectTime } from './native-time.js';

export interface NativeProjectSnapshot {
  candidate: ProjectCandidate;
  panel: Element;
  allMembersContainerLinked: boolean;
  routeBound: boolean;
  titleSurface?: Element;
  /** Every DOM source contributing a member or title, not just the first root. */
  identitySurfaces: Element[];
}
const EXCLUDED = '[contenteditable],dialog,[role="dialog"],article,[data-preview],[data-message-author-role],[data-testid^="conversation-turn"],.markdown,[data-thread-scroll-footer],[data-app-action-timeline-scroll],[data-va-owned],[data-vaiwl-owned],#cgps-project-groups';
const SIDEBAR = 'nav[aria-label="Chat history"],[data-sidebar-navigation-root]';

function visible(document: Document, element: Element): boolean {
  if (!element.isConnected || element.ownerDocument !== document || !document.defaultView || element.closest(EXCLUDED) || !element.getClientRects().length) return false;
  if (typeof element.checkVisibility === 'function' && !element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true, contentVisibilityAuto: true })) return false;
  let depth = 0;
  for (let node: Element | null = element; node; node = node.parentElement) {
    if (++depth > 64 || node.hasAttribute('hidden') || node.getAttribute('aria-hidden') === 'true') return false;
    const wrapper: Element | null = node.parentElement;
    if (wrapper?.tagName === 'DIV' && wrapper.parentElement?.tagName === 'A' && wrapper.children.length === 2 && wrapper.lastElementChild === node) return false;
    const style = document.defaultView.getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || style.opacity === '0') return false;
  }
  return true;
}
function clean(value: string | null, limit = 200): string | null {
  if (value === null || /[\u0000-\u001f\u007f]/u.test(value)) return null;
  const text = value.trim(); return text && text.length <= limit ? text : null;
}
function href(document: Document, element: Element): string | null {
  const value = element.getAttribute('href');
  if (!value || /[\u0000-\u0020\u007f\\]/u.test(value) || !(value.startsWith('/') && !value.startsWith('//') || value.startsWith('https://chatgpt.com/'))) return null;
  return value.startsWith('/') ? document.location.origin + value : value;
}
/** Never reads an anchor/container aggregate: only a bounded native label
 * attribute or an independently selected title leaf, never its preview. */
function leafTitle(document: Document, node: Element): string | null {
  if (!visible(document, node) || node.children.length) return null;
  return clean(node.textContent);
}
function anchorTitle(document: Document, anchor: Element): string | null {
  for (const attribute of ['aria-label', 'title']) {
    const label = clean(anchor.getAttribute(attribute));
    if (label && !/,\s*chat in project\s/i.test(label)) return label;
  }
  if (!anchor.children.length) return leafTitle(document, anchor);
  const headings = [...anchor.querySelectorAll('h2,h3')].filter(node => visible(document, node));
  if (headings.length === 1) return leafTitle(document, headings[0]!);
  // Native card shape: the first leaf is the title and the following sibling
  // is a preview. Neither the wrapper nor the preview text is ever read.
  const wrapper = anchor.firstElementChild;
  if (anchor.children.length === 1 && wrapper?.tagName === 'DIV' && wrapper.children.length === 2 && wrapper.firstElementChild?.tagName === 'DIV' && wrapper.lastElementChild?.tagName === 'DIV') return leafTitle(document, wrapper.firstElementChild);
  if (anchor.children.length === 1 && wrapper?.tagName === 'SPAN') return leafTitle(document, wrapper);
  return null;
}
function outermost(elements: Element[]): Element[] { return elements.filter(node => !elements.some(other => other !== node && other.contains(node))); }
function mainSurface(document: Document): Element | null {
  const nodes = [...document.querySelectorAll('main,[role="main"]')];
  if (nodes.length > 8) return null;
  const found = outermost(nodes.filter(node => visible(document, node)));
  return found.length === 1 ? found[0]! : null;
}
function projectHeading(document: Document, main: Element): { nativeTitle: string; surface: Element } | null {
  const buttons = [...main.querySelectorAll('button[aria-label]')].filter(node => visible(document, node) && /^Edit the title of /i.test(node.getAttribute('aria-label') ?? ''));
  if (buttons.length === 1) {
    const button = buttons[0]!, nativeTitle = clean(button.getAttribute('aria-label')!.replace(/^Edit the title of /i, ''));
    return nativeTitle ? { nativeTitle, surface: button.closest('h1') ?? button } : null;
  }
  if (buttons.length > 1) return null;
  const headings = [...main.querySelectorAll('h1')].filter(node => visible(document, node));
  if (headings.length !== 1) return null;
  let title: Element = headings[0]!;
  // A title's harmless wrapper changes must not change Project identity.
  for (let depth = 0; depth < 4; depth++) {
    if (!title.children.length) { const nativeTitle = leafTitle(document, title); return nativeTitle ? { nativeTitle, surface: headings[0]! } : null; }
    const children = [...title.children].filter(child => child.tagName.toLowerCase() !== 'svg');
    if (children.length !== 1 || !['BUTTON', 'SPAN', 'DIV'].includes(children[0]!.tagName)
      || [...title.childNodes].some(node => node.nodeType === 3 && (node.textContent ?? '').trim())) return null;
    title = children[0]!;
  }
  return null;
}
function projectTitle(document: Document, main: Element): string | null { return projectHeading(document, main)?.nativeTitle ?? null; }
function linkedPanel(document: Document, main: Element): Element | null {
  const panels = [...main.querySelectorAll('[role="tabpanel"]')].filter(node => visible(document, node));
  if (panels.length !== 1) return null;
  const panel = panels[0]!, label = panel.getAttribute('aria-labelledby'), id = panel.id;
  if (!id || !label || /\s|[\u0000-\u001f\u007f]/u.test(id + label) || id.length > 256 || label.length > 256) return null;
  // ID lookup plus a duplicate count avoids interpolating selectors and keeps
  // the tab/panel relation independent of wrapper depth and list semantics.
  const ids = [...document.querySelectorAll('[id]')];
  if (ids.filter(node => node.id === id).length !== 1 || ids.filter(node => node.id === label).length !== 1) return null;
  const tab = document.getElementById(label);
  const selected = [...main.querySelectorAll('[role="tab"][aria-selected="true"]')].filter(node => visible(document, node));
  const labelText = tab ? clean(tab.getAttribute('aria-label')) ?? leafTitle(document, tab)
    ?? (tab.children.length === 1 && tab.firstElementChild?.tagName === 'SPAN' ? leafTitle(document, tab.firstElementChild) : null) : null;
  const chatTab = labelText !== null && /^(?:Chats|Conversations|聊天|对话|会话)$/iu.test(labelText);
  return tab && main.contains(tab) && visible(document, tab) && tab.getAttribute('role') === 'tab'
    && tab.getAttribute('aria-selected') === 'true' && tab.getAttribute('aria-controls') === id
    && selected.length === 1 && selected[0] === tab && chatTab && !!tab.closest('[role="tablist"]') ? panel : null;
}
function semanticPanel(document: Document, main: Element, project: { projectId: string; canonicalUrl: string }): NativeProjectSnapshot | null {
  const nativeTitle = projectTitle(document, main), panel = linkedPanel(document, main);
  if (!nativeTitle || !panel) return null;
  const anchors = [...panel.querySelectorAll('a[href]')]; if (anchors.length > 256) return null;
  const members = new Map<string, ProjectCandidate['members'][number]>();
  let allLinked = true;
  for (const anchor of anchors) {
    if (!visible(document, anchor)) continue;
    const sourceUrl = href(document, anchor), identity = sourceUrl ? parseConversationUrl(sourceUrl) : null;
    if (!identity) { if ((anchor.getAttribute('href') ?? '').includes('/c/')) return null; continue; }
    if (identity.containerHint !== null && identity.containerHint !== project.projectId) return null;
    if (identity.containerHint !== project.projectId) allLinked = false;
    const nativeTitle = anchorTitle(document, anchor); if (!nativeTitle) continue;
    const previous = members.get(identity.conversationId);
    if (previous && previous.nativeTitle !== nativeTitle) return null;
    if (previous) continue;
    members.set(identity.conversationId, { conversationId: identity.conversationId, nativeTitle, canonicalUrl: identity.canonicalUrl });
  }
  return { candidate: { state: 'candidate', relationBasis: 'linked-native-panel', ...project, nativeTitle, members: [...members.values()] }, panel,
    allMembersContainerLinked: members.size > 0 && allLinked, routeBound: true, identitySurfaces: [panel] };
}
function sidebarLabel(anchor: Element): { project: string; title: string } | null {
  const label = clean(anchor.getAttribute('aria-label'), 600); if (!label) return null;
  const parts = label.split(/,\s*chat in project\s+/i); if (parts.length !== 2) return null;
  const title = clean(parts[0]!), project = clean(parts[1]!.replace(/(?:,\s*(?:Work|unread|read|shared))+$/i, ''));
  return title && project ? { title, project } : null;
}

/** No API calls or full-document text. Each adapter independently proves a
 * Project/member ID relationship; a sidebar name alone never supplies an ID. */
export function observeNativeProjectSnapshots(document: Document): NativeProjectSnapshot[] {
  if (document.location.origin !== 'https://chatgpt.com') return [];
  const project = parseProjectUrl(document.location.href), current = parseConversationUrl(document.location.href);
  if (!project && !current && !['/', '/projects'].includes(document.location.pathname)) return [];
  const results: NativeProjectSnapshot[] = [];
  const strict = project ? observeProjectSnapshot(document) : null, main = mainSurface(document);
  const heading = project && main ? projectHeading(document, main) : null;
  const panel: NativeProjectSnapshot | null = strict ? { ...strict, routeBound: true, identitySurfaces: [strict.panel] } : project && main ? semanticPanel(document, main, project) : null;
  if (panel && heading) { panel.titleSurface = heading.surface; panel.identitySurfaces.push(heading.surface); }
  if (panel) { panel.candidate = withNativeProjectTime(document, panel.panel, panel.candidate); results.push(panel); }
  const sidebars = outermost([...document.querySelectorAll(SIDEBAR)].filter(node => visible(document, node)));
  const roots = [...sidebars, ...(project && main ? [main] : [])];
  const anchors = [...new Set(roots.flatMap(root => [...root.querySelectorAll('a[href]')]))];
  if (anchors.length > 1024 || sidebars.length > 4) return results;
  const names = new Map<string, string | null>(), conflictingNames = new Set<string>();
  const nameSurfaces = new Map<string, Set<Element>>();
  if (project && main) names.set(project.projectId, projectTitle(document, main));
  if (project && heading) nameSurfaces.set(project.projectId, new Set([heading.surface]));
  for (const anchor of anchors) {
    if (!visible(document, anchor)) continue;
    const sourceUrl = href(document, anchor), identity = sourceUrl ? parseProjectUrl(sourceUrl) : null;
    if (!identity || conflictingNames.has(identity.projectId) || identity.projectId === project?.projectId && names.get(identity.projectId)) continue;
    const title = anchorTitle(document, anchor); if (!title) continue;
    if (names.has(identity.projectId) && names.get(identity.projectId) !== title) { names.set(identity.projectId, null); conflictingNames.add(identity.projectId); nameSurfaces.delete(identity.projectId); }
    else {
      names.set(identity.projectId, title);
      const sources = nameSurfaces.get(identity.projectId) ?? new Set<Element>();
      sources.add(sidebars.find(root => root.contains(anchor)) ?? main!); nameSurfaces.set(identity.projectId, sources);
    }
  }
  const groups = new Map<string, NativeProjectSnapshot>();
  const labelNames = new Map<string, string | null>();
  function add(projectId: string, member: ProjectCandidate['members'][number], surface: Element, label: ReturnType<typeof sidebarLabel>) {
    if (groups.size >= 64 && !groups.has(projectId)) return;
    const group: NativeProjectSnapshot = groups.get(projectId) ?? { candidate: { state: 'candidate', relationBasis: label ? 'labelled-sidebar-project' : 'explicit-project-links',
      projectId, canonicalUrl: `https://chatgpt.com/g/${projectId}/project`, nativeTitle: names.has(projectId) ? names.get(projectId)! : label?.project ?? null, members: [] },
      panel: surface, allMembersContainerLinked: true, routeBound: false, identitySurfaces: [...nameSurfaces.get(projectId) ?? []] };
    if (!group.identitySurfaces.includes(surface)) group.identitySurfaces.push(surface);
    if (label && !names.has(projectId)) {
      if (labelNames.has(projectId) && labelNames.get(projectId) !== label.project) labelNames.set(projectId, null);
      else labelNames.set(projectId, label.project);
      group.candidate.nativeTitle = labelNames.get(projectId)!;
    }
    const prior = group.candidate.members.find(value => value.conversationId === member.conversationId);
    if (!prior) group.candidate.members.push(member);
    else if (prior.nativeTitle !== member.nativeTitle && prior.nativeTitle !== null && member.nativeTitle !== null) prior.nativeTitle = null;
    groups.set(projectId, group);
  }
  for (const anchor of anchors) {
    if (!visible(document, anchor)) continue;
    const sourceUrl = href(document, anchor), identity = sourceUrl ? parseConversationUrl(sourceUrl) : null;
    const projectId = identity ? projectIdFromContainer(identity.containerHint) : null;
    if (!identity || !projectId || !sourceUrl) continue;
    const sidebar = sidebars.find(root => root.contains(anchor)), label = sidebar ? sidebarLabel(anchor) : null;
    add(projectId, { conversationId: identity.conversationId, canonicalUrl: identity.canonicalUrl, nativeTitle: label?.title ?? anchorTitle(document, anchor), sourceUrl }, sidebar ?? main!, label);
  }
  const currentProject = current ? projectIdFromContainer(current.containerHint) : null;
  if (current && currentProject) add(currentProject, { conversationId: current.conversationId, canonicalUrl: current.canonicalUrl, nativeTitle: null, sourceUrl: document.location.href }, document.documentElement, null);
  for (const group of groups.values()) {
    // Prefer the route's bounded panel when available. Its rename/title and
    // stale-panel memory remain authoritative for that local observation.
    if (!panel || group.candidate.projectId !== panel.candidate.projectId) results.push(group);
  }
  if (project && heading && !results.some(value => value.candidate.projectId === project.projectId)) {
    // Empty/unloaded Project pages still have their own native identity and
    // title. This says nothing about a member list or its completeness.
    results.push({ candidate: { state: 'candidate', relationBasis: 'native-project-page', ...project, nativeTitle: heading.nativeTitle, members: [] },
      panel: heading.surface, titleSurface: heading.surface, allMembersContainerLinked: false, routeBound: true, identitySurfaces: [heading.surface] });
  }
  return results;
}
