export interface TaskScope { provider: string; profileId: string; accountId: string }
export interface ModelStore { schemaVersion: 1; scopes: Record<string, any> }
export interface NativeTask {
  id: string; title: string; is_enabled: boolean | null; schedule: string | null;
  default_timezone: string | null; next_run_time: string | null; last_run_time: string | null;
  conversation_id: string | null; team_id: string | null;
}
export interface NativeResult {
  taskId: string; conversationId: string; messageId: string; turnId: string | null;
  createdAt: string; body: string; complete: boolean;
}
export type SourcePacket = {
  kind: 'list'; filter: 'scheduled' | 'paused' | 'finished'; cursor: string | null;
  firstPage: boolean; tasks: NativeTask[]; observedAt: string; pageHref: string;
} | { kind: 'results'; results: NativeResult[]; taskId: string; conversationId: string; observedAt: string; pageHref: string }
  | { kind: 'error'; code: string; observedAt: string; pageHref: string };
export interface TaskSettings {
  enabled: boolean; automatic: boolean; showWidget: boolean; preview: boolean;
  // An absent account selection uses the five most recently run readable tasks.
  selections: Record<string, string[]>;
}
export interface CatalogTask { key: string; scope: TaskScope; task: NativeTask; observedAt: string; resultSyncedAt: string | null }
export interface TaskState {
  version: 1; generation: number; model: ModelStore; settings: TaskSettings;
  principal: string | null; catalog: Record<string, CatalogTask>;
  coverage: Record<string, { filters: Record<string, { cursor: string | null; observedAt: string; firstPage: boolean }>; at: string | null }>;
  sync: { status: 'never' | 'syncing' | 'ok' | 'error'; attemptedAt: string | null; succeededAt: string | null; code: string | null; mode: 'temporary' | 'visit' | null };
  sourceEvidence: Record<string, { messageId: string; turnId: string | null; conversationId: string; complete: boolean }>;
}
export interface ResultView {
  runId: string; revision: number; createdAt: string | null; observedAt: string;
  preview: string; bodyText?: string; contentTruncated: boolean; resultConversationUrl: string | null;
  sourceUrls: string[]; classification: { outcome: string; evidence: { kind: string }; classifiedAt: string } | null;
  isFailureMessage: boolean;
}
export interface TaskView {
  key: string; taskId: string; title: string; enabledState: string; nextRunAt: string | null;
  lastRunAt: string | null; timeZone: string | null; selected: boolean; readable: boolean;
  recordedStatus: string; displayState: string; latestRunId: string | null;
  latestAvailableResult: ResultView | null; lastValuableResult: ResultView | null;
  currentResult: ResultView | null; resultSyncedAt: string | null; sourceUrl: string;
}
export interface TaskSnapshot {
  settings: TaskSettings; principal: string | null; tasks: TaskView[];
  sync: TaskState['sync']; completeList: boolean; permission: boolean;
}
