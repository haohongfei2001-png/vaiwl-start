/** Synthetic DOM timing/metadata tests; not a live ChatGPT source certificate. */
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as immediate } from 'node:timers';
import { JSDOM } from 'jsdom';
import { startProjectObservation, type ProjectObservationMemory } from '../../src/collectors/chatgpt/project-observer.js';
import type { ProjectCandidate } from '../../src/collectors/chatgpt/project-candidate.js';

const P = 'g-p-11111111111111111111111111111111';
const Q = 'g-p-22222222222222222222222222222222';
const C = '12345678-1234-1234-1234-123456789abc';
const D = '22345678-1234-1234-1234-123456789abc';
const url = (project = P) => `https://chatgpt.com/g/${project}/project`;
const row = (id: string, title = 'Member title') => `<li><a href="/c/${id}"><div><div>${title}</div><div data-preview>PRIVATE PREVIEW</div></div></a></li>`;
const html = (members = row(C)) => `<main data-app-shell-main-surface><div data-app-shell-main-content-layout><div role="main"><h1><button><span>Project title</span></button></h1><div><div role="tablist"><button role="tab" aria-selected="true" id="t" aria-controls="p">Chats</button></div><div role="tabpanel" id="p" aria-labelledby="t"><section><ol>${members}</ol></section></div></div></div></div></main><aside><a href="/c/${D}">Unrelated history</a></aside>`;
const flush = () => new Promise<void>(resolve => immediate(resolve));
async function advance(t: TestContext, ms = 0) {
  // MutationObserver delivery and the async acknowledgement are microtasks;
  // flush them on both sides of the controlled production timer.
  await flush(); t.mock.timers.tick(ms); await flush();
}
function fixture(t: TestContext, initial = html()) {
  const dom = new JSDOM(initial, { url: url(), pretendToBeVisual: true });
  const document = dom.window.document;
  Object.defineProperty(dom.window.Element.prototype, 'getClientRects', { value() { return [{ x: 0, y: 0, width: 80, height: 20 }]; } });
  Object.defineProperty(dom.window, 'CSS', { value: { escape: (id: string) => id } });
  let privateReads = 0;
  const protectedNodes = new WeakSet<Element>();
  function protect() {
    for (const node of [document.documentElement, document.body, ...document.querySelectorAll('[data-preview]')]) {
      if (protectedNodes.has(node)) continue;
      protectedNodes.add(node);
      for (const field of ['textContent', 'innerHTML', 'outerHTML']) {
        Object.defineProperty(node, field, { get() { privateReads++; throw Error(`forbidden private ${field} read`); } });
      }
    }
  }
  protect();
  const stops: Array<() => void> = [];
  function start(deliver: (candidate: ProjectCandidate) => Promise<boolean>, memory: ProjectObservationMemory = {}, current = () => true) {
    const controller = new AbortController();
    const stop = startProjectObservation(document, { signal: controller.signal, current, memory, deliver });
    stops.push(stop);
    return { controller, stop, memory };
  }
  function addRows(markup: string) {
    document.querySelector('ol')!.append(document.createRange().createContextualFragment(markup));
    protect();
  }
  t.after(() => {
    for (const stop of stops) stop();
    dom.window.close();
    assert.equal(privateReads, 0, 'observer/parser must never read preview or full-page text/HTML, including failure paths');
  });
  return { dom, document, start, addRows, protect };
}

test('incremental Project observation survives late hydration, empty projects, and member additions', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = fixture(t, '<main></main>'), seen: ProjectCandidate[] = [];
  h.start(async candidate => { seen.push(candidate); return true; });
  await advance(t, 0);
  await advance(t, 3000);
  assert.equal(seen.length, 0, 'unproven shell must not become a Project');
  h.document.body.replaceChildren(h.document.createRange().createContextualFragment(html('')));
  h.protect();
  await advance(t, 120);
  assert.equal(seen.length, 1);
  assert.equal(seen[0]!.projectId, P);
  assert.deepEqual(seen[0]!.members, [], 'an empty proven panel is a candidate, not an invented member');
  h.addRows(row(C, 'Same member title'));
  await advance(t, 120);
  h.addRows(row(D, 'Same member title'));
  await advance(t, 120);
  assert.deepEqual(seen.map(candidate => candidate.members.length), [0, 1, 2]);
  assert.deepEqual(seen[2]!.members.map(member => member.conversationId), [C, D], 'same title must not merge distinct IDs');
  assert.ok(seen.every(candidate => candidate.state === 'candidate' && !Object.hasOwn(candidate, 'scopeKey')));
});

test('Project and member renames update their own metadata, without rereading previews', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = fixture(t), seen: ProjectCandidate[] = [];
  h.start(async candidate => { seen.push(candidate); return true; });
  await advance(t, 0);
  h.document.querySelector('h1 span')!.firstChild!.nodeValue = 'Renamed project';
  await advance(t, 120);
  assert.equal(seen[1]!.nativeTitle, 'Renamed project');
  assert.equal(seen[1]!.members[0]!.nativeTitle, 'Member title');
  h.document.querySelector('li a > div > div')!.firstChild!.nodeValue = 'Renamed member';
  await advance(t, 120);
  assert.equal(seen[2]!.nativeTitle, 'Renamed project');
  assert.equal(seen[2]!.members[0]!.nativeTitle, 'Renamed member');
  assert.equal(JSON.stringify(seen).includes('PRIVATE'), false);
});

test('one in-flight delivery coalesces concurrent changes into the latest Project snapshot', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = fixture(t), seen: ProjectCandidate[] = [];
  let release!: (accepted: boolean) => void;
  let active = 0, maxActive = 0;
  h.start(async candidate => {
    active++; maxActive = Math.max(maxActive, active); seen.push(candidate);
    try { return seen.length === 1 ? await new Promise<boolean>(resolve => { release = resolve; }) : true; }
    finally { active--; }
  });
  await advance(t, 0);
  assert.equal(seen.length, 1);
  h.addRows(row(D, 'Added while sending'));
  h.document.querySelector('h1 span')!.firstChild!.nodeValue = 'Updated while sending';
  await advance(t, 120);
  assert.equal(seen.length, 1, 'a slow acknowledgement must not cause concurrent sends');
  release(true); await flush(); await advance(t, 120);
  assert.equal(seen.length, 2);
  assert.equal(seen[1]!.nativeTitle, 'Updated while sending');
  assert.deepEqual(seen[1]!.members.map(member => member.conversationId), [C, D]);
  assert.equal(maxActive, 1);
  await advance(t, 5000);
  assert.equal(seen.length, 2);
});

test('failed acknowledgement retries once and a successful acknowledgement deduplicates the snapshot', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = fixture(t), seen: ProjectCandidate[] = [];
  h.start(async candidate => { seen.push(candidate); if (seen.length === 1) throw Error('transient IPC failure'); return true; });
  await advance(t, 0);
  assert.equal(seen.length, 1);
  await advance(t, 499); assert.equal(seen.length, 1);
  await advance(t, 1); assert.equal(seen.length, 2);
  assert.deepEqual(seen[1], seen[0]);
  await advance(t, 5000); assert.equal(seen.length, 2);
  h.document.querySelector('h1 span')!.firstChild!.nodeValue = 'Project title';
  await advance(t, 120); assert.equal(seen.length, 2, 'only an acknowledged signature suppresses a duplicate write');
});

test('repeated delivery failure has at most one automatic retry per snapshot', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = fixture(t), seen: ProjectCandidate[] = [];
  h.start(async candidate => { seen.push(candidate); return false; });
  await advance(t, 0); await advance(t, 500);
  assert.equal(seen.length, 2);
  await advance(t, 5000); await advance(t, 5000);
  assert.equal(seen.length, 2, 'failed IPC must not start an infinite polling loop');
  h.document.querySelector('h1 span')!.firstChild!.nodeValue = 'New snapshot';
  await advance(t, 120); await advance(t, 500);
  assert.equal(seen.length, 4, 'a genuinely new snapshot gets its own bounded retry');
  assert.equal(seen[2]!.nativeTitle, 'New snapshot');
  await advance(t, 5000); assert.equal(seen.length, 4);
});

test('reordering, duplicate renders and preview changes do not produce duplicate observations', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = fixture(t, html(row(D) + row(C))), seen: ProjectCandidate[] = [];
  h.start(async candidate => { seen.push(candidate); return true; });
  await advance(t, 0);
  assert.deepEqual(seen[0]!.members.map(member => member.conversationId), [C, D], 'canonical order is independent of rendered order');
  const ol = h.document.querySelector('ol')!;
  ol.append(ol.firstElementChild!);
  await advance(t, 120); assert.equal(seen.length, 1);
  h.document.querySelector('li a > div > div')!.firstChild!.nodeValue = 'Member title';
  h.document.querySelector('[data-preview]')!.firstChild!.nodeValue = 'PRIVATE UPDATED PREVIEW';
  h.document.querySelector('aside a')!.firstChild!.nodeValue = 'Unrelated sidebar changed';
  await advance(t, 120); assert.equal(seen.length, 1);
  ol.firstElementChild!.remove();
  await advance(t, 120);
  assert.equal(seen.length, 2);
  assert.equal(seen[1]!.members.length, 1, 'member disappearance is only a new partial observation');
  assert.equal(seen[1]!.state, 'candidate');
  assert.equal(Object.hasOwn(seen[1], 'deletedMembers'), false);
});

test('abort and explicit stop disconnect pending mutations and retry timers', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = fixture(t), seen: ProjectCandidate[] = [];
  const observer = h.start(async candidate => { seen.push(candidate); return false; });
  await advance(t, 0); assert.equal(seen.length, 1);
  h.document.querySelector('h1 span')!.firstChild!.nodeValue = 'Must not be delivered';
  observer.controller.abort();
  await advance(t, 5000); assert.equal(seen.length, 1);
  const second = h.start(async candidate => { seen.push(candidate); return true; });
  second.stop();
  await advance(t, 5000); assert.equal(seen.length, 1, 'explicit STOP before the first sample cancels it');
});

test('changed route or invalidated current document cancels a queued Project observation', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = fixture(t), seen: ProjectCandidate[] = [];
  let current = true;
  h.start(async candidate => { seen.push(candidate); return true; }, {}, () => current);
  await advance(t, 0);
  h.document.querySelector('h1 span')!.firstChild!.nodeValue = 'Queued stale metadata';
  current = false;
  await advance(t, 120); assert.equal(seen.length, 1);
  current = true;
  h.start(async candidate => { seen.push(candidate); return true; });
  h.dom.reconfigure({ url: `https://chatgpt.com/c/${C}` });
  await advance(t, 5000); assert.equal(seen.length, 1, 'ordinary conversation must not inherit a Project panel');
  h.start(async candidate => { seen.push(candidate); return true; });
  await advance(t, 5000); assert.equal(seen.length, 1, 'observer is disabled on a non-Project route');
});

test('a reused old panel remains rejected across Project routes even if titles change', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = fixture(t), seen: ProjectCandidate[] = [], memory: ProjectObservationMemory = {};
  const old = h.start(async candidate => { seen.push(candidate); return true; }, memory);
  await advance(t, 0); old.stop();
  h.dom.reconfigure({ url: url(Q) });
  h.start(async candidate => { seen.push(candidate); return true; }, memory);
  await advance(t, 0); assert.equal(seen.length, 1);
  h.document.querySelector('h1 span')!.firstChild!.nodeValue = 'Q title hydrated first';
  h.document.querySelector('li a > div > div')!.firstChild!.nodeValue = 'Old member renamed';
  await advance(t, 120);
  assert.equal(seen.length, 1, 'a title mutation cannot certify that the reused membership panel belongs to Q');
  h.document.querySelector('ol a')!.setAttribute('href', `/g/${Q}/c/${C}`);
  await advance(t, 120);
  assert.equal(seen.length, 2, 'an explicit matching container is additional route linkage');
  assert.equal(seen[1]!.projectId, Q);
  assert.equal(seen[1]!.members[0]!.conversationId, C);
  assert.equal(seen[1]!.state, 'candidate', 'stronger local linkage still does not certify account/membership');
});

test('replacement panel allows same-title Projects with distinct IDs without reusing the old observation', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = fixture(t), seen: ProjectCandidate[] = [], memory: ProjectObservationMemory = {};
  const old = h.start(async candidate => { seen.push(candidate); return true; }, memory);
  await advance(t, 0); old.stop();
  h.dom.reconfigure({ url: url(Q) });
  h.start(async candidate => { seen.push(candidate); return true; }, memory);
  await advance(t, 0); assert.equal(seen.length, 1);
  const panel = h.document.querySelector('[role="tabpanel"]')!;
  panel.replaceWith(panel.cloneNode(true)); h.protect();
  await advance(t, 120);
  assert.deepEqual(seen.map(candidate => candidate.projectId), [P, Q]);
  assert.equal(seen[0]!.nativeTitle, seen[1]!.nativeTitle);
  assert.ok(seen.every(candidate => candidate.state === 'candidate'));
});

test('a reused panel with mixed old plain links and new container links remains rejected until every member matches the new Project', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = fixture(t, html(row(C, 'First member') + row(D, 'Second member')));
  const seen: ProjectCandidate[] = [], memory: ProjectObservationMemory = {};
  const old = h.start(async candidate => { seen.push(candidate); return true; }, memory);
  await advance(t, 0);
  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0]!.members.map(member => member.conversationId), [C, D]);
  old.stop();

  h.dom.reconfigure({ url: url(Q) });
  h.start(async candidate => { seen.push(candidate); return true; }, memory);
  await advance(t, 0);
  h.document.querySelector('h1 span')!.firstChild!.nodeValue = 'Q title hydrated first';
  await advance(t, 120);
  assert.equal(seen.length, 1, 'the new title cannot reassign old plain /c/ members');

  const links = h.document.querySelectorAll('ol a');
  links[0]!.setAttribute('href', `/g/${Q}/c/${C}`);
  await advance(t, 120);
  assert.equal(seen.length, 1, 'one updated member cannot certify other members left in the reused panel');
  assert.equal(memory.last!.projectId, P, 'partial hydration must not overwrite the old-panel guard');

  links[1]!.setAttribute('href', `/g/${Q}/c/${D}`);
  await advance(t, 120);
  assert.equal(seen.length, 2);
  assert.equal(seen[1]!.projectId, Q);
  assert.deepEqual(seen[1]!.members.map(member => member.conversationId), [C, D]);
  assert.equal(seen[1]!.state, 'candidate', 'complete local linkage still does not establish account scope or formal membership');
});
