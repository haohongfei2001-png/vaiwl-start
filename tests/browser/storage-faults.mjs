import { chromium } from 'playwright';
import { build } from 'esbuild';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

// Fault injection is confined to a temporary test-only MV3 extension. The module
// below imports the current production Repository/DB unchanged; no harness ships.
async function runStorageFaults() {
  const checks = [], failures = [], databases = [];
  const assert = (condition, message) => { if (!condition) throw Error(message); };
  const openDescriptor = Object.getOwnPropertyDescriptor(indexedDB, 'open');
  const nativeOpen = indexedDB.open.bind(indexedDB);
  const nativePut = IDBObjectStore.prototype.put;
  const restoreOpen = () => { if (openDescriptor) Object.defineProperty(indexedDB, 'open', openDescriptor); else delete indexedDB.open; };
  const overrideOpen = fn => Object.defineProperty(indexedDB, 'open', { value: fn, writable: true, configurable: true });
  const databaseName = suffix => { const name = `vaiwl-d10-${suffix}-${crypto.randomUUID()}`; databases.push(name); return name; };
  const now = () => '2026-11-02T00:00:00.000Z';
  const url = number => `https://chatgpt.com/c/00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
  const options = name => ({ indexedDB, name, timeZone: 'UTC', now });
  const run = async (id, fn) => {
    try { checks.push({ id, status: 'PASS', observed: await fn() }); }
    catch (error) { checks.push({ id, status: 'FAIL', observed: error.message }); failures.push({ id, name: error.name, message: error.message }); }
    finally { restoreOpen(); IDBObjectStore.prototype.put = nativePut; }
  };
  assert(indexedDB instanceof IDBFactory && Function.prototype.toString.call(nativePut).includes('[native code]'), 'Harness must use real browser IndexedDB, not a fake implementation');

  await run('D10-B-initial-upgrade-abort-recovery', async () => {
    const name = databaseName('initial'), repos = []; let interrupted = false, recoveredOldVersion = null;
    try {
      overrideOpen((dbName, version) => {
        const open = nativeOpen(dbName, version);
        open.addEventListener('upgradeneeded', () => queueMicrotask(() => { interrupted = true; open.transaction.abort(); }), { once: true });
        return open;
      });
      let rejection;
      try { await createRepository(options(name)); } catch (error) { rejection = error; }
      assert(interrupted && rejection?.name === 'AbortError', 'Initial v1 upgrade must reject AbortError after injected versionchange abort');
      overrideOpen((dbName, version) => {
        const open = nativeOpen(dbName, version);
        open.addEventListener('upgradeneeded', event => { recoveredOldVersion = event.oldVersion; }, { once: true }); return open;
      });
      const repo = await createRepository(options(name)); repos.push(repo);
      assert(recoveredOldVersion === 0, 'Aborted v1 creation must not leave an installed partial schema');
      const db = await openDatabase(indexedDB, name);
      assert(db.version === 1 && JSON.stringify([...db.objectStoreNames].sort()) === JSON.stringify([...STORE_NAMES].sort()), 'Recovered schema must contain exactly all twelve production stores'); db.close();
      const initial = await repo.getSnapshot();
      assert(initial.revision === 0 && initial.conversations.length === 0, 'Recovered repository must initialize cleanly');
      await repo.discoverCandidates([{ url: url(1), title: 'Synthetic retained after schema recovery' }]);
      const saved = (await repo.getSnapshot()).conversations[0]; repo.close();
      const reopened = await createRepository(options(name)); repos.push(reopened);
      const next = await reopened.getSnapshot();
      assert(next.conversations.length === 1 && next.conversations[0].key === saved.key, 'Reopening recovered v1 must preserve the saved entry');
      return { injectedFault: 'versionchange transaction abort after production store creation', rejectionName: rejection.name, recoveredOldVersion, schemaVersion: 1, storeCount: STORE_NAMES.length, recordsAfterRecoveryAndReopen: 1 };
    } finally { for (const repo of repos) repo.close(); }
  });

  await run('D10-B-concurrent-and-repeated-v1-open', async () => {
    const name = databaseName('idempotent'), repos = []; let upgrades = 0;
    try {
      overrideOpen((dbName, version) => { const open = nativeOpen(dbName, version); open.addEventListener('upgradeneeded', () => { upgrades++; }); return open; });
      const [first, second] = await Promise.all([createRepository(options(name)), createRepository(options(name))]); repos.push(first, second);
      assert(upgrades === 1, 'Concurrent initial opens must create the schema only once');
      const profile = (await first.getSnapshot()).localProfileKey;
      assert((await second.getSnapshot()).localProfileKey === profile, 'Concurrent owners must share the same initialized profile key');
      await first.discoverCandidates([{ url: url(2), title: 'Synthetic unique entry' }]);
      await second.discoverCandidates([{ url: url(2).replace('chatgpt.com', 'chat.openai.com'), title: 'Synthetic unique entry' }]);
      const saved = (await first.getSnapshot()).conversations[0];
      assert((await second.getSnapshot()).conversations.length === 1, 'Alias import through second owner must not duplicate an entity');
      first.close(); second.close();
      for (let index = 0; index < 3; index++) {
        const repo = await createRepository(options(name)); repos.push(repo);
        await repo.discoverCandidates([{ url: url(2), title: 'Synthetic unique entry' }]);
        const snapshot = await repo.getSnapshot();
        assert(snapshot.localProfileKey === profile && snapshot.conversations.length === 1 && snapshot.conversations[0].key === saved.key && snapshot.conversations[0].stableRank === saved.stableRank, 'Repeated existing-v1 requests must preserve profile, identity and rank');
        repo.close();
      }
      assert(upgrades === 1, 'Repeated open(name, 1) must not rerun a committed upgrade');
      return { concurrentInitialOpens: 2, repeatedExistingVersionOpens: 3, upgradeEvents: upgrades, uniqueConversations: 1, profileAndRankPreserved: true };
    } finally { for (const repo of repos) repo.close(); }
  });

  await run('D10-B-quota-rollback-retry-and-replay', async () => {
    const name = databaseName('quota'), repos = [];
    try {
      const repo = await createRepository(options(name)); repos.push(repo);
      await repo.discoverCandidates([{ url: url(3), title: 'Synthetic existing directory entry' }]);
      await repo.saveShortcut({ label: 'Synthetic retained shortcut', url: 'https://example.invalid/retained', pinned: true });
      const before = await repo.getSnapshot(), inputs = [{ url: url(4) }, { url: url(5) }]; let writes = 0;
      IDBObjectStore.prototype.put = function (...args) {
        if (this.name === 'conversations' && ++writes === 2) throw new DOMException('Injected test-only quota failure', 'QuotaExceededError');
        return nativePut.apply(this, args);
      };
      let rejection;
      try { await repo.discoverCandidates(inputs); } catch (error) { rejection = error; }
      finally { IDBObjectStore.prototype.put = nativePut; }
      assert(rejection?.name === 'QuotaExceededError' && writes === 2, 'The second production conversation write must receive the injected quota failure');
      const failed = await repo.getSnapshot();
      assert(failed.revision === before.revision && JSON.stringify(failed.conversations) === JSON.stringify(before.conversations) && JSON.stringify(failed.shortcuts) === JSON.stringify(before.shortcuts), 'Real IDB abort must roll back partial writes and revision without deleting old directory or shortcuts');
      repo.close();
      const reopened = await createRepository(options(name)); repos.push(reopened);
      assert((await reopened.getSnapshot()).conversations.length === 1, 'Reopen after failed transaction must expose no partial entry');
      const retry = await reopened.discoverCandidates(inputs), retried = await reopened.getSnapshot();
      assert(retry.inserted === 2 && retried.conversations.length === 3 && retried.revision === before.revision + 1, 'Actual retry must commit exactly the two previously rolled-back records');
      const replay = await reopened.discoverCandidates(inputs), replayed = await reopened.getSnapshot();
      assert(replay.inserted === 0 && replayed.conversations.length === 3 && new Set(replayed.conversations.map(record => record.conversationId)).size === 3, 'Repeated retry must not create duplicate records');
      assert(JSON.stringify(replayed.conversations.map(record => [record.key, record.stableRank])) === JSON.stringify(retried.conversations.map(record => [record.key, record.stableRank])), 'Replay must preserve stable identity and ranks');
      assert(JSON.stringify(replayed.shortcuts) === JSON.stringify(before.shortcuts), 'Successful retries must preserve existing shortcuts');
      return { injectedFault: 'synchronous QuotaExceededError on second production IDBObjectStore.put', rollbackPreservedRevisionAndExistingData: true, reopenedBeforeRetryRecords: 1, retryInserted: retry.inserted, replayInserted: replay.inserted, finalUniqueRecords: 3, physicalStorageExhaustionTested: false };
    } finally { for (const repo of repos) repo.close(); }
  });
  for (const name of databases) await new Promise((resolve, reject) => { const deletion = indexedDB.deleteDatabase(name); deletion.onsuccess = resolve; deletion.onerror = () => reject(deletion.error); deletion.onblocked = () => reject(Error('Test cleanup database remained open')); });
  return { status: failures.length ? 'FAIL' : 'PASS', checks, failures, databaseImplementation: 'native Chromium IndexedDB', temporaryDatabasesDeleted: databases.length };
}

const cwd = process.cwd(), harness = await mkdtemp(join(tmpdir(), 'vaiwl-storage-faults-harness-'));
const profile = await mkdtemp(join(tmpdir(), 'vaiwl-storage-faults-profile-'));
const fingerprint = JSON.parse(await readFile('dist/build.json', 'utf8'));
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const sourceDirty = execFileSync('git', ['status', '--porcelain', '--', 'src'], { encoding: 'utf8' }).trim().length !== 0;
const built = await build({
  stdin: { contents: `import { createRepository } from ${JSON.stringify(resolve('src/storage/repository.ts'))};\nimport { openDatabase, STORE_NAMES } from ${JSON.stringify(resolve('src/storage/db.ts'))};\nglobalThis.__runStorageFaults = ${runStorageFaults.toString()};\nglobalThis.__storageFaultsReady = true;`, resolveDir: cwd, sourcefile: 'storage-faults-test-entry.js', loader: 'js' },
  outfile: join(harness, 'harness.js'), bundle: true, format: 'esm', platform: 'browser', target: 'chrome120', metafile: true, logLevel: 'silent',
});
const productionSources = [];
for (const input of Object.keys(built.metafile.inputs).filter(path => path.startsWith('src/')).sort()) productionSources.push({ path: relative(cwd, resolve(input)), sha256: createHash('sha256').update(await readFile(input)).digest('hex') });
if (!productionSources.some(file => file.path === 'src/storage/repository.ts') || !productionSources.some(file => file.path === 'src/storage/db.ts')) throw Error('Harness source provenance incomplete');
await writeFile(join(harness, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'VAIWL Start storage fault test ONLY', version: '0.0.0', minimum_chrome_version: '120', background: { service_worker: 'worker.js', type: 'module' }, content_security_policy: { extension_pages: "script-src 'self'; object-src 'none'; connect-src 'none'" } }));
await writeFile(join(harness, 'worker.js'), 'chrome.runtime.onInstalled.addListener(() => {});');
await writeFile(join(harness, 'harness.html'), '<!doctype html><meta charset="utf-8"><title>Test-only native IDB faults</title><script type="module" src="harness.js"></script>');
const report = {
  status: 'NOT_RUN', buildSha: fingerprint.sha, dirty: fingerprint.dirty || sourceDirty || sourceCommit !== fingerprint.sha, sourceCommit, productionSourceDirty: sourceDirty,
  contract: fingerprint.contract, environment: 'isolated Linux headless Chromium; test-only MV3 extension; real native IndexedDB',
  productionSources, harnessBundleSha256: createHash('sha256').update(await readFile(join(harness, 'harness.js'))).digest('hex'),
  limitations: ['This separate test-only MV3 harness imports unchanged production Repository/DB modules; it is not the packaged production extension or an IPC/permission test.', 'QuotaExceededError is deliberately injected at the second real IDB store write; physical disk exhaustion and browser quota-pressure policy are not tested.', 'Upgrade coverage is initial creation of current schema v1 and repeated requests for that version. No earlier production schema or backward migration is invented.', 'No live ChatGPT, user data, account/source admission, Mac or Edge acceptance, or native permission prompt is exercised.'],
};
let context;
try {
  context = await chromium.launchPersistentContext(profile, {
    ...(process.env.VAIWL_CHROMIUM_EXECUTABLE ? { executablePath: process.env.VAIWL_CHROMIUM_EXECUTABLE } : { channel: 'chromium' }),
    headless: true, args: ['--no-sandbox', `--disable-extensions-except=${harness}`, `--load-extension=${harness}`],
  });
  report.browserVersion = context.browser()?.version();
  await context.route(/^https?:\/\//, route => route.abort());
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host, page = await context.newPage();
  await page.goto(`chrome-extension://${id}/harness.html`); await page.waitForFunction(() => globalThis.__storageFaultsReady === true);
  Object.assign(report, await page.evaluate(() => globalThis.__runStorageFaults()));
} catch (error) { report.status = 'FAIL'; report.error = error.message; }
finally {
  if (context) await context.close(); report.finishedAt = new Date().toISOString();
  await mkdir('artifacts', { recursive: true }); await writeFile('artifacts/storage-faults-validation.json', JSON.stringify(report, null, 2));
}
console.log(JSON.stringify({ status: report.status, buildSha: report.buildSha, dirty: report.dirty, browserVersion: report.browserVersion, productionSources: productionSources.length, checks: report.checks, artifact: 'artifacts/storage-faults-validation.json', ...(report.error ? { error: report.error } : {}) }));
if (report.status !== 'PASS') process.exitCode = 1;
