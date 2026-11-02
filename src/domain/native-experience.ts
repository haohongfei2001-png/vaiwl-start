/** Local preferences, deliberately separate from catalog ownership and IndexedDB schema. */
export const NATIVE_KEYS = ['native.title', 'native.icon', 'native.bookmarks', 'native.bookmarksCollapsed'] as const;
export type BookmarkPreference = 'ask' | 'always' | 'newtab' | 'hidden';
export type TabIcon = { kind: 'browser' | 'product' } | { kind: 'upload'; data: string };
export function browserFamily(ua: string): 'chrome' | 'edge' { return /Edg(?:e|A|iOS)?\//.test(ua) ? 'edge' : 'chrome'; }
export function defaultTabTitle(language: string, browser: 'chrome' | 'edge'): string {
  const lang = language.toLowerCase();
  if (/^zh/.test(lang)) return /(?:tw|hk|hant)/.test(lang) ? (browser === 'edge' ? '新增索引標籤' : '新分頁') : (browser === 'edge' ? '新建标签页' : '新标签页');
  const titles: Record<string, string> = { ja: '新しいタブ', ko: '새 탭', de: 'Neuer Tab', fr: 'Nouvel onglet', es: 'Nueva pestaña', it: 'Nuova scheda', pt: 'Nova guia', ru: 'Новая вкладка', nl: 'Nieuw tabblad' };
  return titles[lang.split('-')[0]!] ?? (browser === 'edge' ? 'New tab' : 'New Tab');
}
export function validTitle(value: unknown): string {
  if (typeof value !== 'string' || [...value].length > 80 || /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(value)) throw Error('名称最多 80 个字符，不能包含控制字符。');
  return value.trim();
}
export function normalizeTitle(value: unknown): string { try { return validTitle(value); } catch { return ''; } }
export function normalizeIcon(value: unknown): TabIcon {
  if (value && typeof value === 'object') {
    const icon = value as { kind?: unknown; data?: unknown };
    if (icon.kind === 'product') return { kind: 'product' };
    if (icon.kind === 'upload' && typeof icon.data === 'string' && icon.data.length <= 100_000 && /^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/.test(icon.data)) return { kind: 'upload', data: icon.data };
  }
  return { kind: 'browser' };
}
export function bookmarkPreference(value: unknown): BookmarkPreference { return value === 'always' || value === 'newtab' || value === 'hidden' ? value : 'ask'; }
export function safeBookmarkUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 8192) return null;
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null; } catch { return null; }
}
export interface BookmarkNode { id: string; title: string; url?: string; parentId?: string; index?: number; folderType?: string; unmodifiable?: string; children?: BookmarkNode[] }
export function bookmarkBars(tree: BookmarkNode[]): BookmarkNode[] {
  const roots = tree.flatMap(root => root.children ?? []);
  const typed = roots.filter(node => node.folderType === 'bookmarks-bar' && !node.url);
  // Chromium's legacy permanent bookmark-bar node. Never infer from localized names.
  return typed.length ? typed : roots.filter(node => node.id === '1' && !node.url && !node.folderType);
}
/** Inspect size/header BEFORE image decode to limit decompression allocations. SVG/GIF rejected. */
export function imageDimensions(bytes: Uint8Array, mime: string): { width: number; height: number } {
  if (!bytes.length || bytes.length > 1_048_576) throw Error('图片须小于或等于 1 MB。');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0, height = 0;
  if (mime === 'image/png' && bytes.length >= 33 && [137,80,78,71,13,10,26,10].every((v,i) => bytes[i] === v) && dv.getUint32(8) === 13 && dv.getUint32(12) === 0x49484452) {
    width = dv.getUint32(16); height = dv.getUint32(20);
  } else if (mime === 'image/jpeg' && bytes[0] === 255 && bytes[1] === 216) {
    let pos = 2;
    while (pos + 4 <= bytes.length) {
      if (bytes[pos++] !== 255) break;
      while (bytes[pos] === 255) pos++;
      const marker = bytes[pos++]; if (marker === 217 || marker === 218) break;
      if (marker === 1 || marker! >= 208 && marker! <= 215) continue;
      if (pos + 2 > bytes.length) break;
      const size = dv.getUint16(pos); if (size < 2 || pos + size > bytes.length) break;
      if ([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker!) && size >= 8) { height = dv.getUint16(pos + 3); width = dv.getUint16(pos + 5); break; }
      pos += size;
    }
  } else if (mime === 'image/webp' && bytes.length >= 30 && dv.getUint32(0) === 0x52494646 && dv.getUint32(8) === 0x57454250) {
    const tag = dv.getUint32(12);
    if (tag === 0x56503858) { width = 1 + bytes[24]! + (bytes[25]! << 8) + (bytes[26]! << 16); height = 1 + bytes[27]! + (bytes[28]! << 8) + (bytes[29]! << 16); }
    else if (tag === 0x56503820 && bytes[23] === 157 && bytes[24] === 1 && bytes[25] === 42) { width = dv.getUint16(26, true) & 0x3fff; height = dv.getUint16(28, true) & 0x3fff; }
    else if (tag === 0x5650384c && bytes[20] === 47) { const n = dv.getUint32(21, true); width = (n & 0x3fff) + 1; height = ((n >>> 14) & 0x3fff) + 1; }
  }
  if (!width || !height || width > 2048 || height > 2048) throw Error('仅支持有效的 PNG、JPEG、WebP，且宽高均不超过 2048 像素。');
  return { width, height };
}
