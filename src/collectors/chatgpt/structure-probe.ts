/** User-selected metadata structure only. This module reads no text or semantic
 * labels and supplies no scope, membership or arrival authority. */
import { parseConversationUrl, parseProjectUrl } from '../../domain/ids.js';
import { CHATGPT_METADATA_PROFILE } from './profile.js';

export const STRUCTURE_PROBE_CODES = Object.freeze([
  'structure-observed', 'source-origin-rejected', 'structure-unavailable',
  'structure-hidden', 'structure-forbidden', 'structure-limit', 'structure-route-changed',
] as const);
export const STRUCTURE_BOUNDARIES = Object.freeze(['project', 'sidebar', 'linked-menu'] as const);
export const STRUCTURE_TAGS = Object.freeze([
  'A', 'BUTTON', 'DIV', 'SPAN', 'HEADER', 'NAV', 'SECTION', 'UL', 'OL', 'LI',
  'H1', 'H2', 'H3', 'P', 'SMALL', 'STRONG', 'EM', 'B', 'I', 'HR',
  'SVG', 'PATH', 'G', 'CIRCLE', 'RECT', 'LINE', 'POLYGON', 'POLYLINE', 'ELLIPSE',
] as const);
export const STRUCTURE_ROLES = Object.freeze([
  'button', 'menu', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'tab', 'tablist',
  'tabpanel', 'navigation', 'list', 'listitem', 'heading', 'group', 'separator',
  'main', 'none', 'presentation', 'link', 'other',
] as const);
export const STRUCTURE_ATTRIBUTES = Object.freeze([
  'role', 'aria-current', 'aria-checked', 'aria-selected', 'aria-expanded',
  'aria-controls', 'aria-labelledby', 'data-state', 'href', 'id', 'data-testid',
] as const);
export const STRUCTURE_CURRENT = Object.freeze(['page', 'step', 'location', 'date', 'time', 'true', 'false', 'other'] as const);
export const STRUCTURE_CHECKED = Object.freeze(['true', 'false', 'mixed', 'other'] as const);
export const STRUCTURE_BOOLEAN = Object.freeze(['true', 'false', 'other'] as const);
export const STRUCTURE_STATES = Object.freeze(['open', 'closed', 'checked', 'unchecked', 'on', 'off', 'active', 'inactive', 'other'] as const);
export const STRUCTURE_LIMITS = Object.freeze({ depth: 3, nodes: 40, children: 12, boundaries: 8, ancestors: 64 });
type Item<T extends readonly string[]> = T[number];
export interface MetadataStructureNode {
  tag: Item<typeof STRUCTURE_TAGS>;
  role: Item<typeof STRUCTURE_ROLES> | null;
  attributes: Array<Item<typeof STRUCTURE_ATTRIBUTES>>;
  current: Item<typeof STRUCTURE_CURRENT> | null;
  checked: Item<typeof STRUCTURE_CHECKED> | null;
  selected: Item<typeof STRUCTURE_BOOLEAN> | null;
  expanded: Item<typeof STRUCTURE_BOOLEAN> | null;
  state: Item<typeof STRUCTURE_STATES> | null;
  linkKind: 'conversation' | 'project' | null;
  children: MetadataStructureNode[];
}
export type MetadataStructureSummary = {
  state: 'observed'; code: 'structure-observed'; authority: false;
  boundary: Item<typeof STRUCTURE_BOUNDARIES>; node: MetadataStructureNode;
  assertions: { boundaryUnique: true; visible: true; menuLinked: boolean };
  nodeCount: number;
} | { state: 'blocked'; code: Exclude<Item<typeof STRUCTURE_PROBE_CODES>, 'structure-observed'>; authority: false };

// These selectors are refusal boundaries, never content extraction selectors.
const EXCLUDED = 'dialog,[role="dialog"],form,input,textarea,select,option,script,style,iframe,object,embed,[contenteditable],[role="textbox"],[role="combobox"],[data-message-id],[data-message-author-role],[data-testid^="conversation-turn"],[data-testid*="attachment"],[data-testid*="composer"],#prompt-textarea,[data-thread-scroll-footer],[data-app-action-timeline-scroll],[data-va-owned],[data-vaiwl-owned]';
const isOneOf = <T extends readonly string[]>(value: unknown, choices: T): value is T[number] => typeof value === 'string' && choices.includes(value);
const refused = (code: Exclude<Item<typeof STRUCTURE_PROBE_CODES>, 'structure-observed'>): MetadataStructureSummary => ({ state: 'blocked', code, authority: false });
function visible(document: Document, node: Element): boolean {
  if (!node.isConnected || node.ownerDocument !== document || !document.defaultView || !node.getClientRects().length) return false;
  if (typeof node.checkVisibility === 'function' && !node.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true, contentVisibilityAuto: true })) return false;
  let count = 0;
  for (let parent: Element | null = node; parent; parent = parent.parentElement) {
    if (++count > STRUCTURE_LIMITS.ancestors || parent.hasAttribute('hidden') || parent.getAttribute('aria-hidden') === 'true') return false;
    const style = document.defaultView.getComputedStyle(parent);
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || style.opacity === '0') return false;
  }
  return true;
}
function forbidden(node: Element): boolean {
  return ['HTML', 'BODY'].includes(node.tagName.toUpperCase()) || !!node.closest(EXCLUDED);
}
function boundarySet(document: Document): Array<{ kind: 'project' | 'sidebar'; node: Element }> | null {
  const result: Array<{ kind: 'project' | 'sidebar'; node: Element }> = [];
  for (const [kind, selector] of [['project', CHATGPT_METADATA_PROFILE.projectBoundary], ['sidebar', CHATGPT_METADATA_PROFILE.sidebarBoundary]] as const) {
    const found = document.querySelectorAll(selector);
    if (found.length > STRUCTURE_LIMITS.boundaries) return null;
    const accepted = [...found].filter(node => visible(document, node) && !forbidden(node));
    if (accepted.length > 1) return null;
    if (accepted[0]) result.push({ kind, node: accepted[0] });
  }
  return result;
}
function linkedMenu(document: Document, node: Element, boundaries: Array<{ kind: 'project' | 'sidebar'; node: Element }>): boolean {
  const menu = node.closest('[role="menu"]');
  if (!menu || forbidden(menu) || !visible(document, menu)) return false;
  const id = menu.getAttribute('id');
  // IDs are compared transiently; no value is returned or logged. Restrict the
  // grammar so it cannot become selector syntax, even when CSS.escape is absent.
  if (!id || !/^[a-zA-Z0-9_:.-]{1,128}$/.test(id)) return false;
  const sameIds = document.querySelectorAll('[id="' + id + '"]');
  if (sameIds.length !== 1 || sameIds[0] !== menu) return false;
  let linked = 0, inspected = 0;
  for (const boundary of boundaries) {
    const controls = boundary.node.querySelectorAll('[aria-controls]');
    if ((inspected += controls.length) > STRUCTURE_LIMITS.nodes) return false;
    for (const trigger of controls) {
      if (trigger.getAttribute('aria-controls') !== id) continue;
      if (forbidden(trigger) || !visible(document, trigger) || trigger.getAttribute('aria-expanded') !== 'true' || trigger.getAttribute('aria-haspopup') !== 'menu' || !(trigger.tagName === 'BUTTON' || trigger.getAttribute('role') === 'button')) return false;
      linked++;
    }
  }
  return linked === 1;
}
function unsafeProjectMemberSurface(node: Element): boolean {
  // The fixed Project panel includes message previews. Only its already-known
  // text-only title leaf is an eligible selection; unknown member layouts and
  // containing rows are refused without traversing their content.
  if (!node.closest('[role="tabpanel"]')) return false;
  const anchor = node.closest('[role="tabpanel"] > section > ol > li > a');
  const wrapper = anchor?.firstElementChild;
  if (!anchor || anchor.children.length !== 1 || wrapper?.tagName !== 'DIV' || wrapper.children.length !== 2) return true;
  const title = wrapper.firstElementChild;
  return !title || title.tagName !== 'DIV' || title.children.length !== 0 || wrapper.lastElementChild?.tagName !== 'DIV' || node !== title;
}
function enumAttribute<T extends readonly string[]>(node: Element, name: string, values: T): T[number] | null {
  const value = node.getAttribute(name);
  return value === null ? null : isOneOf(value, values) ? value : 'other' as T[number];
}
function linkKind(node: Element): MetadataStructureNode['linkKind'] {
  if (node.tagName !== 'A') return null;
  const href = node.getAttribute('href');
  if (!href || /[\u0000-\u0020\u007f\\]/u.test(href) || !(href.startsWith('/') && !href.startsWith('//') || href.startsWith('https://'))) return null;
  const url = href.startsWith('/') ? 'https://chatgpt.com' + href : href;
  return parseConversationUrl(url) ? 'conversation' : parseProjectUrl(url) ? 'project' : null;
}

/** Pure one-shot inspection. A qualifying shape is explicitly not evidence of
 * current identity, project membership, positive NONE, or successful arrival. */
export function inspectMetadataStructure(document: Document, element: Element): MetadataStructureSummary {
  try {
    if (document.location.origin !== 'https://chatgpt.com' || !document.defaultView || document.defaultView.top !== document.defaultView || (document as Document & { prerendering?: boolean }).prerendering) return refused('source-origin-rejected');
    const href = document.location.href;
    if (!element || element.ownerDocument !== document || forbidden(element) || unsafeProjectMemberSurface(element)) return refused('structure-forbidden');
    if (!visible(document, element)) return refused('structure-hidden');
    const boundaries = boundarySet(document);
    if (!boundaries) return refused('structure-unavailable');
    const own = boundaries.filter(boundary => boundary.node === element || boundary.node.contains(element));
    if (own.length > 1) return refused('structure-unavailable');
    const selectedMenu = element.closest('[role="menu"]');
    const menuLinked = selectedMenu !== null && linkedMenu(document, element, boundaries);
    if (selectedMenu && !menuLinked) return refused('structure-unavailable');
    if (own.length === 0 && !menuLinked) return refused('structure-unavailable');
    let nodeCount = 0;
    function inspect(node: Element, depth: number): MetadataStructureNode {
      if (depth > STRUCTURE_LIMITS.depth || ++nodeCount > STRUCTURE_LIMITS.nodes || node.children.length > STRUCTURE_LIMITS.children) throw Error('structure-limit');
      if (forbidden(node) || unsafeProjectMemberSurface(node)) throw Error('structure-forbidden');
      if (node.getAttribute('role') === 'menu' && node !== selectedMenu) throw Error('structure-forbidden');
      const tag = node.tagName.toUpperCase();
      if (!isOneOf(tag, STRUCTURE_TAGS)) throw Error('structure-unavailable');
      // Descendants only contribute fixed shape. Hidden descendants are refused,
      // never mined for stale or non-visible state.
      if (!visible(document, node)) throw Error('structure-hidden');
      return {
        tag, role: enumAttribute(node, 'role', STRUCTURE_ROLES), attributes: STRUCTURE_ATTRIBUTES.filter(name => node.hasAttribute(name)),
        current: enumAttribute(node, 'aria-current', STRUCTURE_CURRENT), checked: enumAttribute(node, 'aria-checked', STRUCTURE_CHECKED),
        selected: enumAttribute(node, 'aria-selected', STRUCTURE_BOOLEAN), expanded: enumAttribute(node, 'aria-expanded', STRUCTURE_BOOLEAN),
        state: enumAttribute(node, 'data-state', STRUCTURE_STATES), linkKind: linkKind(node),
        children: [...node.children].map(child => inspect(child, depth + 1)),
      };
    }
    const node = inspect(element, 0);
    if (document.location.href !== href || !element.isConnected) return refused('structure-route-changed');
    return { state: 'observed', code: 'structure-observed', authority: false, boundary: menuLinked ? 'linked-menu' : own[0]?.kind ?? 'linked-menu', node,
      assertions: { boundaryUnique: true, visible: true, menuLinked }, nodeCount };
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    return refused(isOneOf(code, STRUCTURE_PROBE_CODES) && code !== 'structure-observed' ? code : 'structure-unavailable');
  }
}

function exact(value: unknown, keys: string[]): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
/** Worker-side closed schema. Report data can never supply a raw attribute,
 * unknown field, live selector, capability, or authority assertion. */
export function validateMetadataStructure(value: unknown): value is MetadataStructureSummary {
  try {
    if (exact(value, ['state', 'code', 'authority']) && value.state === 'blocked') return value.authority === false && isOneOf(value.code, STRUCTURE_PROBE_CODES) && value.code !== 'structure-observed';
    if (!exact(value, ['state', 'code', 'authority', 'boundary', 'node', 'assertions', 'nodeCount']) || value.state !== 'observed' || value.code !== 'structure-observed' || value.authority !== false || !isOneOf(value.boundary, STRUCTURE_BOUNDARIES)) return false;
    if (!exact(value.assertions, ['boundaryUnique', 'visible', 'menuLinked']) || value.assertions.boundaryUnique !== true || value.assertions.visible !== true || value.assertions.menuLinked !== (value.boundary === 'linked-menu')) return false;
    let count = 0;
    function nodeValid(node: unknown, depth: number): boolean {
      if (depth > STRUCTURE_LIMITS.depth || ++count > STRUCTURE_LIMITS.nodes || !exact(node, ['tag', 'role', 'attributes', 'current', 'checked', 'selected', 'expanded', 'state', 'linkKind', 'children'])) return false;
      if (!isOneOf(node.tag, STRUCTURE_TAGS) || !(node.role === null || isOneOf(node.role, STRUCTURE_ROLES))) return false;
      if (!Array.isArray(node.attributes) || node.attributes.length > STRUCTURE_ATTRIBUTES.length || new Set(node.attributes).size !== node.attributes.length || !node.attributes.every(attr => isOneOf(attr, STRUCTURE_ATTRIBUTES))) return false;
      for (const [key, attribute, values] of [
        ['role', 'role', STRUCTURE_ROLES], ['current', 'aria-current', STRUCTURE_CURRENT], ['checked', 'aria-checked', STRUCTURE_CHECKED],
        ['selected', 'aria-selected', STRUCTURE_BOOLEAN], ['expanded', 'aria-expanded', STRUCTURE_BOOLEAN], ['state', 'data-state', STRUCTURE_STATES],
      ] as const) if (node[key] === null ? node.attributes.includes(attribute) : !node.attributes.includes(attribute) || !isOneOf(node[key], values)) return false;
      if (node.linkKind !== null && (!isOneOf(node.linkKind, ['conversation', 'project'] as const) || node.tag !== 'A' || !node.attributes.includes('href'))) return false;
      return Array.isArray(node.children) && node.children.length <= STRUCTURE_LIMITS.children && node.children.every(child => nodeValid(child, depth + 1));
    }
    return nodeValid(value.node, 0) && value.nodeCount === count;
  } catch { return false; }
}
