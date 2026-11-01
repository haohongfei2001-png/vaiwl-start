type Child = Node | string | null | undefined | false;

/** Dynamic data always becomes a text node or a DOM attribute, never HTML. */
export function element<K extends keyof HTMLElementTagNameMap>(tag: K, attributes: Record<string, string | number | boolean> = {}, children: Child[] = []): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (value === false) continue;
    if (key === 'class') node.className = String(value);
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children) if (child !== null && child !== undefined && child !== false) node.append(child);
  return node;
}

export function icon(name: string, className = ''): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('aria-hidden', 'true');
  if (className) svg.setAttribute('class', className);
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.append(use);
  return svg;
}

export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`UI_ELEMENT_MISSING:${id}`);
  return found as T;
}

export function button(label: string, attributes: Record<string, string | number | boolean> = {}, iconName?: string): HTMLButtonElement {
  return element('button', { type: 'button', ...attributes }, [iconName ? icon(iconName) : null, label]);
}

export function isEditing(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"]');
}

export function allowedWebsiteUrl(raw: string): string | null {
  if (new TextEncoder().encode(raw).length > 8192) return null;
  try {
    const url = new URL(raw);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export function dateTime(iso: string | null, timeZone: string): string {
  if (!iso) return '尚无记录';
  const date = new Date(iso);
  if (!Number.isFinite(date.valueOf())) return '日期不可用';
  return new Intl.DateTimeFormat('zh-CN', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
}
