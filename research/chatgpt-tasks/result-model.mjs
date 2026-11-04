/**
 * Isolated research model. No network, browser access, credentials or production imports.
 * Input fixture shape follows ChatGPT's internal automations tool observation.
 * This does NOT establish an API callable by a browser extension.
 *
 * All state is JSON serializable. observedAt means source sampling/request-start time,
 * never the arrival time of an older response. Callers must fence account lifetimes.
 */
const RUN_STATES = new Set(['completed', 'no_update', 'failed', 'in_progress']);
const TERMINAL = new Set(['completed', 'no_update', 'failed']);
const OUTCOMES = new Set(['new_information', 'no_new_information', 'failed']);
const clone = value => JSON.parse(JSON.stringify(value));
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function identifier(value, name) {
  if (typeof value !== 'string' || !value || value.length > 512 || /[\u0000-\u001f]/.test(value)) {
    throw Error('INVALID_' + name);
  }
  return value;
}
function instant(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const n = Date.parse(value);
  return Number.isFinite(n) ? new Date(n).toISOString() : null;
}
function requiredInstant(value, name) {
  const normalized = instant(value);
  if (!normalized) throw Error('INVALID_' + name);
  return normalized;
}
function scopeTuple(scope) {
  if (!object(scope)) throw Error('INVALID_SCOPE');
  return ['provider', 'profileId', 'accountId'].map(name => identifier(scope[name], name));
}
function keyFor(scope, ...parts) { return JSON.stringify([...scopeTuple(scope), ...parts]); }
function chatRef(value) {
  return object(value) && ['chatgpt', 'codex'].includes(value.type) && typeof value.id === 'string' && value.id
    ? { type: value.type, id: value.id } : null;
}
function conversationUrl(ref) {
  return ref?.type === 'chatgpt' && /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(ref.id)
    ? 'https://chatgpt.com/c/' + ref.id : null;
}

/** Conservative extraction: URLs are exact substrings; opaque citation tokens stay opaque. */
export function sourceUrls(text) {
  if (typeof text !== 'string') return [];
  const visible = text.replace(/\ue200[^\ue201]*\ue201/g, '');
  const found = visible.match(/https?:\/\/[^\s<>"'\x60\\()[\]\u0000-\u001f\ue000-\uf8ff]+/gi) || [];
  return [...new Set(found.map(raw => raw.replace(/[.,;!]+$/, '')).filter(raw =>
    /^https?:\/\/(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?::\d{1,5})?(?:[/?#][^\s<>"'\x60\\]*)?$/i.test(raw)
  ))];
}
/** A mechanical text excerpt, never a separately generated AI summary or HTML. */
export function previewText(body, limit = 180) {
  if (typeof body !== 'string') return '';
  return body.replace(/\ue200[^\ue201]*\ue201/g, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[\x60*_#>]/g, '').replace(/\s+/g, ' ').trim().slice(0, limit);
}
export function createStore() { return { schemaVersion: 1, scopes: {} }; }

function assertStore(store) {
  if (!object(store) || store.schemaVersion !== 1 || !object(store.scopes)) throw Error('INVALID_STORE');
}
function newTask(scope, input) {
  const id = identifier(input.id, 'TASK_ID');
  return { key: keyFor(scope, id), id, title: '', enabledState: 'unknown', schedule: null,
    timeZone: null, nextRunAt: null, lastRunAt: null, taskConversationUrl: null,
    metadataObservedAt: null, latestRunKey: null, latestRunObservedAt: null, runs: {} };
}
function newRun(scope, taskId, runId) {
  return { key: keyFor(scope, taskId, runId), id: runId, recordedStatus: 'unknown',
    scheduledFor: null, startedAt: null, completedAt: null, chatRef: null,
    statusObservedAt: null, lastResultObservedAt: null, results: [], latestResultRevision: null };
}
function runTime(run) { return run.scheduledFor || run.startedAt || run.completedAt || ''; }
function observeRun(task, input, scope, at) {
  if (!object(input) || typeof input.id !== 'string' || !input.id) return;
  const id = identifier(input.id, 'RUN_ID'), key = keyFor(scope, task.id, id);
  const run = task.runs[key] ||= newRun(scope, task.id, id);
  const start = instant(input.started_at);
  const state = RUN_STATES.has(input.recorded_status) ? input.recorded_status : 'unknown';
  const newer = !run.statusObservedAt || at > run.statusObservedAt;
  const earlierAttempt = run.startedAt && start && start < run.startedAt;
  const regressedTerminal = start === run.startedAt && TERMINAL.has(run.recordedStatus) && state === 'in_progress';
  if (newer && !earlierAttempt && !regressedTerminal) {
    Object.assign(run, { recordedStatus: state, scheduledFor: instant(input.scheduled_for),
      startedAt: start, completedAt: instant(input.completed_at),
      chatRef: chatRef(input.chat_ref), statusObservedAt: at });
  }
  const current = task.runs[task.latestRunKey];
  if ((!task.latestRunObservedAt || at > task.latestRunObservedAt) &&
      (!current || key === current.key || runTime(run) > runTime(current))) {
    task.latestRunKey = key;
    task.latestRunObservedAt = at;
  }
}
function resultSignature(row) {
  const { createdAt, scheduledFor, completedAt, bodyText, contentTruncated, chatRef: ref, requiresUserAction, isFailureMessage } = row;
  return JSON.stringify({ createdAt, scheduledFor, completedAt, bodyText, contentTruncated, chatRef: ref, requiresUserAction, isFailureMessage });
}
function observeResult(task, input, scope, at) {
  if (!object(input) || typeof input.run_id !== 'string' || !input.run_id ||
      typeof input.content_text !== 'string' || !input.content_text.trim()) return;
  if (input.content_text.length > 1000000) throw Error('RESULT_TOO_LARGE');
  const id = identifier(input.run_id, 'RESULT_RUN_ID'), key = keyFor(scope, task.id, id);
  const run = task.runs[key] ||= newRun(scope, task.id, id);
  if (run.lastResultObservedAt && at <= run.lastResultObservedAt) return;
  const payload = {
    createdAt: instant(input.created_at), scheduledFor: instant(input.scheduled_for),
    completedAt: instant(input.completed_at), bodyText: input.content_text,
    contentTruncated: input.content_truncated === true, chatRef: chatRef(input.chat_ref),
    requiresUserAction: input.requires_user_action === true,
    isFailureMessage: input.is_failure_message === true
  };
  const previous = run.results.find(row => row.revision === run.latestResultRevision);
  // Same run and content is not a new result. Changed flags/link/text create a revision.
  const signature = resultSignature(payload);
  run.lastResultObservedAt = at;
  if (previous && resultSignature(previous) === signature) return;
  // An older source artifact in a later snapshot cannot replace a newer artifact.
  if (previous?.createdAt && (!payload.createdAt || payload.createdAt < previous.createdAt)) return;
  const revision = run.results.length + 1;
  run.results.push({ ...payload, revision, observedAt: at, classification: null });
  run.latestResultRevision = revision;
}

/**
 * Merge one observation without mutating input state.
 * syncStatus error preserves all cached data; missing rows never mean deletion.
 * The task count represents this store's observed scope, not the whole ChatGPT account.
 */
export function ingest(store, observation) {
  assertStore(store);
  if (!object(observation)) throw Error('INVALID_OBSERVATION');
  const { scope, tasks = [], syncStatus = 'ok', errorCode = null } = observation;
  const scopeKey = keyFor(scope);
  const at = requiredInstant(observation.observedAt, 'OBSERVATION_TIME');
  if (!['ok', 'error'].includes(syncStatus) || !Array.isArray(tasks) || tasks.length > 10000) throw Error('INVALID_SNAPSHOT');
  const out = clone(store);
  const bucket = out.scopes[scopeKey] ||= { scope: clone(scope), tasks: {}, sync: {
    status: 'never', lastAttemptAt: null, lastSucceededAt: null, errorCode: null,
    sourceChannel: 'chatgpt-internal-automations-tool'
  } };
  if (!bucket.sync.lastAttemptAt || at > bucket.sync.lastAttemptAt) {
    Object.assign(bucket.sync, { status: syncStatus, lastAttemptAt: at,
      errorCode: syncStatus === 'error' ? String(errorCode || 'sync-unavailable') : null });
  }
  if (syncStatus === 'error') return out;
  if (!bucket.sync.lastSucceededAt || at > bucket.sync.lastSucceededAt) bucket.sync.lastSucceededAt = at;
  for (const input of tasks) {
    if (!object(input)) throw Error('INVALID_TASK');
    const id = identifier(input.id, 'TASK_ID'), key = keyFor(scope, id);
    const task = bucket.tasks[key] ||= newTask(scope, input);
    if (!task.metadataObservedAt || at > task.metadataObservedAt) {
      Object.assign(task, {
        title: typeof input.title === 'string' ? input.title : '',
        enabledState: input.is_enabled === true ? 'enabled' : input.is_enabled === false ? 'disabled' : 'unknown',
        schedule: typeof input.schedule === 'string' ? input.schedule : null,
        timeZone: typeof input.default_timezone === 'string' ? input.default_timezone : null,
        nextRunAt: instant(input.next_run_time), lastRunAt: instant(input.last_run_time),
        taskConversationUrl: conversationUrl({ type: 'chatgpt', id: input.conversation_id }),
        metadataObservedAt: at
      });
    }
    observeRun(task, input.run_details?.last_run, scope, at);
    observeResult(task, input.run_details?.latest_result, scope, at);
  }
  return out;
}

/** Optional explicit classification is tied to an immutable result revision and evidence. */
export function classify(store, input) {
  assertStore(store);
  const at = requiredInstant(input.classifiedAt, 'CLASSIFICATION_TIME');
  if (!OUTCOMES.has(input.outcome) || !object(input.evidence) ||
      !['user', 'structured'].includes(input.evidence.kind)) throw Error('INVALID_CLASSIFICATION');
  identifier(input.evidence.reference, 'CLASSIFICATION_EVIDENCE');
  const out = clone(store), bucket = out.scopes[keyFor(input.scope)];
  const task = bucket?.tasks[keyFor(input.scope, input.taskId)];
  const run = task?.runs[keyFor(input.scope, input.taskId, input.runId)];
  const result = run?.results.find(row => row.revision === input.resultRevision);
  if (!result) throw Error('RESULT_NOT_FOUND');
  if (input.outcome === 'new_information' &&
      (result.isFailureMessage || run.recordedStatus === 'failed')) throw Error('FAILURE_NOT_VALUABLE');
  if (at < result.observedAt) throw Error('CLASSIFICATION_BEFORE_RESULT');
  if (!result.classification || at > result.classification.classifiedAt) {
    result.classification = { outcome: input.outcome, evidence: clone(input.evidence), classifiedAt: at };
  }
  return out;
}
function resultView(run, row, includeBodies) {
  if (!row) return null;
  return {
    runId: run.id, revision: row.revision, createdAt: row.createdAt, observedAt: row.observedAt,
    preview: previewText(row.bodyText), previewKind: 'mechanical_excerpt',
    sourceUrls: sourceUrls(row.bodyText), linkBasis: 'literal_urls_in_output', contentTruncated: row.contentTruncated,
    chatRef: clone(row.chatRef), resultConversationUrl: conversationUrl(row.chatRef),
    requiresUserAction: row.requiresUserAction, isFailureMessage: row.isFailureMessage,
    classification: clone(row.classification),
    ...(includeBodies ? { bodyText: row.bodyText } : {})
  };
}
function taskView(task, includeBodies) {
  const run = task.runs[task.latestRunKey] || null;
  const latest = run?.results.find(row => row.revision === run.latestResultRevision) || null;
  // Same ID alone is insufficient after a retry reuses that ID.
  const current = latest && run.startedAt && latest.createdAt && latest.createdAt >= run.startedAt ? latest : null;
  const all = Object.values(task.runs).flatMap(r => r.results.map(row => ({ run: r, row })))
    .sort((a, b) => (b.row.createdAt || b.row.observedAt).localeCompare(a.row.createdAt || a.row.observedAt) ||
      b.row.observedAt.localeCompare(a.row.observedAt) || b.row.revision - a.row.revision);
  const available = all[0] || null;
  const valuable = all.find(({ run: r, row }) => row.classification?.outcome === 'new_information' &&
    !row.isFailureMessage && r.recordedStatus !== 'failed') || null;
  const declared = current?.classification?.outcome || 'unclassified';
  let displayState = 'awaiting_result';
  if (run?.recordedStatus === 'failed' || current?.isFailureMessage || declared === 'failed') displayState = 'failed';
  else if (run?.recordedStatus === 'no_update' || declared === 'no_new_information') displayState = 'no_update';
  else if (current && run?.recordedStatus === 'completed') {
    displayState = declared === 'new_information' ? 'new_result' : 'output_available';
  }
  return {
    taskId: task.id, title: task.title, enabledState: task.enabledState,
    schedule: task.schedule, timeZone: task.timeZone, nextRunAt: task.nextRunAt,
    lastRunAt: task.lastRunAt, taskConversationUrl: task.taskConversationUrl,
    metadataObservedAt: task.metadataObservedAt,
    latestRunId: run?.id || null, recordedStatus: run?.recordedStatus || 'unknown',
    runStartedAt: run?.startedAt || null, runCompletedAt: run?.completedAt || null,
    runObservedAt: run?.statusObservedAt || null,
    displayState, businessOutcome: declared,
    currentResult: resultView(run, current, includeBodies),
    latestAvailableResult: available ? resultView(available.run, available.row, includeBodies) : null,
    lastValuableResult: valuable ? resultView(valuable.run, valuable.row, includeBodies) : null,
    runCount: Object.keys(task.runs).length,
    resultRevisionCount: all.length
  };
}

/** Life mode returns no account, title, count, timestamp or summary. */
export function project(store, scope, { mode = 'workspace', now = null, staleAfterMs = 3600000, includeBodies = false } = {}) {
  if (mode === 'life') return { hidden: true };
  if (mode !== 'workspace') throw Error('INVALID_MODE');
  assertStore(store);
  const bucket = store.scopes[keyFor(scope)];
  if (!bucket) return { hidden: false, taskCount: 0, countBasis: 'cached_observed_tasks', tasks: [],
    sync: { status: 'never', lastAttemptAt: null, lastSucceededAt: null }, freshness: 'unknown' };
  const clock = instant(now), synced = bucket.sync.lastSucceededAt;
  const freshness = !clock || !synced ? 'unknown' : clock < synced ? 'clock_inconsistent'
    : Date.parse(clock) - Date.parse(synced) > staleAfterMs ? 'stale' : 'fresh';
  const tasks = Object.values(bucket.tasks).map(task => taskView(task, includeBodies))
    .sort((a, b) => a.taskId.localeCompare(b.taskId));
  return { hidden: false, taskCount: tasks.length, countBasis: 'cached_observed_tasks',
    tasks, sync: clone(bucket.sync), freshness };
}
