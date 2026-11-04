/** Home appearance is a local preference, independent of workspace or catalog data. */
export type HomeTheme = 'classic' | 'spatial' | 'workbench' | 'folio';

export const HOME_THEME_KEY = 'native.homeTheme';
export const DEFAULT_HOME_THEME: HomeTheme = 'classic';

export function isHomeTheme(value: unknown): value is HomeTheme {
  return value === 'classic' || value === 'spatial' || value === 'workbench' || value === 'folio';
}

export function normalizeHomeTheme(value: unknown): HomeTheme {
  return isHomeTheme(value) ? value : DEFAULT_HOME_THEME;
}
