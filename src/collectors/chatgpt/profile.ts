/** Packaged candidates only. A browser/page/config value cannot enable authority. */
export const CHATGPT_METADATA_PROFILE = Object.freeze({
  id: 'start-chatgpt-metadata-candidate-20261102', revision: 1,
  upstreamSha: '1903b00f774b4fd7f3d15b3669878c32e2c7a9c8',
  liveVerified: false,
  capabilities: Object.freeze({ currentContext: false, projectMembership: false, positiveNone: false, arrival: false, addressBar: false }),
  projectBoundary: 'main[data-app-shell-main-surface] [data-app-shell-main-content-layout] [role="main"]:has(h1 > button):has([role="tabpanel"])',
  projectMembers: '[role="tabpanel"]',
  sidebarBoundary: 'aside[data-app-shell-left-panel-appearance] [data-sidebar-navigation-root] [data-slate-sidebar-content], div[role="dialog"][aria-modal="true"][data-state="open"] [data-sidebar-navigation-root]',
  // This is deliberately not a selector for an assumed NONE state.
  noneSelector: ':not(*)',
});

export const SOURCE_FAILURE_CODES = Object.freeze([
  'current-context-unproven', 'positive-none-unproven', 'arrival-profile-unverified',
  'project-profile-unverified', 'project-structure-unsupported', 'source-origin-rejected',
  'session-read-busy', 'request-timeout', 'session-aborted', 'session-unauthorized',
  'session-challenged', 'invalid-session-response', 'invalid-session-mime',
  'session-response-too-large', 'missing-session-body', 'invalid-session-body',
  'invalid-session-json', 'invalid-session-schema', 'invalid-accounts-schema',
  'default-null-context-id', 'session-expired', 'session-transport-failed',
] as const);
export type SourceFailureCode = typeof SOURCE_FAILURE_CODES[number];
const failureCodes: ReadonlySet<string> = new Set(SOURCE_FAILURE_CODES);
export function normalizeSourceFailure(error: unknown): SourceFailureCode {
  const message = error instanceof Error ? error.message : '';
  return failureCodes.has(message) ? message as SourceFailureCode : 'session-transport-failed';
}
export interface SourceStatus {
  state: 'candidate' | 'blocked';
  code: SourceFailureCode;
  profileId: typeof CHATGPT_METADATA_PROFILE.id;
}
