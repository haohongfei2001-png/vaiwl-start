import { instant } from './time.js';
export function exactObject(value: unknown, required: readonly string[], optional: readonly string[] = []): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype || required.some(k => !Object.hasOwn(value, k)) || Object.keys(value).some(k => !required.includes(k) && !optional.includes(k))) throw Error('invalid-fields');
}
export function boundedString(value: unknown, max: number, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && !value) || [...value].length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value) || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) throw Error('invalid-string');
  return value;
}
export function title(value: unknown): string | null { return value === null || value === undefined || value === '' ? null : boundedString(value, 512); }
export function iso(value: unknown): string { if (instant(value) === null) throw Error('invalid-instant'); return new Date(instant(value)!).toISOString(); }
export function nonnegative(value: unknown): number { if (!Number.isSafeInteger(value) || (value as number) < 0) throw Error('invalid-integer'); return value as number; }
export function positiveInteger(value: unknown): number { const n = nonnegative(value); if (!n) throw Error('invalid-integer'); return n; }
