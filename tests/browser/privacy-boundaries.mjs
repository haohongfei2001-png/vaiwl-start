import { chromium } from 'playwright';
import { mkdtemp, mkdir, cp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const output = resolve('artifacts'); await mkdir(output, { recursive: true });
const fingerprint = JSON.parse(await readFile('dist/build.json', 'utf8'));
const checks = [], limitations = [
  'A temporary manifest pre-grants scripting, webNavigation and the exact https://chatgpt.com/* host. Production JavaScript bytes are unchanged; this is not native permission-prompt acceptance.',
  'Every HTTPS page and fixed session endpoint is a synthetic intercepted response; no real account, private conversation or live metadata source is accessed.',
  'No metadata capability is enabled, and no current-context/PROJECT/NONE/arrival proof is claimed. This is Linux Chromium, not Mac Chrome or Edge.',
  'Offline caching is a separate test; this experiment specifically verifies a pending fixed identity request cannot block a fresh Start page.',
];
const check = (id, condition, observed) => { assert.ok(condition, `${id}: ${observed}`); checks.push({ id, status: 'PASS', observed }); };
const ORIGIN = 'https://chatgpt.com';
const CACHED = `${ORIGIN}/c/71000000-0000-4000-8000-000000000001`;
const SLOW = `${ORIGIN}/c/71000000-0000-4000-8000-000000000002`;
const FRAME = `${ORIGIN}/synthetic-privacy-frame`;
const SESSION = `${ORIGIN}/api/auth/session`;
const ACCOUNTS = `${ORIGIN}/backend-api/accounts/check/v4-2023-04-27`;
let context, browserVersion = null, holdSession = false, releaseSession = () => {};
const sessionGate = new Promise(resolve => { releaseSession = resolve; });
const pendingRequests = new Set();
let authStartedResolve;
const authStarted = new Promise(resolve => { authStartedResolve = resolve; });

async function command(page, command, payload = {}) {
  return page.evaluate(async ({ command, payload }) => {
    const send = (name, payload, revision) => chrome.runtime.sendMessage({ protocol: 'vaiwl-start-internal/1', operationId: crypto.randomUUID(), expectedRevision: revision, command: name, payload });
    const initial = await send('SNAPSHOT', {}, 0); if (!initial.ok) throw Error(initial.code);
    const result = await send(command, payload, initial.data.revision); if (!result.ok) throw Error(result.code);
    return result.data;
  }, { command, payload });
}
async function injectMessage(worker, tabId, frameId, message) {
  return worker.evaluate(async ({ tabId, frameId, message }) => {
    const [result] = await chrome.scripting.executeScript({ target: { tabId, frameIds: [frameId] }, world: 'ISOLATED',
      func: async message => ({ topFrame: window === window.top, response: await chrome.runtime.sendMessage(message) }), args: [message] });
    return result;
  }, { tabId, frameId, message });
}
const collectorMessage = (command, payload) => ({ protocol: 'vaiwl-start-collector/1', operationId: crypto.randomUUID(), command, payload });

try {
  const harness = await mkdtemp(join(tmpdir(), 'vaiwl-privacy-harness-'));
  await cp(resolve('dist'), harness, { recursive: true });
  const manifest = JSON.parse(await readFile(join(harness, 'manifest.json'), 'utf8'));
  manifest.permissions.push('scripting', 'webNavigation');
  manifest.optional_permissions = manifest.optional_permissions.filter(permission => !['scripting', 'webNavigation'].includes(permission));
  manifest.host_permissions = [`${ORIGIN}/*`]; manifest.optional_host_permissions = [];
  await writeFile(join(harness, 'manifest.json'), JSON.stringify(manifest));
  for (const name of ['service-worker.js', 'content.js', 'newtab.js']) assert.equal(createHash('sha256').update(await readFile(join(harness, name))).digest('hex'), fingerprint.files[name]);
  check('PRIVACY-B-identical-production-js', true, 'Only the temporary manifest changes permission grant timing. All production JavaScript bundle hashes match the fingerprint.');
  const profile = await mkdtemp(join(tmpdir(), 'vaiwl-privacy-profile-'));
  context = await chromium.launchPersistentContext(profile, {
    ...(process.env.VAIWL_CHROMIUM_EXECUTABLE ? { executablePath: process.env.VAIWL_CHROMIUM_EXECUTABLE } : { channel: 'chromium' }),
    headless: true, viewport: { width: 1280, height: 900 },
    args: ['--no-sandbox', `--disable-extensions-except=${harness}`, `--load-extension=${harness}`],
  });
  context.on('requestfailed', request => pendingRequests.delete(request));
  context.on('requestfinished', request => pendingRequests.delete(request));
  await context.route(/^https?:\/\//, async route => {
    const url = route.request().url();
    if (url === SESSION) {
      if (holdSession) { pendingRequests.add(route.request()); authStartedResolve(); await sessionGate; }
      try { await route.fulfill({ status: 401, contentType: 'application/json', body: '{}' }); } catch { /* expected if production timeout aborts */ }
      return;
    }
    if (url === ACCOUNTS) { await route.fulfill({ status: 403, contentType: 'application/json', body: '{}' }); return; }
    if (url === CACHED) { await route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><title>Synthetic cache source</title><iframe src="${FRAME}" title="Synthetic same-origin frame"></iframe>` }); return; }
    if (url === SLOW || url === FRAME) { await route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Synthetic bounded surface</title><p>Test fixture only.</p>' }); return; }
    await route.abort();
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  browserVersion = context.browser()?.version() || await worker.evaluate(() => navigator.userAgent);
  const extensionId = new URL(worker.url()).host;
  const start = await context.newPage(); await start.goto(`chrome-extension://${extensionId}/newtab.html`); await start.waitForSelector('html[data-start-ready="true"]');
  await command(start, 'PERMISSIONS_SYNC', { enableCapture: true });
  const cachedPage = await context.newPage(); await cachedPage.goto(CACHED);
  await start.waitForFunction(async url => {
    const result = await chrome.runtime.sendMessage({ protocol: 'vaiwl-start-internal/1', operationId: crypto.randomUUID(), expectedRevision: 0, command: 'SNAPSHOT', payload: {} });
    return result.ok && result.data.settings.captureEnabled && result.data.conversations.some(record => record.canonicalUrl === url);
  }, CACHED, { timeout: 10000 });
  const beforeSlow = await command(start, 'SNAPSHOT');
  const cachedRecord = beforeSlow.conversations.find(record => record.canonicalUrl === CACHED);
  check('PRIVACY-B-cached-directory-capture-enabled', !!cachedRecord && beforeSlow.settings.captureEnabled && beforeSlow.capabilities.chatgpt && cachedRecord.owner.kind === 'unassigned' && cachedRecord.activity === null, 'A prior real browser route produced a durable staging candidate through the unmodified observer; capture is connected without any scope authority.');
  holdSession = true;
  const slowPage = await context.newPage(); await slowPage.goto(SLOW);
  await Promise.race([authStarted, new Promise((_, reject) => setTimeout(() => reject(Error('Known session request did not start')), 10000))]);
  const openedAt = Date.now();
  const freshStart = await context.newPage(); await freshStart.goto(`chrome-extension://${extensionId}/newtab.html`);
  await freshStart.waitForSelector('html[data-start-ready="true"]', { timeout: 3000 });
  await freshStart.locator(`a[data-record-key="${cachedRecord.key}"]`).first().waitFor({ state: 'visible', timeout: 3000 });
  const elapsed = Date.now() - openedAt;
  check('PRIVACY-B-D11-cache-before-slow-identity', pendingRequests.size > 0 && elapsed < 3000, `A fresh Start page displayed the previously stored entry in ${elapsed}ms while the exact /api/auth/session request was still pending and unanswered (before its 6-second production deadline).`);
  releaseSession(); holdSession = false;

  const target = await worker.evaluate(async url => (await chrome.tabs.query({ url }))[0], CACHED);
  assert.ok(Number.isInteger(target?.id), 'Controlled top-frame tab exists.');
  const hello = await injectMessage(worker, target.id, 0, collectorMessage('HELLO', { href: CACHED }));
  check('PRIVACY-B-topframe-positive-control', hello.frameId === 0 && hello.result.topFrame === true && hello.result.response.ok === true, 'The same installed collector protocol accepts a real active Chrome main-frame sender under the granted permissions.');
  const binding = hello.result.response.data;
  const attack = '<img src=x onerror=window.__privacyXss=1>';
  const observed = await injectMessage(worker, target.id, 0, collectorMessage('OBSERVE', { bindingId: binding.id, routeEpoch: binding.routeEpoch, candidates: [{ url: CACHED, title: attack }] }));
  assert.equal(observed.result.response.ok, true);
  await freshStart.getByText(attack, { exact: true }).waitFor({ state: 'visible' });
  check('PRIVACY-B-D12-title-plain-text', await freshStart.evaluate(() => !window.__privacyXss && !document.querySelector('img[src="x"]')), 'An HTML-looking title crossed the real validated metadata IPC and is rendered as text without an injected element or script execution.');

  const uiResults = await freshStart.evaluate(async () => {
    const envelope = { protocol: 'vaiwl-start-internal/1', operationId: crypto.randomUUID(), expectedRevision: 0, command: 'SNAPSHOT', payload: {} };
    return Promise.all([
      { ...envelope, unknownEnvelopeField: 'synthetic' },
      { ...envelope, payload: { unknownPayloadField: 'synthetic' } },
      { ...envelope, payload: { scope: 'synthetic-fake', verified: true } },
      { ...envelope, command: 'OBSERVATION', payload: { scope: 'synthetic-fake', verified: true } },
    ].map(message => chrome.runtime.sendMessage({ ...message, operationId: crypto.randomUUID() })));
  });
  check('PRIVACY-B-D12-ui-fields-and-authority-rejected', uiResults.length === 4 && uiResults.every(result => result.ok === false && result.code === 'INVALID_MESSAGE'), 'Actual extension runtime rejects unknown envelope/payload fields and invented scope/verified/source-admission messages.');
  const collectorResults = [];
  for (const message of [
    { ...collectorMessage('HELLO', { href: CACHED }), verified: true },
    collectorMessage('HELLO', { href: CACHED, scope: 'synthetic-fake', verified: true }),
    collectorMessage('OBSERVE', { bindingId: binding.id, routeEpoch: binding.routeEpoch, candidates: [{ url: CACHED, title: 'Synthetic', verified: true }] }),
  ]) collectorResults.push((await injectMessage(worker, target.id, 0, message)).result.response);
  check('PRIVACY-B-D12-collector-fields-rejected', collectorResults.every(result => result.ok === false && result.code === 'INVALID_MESSAGE'), 'Actual isolated main-frame runtime also rejects extra collector envelope, payload and candidate authority fields.');
  const frames = await worker.evaluate(tabId => chrome.webNavigation.getAllFrames({ tabId }), target.id);
  const child = frames.find(frame => frame.frameId !== 0 && frame.url === FRAME);
  assert.ok(child && child.documentId, 'A real same-origin child document exists.');
  const subframe = await injectMessage(worker, target.id, child.frameId, collectorMessage('HELLO', { href: FRAME }));
  check('PRIVACY-B-D12-real-subframe-rejected', subframe.frameId === child.frameId && subframe.frameId !== 0 && subframe.result.topFrame === false && subframe.result.response.ok === false && subframe.result.response.code === 'UNAUTHORIZED_SENDER', `Chrome supplied actual nonzero frameId=${subframe.frameId}; no MessageSender was constructed by the test, and the real runtime rejected its otherwise valid HELLO.`);
  const final = await command(freshStart, 'SNAPSHOT');
  check('PRIVACY-B-no-false-authority-or-activity', final.scopes.length === 0 && final.capabilities.sourceGate === 'SOURCE_GATE_BLOCKED' && final.conversations.every(record => record.owner.kind === 'unassigned' && record.membership.state === 'UNKNOWN' && record.activity === null), 'Rejected messages create no scope, Project/NONE membership or activity; the source gate remains blocked.');
  await writeFile(join(output, 'privacy-boundaries-validation.json'), JSON.stringify({ status: 'PASS', buildSha: fingerprint.sha, dirty: fingerprint.dirty, browserVersion, environment: 'isolated Linux Chromium MV3; exact-host permission harness; synthetic controlled HTTPS pages and fixed GET responses', checks, limitations }, null, 2));
  console.log(JSON.stringify({ status: 'PASS', checks: checks.length, buildSha: fingerprint.sha, browserVersion }));
} catch (error) {
  await writeFile(join(output, 'privacy-boundaries-validation.json'), JSON.stringify({ status: 'FAIL', buildSha: fingerprint.sha, dirty: fingerprint.dirty, browserVersion, checks, error: String(error), limitations }, null, 2));
  throw error;
} finally { releaseSession(); if (context) await context.close(); }
