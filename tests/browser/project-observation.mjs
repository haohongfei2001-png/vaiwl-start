/** Installed production collector + synthetic native metadata, never live source certification. */
import { chromium } from 'playwright';
import { mkdtemp, mkdir, cp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const output = resolve('artifacts'); await mkdir(output, { recursive: true });
const fingerprint = JSON.parse(await readFile('dist/build.json', 'utf8'));
const checks = [], limitations = [
  'Actual unchanged production JavaScript is installed in an isolated Chromium Profile. A temporary manifest pre-grants the existing optional ChatGPT/scripting/webNavigation permissions; native prompt acceptance is not tested.',
  'Every HTTPS document and both existing session-only endpoints are intercepted synthetic fixtures. This does not certify current ChatGPT DOM, an actual account/workspace, Project membership, positive NONE, Mac Chrome or Edge.',
  'Missing members and empty Project observations are partial visibility, not authoritative removal. An empty local observed Project is saved independently; no certified Project entity is created.',
];
const check = (id, condition, observed) => { assert.ok(condition, `${id}: ${observed}`); checks.push({ id, status: 'PASS', observed }); };
const ORIGIN = 'https://chatgpt.com';
const SESSION = `${ORIGIN}/api/auth/session`, ACCOUNTS = `${ORIGIN}/backend-api/accounts/check/v4-2023-04-27`;
const P = 'g-p-81000000000000000000000000000001', Q = 'g-p-81000000000000000000000000000002';
const projectUrl = id => `${ORIGIN}/g/${id}/project`;
const cid = n => `82000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const url = n => `${ORIGIN}/c/${cid(n)}`;
const PROJECT_TITLE = 'Synthetic Project title', RENAMED_PROJECT = 'Renamed synthetic Project';
const PREVIEW = 'FORBIDDEN_PREVIEW_MUST_NEVER_BE_PERSISTED';
const TOKEN = 'FORBIDDEN_SESSION_TOKEN', EMAIL = 'forbidden@example.invalid';
const memberMarkup = (n, title = `Synthetic conversation ${n}`, project = null) => `<li><a href="${project ? `/g/${project}/c/${cid(n)}` : `/c/${cid(n)}`}"><div><div>${title}</div><div data-preview>${PREVIEW}</div></div></a></li>`;
const projectMarkup = (members, title = PROJECT_TITLE) => `<main data-app-shell-main-surface><div data-app-shell-main-content-layout><div role="main"><h1><button><span>${title}</span></button></h1><div><div role="tablist"><button role="tab" aria-selected="true" id="fixture-tab" aria-controls="fixture-panel">Conversations</button></div><div role="tabpanel" id="fixture-panel" aria-labelledby="fixture-tab"><section><ol>${members.join('')}</ol></section></div></div></div></div></main><aside><a href="/c/${cid(99)}">Synthetic conversation 1</a></aside>`;
const shell = '<!doctype html><meta charset="utf-8"><title>Synthetic metadata fixture</title><div id="metadata"></div>';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let context, otherContext, browserVersion = null, sessionRequests = 0, persona = 'a';
const requests = [];
const localProjectFor = (snapshot, record) => snapshot.localProjects?.find(project => project.key === record?.localProject?.projectKey);

async function waitUntil(probe, reason, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const value = await probe(); if (value) return value; await sleep(35); }
  throw Error(reason);
}
async function command(page, name, payload = {}) {
  return page.evaluate(async ({ name, payload }) => {
    const send = (command, payload, expectedRevision) => chrome.runtime.sendMessage({ protocol: 'vaiwl-start-internal/1', operationId: crypto.randomUUID(), expectedRevision, command, payload });
    const snapshot = await send('SNAPSHOT', {}, 0); if (!snapshot.ok) throw Error(snapshot.code);
    const reply = await send(name, payload, snapshot.data.revision); if (!reply.ok) throw Error(reply.code); return reply.data;
  }, { name, payload });
}
async function stores(page, names) {
  return page.evaluate(async names => {
    const db = await new Promise((resolve, reject) => { const r = indexedDB.open('vaiwl-start'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    try { return await Promise.all(names.map(name => new Promise((resolve, reject) => { const r = db.transaction(name).objectStore(name).getAll(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); }))); }
    finally { db.close(); }
  }, names);
}
async function fill(native, markup) { await native.locator('#metadata').evaluate((node, markup) => { node.innerHTML = markup; }, markup); }
async function snapshotWith(start, predicate, label) { return waitUntil(async () => { const s = await command(start, 'SNAPSHOT'); return predicate(s) ? s : null; }, label); }
async function routes(browser) {
  await browser.route(/^https?:\/\//, async route => {
    const target = route.request().url();
    if (['fetch', 'xhr'].includes(route.request().resourceType())) requests.push(target);
    if (target === SESSION) {
      sessionRequests++;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: { id: `synthetic-principal-${persona}`, email: EMAIL }, accessToken: TOKEN, expires: new Date(Date.now() + 3600000).toISOString() }) });
    }
    if (target === ACCOUNTS) {
      const id = `synthetic-context-${persona}`;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ accounts: { [id]: { account: { account_id: id, structure: 'personal', is_deactivated: false }, can_access_with_session: true } } }) });
    }
    if (target.startsWith(`${ORIGIN}/`)) return route.fulfill({ status: 200, contentType: 'text/html', body: shell });
    return route.abort();
  });
}
async function launch(profile, harness) {
  const browser = await chromium.launchPersistentContext(profile, {
    ...(process.env.VAIWL_CHROMIUM_EXECUTABLE ? { executablePath: process.env.VAIWL_CHROMIUM_EXECUTABLE } : { channel: 'chromium' }),
    headless: true, viewport: { width: 1280, height: 900 }, args: ['--no-sandbox', `--disable-extensions-except=${harness}`, `--load-extension=${harness}`],
  });
  await routes(browser);
  const worker = browser.serviceWorkers()[0] || await browser.waitForEvent('serviceworker');
  const extensionId = new URL(worker.url()).host;
  const start = await browser.newPage(); await start.goto(`chrome-extension://${extensionId}/newtab.html`);
  await start.waitForSelector('html[data-start-ready="true"]'); await command(start, 'PERMISSIONS_SYNC', { enableCapture: true });
  return { browser, worker, start, extensionId };
}
async function bindingFor(worker, href) {
  return worker.evaluate(async href => { const tabs = await chrome.tabs.query({ url: href }); const tab = tabs[0]; if (!tab) return null; return (await chrome.storage.session.get('browserSession')).browserSession.bindings[String(tab.id)]; }, href);
}
async function oldObservation(worker, tabId, binding, project, members) {
  const [result] = await worker.evaluate(async ({ tabId, binding, project, members }) => chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: ({ binding, project, members }) => chrome.runtime.sendMessage({ protocol: 'vaiwl-start-collector/1', operationId: crypto.randomUUID(), command: 'OBSERVE', payload: { bindingId: binding.id, routeEpoch: binding.routeEpoch, identityToken: binding.localIdentity?.token, candidates: members.map(m => ({ url: m.canonicalUrl, title: m.nativeTitle })), projectCandidate: { state: 'candidate', relationBasis: 'linked-native-panel', projectId: project, nativeTitle: 'Stale forged title', canonicalUrl: `https://chatgpt.com/g/${project}/project`, members } } }), args: [{ binding, project, members }] }), { tabId, binding, project, members });
  return result.result;
}

try {
  const harness = await mkdtemp(join(tmpdir(), 'vaiwl-project-observation-harness-')); await cp(resolve('dist'), harness, { recursive: true });
  const manifest = JSON.parse(await readFile(join(harness, 'manifest.json'), 'utf8'));
  manifest.permissions.push('scripting', 'webNavigation'); manifest.optional_permissions = manifest.optional_permissions.filter(p => !['scripting', 'webNavigation'].includes(p));
  manifest.host_permissions = [`${ORIGIN}/*`]; manifest.optional_host_permissions = [];
  await writeFile(join(harness, 'manifest.json'), JSON.stringify(manifest));
  for (const name of ['content.js', 'service-worker.js', 'newtab.js']) assert.equal(createHash('sha256').update(await readFile(join(harness, name))).digest('hex'), fingerprint.files[name]);
  check('PROJECT-B-production-bytes', true, 'Installed collector, worker and Start JavaScript match the exact build.json hashes; no collector test hook is added.');
  const profile = await mkdtemp(join(tmpdir(), 'vaiwl-project-observation-profile-'));
  let { browser, worker, start } = await launch(profile, harness); context = browser;
  browserVersion = context.browser()?.version() || await worker.evaluate(() => navigator.userAgent);
  let native = await context.newPage(); await native.goto(projectUrl(P));
  await waitUntil(() => sessionRequests > 0, 'Initial metadata observer did not start');
  // This one bounded delay deliberately exceeds the old cumulative 2.22 s sampling window.
  await sleep(2600);
  check('PROJECT-B-no-source-no-guess', (await command(start, 'SNAPSHOT')).conversations.length === 0, 'A supported route without a proven native panel does not invent a Project, title or member.');
  await fill(native, projectMarkup([])); await snapshotWith(start, s => s.localProjects?.length === 1, 'Empty local Project was not saved');
  check('PROJECT-B-empty-project', (await command(start, 'SNAPSHOT')).localProjects.length === 1 && (await command(start, 'SNAPSHOT')).projects.length === 0 && (await command(start, 'SNAPSHOT')).conversations.length === 0, 'An empty structurally valid Project creates its local observed entity without inventing a member or a certified Project.');
  await native.locator('ol').evaluate((node, markup) => { node.insertAdjacentHTML('beforeend', markup); }, memberMarkup(1));
  const first = await snapshotWith(start, s => s.conversations.some(c => c.conversationId === cid(1) && localProjectFor(s, c)?.projectId === P), 'Late-hydrated Project member was not collected');
  const firstRecord = first.conversations.find(c => c.conversationId === cid(1));
  check('PROJECT-B-late-hydration-single-member', firstRecord.nativeTitle === 'Synthetic conversation 1' && localProjectFor(first, firstRecord).nativeTitle === PROJECT_TITLE && !first.conversations.some(c => c.conversationId === cid(99)), 'After the old sampling window expires, an empty Project subsequently gains one member; only its bounded title leaf and true panel link are collected.');
  check('PROJECT-B-title-separation', firstRecord.nativeTitle !== localProjectFor(first, firstRecord).nativeTitle && firstRecord.membership.state === 'UNKNOWN', 'Project name and conversation title remain distinct fields and the locally observed relation remains UNKNOWN.');
  await start.locator('.local-observed-project').getByRole('heading', { name: PROJECT_TITLE, exact: true }).waitFor();
  check('PROJECT-B-Start-candidate-card', await start.locator(`.local-observed-project a[data-record-key="${firstRecord.key}"]`).count() === 1 && await start.locator('[data-project]').count() === 0, 'The actual Start page renders the observed name and member once in a marked locally observed native Project card; it does not present a certified Project card.');

  await native.locator('ol').evaluate((node, markup) => { node.insertAdjacentHTML('beforeend', markup); }, memberMarkup(2, 'Same conversation title') + memberMarkup(3, 'Same conversation title'));
  const added = await snapshotWith(start, s => [1, 2, 3].every(n => s.conversations.some(c => c.conversationId === cid(n) && localProjectFor(s, c)?.projectId === P)), 'Member additions were not collected incrementally');
  check('PROJECT-B-member-additions-and-same-title', added.conversations.length === 3 && new Set(added.conversations.map(c => c.key)).size === 3 && new Set(added.conversations.map(c => c.localProject.projectKey)).size === 1, 'A later multi-member panel updates the three ID-keyed records; equal titles do not merge different conversations.');
  await native.locator('h1 span').evaluate((node, title) => { node.textContent = title; }, RENAMED_PROJECT);
  const renamed = await snapshotWith(start, s => s.conversations.length === 3 && s.localProjects.some(p => p.nativeTitle === RENAMED_PROJECT), 'Project rename was not observed');
  check('PROJECT-B-project-rename', renamed.conversations.find(c => c.conversationId === cid(1)).nativeTitle === firstRecord.nativeTitle && renamed.conversations.find(c => c.conversationId === cid(1)).key === firstRecord.key, 'A live Project title change updates the persistent local Project name while preserving the conversation identity and title.');
  await native.locator('ol li').first().locator('a > div > div').first().evaluate(node => { node.textContent = 'Renamed conversation only'; });
  const memberRenamed = await snapshotWith(start, s => s.conversations.some(c => c.conversationId === cid(1) && c.nativeTitle === 'Renamed conversation only'), 'Conversation title rename was not observed');
  check('PROJECT-B-member-rename', localProjectFor(memberRenamed, memberRenamed.conversations.find(c => c.conversationId === cid(1))).nativeTitle === RENAMED_PROJECT, 'A member label change updates only its conversation title, leaving the Project name intact.');

  const stable = await command(start, 'SNAPSHOT'), requestsBeforeDuplicate = sessionRequests;
  await native.locator('ol').evaluate(node => { node.prepend(node.lastElementChild); });
  await native.locator('[data-preview]').first().evaluate(node => { node.textContent = 'Different private preview'; });
  await native.locator('h1 span').evaluate(node => { node.textContent = node.textContent; });
  await sleep(700);
  const duplicate = await command(start, 'SNAPSHOT');
  check('PROJECT-B-duplicate-and-reorder-no-write', duplicate.revision === stable.revision && JSON.stringify(duplicate.conversations) === JSON.stringify(stable.conversations), 'Repeated identical title observations, member reordering and preview-only changes do not rewrite the saved metadata or churn candidate grouping.');
  check('PROJECT-B-no-session-polling-on-mutation', sessionRequests === requestsBeforeDuplicate, 'Identical metadata, reordering and preview-only mutations do not repeat identity reads; changed accepted observations may recheck the existing session-only endpoint.');

  const beforeRemoval = duplicate.conversations.find(c => c.conversationId === cid(1));
  await native.locator(`a[href="/c/${cid(1)}"]`).evaluate(node => node.parentElement.remove());
  await sleep(500);
  const removed = await command(start, 'SNAPSHOT');
  check('PROJECT-B-missing-member-preserved', removed.conversations.length === 3 && JSON.stringify(removed.conversations.find(c => c.conversationId === cid(1))) === JSON.stringify(beforeRemoval) && removed.conversations.every(c => c.membership.state === 'UNKNOWN'), 'Removing a visible list row does not delete its saved conversation, infer NONE or erase an older local observation.');
  await native.locator('ol').evaluate(node => node.replaceChildren()); await sleep(350);
  check('PROJECT-B-empty-after-members-preserves-directory', (await command(start, 'SNAPSHOT')).conversations.length === 3, 'A now-empty/locally paginated Project does not remove the previously saved catalog.');

  await fill(native, projectMarkup([memberMarkup(2), memberMarkup(3)], RENAMED_PROJECT));
  await snapshotWith(start, s => s.conversations.find(c => c.conversationId === cid(2))?.nativeTitle === 'Synthetic conversation 2', 'Pre-switch Project snapshot did not settle');
  const oldBinding = await waitUntil(() => bindingFor(worker, projectUrl(P)), 'Project binding unavailable');
  persona = 'b'; const beforeSwitchRequests = sessionRequests;
  // Preserve A's exact panel nodes and metadata while the route has become B.
  await native.evaluate(href => { history.pushState({}, '', href); }, projectUrl(Q));
  await waitUntil(async () => (await bindingFor(worker, projectUrl(Q)))?.href === projectUrl(Q) && sessionRequests > beforeSwitchRequests, 'SPA Project switch was not rebound');
  await sleep(600);
  check('PROJECT-B-SPA-old-panel-not-new-Project', !(await command(start, 'SNAPSHOT')).localProjects.some(p => p.projectId === Q), 'A changed Project URL alone does not relabel the known unchanged prior panel and its plain conversation links as the next Project.');
  await fill(native, projectMarkup([memberMarkup(4)], RENAMED_PROJECT));
  const secondProject = await snapshotWith(start, s => s.conversations.some(c => c.conversationId === cid(4) && localProjectFor(s, c)?.projectId === Q), 'Second Project was not collected');
  check('PROJECT-B-SPA-different-project-ID-same-name', secondProject.conversations.length === 4 && secondProject.conversations.find(c => c.conversationId === cid(4)).localProject.projectKey !== removed.conversations.find(c => c.conversationId === cid(2)).localProject.projectKey && secondProject.projects.length === 0 && secondProject.scopes.length === 0, 'A same-document switch to a different Project ID with the same name creates a separate persistent locally observed Project. Changed session principal isolates the local boundary; no roster is promoted to a current workspace.');
  const stale = await oldObservation(worker, oldBinding.tabId, oldBinding, P, [{ conversationId: cid(90), canonicalUrl: url(90), nativeTitle: 'Stale member' }]);
  check('PROJECT-B-stale-route-event-rejected', stale.ok === false && !(await command(start, 'SNAPSHOT')).conversations.some(c => c.conversationId === cid(90)), 'The worker rejects a real isolated-world message carrying the old Project route binding after SPA navigation.');

  await native.evaluate(href => { history.pushState({}, '', href); }, url(10));
  await waitUntil(async () => (await bindingFor(worker, url(10)))?.href === url(10), 'Conversation route was not rebound');
  await fill(native, projectMarkup([memberMarkup(91)], 'Not a Project on this route')); await sleep(450);
  const ordinary = await command(start, 'SNAPSHOT');
  check('PROJECT-B-conversation-route-does-not-claim-Project', !ordinary.conversations.some(c => c.conversationId === cid(91)) && ordinary.conversations.find(c => c.conversationId === cid(10))?.membership.state === 'UNKNOWN', 'Project-like markup on a normal conversation route is not used as Project membership or positive NONE.');

  await native.evaluate(href => { history.pushState({}, '', href); document.getElementById('metadata').replaceChildren(); }, projectUrl(P));
  await waitUntil(async () => (await bindingFor(worker, projectUrl(P)))?.href === projectUrl(P), 'Return Project route not rebound');
  await fill(native, projectMarkup([memberMarkup(1)]));
  const returned = await snapshotWith(start, s => s.conversations.some(c => c.conversationId === cid(1) && c.key !== firstRecord.key && localProjectFor(s, c)?.nativeTitle === PROJECT_TITLE), 'New route observation was not recorded');
  const returnedRecord = returned.conversations.find(c => c.conversationId === cid(1) && c.key !== firstRecord.key);
  check('PROJECT-B-same-ID-different-principal-isolation', returned.conversations.filter(c => c.conversationId === cid(1)).length === 2 && returned.conversations.some(c => c.key === firstRecord.key) && returnedRecord.localProject.projectKey !== firstRecord.localProject.projectKey, 'The same native Project/member IDs under the changed session principal get separate local keys; the first principal record remains preserved.');
  const currentBinding = await bindingFor(worker, projectUrl(P));
  const beforeDocument = returned.conversations.length;
  await native.reload();
  await waitUntil(async () => { const b = await bindingFor(worker, projectUrl(P)); return b && b.documentId !== currentBinding.documentId; }, 'Reload did not replace document binding');
  const expired = await oldObservation(worker, currentBinding.tabId, currentBinding, P, [{ conversationId: cid(92), canonicalUrl: url(92), nativeTitle: 'Expired document member' }]);
  check('PROJECT-B-expired-document-rejected', expired.ok === false && (await command(start, 'SNAPSHOT')).conversations.length === beforeDocument, 'After a real page reload, a payload carrying the expired document binding cannot insert a Project member.');

  await fill(native, projectMarkup([memberMarkup(1)]));
  await snapshotWith(start, s => s.conversations.find(c => c.key === returnedRecord.key)?.localProject?.projectKey === returnedRecord.localProject.projectKey && s.conversations.find(c => c.key === returnedRecord.key)?.localProject?.observedAt !== returnedRecord.localProject.observedAt, 'Reloaded principal document did not update the stable local Project');
  const beforeStop = await command(start, 'SNAPSHOT');
  await command(start, 'SETTINGS_UPDATE', { patch: { captureEnabled: false } });
  await native.locator('ol').evaluate((node, markup) => node.insertAdjacentHTML('beforeend', markup), memberMarkup(93)); await sleep(450);
  const stopped = await command(start, 'SNAPSHOT');
  check('PROJECT-B-capture-stop-disconnects', stopped.settings.captureEnabled === false && !stopped.conversations.some(c => c.conversationId === cid(93)) && JSON.stringify(stopped.conversations) === JSON.stringify(beforeStop.conversations), 'Disabling continued capture stops the already-running Project observer and preserves existing metadata.');
  await command(start, 'PERMISSIONS_SYNC', { enableCapture: true });
  await snapshotWith(start, s => s.conversations.some(c => c.conversationId === cid(93)), 'Re-enabled capture did not observe existing tab');
  const secondProfile = await mkdtemp(join(tmpdir(), 'vaiwl-project-other-profile-'));
  const other = await launch(secondProfile, harness); otherContext = other.browser;
  check('PROJECT-B-fresh-Profile-isolation', (await command(other.start, 'SNAPSHOT')).conversations.length === 0, 'A second actual browser Profile starts with an independent empty catalog.');
  const otherNative = await otherContext.newPage(); await otherNative.goto(projectUrl(P)); await fill(otherNative, projectMarkup([memberMarkup(1)]));
  const otherSnapshot = await snapshotWith(other.start, s => s.conversations.some(c => c.conversationId === cid(1)), 'Other Profile did not collect its independent candidate');
  const beforeProfileCheck = await command(start, 'SNAPSHOT');
  const retained = beforeProfileCheck.conversations.find(c => c.key === returnedRecord.key);
  check('PROJECT-B-same-IDs-across-Profiles', otherSnapshot.localProfileKey !== beforeProfileCheck.localProfileKey && otherSnapshot.conversations[0].key !== retained.key && otherSnapshot.conversations[0].localProject.projectKey !== retained.localProject.projectKey, 'The same native Project/conversation IDs in another Profile receive different local record and observed Project keys; no catalog is shared.');
  await otherContext.close(); otherContext = null;
  // Move the pregranted host back to optional, retaining the synthetic grant in
  // this one test Profile, before exercising Chrome's actual remove API.
  await context.close(); context = null;
  const optionalHostManifest = { ...manifest, host_permissions: [], optional_host_permissions: [`${ORIGIN}/*`] };
  await writeFile(join(harness, 'manifest.json'), JSON.stringify(optionalHostManifest));
  ({ browser, worker, start } = await launch(profile, harness)); context = browser;
  assert.equal((await command(start, 'SNAPSHOT')).capabilities.chatgpt, true, 'The isolated upgrade must retain the prior synthetic host grant');
  native = await context.newPage(); await native.goto(projectUrl(P)); await fill(native, projectMarkup([memberMarkup(1)]));
  await snapshotWith(start, s => s.conversations.find(c => c.key === retained.key)?.localProject?.projectKey === retained.localProject.projectKey && s.conversations.find(c => c.key === retained.key)?.localProject?.observedAt !== retained.localProject.observedAt, 'New browser session did not update the principal Project before optional revocation');
  const beforeRevoke = await command(start, 'SNAPSHOT');
  const revoked = await start.evaluate(() => chrome.permissions.remove({ origins: ['https://chatgpt.com/*'] }));
  await waitUntil(async () => !(await command(start, 'SNAPSHOT')).capabilities.chatgpt, 'Host permission did not revoke');
  await native.locator('ol').evaluate((node, markup) => node.insertAdjacentHTML('beforeend', markup), memberMarkup(94)); await sleep(450);
  const afterRevoke = await command(start, 'SNAPSHOT');
  check('PROJECT-B-real-host-revocation', revoked && JSON.stringify(afterRevoke.conversations) === JSON.stringify(beforeRevoke.conversations) && !afterRevoke.conversations.some(c => c.conversationId === cid(94)), 'Actual chrome.permissions.remove revokes the exact host permission; subsequent DOM changes cannot write, while saved directory rows remain byte-for-byte intact.');

  const [projects, scopes, days, witnesses] = await stores(start, ['projects', 'scopes', 'openDays', 'witnesses']);
  const persistent = JSON.stringify(await stores(start, ['conversations', 'projects', 'scopes', 'witnesses', 'openDays', 'openIntents']));
  check('PROJECT-B-authority-and-body-boundaries', projects.length === 0 && scopes.length === 0 && days.length === 0 && witnesses.length === 0 && afterRevoke.conversations.every(c => c.owner.kind === 'unassigned' && c.membership.state === 'UNKNOWN' && c.activity === null) && [PREVIEW, 'Different private preview', TOKEN, EMAIL].every(value => !persistent.includes(value)), 'No synthetic native observation creates certified PROJECT/NONE, account scope, witness or activity. Preview bodies, tokens and email are absent from persistent business stores.');
  check('PROJECT-B-existing-session-endpoints-only', requests.length > 0 && requests.every(target => target === SESSION || target === ACCOUNTS), 'Only the existing fixed session-only URLs are fetched; metadata observation adds no network endpoint.');

  await writeFile(join(output, 'project-observation-validation.json'), JSON.stringify({ status: 'PASS', buildSha: fingerprint.sha, dirty: fingerprint.dirty, browserVersion, environment: 'isolated installed Chromium; unchanged production JS; synthetic HTTPS metadata; temporary optional-permission pregrant', checks, limitations }, null, 2));
  console.log(JSON.stringify({ status: 'PASS', checks: checks.length, buildSha: fingerprint.sha, browserVersion }));
} catch (error) {
  await writeFile(join(output, 'project-observation-validation.json'), JSON.stringify({ status: 'FAIL', buildSha: fingerprint.sha, dirty: fingerprint.dirty, browserVersion, checks, error: String(error), limitations }, null, 2));
  throw error;
} finally { if (otherContext) await otherContext.close(); if (context) await context.close(); }
