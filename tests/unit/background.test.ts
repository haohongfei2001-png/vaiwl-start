import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { createRepository } from '../../src/storage/repository.js';
import { createHistoryJob, stepHistoryImport, type HistoryJob, type HistoryPort } from '../../src/background/import-history.js';
import { parseEnvelope, trustedExtensionSender, trustedCollectorSender, publicError } from '../../src/shared/protocol.js';
import { openFromStart } from '../../src/background/open-broker.js';

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, '0')}`;
const url = (n: number) => `https://chatgpt.com/c/${uuid(n)}`;
const setup = () => createRepository({ indexedDB: new IDBFactory(), name: crypto.randomUUID(), timeZone: 'Asia/Shanghai' });
const emptyHistory: HistoryPort = { search: async () => [], getVisits: async () => [{ isLocal: true }] };

test('D01/D02 real import algorithm splits full ranges with overlap, drains 200-write batches and survives repository reopen', async () => {
  const factory = new IDBFactory(), name = crypto.randomUUID();
  let repo = await createRepository({ indexedDB: factory, name, timeZone: 'Asia/Shanghai' });
  const job = createHistoryJob('all', false, 10000); await repo.saveImportJob(job);
  const calls: Array<{ text: string; startTime: number; endTime: number; maxResults: number }> = [];
  const history: HistoryPort = {
    search: async q => {
      calls.push(q);
      if (q.text === 'chat.openai.com') return [];
      if (q.startTime === 0 && q.endTime === 10001) return Array.from({ length: 500 }, (_, i) => ({ url: url(i), title: 'Synthetic' }));
      return Array.from({ length: 300 }, (_, i) => ({ url: url(i + (q.startTime === 0 ? 0 : 250)), title: 'Synthetic', lastVisitTime: 100 }));
    }, getVisits: emptyHistory.getVisits,
  };
  let current = await stepHistoryImport(repo, history, job.id);
  assert.equal(current.pendingIntervals.length, 3);
  assert.equal((await repo.getSnapshot('unassigned')).conversations.length, 0);
  current = await stepHistoryImport(repo, history, job.id);
  assert.equal((await repo.getSnapshot('unassigned')).conversations.length, 200);
  assert.equal(current.pendingCandidates.length, 100);
  repo.close(); repo = await createRepository({ indexedDB: factory, name });
  for (let n = 0; n < 10 && current.state === 'running'; n++) current = await stepHistoryImport(repo, history, job.id);
  const catalog = await repo.getSnapshot('unassigned');
  assert.equal(current.state, 'complete'); assert.equal(catalog.conversations.length, 550);
  assert.ok(catalog.conversations.every(c => c.activity === null && c.owner.kind === 'unassigned' && c.membership.state === 'UNKNOWN'));
  assert.ok(calls.every(q => q.maxResults === 500));
  assert.ok(calls.some(q => q.startTime === 5000) && calls.some(q => q.endTime === 5001));
  repo.close();
});

test('D02 minimum saturated time slice is PARTIAL rather than fake completeness', async () => {
  const repo = await setup(), job = createHistoryJob('all', false, 1);
  job.pendingIntervals = [{ startMs: 0, endMs: 1, query: 'chatgpt.com' }];
  await repo.saveImportJob(job);
  const history: HistoryPort = { ...emptyHistory, search: async () => Array.from({ length: 500 }, (_, i) => ({ url: url(i) })) };
  let current: HistoryJob = job;
  for (let n = 0; n < 4 && current.state === 'running'; n++) current = await stepHistoryImport(repo, history, job.id);
  assert.equal(current.state, 'partial'); assert.equal(current.saturatedIntervals.length, 1);
  assert.equal((await repo.getSnapshot()).conversations.length, 500); repo.close();
});

test('D04/D05 importer filters unrelated URLs before getVisits, excludes pure sync by default, retains unknown origin and titles safely', async () => {
  const repo = await setup(), job = createHistoryJob('all', false, 1000);
  job.pendingIntervals = [{ startMs: 0, endMs: 1000, query: 'chatgpt.com' }]; await repo.saveImportJob(job);
  const calls: string[] = [];
  const history: HistoryPort = { search: async () => [ { url: 'https://chatgpt.com.evil.invalid/c/' + uuid(1), title: 'must not persist' }, { url: 'https://example.invalid/?chatgpt.com', title: 'private unrelated' }, { url: url(1), title: 'sync' }, { url: url(2), title: '<img src=x onerror=alert(1)>' }, { url: url(3) } ], getVisits: async ({ url: target }) => { calls.push(target); return target === url(1) ? [{ isLocal: false }] : target === url(2) ? [{}] : [{ isLocal: true }]; } };
  const result = await stepHistoryImport(repo, history, job.id), catalog = await repo.getSnapshot();
  assert.deepEqual(calls, [url(1), url(2), url(3)]); assert.equal(catalog.conversations.length, 2);
  assert.equal(result.rejectedUrls, 2); assert.equal(catalog.conversations.find(c => c.conversationId === uuid(3))!.nativeTitle, null);
  assert.equal(JSON.stringify(catalog).includes('private unrelated'), false);
  assert.ok(catalog.conversations.every(c => c.activity === null)); repo.close();
});

test('D02/D08 paused and cancelled imports do no work; transport failure retains checkpoint', async () => {
  const repo = await setup(), job = createHistoryJob('recent90', false);
  job.state = 'paused'; await repo.saveImportJob(job);
  const history: HistoryPort = { ...emptyHistory, search: async () => { throw Error('sensitive API failure payload'); } };
  assert.equal((await stepHistoryImport(repo, history, job.id)).state, 'paused');
  job.state = 'running'; await repo.saveImportJob(job);
  const result = await stepHistoryImport(repo, history, job.id);
  assert.equal(result.state, 'partial'); assert.equal(result.pendingIntervals.length, 2); assert.equal(result.failureCode, 'history-api-failed');
  assert.equal(JSON.stringify(result).includes('sensitive'), false); repo.close();
});

test('D05 a sync-only alias cannot hide a later local alias of the same conversation', async () => {
  const repo = await setup(), job = createHistoryJob('all', false, 1000);
  job.pendingIntervals = [{ startMs: 0, endMs: 1000, query: 'chatgpt.com' }]; await repo.saveImportJob(job);
  const legacy = `https://chat.openai.com/c/${uuid(7)}`;
  const history: HistoryPort = { search: async () => [{ url: url(7) }, { url: legacy, title: 'local alias' }], getVisits: async ({ url: target }) => [{ isLocal: target === legacy }] };
  await stepHistoryImport(repo, history, job.id);
  const catalog = await repo.getSnapshot(); assert.equal(catalog.conversations.length, 1); assert.equal(catalog.conversations[0]!.nativeTitle, 'local alias'); repo.close();
});

test('D12 IPC rejects unknown fields, invented authority, subframes, stale lifecycle and foreign documents', () => {
  const good = { protocol: 'vaiwl-start-internal/1', operationId: 'synthetic-1', expectedRevision: 0, command: 'SNAPSHOT', payload: {} };
  assert.equal(parseEnvelope(good).command, 'SNAPSHOT');
  for (const bad of [{ ...good, verified: true }, { ...good, expectedRevision: -1 }, { ...good, payload: [] }, { ...good, protocol: 'foreign' }]) assert.throws(() => parseEnvelope(bad));
  const sender = { id: 'synthetic', url: 'chrome-extension://synthetic/newtab.html', frameId: 0, documentId: 'doc', documentLifecycle: 'active', tab: { id: 1 } } as chrome.runtime.MessageSender;
  assert.equal(trustedExtensionSender(sender, 'synthetic'), true);
  for (const patch of [{ frameId: 1 }, { url: 'https://chatgpt.com' }, { documentLifecycle: 'prerender' }, { id: 'other-extension' }]) assert.equal(trustedExtensionSender({ ...sender, ...patch } as chrome.runtime.MessageSender, 'synthetic'), false);
  assert.equal(trustedCollectorSender({ ...sender, url: url(1) }, 'synthetic'), true);
  assert.equal(trustedCollectorSender({ ...sender, url: 'https://chatgpt.com.evil.invalid/' }, 'synthetic'), false);
  assert.equal(publicError(Error('token PRIVATE')), 'REQUEST_FAILED');
});

test('O06 concurrent duplicate operation opens one browser tab and persisted replay cannot navigate twice', async () => {
  const repo = await setup(); await repo.discoverCandidates([{ url: url(99), title: 'synthetic open' }]);
  const record = (await repo.getSnapshot()).conversations[0]!;
  const saved: Record<string, unknown> = {};
  let creates = 0, navigations = 0;
  const before = (globalThis as any).chrome;
  (globalThis as any).chrome = { storage: { session: { get: async (key: string) => ({ [key]: saved[key] }), set: async (value: any) => Object.assign(saved, value) } }, tabs: { create: async () => { creates++; return { id: 777 }; }, update: async () => { navigations++; return { id: 777 }; } } };
  const sender = { documentId: 'start-doc', tab: { id: 1 } } as chrome.runtime.MessageSender;
  const payload = { recordKey: record.key, disposition: 'new-background-tab', gesture: 'auxclick' } as const;
  try {
    await Promise.all([openFromStart(repo, sender, 'operation-once', payload), openFromStart(repo, sender, 'operation-once', payload)]);
    await openFromStart(repo, sender, 'operation-once', payload);
    assert.equal(creates, 1); assert.equal(navigations, 1);
    assert.equal((await repo.listIntents()).length, 1); assert.equal((await repo.getSnapshot()).conversations[0]!.activity, null);
    await assert.rejects(openFromStart(repo, sender, 'operation-once', { ...payload, disposition: 'new-window' }), /INVALID_MESSAGE/);
  } finally { (globalThis as any).chrome = before; repo.close(); }
});
