/** VAIWL-START-FREE/1.0 — Design contract, not production implementation. */
export type ISOInstant = string;
export type LocalDate = string; // YYYY-MM-DD, validated Gregorian date
export type IANATimeZone = string;
export type NativeConversationId = string;
export type NativeProjectId = string;
export type ScopeKey = string; // SHA-256 of length-delimited provider/principal/context tuple
export type RecordKey = string;
export type EvidenceId = string;
export type Revision = number; // safe integer >= 0; never a timestamp
export type ConversationURL = string; // validated exact origin + supported conversation route
export type NativeProjectURL = string; // separate exact native Project route validator
export type WebsiteURL = string; // http/https only; no embedded credentials

export interface AccountScope {
  key: ScopeKey;
  provider: 'chatgpt';
  principalKey: string;
  contextKey: string;
  identity: 'verified';
  label: string; // user-editable display label, never identity
  verifiedAt: ISOInstant;
  identityAdapterVersion: string;
  contextWitnessId: EvidenceId;
  state: 'ready' | 'needs-revalidation' | 'signed-out' | 'conflicted';
}
export type RecordOwner =
  | { kind: 'scoped'; scopeKey: ScopeKey }
  | { kind: 'unassigned'; localProfileKey: string; accountKey: null };

export type EvidenceKind =
  | 'native-project-member-region'
  | 'native-explicit-none'
  | 'allowlisted-metadata'
  | 'verified-session-context';
export interface EvidenceWitness {
  id: EvidenceId;
  kind: EvidenceKind;
  adapterId: string;
  adapterVersion: string;
  scopeKey: ScopeKey;
  documentId: string;
  routeEpoch: number;
  scopeEpoch: number;
  observedAt: ISOInstant;
  sourceRevision: Revision;
  upstreamRevision?: string; // comparable only within declared source domain
  sourceDomain: string;
  fields: Array<'identity' | 'title' | 'project-title' | 'membership' | 'availability'>;
  revoked: boolean;
  // No raw DOM, response body, token, email, prompt, message or screenshot.
}
export type ConfirmedMembership =
  | { state: 'PROJECT'; projectId: NativeProjectId; evidenceId: EvidenceId; confirmedAt: ISOInstant }
  | { state: 'NONE'; projectId: null; evidenceId: EvidenceId; confirmedAt: ISOInstant };
export type Membership = ConfirmedMembership | {
  state: 'UNKNOWN'; projectId: null;
  reason: 'scope-unverified' | 'no-membership-source' | 'conflicting-evidence' | 'source-revoked' | 'unsupported-adapter';
  lastConfirmed?: ConfirmedMembership; // historical evidence only; not current grouping
};
export interface ActivitySummary {
  firstConfirmedOpenAt: ISOInstant;
  lastConfirmedOpenAt: ISOInstant;
  lastActiveDate: LocalDate;
  timeZone: IANATimeZone;
}
export interface ConversationBase {
  key: RecordKey;
  provider: 'chatgpt';
  conversationId: NativeConversationId;
  canonicalUrl: ConversationURL;
  nativeTitle: string | null; // <=512 Unicode scalar values, displayed with textContent
  titleBasis: 'native-label' | 'browser-history' | 'unknown';
  titleObservedAt: ISOInstant | null;
  availability: 'unverified' | 'reachable' | 'auth-required' | 'unavailable';
  firstSeenAt: ISOInstant;
  lastSeenAt: ISOInstant;
  browserLastVisitAt: ISOInstant | null; // NEVER used as confirmed active time
  activity: ActivitySummary | null;
  stableRank: number;
  revision: Revision;
}
export type ConversationRecord = ConversationBase & (
  | { owner: Extract<RecordOwner, { kind: 'scoped' }>; membership: Membership }
  | { owner: Extract<RecordOwner, { kind: 'unassigned' }>; membership: Extract<Membership, { state: 'UNKNOWN' }> }
);
export interface ProjectRecord {
  key: string; // same scope + native project ID
  scopeKey: ScopeKey;
  projectId: NativeProjectId;
  nativeTitle: string | null;
  canonicalUrl: NativeProjectURL;
  evidenceId: EvidenceId;
  observedAt: ISOInstant;
  membershipCoverage: 'observed-only'; // V1 never claims full account inventory
  stableRank: number;
  revision: Revision;
}
export interface CandidateResolution {
  candidateRecordKey: RecordKey;
  scopedRecordKey: RecordKey;
  evidenceId: EvidenceId;
  confirmedAt: ISOInstant;
  // A link only. Does not transfer old visit ownership, activity, or membership.
}
export type OpenIntentEvidence =
  | { kind: 'start-gesture'; sourceDocumentId: string; gesture: 'click' | 'keyboard' | 'auxclick' }
  | { kind: 'native-link-gesture'; sourceDocumentId: string; routeEpoch: number; adapterVersion: string; targetHref: ConversationURL }
  | { kind: 'address-bar-commit'; targetDocumentId: string; transitionType: 'typed' | 'generated' | 'keyword'; adapterVersion: string };
export type OpenDisposition = 'same-tab' | 'new-background-tab' | 'new-foreground-tab' | 'new-window';
export interface OpenIntent {
  id: string;
  browserSessionId: string;
  targetRecordKey: RecordKey; // immutable requested record, may be staging
  resolvedRecordKey: RecordKey | null; // arrival resolution; new activity commits here only
  committedRecordKey: RecordKey | null; // set atomically with consumed intent
  targetConversationId: NativeConversationId;
  expectedScopeKey: ScopeKey | null;
  targetUrl: ConversationURL;
  evidence: OpenIntentEvidence;
  disposition: OpenDisposition;
  sourceTabId: number;
  targetTabId: number | null;
  targetDocumentId: string | null;
  sourceScopeEpoch: number;
  issuedAt: ISOInstant; // local owner receipt time, never copied from page
  issuedTimeZone: IANATimeZone;
  issuedLocalDate: LocalDate; // frozen with issuedAt; never recomputed on arrival
  expiresAt: ISOInstant;
  state: 'issued' | 'navigation-dispatched' | 'arrived' | 'committed' | 'rejected' | 'expired';
  rejectionCode?: 'scope-mismatch' | 'target-mismatch' | 'stale-document' | 'ambiguous-arrival' | 'navigation-failed' | 'clock-anomaly';
}
export interface ConfirmedOpenDay {
  recordKey: RecordKey;
  timeZone: IANATimeZone;
  localDate: LocalDate;
  firstOpenedAt: ISOInstant;
  lastOpenedAt: ISOInstant;
  activityUnit: 1; // same record/day is ALWAYS one; never increment a visit counter
  firstIntentId: string;
  lastIntentId: string;
}
export interface ViewSession {
  id: string;
  selectedScope: ScopeKey | 'unassigned';
  H: 30;
  T: number; // integer civil-day ordinal derived by inherited localDay()
  Z: IANATimeZone;
  k: number;
  dataRevision: Revision;
  anchorRecordKey: RecordKey | null;
  anchorViewportOffset: number;
  expandedOlderProjectKeys: string[];
  visibleRowLimits: Record<string, number>;
  query: string;
}
export interface WebsiteShortcut {
  id: string;
  label: string;
  url: WebsiteURL;
  icon: { kind: 'monogram'; value: string } | { kind: 'builtin'; value: string };
  pinned: boolean;
  order: number;
  createdAt: ISOInstant;
  updatedAt: ISOInstant;
}
export interface ImportCheckpoint {
  id: string;
  provider: 'browser-history';
  state: 'running' | 'paused' | 'partial' | 'complete' | 'cancelled' | 'permission-revoked';
  startTimeMs: number;
  endTimeMs: number;
  pendingIntervals: Array<{ startMs: number; endMs: number; query: 'chatgpt.com' | 'chat.openai.com' }>;
  processedUniqueUrls: number;
  acceptedCandidates: number;
  rejectedUrls: number;
  saturatedIntervals: Array<{ startMs: number; endMs: number }>;
  sourceCoverage: 'browser-available-history';
  completedAt: ISOInstant | null;
}
export interface Tombstone {
  key: string; // exact record identity; includes scope or staging namespace
  removedAt: ISOInstant;
  reason: 'user-removed';
}
export interface StartSettings {
  schemaVersion: 1;
  libraryTimeZone: IANATimeZone;
  shortcutSectionCollapsed: boolean;
  selectedScope: ScopeKey | 'unassigned';
  currentSegment: number;
  captureEnabled: boolean;
}
/** RESERVED future exchange boundary. V1 does not implement export/import or sync. */
export interface PortableCatalogV1 {
  format: 'vaiwl-start-catalog';
  version: 1;
  exportedAt: ISOInstant;
  sourceInstallLabel: string;
  conversations: ConversationRecord[];
  projects: ProjectRecord[];
  shortcuts: WebsiteShortcut[];
  openDays: ConfirmedOpenDay[];
  // AccountScope proofs, tokens, pending intents, tab IDs, DOM and raw payloads excluded.
  // Imported records remain historical/unassigned until live identity/membership proof.
}
export type ProjectionActivity =
  | { basis: 'confirmed-open'; instant: ISOInstant; day: number; segment: number }
  | { basis: 'undated'; instant: null; day: null; segment: null };
export interface DomainMutation {
  protocol: 'vaiwl-start-internal/1';
  expectedRevision: Revision;
  operationId: string;
  // Concrete request union defined by implementation; exact-field validators mandatory.
}
