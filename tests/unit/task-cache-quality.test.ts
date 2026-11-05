import test from 'node:test';
import assert from 'node:assert/strict';
import { indexedDB } from 'fake-indexeddb';
import { initialState, TaskDatabase, TASK_DATABASE } from '../../src/tasks/database.js';
import { applyPacket, projectTaskResult, projectTasks, taskKey } from '../../src/tasks/state.js';
import { taskResults } from '../../src/tasks/source.js';
import { ingest } from '../../research/chatgpt-tasks/result-model.mjs';
import type { NativeTask, SourcePacket, TaskState } from '../../src/tasks/types.js';

Object.defineProperty(globalThis, 'indexedDB', { value: indexedDB, configurable: true, writable: true });
const principal = 'principal:' + 'c'.repeat(64), otherPrincipal = 'principal:' + 'd'.repeat(64);
const at = '2026-11-05T01:00:00.000Z', later = '2026-11-05T02:00:00.000Z';
const cid = '00000000-0000-4000-8000-000000000001';
const task: NativeTask = { id: 'cache-quality', title: 'Synthetic cached report', is_enabled: true,
  schedule: null, default_timezone: 'UTC', next_run_time: null, last_run_time: at,
  conversation_id: cid, team_id: null };
const body = 'SYNTHETIC PRIVATE BODY '.repeat(4000) + 'TAIL_NEVER_IN_HOMEPAGE_PROJECTION';
const list = (tasks: NativeTask[] = [task]): SourcePacket => ({ kind: 'list', filter: 'scheduled', firstPage: true,
  cursor: null, tasks, observedAt: at, pageHref: 'https://chatgpt.com/scheduled' });
const results: Extract<SourcePacket, {kind:'results'}> = { kind: 'results', taskId: task.id, conversationId: cid, observedAt: later,
  pageHref: `https://chatgpt.com/c/${cid}?automationId=${task.id}`, results: [{ taskId: task.id, conversationId: cid,
    messageId: 'final-message', turnId: 'final-turn', createdAt: at, body, complete: true }] };
function fixture(): TaskState {
  const state = initialState(); state.principal = principal; state.settings.enabled = true;
  return applyPacket(applyPacket(state, principal, list()), principal, results);
}

test('homepage and polling projections are body-free while detail remains exact', async () => {
  const db = new TaskDatabase(); await db.update(() => fixture());
  const snapshot = await db.readSnapshot(), control = await db.readControl();
  assert.equal(snapshot.principal, principal);
  assert.equal(snapshot.tasks[0].latestAvailableResult?.preview.length, 180);
  assert.ok(!JSON.stringify(snapshot).includes('bodyText'));
  assert.ok(!JSON.stringify(snapshot).includes('TAIL_NEVER_IN_HOMEPAGE_PROJECTION'));
  assert.ok(!('model' in control)); assert.ok(!('sourceEvidence' in control));
  assert.equal(projectTasks(await db.read(), true)[0].latestAvailableResult?.bodyText, body);
  assert.ok(JSON.stringify(snapshot).length < 5000);
});

test('identity switch and projection invalidation commit together; rollback preserves both', async () => {
  const db = new TaskDatabase(); await db.update(() => fixture());
  await assert.rejects(db.update(state => { state.principal = otherPrincipal; state.generation++; throw Error('rollback'); }), /rollback/);
  assert.equal((await db.readSnapshot()).principal, principal);
  assert.equal((await db.readSnapshot()).tasks.length, 1);
  await db.update(state => { state.principal = otherPrincipal; state.generation++; return state; });
  assert.equal((await db.readSnapshot()).principal, otherPrincipal);
  assert.deepEqual((await db.readSnapshot()).tasks, []);
  assert.equal((await db.readControl()).generation, (await db.readSnapshot()).generation);
  assert.equal(Object.keys((await db.read()).catalog).length, 1);
  await db.update(state => { state.principal = principal; state.generation++; return state; });
  assert.equal((await db.readSnapshot()).tasks[0].title, task.title);
});

test('old installations hydrate projections without resetting settings or cached outputs', async () => {
  const connection = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(TASK_DATABASE, 1); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  const state = fixture(); state.settings.showWidget = false; state.settings.automatic = false;
  const tx = connection.transaction('state', 'readwrite'), store = tx.objectStore('state');
  store.put(state, 'current'); store.delete('snapshot-v1'); store.delete('control-v1');
  await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); }); connection.close();
  const db = new TaskDatabase(), snapshot = await db.readSnapshot();
  assert.equal(snapshot.settings.showWidget, false); assert.equal(snapshot.settings.automatic, false);
  assert.equal(snapshot.tasks[0].latestAvailableResult?.runId, 'turn:final-turn');
  assert.equal(projectTasks(await db.read(), true)[0].latestAvailableResult?.bodyText, body);
});

test('sync-only errors keep the same readable projection; explicit empty selection is respected', async () => {
  const db = new TaskDatabase(); await db.update(() => fixture());
  const before = (await db.readSnapshot()).tasks;
  await db.update(state => { state.sync.status = 'error'; state.sync.code = 'NETWORK_ERROR'; return state; });
  const snapshot = await db.readSnapshot(); assert.deepEqual(snapshot.tasks, before); assert.equal(snapshot.sync.code, 'NETWORK_ERROR');
  await db.update(state => { state.settings.selections[principal] = []; return state; });
  assert.equal((await db.readSnapshot()).tasks[0].selected, false);
});

test('batched task ingestion matches the unchanged PR7 model across team scopes', () => {
  const state = initialState(); state.principal = principal;
  const tasks = Array.from({ length: 20 }, (_, i) => ({ ...task, id: 'task-' + i, team_id: i % 2 ? 'team' : null }));
  let expected = state.model;
  for (const entry of tasks) expected = ingest(expected, { scope: { provider: 'chatgpt', profileId: 'browser-profile',
    accountId: principal + ':' + (entry.team_id || 'personal') }, observedAt: at, tasks: [entry] });
  applyPacket(state, principal, list(tasks));
  for (const bucket of Object.values(expected.scopes)) (bucket as any).sync.sourceChannel = 'chatgpt-native-page';
  assert.deepEqual(state.model, expected);
  assert.ok(state.catalog[taskKey(principal, tasks[0])]);
});

test('a batch of output history retains every turn and does not duplicate reread versions', () => {
  const state = fixture();
  const packet = { ...results, observedAt: '2026-11-05T03:00:00.000Z', results: Array.from({ length: 20 }, (_, i) => ({
    ...results.results[0], messageId: 'message-' + i, turnId: 'turn-' + i, createdAt: new Date(Date.parse(at) + i * 1000).toISOString(), body: 'Report ' + i,
  })) };
  applyPacket(state, principal, packet);
  applyPacket(state, principal, { ...packet, observedAt: '2026-11-05T04:00:00.000Z' });
  const bucket: any = Object.values(state.model.scopes)[0], saved: any = Object.values(bucket.tasks)[0];
  assert.equal(Object.keys(saved.runs).length, 21);
  assert.ok(Object.values(saved.runs).every((run: any) => run.results.length === 1));
  assert.equal(projectTasks(state, true)[0].latestAvailableResult?.bodyText, 'Report 19');
});

test('an open excerpt reads its exact old revision after a new output; account boundaries still apply', () => {
  const state = fixture(), key = taskKey(principal, task);
  applyPacket(state, principal, { ...results, observedAt: '2026-11-05T03:00:00.000Z', results: [{ ...results.results[0],
    body: 'New revised text', createdAt: later,
  }] });
  const before = JSON.stringify(state.model);
  assert.equal(projectTasks(state, true)[0].latestAvailableResult?.bodyText, 'New revised text');
  assert.equal(projectTaskResult(state, key, 'turn:final-turn', 1)?.bodyText, body);
  assert.equal(projectTaskResult(state, key, 'turn:final-turn', 2)?.bodyText, 'New revised text');
  assert.equal(projectTaskResult(state, key, 'turn:final-turn', 3), null);
  assert.equal(JSON.stringify(state.model), before);
  state.principal = otherPrincipal;
  assert.equal(projectTaskResult(state, key, 'turn:final-turn', 1), null);
});

test('broken native source structure cannot masquerade as a successful empty read', () => {
  const base: any = { conversation_id: cid, current_node: 'n', mapping: { n: { parent: null, message: null } } };
  assert.deepEqual(taskResults(base, task.id, cid), []);
  for (const data of [ { ...base, current_node: 'missing' }, { ...base, mapping: { n: { parent: 'missing' } } },
    { ...base, mapping: { n: { parent: 'n' } } }, { ...base, mapping: { n: {} } } ]) {
    assert.throws(() => taskResults(data, task.id, cid), /SOURCE_CHANGED/);
  }
  const final = { id: 'n', author: { role: 'assistant' }, channel: 'final', recipient: 'all', end_turn: true,
    status: 'finished_successfully', create_time: 1793840400, content: { content_type: 'changed-format', parts: ['text'] },
    metadata: { automation_id: task.id, is_complete: true } };
  assert.throws(() => taskResults({ ...base, mapping: { n: { parent: null, message: final } } }, task.id, cid), /SOURCE_CHANGED/);
});
