import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore, ingest, project, classify, previewText, sourceUrls } from './result-model.mjs';

// Every name, identifier, timestamp and result below is synthetic test data.
const SCOPE = { provider: 'chatgpt', profileId: 'fixture-profile', accountId: 'fixture-account' };
const at = minute => new Date(Date.UTC(2026, 0, 1) + minute * 60000).toISOString();
const copy = value => JSON.parse(JSON.stringify(value));
function fixture() {
  return { id: 'fixture-task', title: 'Synthetic monitoring task', is_enabled: true,
    schedule: 'BEGIN:VEVENT\nRRULE:FREQ=DAILY;BYHOUR=8;BYMINUTE=0\nEND:VEVENT',
    default_timezone: 'Asia/Shanghai', next_run_time: null, last_run_time: at(1),
    conversation_id: '00000000-0000-0000-0000-000000000001',
    run_details: {
      last_run: { id: 'fixture-run-a', recorded_status: 'completed',
        scheduled_for: at(0), started_at: at(1), completed_at: at(2),
        chat_ref: { type: 'chatgpt', id: '00000000-0000-0000-0000-000000000002' } },
      latest_result: { run_id: 'fixture-run-a', created_at: at(2),
        scheduled_for: at(0), completed_at: at(2),
        content_text: 'Synthetic finding. [Source](https://example.test/release)',
        content_truncated: false, requires_user_action: false, is_failure_message: false,
        chat_ref: { type: 'chatgpt', id: '00000000-0000-0000-0000-000000000002' } },
      delivery_status: 'unknown'
    }
  };
}
const observe = (store, task, time = 3, scope = SCOPE) =>
  ingest(store, { scope, observedAt: at(time), tasks: [task] });
const read = (store, scope = SCOPE, options = {}) =>
  project(store, scope, { now: at(4), includeBodies: true, ...options });
const first = store => read(store).tasks[0];
function marked(store, outcome = 'new_information', revision = 1, time = 4) {
  return classify(store, { scope: SCOPE, taskId: 'fixture-task', runId: 'fixture-run-a',
    resultRevision: revision, outcome, classifiedAt: at(time),
    evidence: { kind: 'user', reference: 'synthetic-explicit-review' } });
}
function anotherRun(task, id, status, time) {
  task.run_details.last_run = { id, recorded_status: status, scheduled_for: at(time),
    started_at: at(time), completed_at: status === 'in_progress' ? null : at(time + 1), chat_ref: null };
  return task;
}

test('completed with text is available output, not proven business success', () => {
  const task = first(observe(createStore(), fixture()));
  assert.equal(task.displayState, 'output_available');
  assert.equal(task.businessOutcome, 'unclassified');
  assert.equal(task.lastValuableResult, null);
  assert.equal(task.currentResult.bodyText, fixture().run_details.latest_result.content_text);
});

test('two independent identical observations deduplicate and do not mutate input', () => {
  const one = observe(createStore(), fixture()), before = JSON.stringify(one);
  const two = observe(one, fixture(), 4);
  assert.equal(JSON.stringify(one), before);
  assert.equal(first(two).runCount, 1);
  assert.equal(first(two).resultRevisionCount, 1);
});

test('body change on the same run produces a revision, not a duplicate run', () => {
  const one = observe(createStore(), fixture()), changed = fixture();
  changed.run_details.latest_result.content_text = 'Synthetic revised finding.';
  const two = observe(one, changed, 5);
  assert.equal(first(two).runCount, 1);
  assert.equal(first(two).resultRevisionCount, 2);
  assert.equal(first(two).currentResult.revision, 2);
  assert.equal(first(two).currentResult.bodyText, 'Synthetic revised finding.');
});

test('conflicting observations with an equal sampling timestamp do not overwrite', () => {
  const one = observe(createStore(), fixture()), changed = fixture();
  changed.title = 'Ambiguous late title';
  changed.run_details.latest_result.content_text = 'Ambiguous late body';
  const two = observe(one, changed, 3);
  assert.equal(first(two).title, fixture().title);
  assert.equal(first(two).resultRevisionCount, 1);
});

test('late old response does not undo retry state, disabled metadata or result body', () => {
  let store = observe(createStore(), fixture());
  const retry = anotherRun(fixture(), 'fixture-run-a', 'in_progress', 8);
  retry.is_enabled = false;
  store = observe(store, retry, 10);
  store = observe(store, fixture(), 4);
  const task = first(store);
  assert.equal(task.enabledState, 'disabled');
  assert.equal(task.recordedStatus, 'in_progress');
  assert.equal(task.runStartedAt, at(8));
  assert.equal(task.currentResult, null);
});

test('older artifact returned by a newer request cannot replace a newer artifact', () => {
  const fresh = fixture(); fresh.run_details.latest_result.created_at = at(5);
  fresh.run_details.latest_result.content_text = 'Newer source artifact';
  let store = observe(createStore(), fresh, 6);
  store = observe(store, fixture(), 7);
  assert.equal(first(store).currentResult.bodyText, 'Newer source artifact');
  assert.equal(first(store).resultRevisionCount, 1);
});

test('a result from a different run is historical and cannot fulfill the current run', () => {
  const task = anotherRun(fixture(), 'fixture-run-b', 'completed', 6);
  const view = first(observe(createStore(), task, 8));
  assert.equal(view.latestRunId, 'fixture-run-b');
  assert.equal(view.currentResult, null);
  assert.equal(view.displayState, 'awaiting_result');
  assert.equal(view.latestAvailableResult.runId, 'fixture-run-a');
});

test('retry reusing a run ID requires result creation after its new start', () => {
  let store = observe(createStore(), fixture());
  const retry = anotherRun(fixture(), 'fixture-run-a', 'completed', 6);
  store = observe(store, retry, 8);
  assert.equal(first(store).currentResult, null);
  assert.equal(first(store).displayState, 'awaiting_result');
  assert.equal(first(store).runCount, 1);
});

test('missing run start does not establish result-to-attempt correspondence', () => {
  const task = fixture(); task.run_details.last_run.started_at = null;
  assert.equal(first(observe(createStore(), task)).currentResult, null);
  assert.equal(first(observe(createStore(), task)).displayState, 'awaiting_result');
});

test('no_update preserves the previously classified valuable result', () => {
  let store = marked(observe(createStore(), fixture()));
  const task = anotherRun(fixture(), 'fixture-run-b', 'no_update', 8);
  store = observe(store, task, 10);
  assert.equal(first(store).displayState, 'no_update');
  assert.equal(first(store).lastValuableResult.runId, 'fixture-run-a');
  assert.equal(first(store).currentResult, null);
});

test('a failed later run keeps its body and the older valuable result', () => {
  let store = marked(observe(createStore(), fixture()));
  const task = anotherRun(fixture(), 'fixture-run-b', 'failed', 8);
  Object.assign(task.run_details.latest_result, { run_id: 'fixture-run-b', created_at: at(9),
    content_text: 'Synthetic failure explanation', is_failure_message: true });
  store = observe(store, task, 10);
  assert.equal(first(store).displayState, 'failed');
  assert.equal(first(store).currentResult.bodyText, 'Synthetic failure explanation');
  assert.equal(first(store).lastValuableResult.runId, 'fixture-run-a');
});

test('explicit failure flag prevents promotion even if platform says completed', () => {
  const task = fixture(); task.run_details.latest_result.is_failure_message = true;
  const store = observe(createStore(), task);
  assert.equal(first(store).displayState, 'failed');
  assert.throws(() => marked(store), /FAILURE_NOT_VALUABLE/);
});

test('failure-like prose alone does not silently classify business outcome', () => {
  const task = fixture();
  task.run_details.latest_result.content_text = 'Synthetic external write returned AUTH_FORBIDDEN.';
  const view = first(observe(createStore(), task));
  assert.equal(view.recordedStatus, 'completed');
  assert.equal(view.currentResult.isFailureMessage, false);
  assert.equal(view.displayState, 'output_available');
  assert.equal(view.businessOutcome, 'unclassified');
  assert.equal(view.lastValuableResult, null);
});

test('evidence-backed new information permits the stronger display label', () => {
  const task = first(marked(observe(createStore(), fixture())));
  assert.equal(task.displayState, 'new_result');
  assert.equal(task.lastValuableResult.revision, 1);
  assert.equal(task.currentResult.classification.evidence.kind, 'user');
});

test('explicit no-new-information classification separates it from failure', () => {
  const task = first(marked(observe(createStore(), fixture()), 'no_new_information'));
  assert.equal(task.displayState, 'no_update');
  assert.equal(task.recordedStatus, 'completed');
  assert.equal(task.lastValuableResult, null);
});

test('classification is bound to a revision and never transfers to edited text', () => {
  let store = marked(observe(createStore(), fixture()));
  const changed = fixture(); changed.run_details.latest_result.content_text = 'Different synthetic result';
  store = observe(store, changed, 5);
  assert.equal(first(store).currentResult.revision, 2);
  assert.equal(first(store).currentResult.classification, null);
  assert.equal(first(store).displayState, 'output_available');
  assert.equal(first(store).lastValuableResult.revision, 1);
});

test('account and profile switches cannot read the previous scope', () => {
  let store = observe(createStore(), fixture());
  const account = { ...SCOPE, accountId: 'other-fixture-account' };
  const profile = { ...SCOPE, profileId: 'other-fixture-profile' };
  assert.equal(read(store, account).taskCount, 0);
  assert.equal(read(store, profile).taskCount, 0);
  const task = fixture(); task.title = 'Second account fixture';
  store = observe(store, task, 5, account);
  assert.equal(read(store, account).tasks[0].title, 'Second account fixture');
  assert.equal(first(store).title, fixture().title);
});

test('life mode returns no title, count, summary, account or timestamps', () => {
  const store = observe(createStore(), fixture());
  assert.deepEqual(project(store, SCOPE, { mode: 'life' }), { hidden: true });
});

test('sync failure preserves cached output and differs from task execution failure', () => {
  let store = observe(createStore(), fixture());
  store = ingest(store, { scope: SCOPE, observedAt: at(5), syncStatus: 'error', errorCode: 'synthetic-offline' });
  const view = read(store, SCOPE, { now: at(100) });
  assert.equal(view.sync.status, 'error');
  assert.equal(view.sync.lastSucceededAt, at(3));
  assert.equal(view.freshness, 'stale');
  assert.equal(view.tasks[0].displayState, 'output_available');
});

test('disabled is not inferred pause or deletion, and null next-run stays unknown', () => {
  const task = fixture(); task.is_enabled = false;
  const view = first(observe(createStore(), task));
  assert.equal(view.enabledState, 'disabled');
  assert.equal(view.nextRunAt, null);
  assert.equal(Object.hasOwn(view, 'paused'), false);
  assert.equal(view.schedule, task.schedule);
});

test('offset times normalize without changing schedule timezone or inferring next run', () => {
  const task = fixture();
  task.next_run_time = '2026-01-02T08:00:00+08:00';
  const view = first(observe(createStore(), task));
  assert.equal(view.nextRunAt, '2026-01-02T00:00:00.000Z');
  assert.equal(view.timeZone, 'Asia/Shanghai');
});

test('missing or unsupported result chat ref never falls back to the task ID or task URL', () => {
  const task = fixture(); task.run_details.latest_result.chat_ref = null;
  let view = first(observe(createStore(), task));
  assert.ok(view.taskConversationUrl);
  assert.equal(view.currentResult.resultConversationUrl, null);
  task.run_details.latest_result.chat_ref = { type: 'codex', id: 'synthetic-codex-reference' };
  view = first(observe(createStore(), task));
  assert.equal(view.currentResult.resultConversationUrl, null);
});

test('opaque citations remain in body but do not become invented source URLs', () => {
  const task = fixture();
  const body = 'Synthetic evidence \ue200cite\ue202turn9search2\ue201. [Official](https://example.test/item?q=1) javascript:alert(1)';
  task.run_details.latest_result.content_text = body;
  const result = first(observe(createStore(), task)).currentResult;
  assert.equal(result.bodyText, body);
  assert.equal(result.preview.includes('turn9search2'), false);
  assert.deepEqual(result.sourceUrls, ['https://example.test/item?q=1']);
});

test('raw HTML is stored as text while preview strips tags and image markup', () => {
  const task = fixture();
  const body = '<img src="https://example.test/image.png" onerror="bad()">Synthetic <b>result</b>.';
  task.run_details.latest_result.content_text = body;
  const result = first(observe(createStore(), task)).currentResult;
  assert.equal(result.bodyText, body);
  assert.equal(result.preview.includes('<'), false);
  assert.equal(result.preview.includes('onerror'), false);
});

test('long or source-truncated output remains explicit and body is not shortened', () => {
  const task = fixture(); task.run_details.latest_result.content_text = 'x'.repeat(2000);
  task.run_details.latest_result.content_truncated = true;
  const result = first(observe(createStore(), task)).currentResult;
  assert.equal(result.bodyText.length, 2000);
  assert.equal(result.preview.length, 180);
  assert.equal(result.contentTruncated, true);
});

test('an empty observation is not deletion or an authoritative account total', () => {
  let store = observe(createStore(), fixture());
  store = ingest(store, { scope: SCOPE, observedAt: at(5), tasks: [] });
  assert.equal(read(store).taskCount, 1);
  assert.equal(read(store).countBasis, 'cached_observed_tasks');
});

test('classification without evidence or against an unknown revision is rejected', () => {
  const store = observe(createStore(), fixture());
  assert.throws(() => classify(store, { scope: SCOPE, classifiedAt: at(4),
    outcome: 'new_information', evidence: null }), /INVALID_CLASSIFICATION/);
  assert.throws(() => marked(store, 'new_information', 99), /RESULT_NOT_FOUND/);
});

test('terminal status cannot regress within the same attempt but a new retry can run', () => {
  let store = observe(createStore(), fixture());
  const late = fixture(); late.run_details.last_run.recorded_status = 'in_progress';
  store = observe(store, late, 5);
  assert.equal(first(store).recordedStatus, 'completed');
  const retry = anotherRun(fixture(), 'fixture-run-a', 'in_progress', 8);
  store = observe(store, retry, 10);
  assert.equal(first(store).recordedStatus, 'in_progress');
  assert.equal(first(store).currentResult, null);
});

test('missing creation time cannot satisfy the current attempt', () => {
  const task = fixture(); task.run_details.latest_result.created_at = null;
  assert.equal(first(observe(createStore(), task)).currentResult, null);
});

test('source URL extraction excludes credentials, executable schemes and opaque citations', () => {
  assert.deepEqual(sourceUrls('https://user:pass@example.test/private javascript:alert(1) data:text/html,bad \ue200cite\ue202id\ue201'), []);
  assert.equal(previewText('**Synthetic**'), 'Synthetic');
});

test('JSON serialization and restoration retain all cache and classification records', () => {
  const store = marked(observe(createStore(), fixture()));
  const restored = JSON.parse(JSON.stringify(store));
  assert.deepEqual(read(restored), read(store));
});

test('older successful synchronization cannot overwrite a newer failure indication', () => {
  let store = observe(createStore(), fixture());
  store = ingest(store, { scope: SCOPE, observedAt: at(10), syncStatus: 'error', errorCode: 'synthetic-login-expired' });
  store = observe(store, fixture(), 5);
  assert.equal(read(store).sync.status, 'error');
  assert.equal(read(store).sync.lastAttemptAt, at(10));
  assert.equal(read(store).sync.lastSucceededAt, at(5));
});

test('URLs inside opaque citation payloads are not promoted into source links', () => {
  assert.deepEqual(sourceUrls('\ue200genui\ue202{"citation":{"ref":"https://example.test/not-an-observed-link"}}\ue201'), []);
});

test('partial metadata refresh exposes the older run observation timestamp', () => {
  let store = observe(createStore(), fixture());
  const partial = fixture(); partial.run_details = null;
  store = observe(store, partial, 5);
  assert.equal(first(store).metadataObservedAt, at(5));
  assert.equal(first(store).runObservedAt, at(3));
});

test('failed retry with the same run ID preserves a valuable earlier attempt', () => {
  let store = marked(observe(createStore(), fixture()));
  const retry = anotherRun(fixture(), 'fixture-run-a', 'failed', 6);
  store = observe(store, retry, 8);
  const task = first(store);
  assert.equal(task.recordedStatus, 'failed');
  assert.equal(task.displayState, 'failed');
  assert.equal(task.currentResult, null);
  assert.equal(task.lastValuableResult.revision, 1);
  assert.equal(task.lastValuableResult.attemptStartedAt, at(1));
  assert.equal(task.lastValuableResult.attemptRecordedStatus, 'completed');
});

test('historical successful-attempt result can be classified after a failed retry', () => {
  let store = observe(createStore(), fixture());
  store = observe(store, anotherRun(fixture(), 'fixture-run-a', 'failed', 6), 8);
  store = marked(store, 'new_information', 1, 9);
  assert.equal(first(store).lastValuableResult.revision, 1);
  assert.equal(first(store).lastValuableResult.attemptRecordedStatus, 'completed');
});

test('failed current-attempt output cannot be promoted even without its failure flag', () => {
  let store = marked(observe(createStore(), fixture()));
  const retry = anotherRun(fixture(), 'fixture-run-a', 'failed', 6);
  Object.assign(retry.run_details.latest_result, {
    created_at: at(7), content_text: 'Synthetic output from the failed retry', is_failure_message: false
  });
  store = observe(store, retry, 8);
  assert.equal(first(store).currentResult.attemptStartedAt, at(6));
  assert.equal(first(store).currentResult.attemptRecordedStatus, 'failed');
  assert.throws(() => marked(store, 'new_information', 2, 9), /FAILURE_NOT_VALUABLE/);
  assert.equal(first(store).lastValuableResult.revision, 1);
});

test('later failure of the same attempt is retained when another retry starts', () => {
  let store = observe(createStore(), fixture());
  const failed = fixture(); failed.run_details.last_run.recorded_status = 'failed';
  store = observe(store, failed, 4);
  store = observe(store, anotherRun(fixture(), 'fixture-run-a', 'in_progress', 6), 7);
  assert.throws(() => marked(store, 'new_information', 1, 8), /FAILURE_NOT_VALUABLE/);
});

test('a partial last-run object does not erase known attempt evidence', () => {
  let store = observe(createStore(), fixture());
  const partial = fixture(); partial.run_details.last_run = { id: 'fixture-run-a' };
  store = observe(store, partial, 5);
  const task = first(store);
  assert.equal(task.recordedStatus, 'completed');
  assert.equal(task.runStartedAt, at(1));
  assert.equal(task.runCompletedAt, at(2));
  assert.equal(task.currentResult.revision, 1);
  assert.equal(task.runObservedAt, at(3));
});

test('unknown fields retain current evidence but an explicit new attempt resets terminal time', () => {
  let store = observe(createStore(), fixture());
  const partial = fixture();
  partial.run_details.last_run = { id: 'fixture-run-a', recorded_status: 'unknown',
    started_at: null, scheduled_for: null, completed_at: null, chat_ref: null };
  store = observe(store, partial, 5);
  assert.equal(first(store).recordedStatus, 'completed');
  assert.equal(first(store).runStartedAt, at(1));
  const retry = fixture();
  retry.run_details.last_run = { id: 'fixture-run-a', started_at: at(6) };
  store = observe(store, retry, 7);
  assert.equal(first(store).recordedStatus, 'unknown');
  assert.equal(first(store).runCompletedAt, null);
  assert.equal(first(store).currentResult, null);
});

test('actual retry start outranks an older schedule when choosing the latest run', () => {
  let store = observe(createStore(), fixture());
  const second = anotherRun(fixture(), 'fixture-run-b', 'completed', 10);
  store = observe(store, second, 12);
  const retry = anotherRun(fixture(), 'fixture-run-a', 'in_progress', 20);
  retry.run_details.last_run.scheduled_for = at(0);
  store = observe(store, retry, 21);
  assert.equal(first(store).latestRunId, 'fixture-run-a');
  assert.equal(first(store).runStartedAt, at(20));
  store = observe(store, second, 13);
  assert.equal(first(store).latestRunId, 'fixture-run-a');
});
