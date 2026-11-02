import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { inspectMetadataStructure, validateMetadataStructure } from '../../src/collectors/chatgpt/structure-probe.js';

const URL = 'https://chatgpt.com/c/71000000-0000-4000-8000-000000000001';
const sidebar = (content: string) => `<aside data-app-shell-left-panel-appearance><div data-sidebar-navigation-root><div data-slate-sidebar-content>${content}</div></div></aside>`;
function fixture(content: string, url = URL) {
  const dom = new JSDOM(`<!doctype html><html><body>${content}</body></html>`, { url });
  Object.defineProperty(dom.window.Element.prototype, 'getClientRects', { value() { return [{}]; }, configurable: true });
  return { dom, document: dom.window.document };
}
function prohibitText(dom: JSDOM) {
  for (const [prototype, names] of [
    [dom.window.Node.prototype, ['textContent', 'nodeValue']],
    [dom.window.Element.prototype, ['innerHTML', 'outerHTML']],
    [dom.window.HTMLElement.prototype, ['innerText']],
  ] as const) for (const name of names) Object.defineProperty(prototype, name, { get() { throw Error('private-content-read'); }, configurable: true });
}
const select = (document: Document, selector: string) => {
  const element = document.querySelector(selector); assert.ok(element); return inspectMetadataStructure(document, element);
};

test('structure probe reads only closed structural enums inside the known sidebar, never labels or raw attribute values', () => {
  const { dom, document } = fixture(sidebar('<a id="selected-private-id" href="/c/71000000-0000-4000-8000-000000000099" aria-current="page" data-testid="private-test-id" class="private-class" data-private-name="email@example.invalid"><span>PRIVATE TITLE / BODY SENTINEL</span></a>'));
  prohibitText(dom);
  const summary = select(document, 'a');
  assert.equal(summary.state, 'observed'); assert.ok(validateMetadataStructure(summary));
  if (summary.state !== 'observed') return;
  assert.equal(summary.authority, false); assert.equal(summary.boundary, 'sidebar'); assert.equal(summary.node.linkKind, 'conversation');
  assert.equal(summary.node.current, 'page'); assert.equal(summary.nodeCount, 2);
  const result = JSON.stringify(summary);
  for (const secret of ['PRIVATE', 'private-', 'email@', '71000000', 'href=', 'selected-private-id']) assert.equal(result.includes(secret), false);
  assert.deepEqual(summary.node.attributes, ['aria-current', 'href', 'id', 'data-testid']);
  dom.window.close();
});

test('structure probe requires a unique visible native menu linked to a fixed-boundary trigger', () => {
  const trigger = '<button aria-controls=workspace-menu aria-expanded=true aria-haspopup=menu>Private account</button>';
  const menu = '<div id=workspace-menu role=menu><button role=menuitemradio aria-checked=true data-state=checked>Private workspace</button></div>';
  const { dom, document } = fixture(sidebar(trigger) + menu); prohibitText(dom);
  const result = select(document, '[role=menuitemradio]');
  assert.equal(result.state, 'observed'); assert.ok(validateMetadataStructure(result));
  if (result.state === 'observed') { assert.equal(result.boundary, 'linked-menu'); assert.equal(result.assertions.menuLinked, true); assert.equal(result.node.checked, 'true'); }
  document.querySelector('button')!.setAttribute('aria-expanded', 'false');
  assert.equal(select(document, '[role=menuitemradio]').code, 'structure-unavailable');
  document.querySelector('button')!.setAttribute('aria-expanded', 'true');
  const duplicate = document.createElement('div'); duplicate.id = 'workspace-menu'; document.body.append(duplicate);
  assert.equal(select(document, '[role=menuitemradio]').code, 'structure-unavailable');
  dom.window.close();
});

test('structure probe refuses arbitrary headers, unlinked menus, body and foreign origin', () => {
  const { dom, document } = fixture('<header><button>Private header</button></header><div role=menu id=loose-menu><button>Private menu</button></div>');
  assert.equal(select(document, 'header button').code, 'structure-unavailable');
  assert.equal(select(document, '[role=menu] button').code, 'structure-unavailable');
  assert.equal(select(document, 'body').code, 'structure-forbidden'); dom.window.close();
  const other = fixture(sidebar('<button>Private</button>'), 'https://chatgpt.com.evil.invalid/');
  assert.equal(select(other.document, 'button').code, 'source-origin-rejected'); other.dom.window.close();
});

test('structure probe refuses editors, messages, attachments, forms, dialog ancestry and unsafe submenus before reading content', () => {
  for (const content of [
    '<div contenteditable><button id=chosen>Private draft</button></div>',
    '<div data-message-id=private-message><button id=chosen>Private message</button></div>',
    '<div data-testid=attachment-private><button id=chosen>Private file</button></div>',
    '<form><button id=chosen>Private form</button></form>',
    '<div role=dialog><button id=chosen>Private dialog</button></div>',
    '<button id=chosen><input value=PRIVATE></button>',
  ]) {
    const { dom, document } = fixture(sidebar(content)); prohibitText(dom);
    assert.equal(select(document, '#chosen').code, 'structure-forbidden'); dom.window.close();
  }
  const fixtureMenu = fixture(sidebar('<button aria-controls=menu aria-expanded=true aria-haspopup=menu>Meta</button>') + '<div id=menu role=menu><div role=menu><button id=chosen>Unsafe submenu</button></div></div>');
  assert.equal(select(fixtureMenu.document, '#chosen').code, 'structure-unavailable');
  assert.equal(select(fixtureMenu.document, '#menu').code, 'structure-forbidden'); fixtureMenu.dom.window.close();
});

test('structure probe refuses hidden and duplicate boundaries, stale elements and unsupported nodes', () => {
  for (const styling of ['hidden', 'aria-hidden=true', 'style="display:none"']) {
    const { dom, document } = fixture(sidebar(`<button id=chosen ${styling}>Hidden</button>`));
    assert.equal(select(document, '#chosen').code, 'structure-hidden'); dom.window.close();
  }
  const duplicate = fixture(sidebar('<button id=chosen>A</button>') + sidebar('<button>B</button>'));
  assert.equal(select(duplicate.document, '#chosen').code, 'structure-unavailable'); duplicate.dom.window.close();
  const disconnected = fixture(sidebar('<button id=chosen>A</button>'));
  const target = disconnected.document.querySelector('#chosen')!; target.remove();
  assert.equal(inspectMetadataStructure(disconnected.document, target).code, 'structure-hidden'); disconnected.dom.window.close();
  const custom = fixture(sidebar('<private-widget id=chosen></private-widget>'));
  assert.equal(select(custom.document, '#chosen').code, 'structure-unavailable'); custom.dom.window.close();
});

test('structure probe refuses node, depth and child overflow without returning partial summaries', () => {
  const cases = [
    '<div id=chosen>' + '<span></span>'.repeat(13) + '</div>',
    '<div id=chosen><div><div><div><div></div></div></div></div></div>',
    '<div id=chosen>' + ('<div>' + '<span></span>'.repeat(12) + '</div>').repeat(4) + '</div>',
  ];
  for (const content of cases) {
    const { dom, document } = fixture(sidebar(content));
    const result = select(document, '#chosen');
    assert.deepEqual(result, { state: 'blocked', code: 'structure-limit', authority: false }); assert.ok(validateMetadataStructure(result)); dom.window.close();
  }
});

test('structure probe rejects known Project preview subtrees while allowing only the selected native title structure', () => {
  const html = '<main data-app-shell-main-surface><div data-app-shell-main-content-layout><section role=main><h1><button id=project-name>Project title</button></h1><div role=tabpanel><section><ol><li><a href="/c/71000000-0000-4000-8000-000000000001"><div><div id=title>Conversation title</div><div id=preview>PRIVATE MESSAGE PREVIEW</div></div></a></li></ol></section></div></section></div></main>';
  const { dom, document } = fixture(html); prohibitText(dom);
  const title = select(document, '#title'); assert.equal(title.state, 'observed'); assert.ok(validateMetadataStructure(title));
  assert.equal(select(document, '#preview').code, 'structure-forbidden');
  assert.equal(select(document, 'a').code, 'structure-forbidden');
  assert.equal(select(document, '#project-name').state, 'observed');
  document.querySelector('#preview')!.parentElement!.append(document.createElement('div'));
  assert.equal(select(document, '#title').code, 'structure-forbidden', 'an unknown card layout cannot establish a safe title leaf'); dom.window.close();
});

test('structure report validator rejects extras, raw values, inconsistent attributes, authority and forged counts', () => {
  const { dom, document } = fixture(sidebar('<button id=chosen aria-selected=true>Private title</button>'));
  const good = select(document, '#chosen'); assert.equal(good.state, 'observed'); assert.ok(validateMetadataStructure(good));
  if (good.state !== 'observed') return;
  for (const bad of [
    { ...good, rawHtml: 'PRIVATE' }, { ...good, authority: true }, { ...good, nodeCount: 99 },
    { ...good, node: { ...good.node, label: 'PRIVATE' } },
    { ...good, node: { ...good.node, attributes: ['data-private-email'] } },
    { ...good, node: { ...good.node, selected: 'private-value' } },
    { ...good, node: { ...good.node, selected: null } },
    { ...good, node: { ...good.node, linkKind: 'conversation' } },
    { ...good, assertions: { ...good.assertions, menuLinked: true } },
    { state: 'blocked', code: 'structure-unavailable', authority: false, title: 'PRIVATE' },
    { state: 'blocked', code: 'PRIVATE', authority: false },
  ]) assert.equal(validateMetadataStructure(bad), false);
  dom.window.close();
});
