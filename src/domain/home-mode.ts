/** This preference never changes catalog ownership, capture, or bookmark data. */
export const HOME_MODE_KEY = 'native.homeMode';
export type HomeMode = 'workspace' | 'life';

export function homeMode(value: unknown): HomeMode {
  return value === 'life' ? 'life' : 'workspace';
}
