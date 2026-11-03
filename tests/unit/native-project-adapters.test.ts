/** Synthetic source-shape checks; these do not claim live ChatGPT validation. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { parseConversationUrl, parseProjectUrl, projectIdFromContainer } from '../../src/domain/ids.js';
import { observeNativeProjectSnapshots } from '../../src/collectors/chatgpt/native-projects.js';
import { parseLocalProjectCandidate } from '../../src/collectors/chatgpt/project-candidate.js';

const P = 'g-p-6aa291f71f5481919da8335dfd4967c5';
const Q = 'g-p-22222222222222222222222222222222';
const C = '12345678-1234-1234-1234-123456789abc';
const D = '22345678-1234-1234-1234-123456789abc';
const project = (id = P) => `https://chatgpt.com/g/${id}/project`;
const contained = (id = P, cid = C) => `https://chatgpt.com/g/${id}/c/${cid}`;
const row = (cid = C, title = 'Member title') => `<li><div><a href="/c/${cid}" aria-label="${title}"><span>${title}</span><p data-preview>PRIVATE PREVIEW</p></a></div></li>`;
const panel = (members = row(), title = 'Native project') => `<main><h1><button aria-label="Edit the title of ${title}"><span>${title}</span></button></h1><section><div role="tablist"><button role="tab" aria-selected="true" id="t" aria-controls="p">Chats</button></div><div class="layout"><div role="tabpanel" id="p" aria-labelledby="t"><ul>${members}</ul></div></div></section></main>`;
function fixture(markup: string, url = project()) {
  const dom = new JSDOM(markup, { url, pretendToBeVisual: true }); let privateReads = 0;
  Object.defineProperty(dom.window.Element.prototype, 'getClientRects', { value() { return [{ x: 0, y: 0, width: 80, height: 20 }]; } });
  for (const node of [dom.window.document.body, dom.window.document.documentElement, ...dom.window.document.querySelectorAll('[data-preview],[data-message-author-role]')]) {
    for (const field of ['textContent', 'innerHTML', 'outerHTML']) Object.defineProperty(node, field, { get() { privateReads++; throw Error('private read'); } });
  }
  return { dom, document: dom.window.document, close() { dom.window.close(); assert.equal(privateReads, 0); } };
}
test('native Project slugs are presentation metadata, with safe fixed IDs and no generic GPT inference', () => {
  const source = `${project().replace('/project', '-testarossa/project')}`;
  assert.deepEqual(parseProjectUrl(source), { projectId: P, canonicalUrl: project() });
  assert.equal(parseConversationUrl(contained(`${P}-renamed-project`))!.containerHint, P);
  assert.equal(projectIdFromContainer('g-generic-gpt'), null);
  assert.equal(projectIdFromContainer(P + 'a'), null);
  for (const bad of [`${P}--/x`, `${P}-%2e`, `${P}-bad slug`, `${P}-${'a'.repeat(92)}`]) assert.equal(parseProjectUrl(project(bad)), null);
});
test('semantic native panel tolerates wrapper/list changes and keeps Project/member titles separate', () => {
  const h = fixture(panel(row(C, 'Same member') + row(D, 'Same member')));
  try {
    const snapshots = observeNativeProjectSnapshots(h.document); assert.equal(snapshots.length, 1);
    const value = snapshots[0]!.candidate;
    assert.equal(value.projectId, P); assert.equal(value.nativeTitle, 'Native project');
    assert.deepEqual(value.members.map(member => [member.conversationId, member.nativeTitle]), [[C, 'Same member'], [D, 'Same member']]);
    assert.deepEqual(parseLocalProjectCandidate(value, project()), value);
    assert.equal(snapshots[0]!.routeBound, true); assert.equal(snapshots[0]!.allMembersContainerLinked, false);
  } finally { h.close(); }
});
test('empty linked panels retain a Project, while broken links and foreign containers cannot certify a panel', () => {
  const h = fixture(panel(''));
  try {
    assert.deepEqual(observeNativeProjectSnapshots(h.document)[0]!.candidate.members, []);
    h.document.querySelector('[role="tab"]')!.setAttribute('aria-controls', 'other');
    assert.equal(observeNativeProjectSnapshots(h.document)[0]!.candidate.relationBasis, 'native-project-page');
    assert.deepEqual(observeNativeProjectSnapshots(h.document)[0]!.candidate.members, []);
  } finally { h.close(); }
  const foreign = fixture(panel(row().replace(`/c/${C}`, `/g/${Q}/c/${C}`)));
  try { assert.deepEqual(observeNativeProjectSnapshots(foreign.document).find(value => value.candidate.projectId === P)!.candidate.members, []); }
  finally { foreign.close(); }
});
test('the semantic adapter cannot turn a Project Files tab or a partial invalid conversation URL into plain-link members', () => {
  const files = fixture(panel().replace('>Chats<', '>Files<'));
  try { assert.deepEqual(observeNativeProjectSnapshots(files.document)[0]!.candidate.members, []); } finally { files.close(); }
  const bad = fixture(panel(row().replace(`/c/${C}`, '/c/not-a-conversation-id')));
  try { assert.deepEqual(observeNativeProjectSnapshots(bad.document)[0]!.candidate.members, []); } finally { bad.close(); }
});
test('a title-only native Project page has an empty persistent observation but cannot smuggle members', () => {
  const h = fixture('<main><h1><button aria-label="Edit the title of Empty project"><span>Empty project</span></button></h1><p>Welcome</p></main>');
  try {
    const snapshots = observeNativeProjectSnapshots(h.document); assert.equal(snapshots.length, 1);
    const value = snapshots[0]!.candidate;
    assert.equal(value.relationBasis, 'native-project-page'); assert.equal(value.nativeTitle, 'Empty project');
    assert.deepEqual(value.members, []); assert.deepEqual(parseLocalProjectCandidate(value, project()), value);
    const forged = { ...value, members: [{ conversationId: C, nativeTitle: 'Forged', canonicalUrl: `https://chatgpt.com/c/${C}` }] };
    assert.throws(() => parseLocalProjectCandidate(forged, project()), /INVALID_MESSAGE/);
    assert.throws(() => parseLocalProjectCandidate(value, project(Q)), /INVALID_MESSAGE/);
  } finally { h.close(); }
});
test('explicit current Project conversation URLs establish only their own ID relation without reading body or document title', () => {
  const h = fixture(`<main><article data-message-author-role="user"><a href="${contained(Q, D)}">Private body</a></article></main>`, contained(`${P}-presentation-slug`));
  try {
    Object.defineProperty(h.document, 'title', { get() { throw Error('page title is not a conversation label'); } });
    const value = observeNativeProjectSnapshots(h.document)[0]!.candidate;
    assert.equal(value.nativeTitle, null); assert.equal(value.projectId, P); assert.equal(value.members.length, 1);
    assert.deepEqual(value.members[0], { conversationId: C, canonicalUrl: `https://chatgpt.com/c/${C}`, nativeTitle: null, sourceUrl: contained(`${P}-presentation-slug`) });
    assert.deepEqual(parseLocalProjectCandidate(value, h.document.location.href), value);
    h.dom.reconfigure({ url: `https://chatgpt.com/g/g-generic/c/${C}` });
    assert.deepEqual(observeNativeProjectSnapshots(h.document), []);
  } finally { h.close(); }
});
test('sidebar labels supply metadata only when the same anchor carries an explicit Project ID', () => {
  const h = fixture(`<nav aria-label="Chat history"><a href="/g/${P}/project"><span>Same project name</span></a><a href="/g/${P}/c/${C}" aria-label="Member A, chat in project Same project name, Work, unread"><span>Member A</span></a><a href="/g/${Q}/c/${D}" aria-label="Member B, chat in project Same project name, read"><span>Member B</span></a><a href="/c/32345678-1234-1234-1234-123456789abc" aria-label="Unproven, chat in project Same project name">Unproven</a></nav>`, 'https://chatgpt.com/');
  try {
    const values = observeNativeProjectSnapshots(h.document).map(value => value.candidate);
    assert.equal(values.length, 2); assert.deepEqual(values.map(value => value.projectId), [P, Q]);
    assert.ok(values.every(value => value.nativeTitle === 'Same project name' && value.members.length === 1));
    assert.deepEqual(values.map(value => value.members[0]!.nativeTitle), ['Member A', 'Member B']);
    for (const value of values) assert.deepEqual(parseLocalProjectCandidate(value, h.document.location.href), value);
  } finally { h.close(); }
});
test('explicit relationship IPC independently rejects wrong containers, forged evidence, invalid source paths and private fields', () => {
  const h = fixture('', contained());
  try {
    const value = observeNativeProjectSnapshots(h.document)[0]!.candidate;
    const bad = (change: (value: any) => void) => { const clone = structuredClone(value); change(clone); assert.throws(() => parseLocalProjectCandidate(clone, contained()), /INVALID_MESSAGE/); };
    bad(value => { value.members[0].sourceUrl = contained(Q); });
    bad(value => { value.members[0].sourceUrl = `https://chatgpt.com/c/${C}`; });
    bad(value => { value.members[0].sourceUrl = contained(P, D); });
    bad(value => { delete value.members[0].sourceUrl; });
    bad(value => { value.members[0].preview = 'PRIVATE'; });
    bad(value => { value.members = []; });
    for (const source of ['https://chatgpt.com/share/abc', 'https://chatgpt.com/?temporary-chat=true', 'https://evil.example/']) assert.throws(() => parseLocalProjectCandidate(value, source), /INVALID_MESSAGE/);
  } finally { h.close(); }
});
test('duplicate Project labels with conflicting names do not force an arbitrary name', () => {
  const h = fixture(`<nav aria-label="Chat history"><a href="/g/${P}/project"><span>First</span></a><a href="/g/${P}/project"><span>Second</span></a><a href="/g/${P}/project"><span>Third</span></a><a href="/g/${P}/c/${C}" aria-label="Member, chat in project Unreliable old name">Member</a></nav>`, 'https://chatgpt.com/');
  try { assert.equal(observeNativeProjectSnapshots(h.document)[0]!.candidate.nativeTitle, null); }
  finally { h.close(); }
});
test('conflicting labelled sidebar names or duplicate member titles retain IDs without choosing arbitrary labels', () => {
  const h = fixture(`<nav aria-label="Chat history"><a href="/g/${P}/c/${C}" aria-label="Member first, chat in project First">Label</a><a href="/g/${P}/c/${C}" aria-label="Member second, chat in project Second">Label</a><a href="/g/${P}/c/${D}" aria-label="Other, chat in project First">Label</a></nav>`, 'https://chatgpt.com/');
  try {
    const value = observeNativeProjectSnapshots(h.document)[0]!.candidate;
    assert.equal(value.nativeTitle, null); assert.equal(value.members.length, 2); assert.equal(value.members[0]!.nativeTitle, null);
  } finally { h.close(); }
});
