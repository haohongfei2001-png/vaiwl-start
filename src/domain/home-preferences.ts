import type { PeriodDays } from './time.js';
import { normalizePeriodDays } from './time.js';
export type { PeriodDays } from './time.js';
export { normalizePeriodDays } from './time.js';

/** Display preferences stay independent of theme, home mode, and library content. */
export type ProjectLayout = 'adaptive' | 'equal';

export interface HomePreferences {
  readonly periodDays: PeriodDays;
  readonly projectLayout: ProjectLayout;
  readonly recentPinnedKeys: readonly string[];
}

export const HOME_PERIOD_DAYS_KEY = 'native.homePeriodDays';
export const PROJECT_LAYOUT_KEY = 'native.projectLayout';
export const RECENT_PINNED_KEYS_KEY = 'native.recentPinnedKeys';
export const HOME_PREFERENCE_KEYS = Object.freeze([
  HOME_PERIOD_DAYS_KEY, PROJECT_LAYOUT_KEY, RECENT_PINNED_KEYS_KEY,
]);

export function normalizeProjectLayout(value: unknown): ProjectLayout {
  return value === 'equal' ? 'equal' : 'adaptive';
}

export function normalizePinnedKeys(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return Object.freeze([]);
  // Keys are opaque identifiers. Preserve them exactly; never derive pins from activity.
  return Object.freeze([...new Set(value.filter((key): key is string => (
    typeof key === 'string' && key.trim().length > 0 && !/[\u0000-\u001f\u007f]/.test(key)
  )))]);
}

export function normalizeHomePreferences(stored: Record<string, unknown>): HomePreferences {
  return Object.freeze({
    periodDays: normalizePeriodDays(stored[HOME_PERIOD_DAYS_KEY]),
    projectLayout: normalizeProjectLayout(stored[PROJECT_LAYOUT_KEY]),
    recentPinnedKeys: normalizePinnedKeys(stored[RECENT_PINNED_KEYS_KEY]),
  });
}

export const DEFAULT_HOME_PREFERENCES = normalizeHomePreferences({});

export function samePinnedKeys(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((key, index) => key === right[index]);
}

export function sameHomePreferences(left: HomePreferences, right: HomePreferences): boolean {
  return left.periodDays === right.periodDays && left.projectLayout === right.projectLayout
    && samePinnedKeys(left.recentPinnedKeys, right.recentPinnedKeys);
}
