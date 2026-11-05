/** Actual installed extension; all native pages and identities below are synthetic fixtures. */
import { chromium } from 'playwright';
import { mkdtemp, mkdir, cp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const output = resolve('artifacts'); await mkdir(output, { recursive: true });
const build = JSON.parse(await readFile('dist/build.json', 'utf8'));
const checks = [], errors = [], limitations = [
  'Installed production content, worker and Start JavaScript match build.json. Only optional permission grant timing changes in a temporary test manifest.',
  'Every ChatGPT page, Project/member label and session response is an intercepted synthetic fixture in disposable browser Profiles. These results do not certify current live ChatGPT DOM or an actual signed-in account/workspace.',
  'Local native relation evidence does not certify account ownership, current Workspace, PROJECT/NONE or full synchronization. Missing list rows do not prove removal.',
  'Legacy history/activity fixtures are explicitly seeded into the existing v1 database to test non-destructive adoption. No real user history, conversations, accounts or browser Profile are accessed.',
];
const check = (id, pass, observed) => { assert.ok(pass, `${id}: ${observed}`); checks.push({ id, status: 'PASS', observed }); };
const ORIGIN = 'https://chatgpt.com';
const SESSION = `${ORIGIN}/api/auth/session`, ACCOUNTS = `${ORIGIN}/backend-api/accounts/check/v4-2023-04-27`;
const P = 'g-p-91000000000000000000000000000001', Q = 'g-p-91000000000000000000000000000002', U = 'g-p-91000000000000000000000000000003';
const cid = n => `92000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const conversationUrl = n => `${ORIGIN}/c/${cid(n)}`;
const projectUrl = (id, slug = '') => `${ORIGIN}/g/${id}${slug}/project`;
const TITLE = 'Observed native Project', RENAMED = 'Renamed native Project', OLD_TITLE = 'Existing specific history title';
const BODY = 'FORBIDDEN_CHAT_PREVIEW_BODY', TOKEN = 'FORBIDDEN_SESSION_TOKEN', EMAIL = 'forbidden@example.invalid';
const shell = '<!doctype html><meta charset="utf-8"><title>ChatGPT</title><div id="metadata"></div>';
const member = (n, title = `Native member ${n}`, project = null) => `<li><a href="${project ? `/g/${project}/c/${cid(n)}` : `/c/${cid(n)}`}"><div><div>${title}</div><div data-preview>${BODY}</div></div></a></li>`;
const panel = (rows = [], title = TITLE) => `<main data-app-shell-main-surface><div data-app-shell-main-content-layout><div role="main"><h1><button><span>${title}</span></button></h1><div role="tablist"><button role="tab" aria-selected="true" id="project-tab" aria-controls="project-panel">Chats</button></div><div role="tabpanel" id="project-panel" aria-labelledby="project-tab"><section><ol>${rows.join('')}</ol></section></div></div></div></main><aside><a href="/c/${cid(99)}">Native member 1</a></aside>`;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let context, otherContext, browserVersion = null, persona = 'a';
const requests = [];

async function waitUntil(probe, label, timeout = 12000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const value = await probe(); if (value) return value; await sleep(35); }
  throw Error(label);
}
async function command(start, command, payload = {}) {
  return start.evaluate(async ({ command, payload }) => {
    const send = (command, payload, expectedRevision) => chrome.runtime.sendMessage({ protocol: 'vaiwl-start-internal/1', operationId: crypto.randomUUID(), command, payload, expectedRevision });
    const snap = await send('SNAPSHOT', {}, 0); if (!snap.ok) throw Error(snap.code);
    const result = await send(command, payload, snap.data.revision); if (!result.ok) throw Error(result.code); return result.data;
  }, { command, payload });
}
async function snapshot(start, predicate, label) {
  return waitUntil(async () => { const s = await command(start, 'SNAPSHOT'); return predicate(s) ? s : null; }, label);
}
const localProjects = s => s.localProjects || [];
const members = (s, key) => s.conversations.filter(row => row.localProject?.projectKey === key);
async function stores(start, names) {
  return start.evaluate(async names => {
    const db = await new Promise((resolve, reject) => { const r = indexedDB.open('vaiwl-start'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    try { return await Promise.all(names.map(name => new Promise((resolve, reject) => { const r = db.transaction(name).objectStore(name).getAll(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); }))); }
    finally { db.close(); }
  }, names);
}
async function fill(page, markup) { await page.locator('#metadata').evaluate((node, markup) => { node.innerHTML = markup; }, markup); }
async function binding(worker, page) {
  const href = page.url();
  return worker.evaluate(async href => {
    const current = (await chrome.storage.session.get('browserSession')).browserSession;
    const candidates = await chrome.tabs.query({ url: href });
    return candidates.map(tab => current.bindings[String(tab.id)]).find(Boolean) || null;
  }, href);
}
async function staleObservation(worker, tabId, old, project, n) {
  return worker.evaluate(async ({ tabId, old, project, n, id }) => {
    const [response] = await chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: ({ old, project, n, id }) => chrome.runtime.sendMessage({
      protocol: 'vaiwl-start-collector/1', operationId: crypto.randomUUID(), command: 'OBSERVE', payload: {
        bindingId: old.id, routeEpoch: old.routeEpoch, identityToken: old.localIdentity?.token, candidates: [{ url: `https://chatgpt.com/c/${id}`, title: `Stale ${n}` }],
        projectCandidate: { state: 'candidate', relationBasis: 'linked-native-panel', projectId: project, nativeTitle: 'Stale name', canonicalUrl: `https://chatgpt.com/g/${project}/project`, members: [{ conversationId: id, canonicalUrl: `https://chatgpt.com/c/${id}`, nativeTitle: `Stale ${n}` }] },
      },
    }), args: [{ old, project, n, id }] });
    return response.result;
  }, { tabId, old, project, n, id: cid(n) });
}
async function routeFixtures(browser) {
  await browser.route(/^https?:\/\//, async route => {
    const target = route.request().url();
    if (['fetch', 'xhr'].includes(route.request().resourceType())) requests.push(target);
    if (target === SESSION) {
      if (persona === null) return route.fulfill({ status: 401, contentType: 'application/json', body: '{}' });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: { id: `synthetic-principal-${persona}`, email: EMAIL }, expires: new Date(Date.now() + 3600000).toISOString(), accessToken: TOKEN }) });
    }
    if (target === ACCOUNTS) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ accounts: { 'irrelevant-roster': { account: { account_id: 'irrelevant-roster', structure: 'personal', is_deactivated: false }, can_access_with_session: true } } }) });
    if (target.startsWith(`${ORIGIN}/`)) return route.fulfill({ status: 200, contentType: 'text/html', body: shell });
    return route.abort();
  });
}
async function launch(profile, harness) {
  const browser = await chromium.launchPersistentContext(profile, {
    ...(process.env.VAIWL_CHROMIUM_EXECUTABLE ? { executablePath: process.env.VAIWL_CHROMIUM_EXECUTABLE } : { channel: 'chromium' }),
    headless: true, viewport: { width: 1280, height: 900 }, args: ['--no-sandbox', `--disable-extensions-except=${harness}`, `--load-extension=${harness}`],
  });
  browser.on('page', page => page.on('pageerror', error => errors.push(String(error))));
  await routeFixtures(browser);
  const worker = browser.serviceWorkers()[0] || await browser.waitForEvent('serviceworker');
  const start = await browser.newPage(); await start.goto(`chrome-extension://${new URL(worker.url()).host}/newtab.html`);
  await start.waitForSelector('html[data-start-ready="true"]'); await command(start, 'PERMISSIONS_SYNC', { enableCapture: true });
  return { browser, worker, start };
}
async function seedLegacyDates(start, records) {
  return start.evaluate(async records => {
    const db = await new Promise((resolve, reject) => { const r = indexedDB.open('vaiwl-start'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const now = Date.now(), recent = new Date(now - 120000).toISOString(), older = new Date(now - 62 * 86400000).toISOString();
    const tx = db.transaction(['conversations', 'openDays', 'revisions'], 'readwrite');
    const done = new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = () => reject(tx.error); });
    for (const [index, record] of records.entries()) {
      const read = tx.objectStore('conversations').get(record.key);
      read.onsuccess = () => {
        const row = read.result, at = index === 0 ? recent : older;
        row.nativeTitle = index === 0 ? 'Existing specific history title' : 'Earlier history member'; row.titleBasis = 'browser-history'; row.titleObservedAt = at; row.browserLastVisitAt = at;
        if (index === 0) {
          row.activity = { firstConfirmedOpenAt: at, lastConfirmedOpenAt: at, lastActiveDate: at.slice(0, 10), timeZone: 'UTC' }; row.lastActiveAt = at;
          tx.objectStore('openDays').put({ recordKey: row.key, timeZone: 'UTC', localDate: at.slice(0, 10), activityUnit: 1, firstOpenedAt: at, lastOpenedAt: at, firstIntentId: 'legacy-fixture', lastIntentId: 'legacy-fixture' });
        }
        tx.objectStore('conversations').put(row);
      };
    }
    const revision = tx.objectStore('revisions').get('main'); revision.onsuccess = () => tx.objectStore('revisions').put({ ...revision.result, value: revision.result.value + 1 });
    await done; db.close();
  }, records);
}

try {
  const harness = await mkdtemp(join(tmpdir(), 'vaiwl-native-project-harness-')); await cp(resolve('dist'), harness, { recursive: true });
  const manifest = JSON.parse(await readFile(join(harness, 'manifest.json'), 'utf8'));
  manifest.permissions.push('scripting', 'webNavigation'); manifest.optional_permissions = manifest.optional_permissions.filter(p => !['scripting', 'webNavigation'].includes(p));
  manifest.host_permissions = [`${ORIGIN}/*`]; manifest.optional_host_permissions = [];
  await writeFile(join(harness, 'manifest.json'), JSON.stringify(manifest));
  for (const file of ['content.js', 'service-worker.js', 'newtab.js']) assert.equal(createHash('sha256').update(await readFile(join(harness, file))).digest('hex'), build.files[file]);
  check('LOCAL-P-production-bytes', true, 'Installed production bundles match the build fingerprint; no parser, repository or UI test hook is substituted.');
  const profile = await mkdtemp(join(tmpdir(), 'vaiwl-native-project-profile-'));
  let { browser, worker, start } = await launch(profile, harness); context = browser;
  browserVersion = context.browser()?.version() || await worker.evaluate(() => navigator.userAgent);
  let native = await context.newPage();
  for (const n of [1, 2]) { await native.goto(conversationUrl(n)); await snapshot(start, s => s.conversations.some(r => r.conversationId === cid(n)), 'Legacy directory fixture was not discovered'); }
  await seedLegacyDates(start, (await command(start, 'SNAPSHOT')).conversations.filter(r => [cid(1), cid(2)].includes(r.conversationId)).sort((a, b) => a.conversationId.localeCompare(b.conversationId)));
  const legacy = await command(start, 'SNAPSHOT'), oldFirst = legacy.conversations.find(r => r.conversationId === cid(1)), oldSecond = legacy.conversations.find(r => r.conversationId === cid(2));
  const daysBefore = (await stores(start, ['openDays']))[0];
  await native.goto(projectUrl(P)); await fill(native, panel());
  const empty = await snapshot(start, s => localProjects(s).some(p => p.projectId === P), 'A supported empty native Project was not saved');
  const pKey = localProjects(empty).find(p => p.projectId === P).key;
  await start.locator('#earlier-projects-toggle').click();
  await start.locator(`[data-local-project="${pKey}"]`).getByRole('heading', { name: TITLE, exact: true }).waitFor();
  check('LOCAL-P-empty-card-without-workspace', localProjects(empty).length === 1 && members(empty, pKey).length === 0 && empty.projects.length === 0 && empty.scopes.length === 0, 'An empty observed native Project has a persistent named Start card without current Workspace certification or invented members.');
  await native.locator('ol').evaluate((node, markup) => node.insertAdjacentHTML('beforeend', markup), member(1, 'ChatGPT') + member(2, 'Earlier history member'));
  const adopted = await snapshot(start, s => members(s, pKey).length === 2, 'Native members did not enter the stable local Project');
  const first = adopted.conversations.find(r => r.key === oldFirst.key), second = adopted.conversations.find(r => r.key === oldSecond.key);
  check('LOCAL-P-members-and-title-separation', first?.localProject?.projectKey === pKey && second?.localProject?.projectKey === pKey && first.nativeTitle === OLD_TITLE && localProjects(adopted)[0].nativeTitle === TITLE && !adopted.conversations.some(r => r.conversationId === cid(99)), 'Direct native member links enter the Project; Project title, conversation title and adjacent ordinary history remain separate.');
  check('LOCAL-P-legacy-data-preserved', JSON.stringify(first.activity) === JSON.stringify(oldFirst.activity) && first.browserLastVisitAt === oldFirst.browserLastVisitAt && first.firstSeenAt === oldFirst.firstSeenAt && first.stableRank === oldFirst.stableRank && second.browserLastVisitAt === oldSecond.browserLastVisitAt && JSON.stringify((await stores(start, ['openDays']))[0]) === JSON.stringify(daysBefore), 'Adopting existing directory rows retains original keys, titles, visits, ranks, first-seen time and existing activity; passive observation creates no OpenDay.');
  const card = start.locator(`[data-local-project="${pKey}"]`);
  await card.locator(`a[data-record-key="${oldFirst.key}"]`).waitFor();
  await card.locator(`.spatial-project-preview a[data-record-key="${oldSecond.key}"]`).waitFor();
  check('LOCAL-P-older-member-stays-in-project', await card.locator(`.spatial-project-preview a[data-record-key="${oldSecond.key}"]`).isVisible() && await start.locator(`#workspace-content a[data-record-key="${oldSecond.key}"]`).count() === 1, 'A member older than the current 30-day window stays under its Project and appears once in the shared card preview; its older date does not require a separate per-card control.');
  await native.locator('ol').evaluate((node, markup) => node.insertAdjacentHTML('beforeend', markup), member(3, 'Same conversation title') + member(4, 'Same conversation title'));
  const expanded = await snapshot(start, s => members(s, pKey).length === 4, 'Incremental members were not observed');
  check('LOCAL-P-incremental-same-title-different-IDs', members(expanded, pKey).filter(r => r.nativeTitle === 'Same conversation title').length === 2 && new Set(members(expanded, pKey).map(r => r.key)).size === 4, 'Late members append to one stable Project; equal titles do not merge different conversation IDs.');
  await native.locator('h1 span').evaluate((node, title) => { node.textContent = title; }, RENAMED);
  const renamed = await snapshot(start, s => localProjects(s).some(p => p.key === pKey && p.nativeTitle === RENAMED), 'Project rename was not saved');
  check('LOCAL-P-rename-keeps-identity', localProjects(renamed).length === 1 && members(renamed, pKey).length === 4 && renamed.conversations.find(r => r.key === oldFirst.key).nativeTitle === OLD_TITLE, 'A Project rename updates its title, keeps the Project key and all observed members, and cannot become a conversation title.');
  const stable = await command(start, 'SNAPSHOT');
  await native.locator('ol').evaluate(node => node.prepend(node.lastElementChild));
  await native.locator('[data-preview]').first().evaluate(node => { node.textContent = 'FORBIDDEN_CHANGED_PREVIEW'; }); await sleep(650);
  const reordered = await command(start, 'SNAPSHOT');
  check('LOCAL-P-reorder-is-idempotent', reordered.revision === stable.revision && localProjects(reordered).length === 1, 'Reordering members and changing only a private preview does not create a new Project, rewrite the directory or read body text.');
  await native.locator('ol li').first().evaluate(node => node.remove()); await sleep(350);
  await native.locator('ol').evaluate(node => node.replaceChildren()); await sleep(350);
  const partial = await command(start, 'SNAPSHOT');
  check('LOCAL-P-missing-partial-empty-no-removal', members(partial, pKey).length === 4 && partial.conversations.every(r => r.membership.state === 'UNKNOWN') && partial.conversations.find(r => r.key === oldFirst.key).activity.lastConfirmedOpenAt === oldFirst.activity.lastConfirmedOpenAt, 'Partial lists and an empty later panel retain every saved member and original activity; no NONE or removal is inferred.');
  const beforeReload = await waitUntil(() => binding(worker, native), 'Current document binding missing');
  await native.reload(); await fill(native, panel([member(5)], RENAMED));
  const reloaded = await snapshot(start, s => members(s, pKey).some(r => r.conversationId === cid(5)), 'Reload did not continue the same local Project');
  check('LOCAL-P-reload-stable-project', localProjects(reloaded).filter(p => p.projectId === P).length === 1 && members(reloaded, pKey).length === 5 && (await binding(worker, native)).documentId !== beforeReload.documentId, 'A new real browser document for the same session principal and Project ID continues the same persistent Project card.');
  const beforeDisclosure = await stores(start, ['conversations', 'openDays']);
  await card.locator(`[data-spatial-expand="${pKey}"]`).click();
  const expandedPanel = start.locator(`[data-expanded-project="${pKey}"]`);
  await expandedPanel.waitFor();
  const displayedMembers = await start.locator(`[data-project="${pKey}"] a.conversation-open,[data-expanded-project="${pKey}"] a.conversation-open`)
    .evaluateAll(nodes => nodes.map(node => ({ key: node.dataset.recordKey, href: node.href, visible: !!node.getClientRects().length })));
  const expectedMembers = members(reloaded, pKey);
  check('LOCAL-P-shared-expansion-keeps-membership-and-links', await card.locator('.spatial-project-preview a.conversation-open').count() === 4
    && await expandedPanel.locator('a.conversation-open').count() === expectedMembers.length - 4
    && displayedMembers.length === expectedMembers.length && new Set(displayedMembers.map(row => row.key)).size === expectedMembers.length
    && expectedMembers.every(record => displayedMembers.some(row => row.key === record.key && row.href === record.canonicalUrl && row.visible)),
    'Four original members remain in the card; the associated full-width panel reveals the remainder once with the same record identities and native URLs.');
  check('LOCAL-P-disclosure-does-not-write-catalog-or-activity', JSON.stringify(await stores(start, ['conversations', 'openDays'])) === JSON.stringify(beforeDisclosure),
    'Opening the shared project panel changes only presentation, preserving conversation metadata, membership, source times and every OpenDay.');
  await card.locator(`[data-spatial-expand="${pKey}"]`).click();
  const old = await staleObservation(worker, beforeReload.tabId, beforeReload, P, 91);
  check('LOCAL-P-expired-document-rejected', old?.ok === false && !(await command(start, 'SNAPSHOT')).conversations.some(r => r.conversationId === cid(91)), 'A real isolated-world message with an expired document binding cannot insert a member.');
  await native.goto(projectUrl(P, '-presentation-slug')); await fill(native, panel([member(6)], RENAMED));
  const slugged = await snapshot(start, s => members(s, pKey).some(r => r.conversationId === cid(6)), 'Project presentation slug was not normalized');
  check('LOCAL-P-slug-is-not-identity', localProjects(slugged).filter(p => p.projectId === P).length === 1 && localProjects(slugged).find(p => p.key === pKey).canonicalUrl === projectUrl(P), 'A supported native presentation slug is normalized to the same Project ID and canonical Project URL.');
  const oldRoute = await binding(worker, native);
  await native.evaluate(href => history.pushState({}, '', href), projectUrl(Q));
  await waitUntil(async () => (await binding(worker, native))?.href === projectUrl(Q), 'SPA route did not bind'); await sleep(450);
  check('LOCAL-P-SPA-retained-panel-not-new-project', !localProjects(await command(start, 'SNAPSHOT')).some(p => p.projectId === Q), 'A changed SPA URL cannot reinterpret the retained previous Project panel as the next Project.');
  await fill(native, panel([member(7)], RENAMED));
  const sameName = await snapshot(start, s => localProjects(s).some(p => p.projectId === Q), 'Second native Project was not saved');
  const qKey = localProjects(sameName).find(p => p.projectId === Q).key;
  check('LOCAL-P-same-name-distinct-IDs', qKey !== pKey && localProjects(sameName).filter(p => p.nativeTitle === RENAMED).length === 2 && members(sameName, pKey).length === 6 && members(sameName, qKey).length === 1, 'Two native Project IDs with exactly the same name remain separate cards and member sets.');
  const stale = await staleObservation(worker, oldRoute.tabId, oldRoute, P, 92);
  check('LOCAL-P-stale-SPA-event-rejected', stale?.ok === false && !(await command(start, 'SNAPSHOT')).conversations.some(r => r.conversationId === cid(92)), 'Old SPA route events cannot write after the route binding changes.');
  await start.locator('#search-trigger').click(); await start.locator('#search-input').fill(RENAMED);
  await waitUntil(async () => Number(await start.locator('#search-results').getAttribute('data-total-matches')) >= 7, 'Project-name search did not find all observed members');
  check('LOCAL-P-project-name-search', await start.locator(`#search-results a[data-record-key="${oldFirst.key}"]`).count() === 1 && await start.locator(`#search-results a[data-record-key="${oldSecond.key}"]`).count() === 1, 'Project-name search reaches both recent and older native members across the entire saved local directory.');
  await start.locator('[data-close="search-dialog"]').click();

  await native.goto(projectUrl(P)); await fill(native, panel([member(1, 'ChatGPT')], RENAMED));
  await snapshot(start, s => localProjects(s).find(p => p.key === pKey)?.source?.href === projectUrl(P), 'A Project did not settle before the same-document identity transition');
  const aBefore = await command(start, 'SNAPSHOT'), aProject = localProjects(aBefore).find(p => p.key === pKey), aRecord = aBefore.conversations.find(r => r.key === oldFirst.key);
  const sameDocument = await binding(worker, native);
  persona = 'b';
  await native.locator('h1 span').evaluate(node => { node.textContent = 'Retained A surface during account transition'; });
  await waitUntil(async () => { const current = await binding(worker, native); return current?.localIdentity?.principalKey && current.localIdentity.principalKey !== sameDocument.localIdentity.principalKey; }, 'Same-document principal change was not rechecked');
  await sleep(550);
  const retainedPanel = await command(start, 'SNAPSHOT');
  check('LOCAL-P-same-document-old-surface-rejected', localProjects(retainedPanel).filter(p => p.projectId === P).length === 1 && localProjects(retainedPanel).find(p => p.key === pKey).nativeTitle === RENAMED && JSON.stringify(retainedPanel.conversations.find(r => r.key === aRecord.key)) === JSON.stringify(aRecord), 'Changing session principal while the old native panel is retained cannot assign that panel, its changed heading or its members to the new identity.');
  await fill(native, panel([member(1, 'B account private title')], RENAMED));
  const bSnapshot = await snapshot(start, s => localProjects(s).filter(p => p.projectId === P).length === 2, 'Different principal did not isolate the same Project ID');
  const bProject = localProjects(bSnapshot).find(p => p.projectId === P && p.key !== pKey), bRecord = members(bSnapshot, bProject.key).find(r => r.conversationId === cid(1));
  check('LOCAL-P-principal-boundary-isolation', bProject.boundaryKey !== aProject.boundaryKey && bProject.identityBasis === 'principal' && bRecord.key !== aRecord.key && bRecord.nativeTitle === 'B account private title' && bRecord.activity === null && bRecord.browserLastVisitAt === null && JSON.stringify(bSnapshot.conversations.find(r => r.key === aRecord.key)) === JSON.stringify(aRecord), 'The same Project and conversation IDs under a different observed session principal get separate local identities; prior title, history and activity stay with the original record.');
  persona = 'a'; await fill(native, panel([member(8)], RENAMED));
  const sameDocumentReturned = await snapshot(start, s => members(s, pKey).some(r => r.conversationId === cid(8)), 'Fresh replacement panel during the reverse identity transition was lost');
  check('LOCAL-P-same-document-fresh-surface-resumes', (await binding(worker, native)).documentId === sameDocument.documentId && members(sameDocumentReturned, bProject.key).length === 1 && localProjects(sameDocumentReturned).filter(p => p.projectId === P).length === 2, 'A fresh native panel replacing B during a reverse B-to-A account switch is naturally observed in the same browser document; the identity barrier does not permanently discard valid new metadata.');
  const oldMember8 = members(sameDocumentReturned, pKey).find(r => r.conversationId === cid(8));
  const again = await context.newPage(); await again.goto(projectUrl(P)); await fill(again, panel([member(8)], RENAMED));
  const returned = await snapshot(start, s => members(s, pKey).find(r => r.conversationId === cid(8))?.localProject.observedAt !== oldMember8.localProject.observedAt, 'The original principal did not resume its own Project in a new tab');
  check('LOCAL-P-principal-return-stable', localProjects(returned).filter(p => p.projectId === P).length === 2 && members(returned, bProject.key).length === 1 && members(returned, pKey).length === 7, 'Returning in a new tab with the original principal reuses its original Project and does not absorb another principal\'s members.');
  await again.close();
  persona = null; const unknown = await context.newPage(); await unknown.goto(projectUrl(U)); await fill(unknown, panel([member(81)], 'Unidentified native Project'));
  const unknownFirst = await snapshot(start, s => localProjects(s).some(p => p.projectId === U), 'Document-bound local grouping was not available without a principal');
  const uKey = localProjects(unknownFirst).find(p => p.projectId === U).key;
  await unknown.locator('ol').evaluate((node, markup) => node.insertAdjacentHTML('beforeend', markup), member(82));
  const unknownUpdate = await snapshot(start, s => members(s, uKey).length === 2, 'Unknown principal document did not update incrementally');
  check('LOCAL-P-unknown-document-stability', localProjects(unknownUpdate).filter(p => p.projectId === U).length === 1 && localProjects(unknownUpdate).find(p => p.key === uKey).identityBasis === 'document', 'Unavailable principal metadata still permits the directly observed Project relation to organize within the same document boundary.');
  await unknown.reload(); await fill(unknown, panel([member(81, 'Other unknown document title')], 'Unidentified native Project'));
  const unknownReload = await snapshot(start, s => localProjects(s).filter(p => p.projectId === U).length === 2, 'Unknown identity documents were merged');
  const otherU = localProjects(unknownReload).find(p => p.projectId === U && p.key !== uKey);
  check('LOCAL-P-unknown-documents-do-not-merge', otherU.boundaryKey !== localProjects(unknownReload).find(p => p.key === uKey).boundaryKey && members(unknownReload, uKey).length === 2 && members(unknownReload, otherU.key).length === 1 && members(unknownReload, uKey).find(r => r.conversationId === cid(81)).nativeTitle === 'Native member 81', 'A new unauthenticated/unavailable-principal document cannot silently merge or rewrite a prior unknown identity boundary.');
  await unknown.close();

  persona = 'a';
  const otherProfile = await mkdtemp(join(tmpdir(), 'vaiwl-native-project-other-profile-'));
  const other = await launch(otherProfile, harness); otherContext = other.browser;
  check('LOCAL-P-fresh-Profile-empty', (await command(other.start, 'SNAPSHOT')).conversations.length === 0 && localProjects(await command(other.start, 'SNAPSHOT')).length === 0, 'A second actual browser Profile has an independent empty local database.');
  const otherNative = await otherContext.newPage(); await otherNative.goto(projectUrl(P)); await fill(otherNative, panel([member(1)], RENAMED));
  const otherSnapshot = await snapshot(other.start, s => localProjects(s).some(p => p.projectId === P), 'Second Profile did not observe its own native Project');
  check('LOCAL-P-same-ID-cross-Profile-isolation', otherSnapshot.localProfileKey !== returned.localProfileKey && localProjects(otherSnapshot)[0].key !== pKey && otherSnapshot.conversations[0].key !== aRecord.key, 'The same observed principal, Project ID and conversation ID in another actual Profile remain fully separate.');
  await otherContext.close(); otherContext = null;
  const beforeRestart = await command(start, 'SNAPSHOT');
  await context.close(); context = null;
  ({ browser, worker, start } = await launch(profile, harness)); context = browser;
  const restarted = await command(start, 'SNAPSHOT');
  check('LOCAL-P-persistence-after-browser-restart', JSON.stringify(localProjects(restarted)) === JSON.stringify(localProjects(beforeRestart)) && JSON.stringify(restarted.conversations) === JSON.stringify(beforeRestart.conversations), 'A full browser process restart preserves all local Project entities, member references and existing directory records.');
  native = await context.newPage(); await native.goto(projectUrl(P)); await fill(native, panel([member(9)], RENAMED));
  const afterRestart = await snapshot(start, s => members(s, pKey).some(r => r.conversationId === cid(9)), 'A restarted browser did not resume the stable principal Project');
  check('LOCAL-P-observation-after-restart-no-duplicate', localProjects(afterRestart).filter(p => p.projectId === P).length === 2 && members(afterRestart, pKey).length === 8, 'The same principal after a new browser session continues its prior Project key rather than creating one card per observation/session.');
  await native.goto(`${ORIGIN}/g/${P}-presentation-slug/c/${cid(10)}`);
  const explicit = await snapshot(start, s => members(s, pKey).some(r => r.conversationId === cid(10)), 'Explicit native Project conversation URL did not add its member');
  check('LOCAL-P-explicit-Project-URL', members(explicit, pKey).find(r => r.conversationId === cid(10)).nativeTitle === null && localProjects(explicit).find(p => p.key === pKey).nativeTitle === RENAMED, 'The explicit native g-p Project ID in a conversation route proves that local relation; absent title metadata does not borrow document.title or erase the known Project name.');
  await native.goto(conversationUrl(11));
  await fill(native, `<nav aria-label="Chat history"><a href="/g/${P}/project"><span>${RENAMED}</span></a><a href="/g/${P}/c/${cid(12)}" aria-label="Sidebar member, chat in project ${RENAMED}, Work, unread"><span>Sidebar member</span></a><a href="/c/${cid(13)}" aria-label="Name-only member, chat in project ${RENAMED}, Work, unread"><span>Name-only member</span></a></nav>`);
  const sidebar = await snapshot(start, s => members(s, pKey).some(r => r.conversationId === cid(12)), 'Explicit native sidebar relation did not add its member');
  check('LOCAL-P-sidebar-explicit-ID-only', members(sidebar, pKey).find(r => r.conversationId === cid(12)).nativeTitle === 'Sidebar member' && !members(sidebar, pKey).some(r => r.conversationId === cid(13)), 'A sidebar link carrying a matching Project ID adds a local member; a plain conversation URL with only a matching Project name does not.');
  await native.goto(projectUrl(Q));
  await fill(native, `<main><h1><button aria-label="Edit the title of Alternate adapter Project"><span>Alternate adapter Project</span></button></h1><section><div role="tablist"><button role="tab" aria-selected="true" id="flexible-tab" aria-controls="flexible-panel">Chats</button></div><div class="wrapper"><div role="tabpanel" id="flexible-panel" aria-labelledby="flexible-tab"><ul><li><div><a href="/c/${cid(15)}" aria-label="Flexible member"><span>Flexible member</span><p data-preview>${BODY}</p></a></div></li></ul></div></section></main>`);
  const alternate = await snapshot(start, s => members(s, qKey).some(r => r.conversationId === cid(15)), 'Independent semantic Project adapter did not collect its member');
  check('LOCAL-P-semantic-adapter-different-hierarchy', localProjects(alternate).find(p => p.key === qKey).nativeTitle === 'Alternate adapter Project' && members(alternate, qKey).find(r => r.conversationId === cid(15)).nativeTitle === 'Flexible member', 'A second independently checked Project heading/tab/panel/list structure works without the original fixed DIV/SECTION/OL hierarchy.');
  await native.goto(`${ORIGIN}/g/g-example-custom-gpt/c/${cid(14)}`);
  const generic = await snapshot(start, s => s.conversations.some(r => r.conversationId === cid(14)), 'Generic container conversation was not retained as ordinary history');
  check('LOCAL-P-generic-GPT-is-not-Project', generic.conversations.filter(r => r.conversationId === cid(14)).every(r => !r.localProject && r.membership.state === 'UNKNOWN'), 'A generic custom-GPT container is not parsed as a native Project identity.');
  await native.goto(projectUrl(P)); await fill(native, panel([member(9)], RENAMED));
  await snapshot(start, s => localProjects(s).find(p => p.key === pKey)?.source?.href === projectUrl(P), 'Principal Project did not settle before logout');
  const beforeLogout = await waitUntil(async () => { const current = await binding(worker, native); return current?.localIdentity?.principalKey ? current : null; }, 'Pre-logout identity binding missing');
  persona = null; await native.reload(); await fill(native, panel([member(96)], RENAMED));
  const loggedOut = await snapshot(start, s => localProjects(s).some(p => p.projectId === P && p.identityBasis === 'document' && members(s, p.key).some(r => r.conversationId === cid(96))), 'Logout/unavailable principal did not establish a new document boundary');
  const oldLogin = await staleObservation(worker, beforeLogout.tabId, beforeLogout, P, 97);
  check('LOCAL-P-logout-does-not-reuse-principal', !members(loggedOut, pKey).some(r => r.conversationId === cid(96)) && oldLogin?.ok === false && !(await command(start, 'SNAPSHOT')).conversations.some(r => r.conversationId === cid(97)), 'After the session endpoint reports unauthenticated on a new document, local observations cannot reuse the old principal boundary and old events remain rejected.');
  const logoutBinding = await binding(worker, native);
  const aBeforeResume = localProjects(loggedOut).find(p => p.key === pKey).observedAt;
  persona = 'a'; await native.reload(); await fill(native, panel([member(9)], RENAMED));
  await waitUntil(async () => { const current = await binding(worker, native); return current && current.documentId !== logoutBinding.documentId && current.localIdentity?.principalKey; }, 'Authenticated document did not rebind');
  await snapshot(start, s => localProjects(s).find(p => p.key === pKey)?.observedAt !== aBeforeResume, 'Authenticated Project observation did not resume');
  await start.screenshot({ path: join(output, 'native-project-grouping.png'), fullPage: true });

  const beforeStop = await command(start, 'SNAPSHOT');
  await command(start, 'SETTINGS_UPDATE', { patch: { captureEnabled: false } });
  await native.locator('ol').evaluate((node, markup) => node.insertAdjacentHTML('beforeend', markup), member(93)); await sleep(450);
  const stopped = await command(start, 'SNAPSHOT');
  check('LOCAL-P-capture-stop-preserves-catalog', !stopped.conversations.some(r => r.conversationId === cid(93)) && JSON.stringify(stopped.conversations) === JSON.stringify(beforeStop.conversations) && JSON.stringify(localProjects(stopped)) === JSON.stringify(localProjects(beforeStop)), 'Disabling capture stops future local observations while retaining saved Project and directory data.');
  await command(start, 'PERMISSIONS_SYNC', { enableCapture: true });
  await snapshot(start, s => members(s, pKey).some(r => r.conversationId === cid(93)), 'Re-enabled capture did not resume local Project updates');
  await context.close(); context = null;
  await writeFile(join(harness, 'manifest.json'), JSON.stringify({ ...manifest, host_permissions: [], optional_host_permissions: [`${ORIGIN}/*`] }));
  ({ browser, worker, start } = await launch(profile, harness)); context = browser;
  assert.equal((await command(start, 'SNAPSHOT')).capabilities.chatgpt, true, 'The test Profile must retain its existing synthetic host grant for actual removal');
  native = await context.newPage(); await native.goto(projectUrl(P)); await fill(native, panel([member(94)], RENAMED));
  const beforeRevoke = await snapshot(start, s => members(s, pKey).some(r => r.conversationId === cid(94)), 'Observation before host revocation did not settle');
  const revoked = await start.evaluate(() => chrome.permissions.remove({ origins: ['https://chatgpt.com/*'] }));
  await waitUntil(async () => !(await command(start, 'SNAPSHOT')).capabilities.chatgpt, 'Host revocation not observed');
  await native.locator('ol').evaluate((node, markup) => node.insertAdjacentHTML('beforeend', markup), member(95)); await sleep(450);
  const final = await command(start, 'SNAPSHOT');
  check('LOCAL-P-real-permission-revocation', revoked && !final.conversations.some(r => r.conversationId === cid(95)) && JSON.stringify(final.conversations) === JSON.stringify(beforeRevoke.conversations) && JSON.stringify(localProjects(final)) === JSON.stringify(localProjects(beforeRevoke)), 'Actual Chrome host-permission removal prevents subsequent writes without deleting saved local Projects or member history.');
  const [formalProjects, scopes, witnesses, days, settings] = await stores(start, ['projects', 'scopes', 'witnesses', 'openDays', 'settings']);
  const persistent = JSON.stringify(await stores(start, ['conversations', 'projects', 'scopes', 'witnesses', 'openDays', 'settings']));
  check('LOCAL-P-certification-boundary', formalProjects.length === 0 && scopes.length === 0 && witnesses.length === 0 && final.conversations.every(r => r.owner.kind === 'unassigned' && r.membership.state === 'UNKNOWN') && localProjects(final).every(p => p.trust === 'native-relation-observed' && p.membershipCoverage === 'observed-only') && settings.filter(r => r.key.startsWith('localProject:')).length === localProjects(final).length, 'Local observed native relations use their independent persistent model; they do not write certified ProjectRecord, PROJECT/NONE membership, account scopes or formal witnesses.');
  check('LOCAL-P-metadata-only-and-activity-preserved', [BODY, 'FORBIDDEN_CHANGED_PREVIEW', TOKEN, EMAIL].every(secret => !persistent.includes(secret)) && requests.length > 0 && requests.every(target => target === SESSION) && JSON.stringify(days) === JSON.stringify(daysBefore), 'Only allowed metadata reaches storage; tokens, email and previews do not. Normal local grouping reads only the existing session endpoint, never a Workspace roster, conversation endpoint or passive activity.');
  const schema = await start.evaluate(async () => { const db = await new Promise(resolve => { const r = indexedDB.open('vaiwl-start'); r.onsuccess = () => resolve(r.result); }); const value = { version: db.version, names: [...db.objectStoreNames] }; db.close(); return value; });
  check('LOCAL-P-v1-nondestructive-storage', schema.version === 1 && schema.names.length === 12 && final.conversations.find(r => r.key === oldFirst.key).browserLastVisitAt === oldFirst.browserLastVisitAt && final.conversations.find(r => r.key === oldFirst.key).nativeTitle === OLD_TITLE, 'Database v1 and all twelve existing stores remain; local project rows require no clear, reimport or destructive schema migration.');
  check('LOCAL-P-no-page-errors', errors.length === 0, `Actual extension/page runtime errors: ${JSON.stringify(errors)}`);
  await writeFile(join(output, 'native-project-grouping-validation.json'), JSON.stringify({ status: 'PASS', buildSha: build.sha, dirty: build.dirty, browserVersion, environment: 'isolated installed Chromium; synthetic native metadata and session fixtures; unchanged production JS', checks, errors, limitations }, null, 2));
  console.log(JSON.stringify({ status: 'PASS', checks: checks.length, buildSha: build.sha, browserVersion }));
} catch (error) {
  await writeFile(join(output, 'native-project-grouping-validation.json'), JSON.stringify({ status: 'FAIL', buildSha: build.sha, dirty: build.dirty, browserVersion, checks, errors, error: String(error), limitations }, null, 2));
  throw error;
} finally { if (otherContext) await otherContext.close(); if (context) await context.close(); }
