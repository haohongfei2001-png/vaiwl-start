import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import type { ConversationRecord } from '../../contracts/free-v1.js';
import { recentDisplayGroups } from '../../src/ui/recent-groups.js';
import type { RecentDisplayGroup } from '../../src/ui/recent-groups.js';
import { readSpatialView, saveSpatialView, spatialColumns, spatialMembers, spatialProjectGrid, spatialProjectSection, spatialRecentSection } from '../../src/ui/spatial-home.js';
import type { SpatialCard, SpatialView } from '../../src/ui/spatial-home.js';

const now = '2026-11-04T12:00:00.000Z';
const record = (key: string, stableRank = 0): ConversationRecord => ({
  key, provider: 'chatgpt', conversationId: key, canonicalUrl: `https://chatgpt.com/c/${key}`,
  nativeTitle: `会话 ${key}`, titleBasis: 'browser-history', titleObservedAt: now, availability: 'unverified',
  firstSeenAt: now, lastSeenAt: now, browserLastVisitAt: null, activity: null, stableRank, revision: 1,
  owner: { kind: 'unassigned', localProfileKey: 'profile', accountKey: null },
  membership: { state: 'UNKNOWN', projectId: null, reason: 'scope-unverified' },
});
const records = (prefix: string, count: number) => Array.from({ length: count }, (_, index) => record(`${prefix}-${index}`, index));
const card = (key: string, members: ConversationRecord[]): SpatialCard => ({
  project: { key, nativeTitle: `项目 ${key}`, canonicalUrl: `https://chatgpt.com/g/g-p-${key}/project` },
  recent: members, older: [], undated: [],
});
const view = (overrides: Partial<SpatialView> = {}): SpatialView => ({
  expandedProject: null, projectsCollapsed: false, collapsedDates: [], dateLimits: {}, ...overrides,
});
const row = (item: ConversationRecord): HTMLElement => {
  const link = document.createElement('a');
  link.dataset.recordKey = item.key; link.href = item.canonicalUrl; link.textContent = item.nativeTitle;
  return link;
};
const renderedKeys = (root: ParentNode) => Array.from(root.querySelectorAll<HTMLElement>('[data-record-key]'), element => element.dataset.recordKey);
const recentOptions = (state: SpatialView, focusedRecord?: string) => ({
  view: state, row, scope: 'local-profile', focusedRecord,
  label: (date: string) => date === '2026-11-04' ? '今天' : date,
  periodLabel: '最近 30 天', rangeLabel: '2026-10-06 至 2026-11-04',
  pinnedKeys: [] as string[], today: '2026-11-04', moreDatesOpen: false,
});
function withDom(run: () => void): void {
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://example.test' });
  const globals = globalThis as any;
  const previous = { document: globals.document, window: globals.window, sessionStorage: globals.sessionStorage };
  globals.document = dom.window.document; globals.window = dom.window; globals.sessionStorage = dom.window.sessionStorage;
  try { run(); } finally { Object.assign(globals, previous); dom.window.close(); }
}

test('spatial members keep projected order and the first record when time buckets overlap', () => {
  const [a, b, c, d] = records('member', 4);
  const duplicate = { ...a!, nativeTitle: '重复来源不得覆盖原条目' };
  const input: SpatialCard = { ...card('overlap', [a!, b!]), older: [duplicate, c!], undated: [b!, d!, c!] };
  const before = JSON.stringify(input);
  const result = spatialMembers(input);
  assert.deepEqual(result.map(item => item.key), ['member-0', 'member-1', 'member-2', 'member-3']);
  assert.equal(result[0], a);
  assert.equal(JSON.stringify(input), before);
});

test('spatial cards show four previews and expose every older or undated member once on expansion', () => withDom(() => {
  const members = records('member', 8);
  const input = { ...card('native-project', members.slice(0, 3)), older: members.slice(3, 6), undated: members.slice(6) };
  const state = view({ expandedProject: input.project.key });
  const grid = spatialProjectGrid([input], { view: state, row, columns: 4 });
  const project = grid.querySelector('.project')!;
  assert.deepEqual(renderedKeys(project), members.slice(0, 4).map(item => item.key));
  assert.equal(project.querySelector('.spatial-project-count'), null);
  const toggle = project.querySelector('[data-spatial-expand]')!;
  const expanded = grid.querySelector('.spatial-project-expanded')!;
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  assert.equal(toggle.getAttribute('aria-controls'), expanded.id);
  assert.deepEqual(renderedKeys(expanded), members.slice(4).map(item => item.key));
  assert.deepEqual(renderedKeys(grid), members.map(item => item.key));
  state.expandedProject = null;
  const collapsed = spatialProjectGrid([input], { view: state, row, columns: 4 });
  assert.equal(collapsed.querySelector('.spatial-project-expanded'), null);
  assert.equal(collapsed.querySelector('[data-spatial-expand]')!.textContent, '展开更多');
}));

test('a 200-member spatial project constructs a bounded first expansion and exposes every member in ordered batches', () => withDom(() => {
  const members = records('large-project', 200);
  const input = { ...card('large-project', members.slice(0, 140)), older: members.slice(140, 180), undated: members.slice(180) };
  const before = JSON.stringify(input), state = view({ expandedProject: input.project.key });
  const batches = [
    { limit: undefined, shown: 28 },
    { limit: 72, shown: 76 },
    { limit: 120, shown: 124 },
    { limit: 168, shown: 172 },
    { limit: 216, shown: 200 },
  ];
  for (const { limit, shown } of batches) {
    if (limit !== undefined) state.projectLimits = { [input.project.key]: limit };
    let constructed = 0;
    const grid = spatialProjectGrid([input], { view: state, columns: 4, row: item => { constructed++; return row(item); } });
    assert.equal(constructed, shown, 'Hidden members must not be constructed and merely hidden with CSS');
    assert.deepEqual(renderedKeys(grid), members.slice(0, shown).map(item => item.key));
    assert.equal(new Set(renderedKeys(grid)).size, shown);
    const more = grid.querySelector('[data-spatial-project-more]');
    if (shown < members.length) {
      assert.equal(more?.getAttribute('data-spatial-project-more'), input.project.key);
      assert.equal(more?.getAttribute('data-focus-key'), `spatial-project-more:${input.project.key}`);
      assert.equal(more?.textContent, '显示更多');
    } else assert.equal(more, null);
  }
  saveSpatialView(state);
  const restored = spatialProjectGrid([input], { view: readSpatialView(), row, columns: 4 });
  assert.deepEqual(renderedKeys(restored), members.map(item => item.key));
  assert.equal(restored.querySelector('[data-spatial-project-more]'), null);
  assert.equal(JSON.stringify(input), before);
}));

test('a deep focused member restores a collapsed 200-member project without rendering its entire remaining catalog', () => withDom(() => {
  const members = records('deep-focus', 200), input = card('deep-project', members);
  const state = view({ expandedProject: 'other-project', projectsCollapsed: true,
    projectLimits: { 'deep-project': 24, 'other-project': 72 }, collapsedDates: ['keep-date-collapsed'], dateLimits: { 'other-date': 33 } });
  const section = spatialProjectSection([input], { view: state, row, columns: 3, focusedRecord: members[155]!.key });
  assert.equal(state.expandedProject, input.project.key);
  assert.equal(state.projectsCollapsed, false);
  const panel = section.querySelector('.spatial-project-expanded')!;
  assert.ok(renderedKeys(panel).includes(members[155]!.key));
  assert.equal(renderedKeys(panel).length, 168);
  assert.deepEqual(renderedKeys(section), members.slice(0, 172).map(item => item.key));
  assert.equal(renderedKeys(section).includes(members[199]!.key), false);
  assert.equal(section.querySelector('[data-spatial-project-more]')?.textContent, '显示更多');
  assert.equal(section.querySelector('#spatial-collapse-projects'), null);
  assert.equal(state.projectLimits?.['other-project'], 72);
  assert.deepEqual(state.collapsedDates, ['keep-date-collapsed']);
  assert.deepEqual(state.dateLimits, { 'other-date': 33 });
  saveSpatialView(state);
  const restored = readSpatialView();
  assert.deepEqual(restored.projectLimits, { 'deep-project': 168, 'other-project': 72 });
  const rerendered = spatialProjectSection([input], { view: restored, row, columns: 2 });
  assert.deepEqual(renderedKeys(rerendered), renderedKeys(section));
}));

test('expanded project follows its complete grid row at each column count, including the final partial row', () => withDom(() => {
  const cards = Array.from({ length: 7 }, (_, index) => card(`project-${index}`, records(`member-${index}`, 5)));
  const cases = [
    { columns: 4, selected: 1, after: 3 },
    { columns: 3, selected: 3, after: 5 },
    { columns: 2, selected: 2, after: 3 },
    { columns: 1, selected: 4, after: 4 },
    { columns: 4, selected: 6, after: 6 },
  ];
  for (const { columns, selected, after } of cases) {
    const key = cards[selected]!.project.key;
    const grid = spatialProjectGrid(cards, { view: view({ expandedProject: key }), row, columns });
    const panel = grid.querySelector<HTMLElement>('.spatial-project-expanded')!;
    assert.equal(panel.parentElement, grid);
    assert.equal(panel.previousElementSibling?.getAttribute('data-project'), `project-${after}`, `${columns} columns, selected ${selected}`);
    assert.equal(panel.nextElementSibling?.getAttribute('data-project') ?? null, after === 6 ? null : `project-${after + 1}`);
    assert.deepEqual(Array.from(grid.querySelectorAll('.project'), project => project.getAttribute('data-project')), cards.map(item => item.project.key));
  }
}));

test('all themes share the same responsive columns at every boundary and required desktop width', () => {
  const cases = [
    [1920, 4], [1720, 4], [1648, 4], [1440, 4], [1280, 4], [1181, 4],
    [1180, 3], [1051, 3], [1050, 3], [960, 3], [851, 3],
    [850, 2], [768, 2], [601, 2], [600, 1], [390, 1],
  ];
  for (const [width, expected] of cases) {
    for (const theme of ['classic', 'spatial', 'workbench', 'folio'] as const) {
      assert.equal(spatialColumns(width!, theme), expected, `${theme} at ${width}px`);
    }
  }
});

test('theme changes preserve the expanded project row and responsive changes relocate only its owning row', () => withDom(() => {
  const cards = Array.from({ length: 7 }, (_, index) => card(`project-${index}`, records(`member-${index}`, 8)));
  const state = view({ expandedProject: 'project-3', projectLimits: { 'project-3': 72 }, collapsedDates: ['keep-date'] });
  const saved = JSON.stringify(state), catalog = JSON.stringify(cards);
  const transitions = [
    { theme: 'classic', width: 1440, after: 3 },
    { theme: 'spatial', width: 1440, after: 3 },
    { theme: 'workbench', width: 1440, after: 3 },
    { theme: 'folio', width: 1440, after: 3 },
    { theme: 'workbench', width: 1180, after: 5 },
    { theme: 'folio', width: 851, after: 5 },
    { theme: 'folio', width: 850, after: 3 },
    { theme: 'folio', width: 390, after: 3 },
    { theme: 'spatial', width: 1440, after: 3 },
  ] as const;
  for (const { theme, width, after } of transitions) {
    const grid = spatialProjectGrid(cards, { view: state, row, columns: spatialColumns(width, theme) });
    const panels = grid.querySelectorAll<HTMLElement>('.spatial-project-expanded');
    assert.equal(panels.length, 1, `${theme} at ${width}px must render exactly one expanded owner`);
    const panel = panels[0]!;
    assert.equal(panel.dataset.expandedProject, 'project-3');
    assert.equal(panel.previousElementSibling?.getAttribute('data-project'), `project-${after}`, `${theme} at ${width}px`);
    assert.equal(panel.nextElementSibling?.getAttribute('data-project'), `project-${after + 1}`);
    assert.deepEqual(renderedKeys(panel), cards[3]!.recent.slice(4).map(item => item.key));
    assert.deepEqual(Array.from(grid.querySelectorAll('.project'), project => project.getAttribute('data-project')), cards.map(item => item.project.key));
    assert.equal(JSON.stringify(state), saved, 'Presentation changes must preserve disclosure and pagination state');
    assert.equal(JSON.stringify(cards), catalog, 'Presentation changes must preserve projected relationships');
  }
  state.expandedProject = 'project-6';
  for (const theme of ['classic', 'spatial', 'workbench', 'folio'] as const) {
    const grid = spatialProjectGrid(cards, { view: state, row, columns: spatialColumns(1440, theme) });
    const panel = grid.querySelector('.spatial-project-expanded')!;
    assert.equal(panel.previousElementSibling?.getAttribute('data-project'), 'project-6');
    assert.equal(panel.nextElementSibling, null, `${theme}'s final partial row must keep its expansion at the end`);
  }
}));

test('spatial presentation uses supplied native URLs and does not assert ownership or project membership', () => withDom(() => {
  const observed = record('local-observation');
  observed.localProject = { projectKey: 'local:boundary:73', boundaryKey: 'boundary', identityBasis: 'document', relationBasis: 'native-project-page', observedAt: now, state: 'observed' };
  const populated = card('local:boundary:73', [observed]);
  populated.project.canonicalUrl = 'https://chatgpt.com/g/g-p-native-id-73/project';
  populated.attributes = { 'data-local-project': 'local:boundary:73' };
  const empty = card('empty:another-boundary', []);
  empty.project.nativeTitle = null;
  empty.project.canonicalUrl = 'https://chatgpt.com/g/g-p-native-id-94/project';
  const cards = [populated, empty], before = JSON.stringify(cards), received: ConversationRecord[] = [];
  const grid = spatialProjectGrid(cards, { view: view(), columns: 4, row: item => { received.push(item); return row(item); } });
  assert.deepEqual(Array.from(grid.querySelectorAll('.spatial-project-name'), link => link.getAttribute('href')), [populated.project.canonicalUrl, empty.project.canonicalUrl]);
  assert.equal(grid.querySelector('.empty-project-link')?.getAttribute('href'), empty.project.canonicalUrl);
  assert.equal(grid.querySelector('[data-local-project]')?.getAttribute('data-project'), populated.project.key);
  assert.deepEqual(received, [observed]);
  assert.equal(received[0], observed);
  assert.equal(observed.owner.kind, 'unassigned');
  assert.equal(observed.membership.state, 'UNKNOWN');
  assert.equal(JSON.stringify(cards), before);
}));

test('restoring a focused hidden project member opens its section and keeps the section control accurate', () => withDom(() => {
  const members = records('focus', 7), input = card('focus-project', members);
  const state = view({ projectsCollapsed: true, expandedProject: 'missing-project' });
  const section = spatialProjectSection([input], { view: state, row, columns: 4, focusedRecord: members[6]!.key });
  assert.equal(state.projectsCollapsed, false);
  assert.equal(state.expandedProject, input.project.key);
  assert.equal(section.querySelector<HTMLElement>('.spatial-project-preview')!.hidden, false);
  assert.ok(renderedKeys(section.querySelector('.spatial-project-expanded')!).includes(members[6]!.key));
  assert.equal(section.querySelector('#spatial-collapse-projects'), null);
}));


test('only a focusable unavailable plus appears in each project header without an unverified creation route', () => withDom(() => {
  const input = card('verified-landing', records('member', 8));
  input.project.canonicalUrl = 'https://chatgpt.com/g/g-p-123456789012345678901234567890ab/project';
  const section = spatialProjectSection([input], { view: view({ expandedProject: input.project.key }), row, columns: 4 });
  const head = section.querySelector('.project-head')!;
  const actions = head.querySelectorAll('button');
  assert.equal(actions.length, 1);
  const plus = actions[0]!;
  assert.equal(plus.getAttribute('aria-disabled'), 'true');
  assert.equal(plus.disabled, false, 'Unavailable explanation remains keyboard discoverable');
  assert.equal(plus.tabIndex, 0);
  assert.equal(plus.querySelector('use')?.getAttribute('href'), '#i-plus');
  assert.match(plus.title, /尚未验证.*新对话入口/);
  assert.match(plus.getAttribute('aria-label')!, /暂不可用/);
  assert.equal(plus.hasAttribute('href'), false);
  assert.equal(section.querySelector('[data-project-menu],[data-project-new]'), null);
  assert.equal(head.querySelector('a')?.getAttribute('href'), input.project.canonicalUrl);
  const userText = [section.textContent, ...Array.from(section.querySelectorAll('[aria-label],[title]'), node => `${node.getAttribute('aria-label')} ${node.getAttribute('title')}`)].join(' ');
  assert.doesNotMatch(userText, /\d+\s*条|其余|还有/);
  assert.equal(section.querySelector('.spatial-expanded-head p'), null);
  assert.equal(section.querySelector('.spatial-project-footer')?.textContent, '收起');
}));

test('retired global collapse state is ignored and never hides fixed project previews', () => withDom(() => {
  sessionStorage.setItem('vaiwl-start-spatial-view/1', JSON.stringify({ projectsCollapsed: true, expandedProject: 'p', collapsedDates: ['keep'], dateLimits: {} }));
  const restored = readSpatialView();
  assert.equal(restored.projectsCollapsed, false);
  assert.deepEqual(restored.collapsedDates, ['keep']);
  const state = view({ projectsCollapsed: true });
  const section = spatialProjectSection([card('p', records('one', 1))], { view: state, row, columns: 4 });
  assert.equal(state.projectsCollapsed, false);
  assert.deepEqual(renderedKeys(section), ['one-0']);
  assert.equal(section.querySelector<HTMLElement>('.spatial-project-preview')!.hidden, false);
  assert.equal(section.querySelector('#spatial-collapse-projects'), null);
  saveSpatialView({ ...state, projectsCollapsed: true });
  assert.equal(readSpatialView().projectsCollapsed, false);
}));

test('an interval-only recent fallback uses a neutral heading without fabricating dates or exposing a range', () => withDom(() => {
  const groups: RecentDisplayGroup[] = [{ key: 'period-0:uncertain', date: null, records: [record('uncertain')] }];
  const before = JSON.stringify(groups), options = recentOptions(view());
  const section = spatialRecentSection(groups, { ...options, label: () => { throw new Error('An interval has no exact date to format'); } });
  const band = section.querySelector('.spatial-date-band')!;
  assert.equal(band.hasAttribute('data-date'), false);
  assert.equal(band.hasAttribute('data-period-range'), false);
  assert.equal(band.getAttribute('data-recent-kind'), 'undated');
  assert.equal(band.querySelector('strong')?.textContent, '本时间段');
  assert.equal(band.querySelector('small'), null);
  assert.deepEqual(renderedKeys(band), ['uncertain']);
  assert.equal(section.querySelector('#recent-toggle-more'), null);
  assert.doesNotMatch(section.outerHTML, /2026-10-06|最近 30 天|条会话/);
  assert.equal(JSON.stringify(groups), before);
}));

test('shared recent selection renders eligible pins, today and yesterday once with one separate more disclosure', () => withDom(() => {
  const groups: RecentDisplayGroup[] = [
    { key: 'today', date: '2026-11-04', records: [record('pinned-today'), record('today')] },
    { key: 'yesterday', date: '2026-11-03', records: [record('yesterday')] },
    { key: 'older', date: '2026-11-01', records: [record('pinned-old'), record('older')] },
    { key: 'interval', date: null, records: [record('interval')] },
  ];
  const options = { ...recentOptions(view()), pinnedKeys: ['pinned-old', 'pinned-today', 'outside-scope'] };
  const section = spatialRecentSection(groups, options);
  assert.equal(section.querySelectorAll('#recent-manage-pins').length, 1);
  assert.equal(section.querySelector('#recent-manage-pins')?.textContent, '管理置顶');
  assert.deepEqual(Array.from(section.querySelectorAll('[data-recent-kind]'), node => node.getAttribute('data-recent-kind')), ['pinned', 'date', 'date']);
  assert.deepEqual(renderedKeys(section), ['pinned-today', 'pinned-old', 'today', 'yesterday']);
  const arrow = section.querySelector('#recent-toggle-more')!;
  assert.equal(section.querySelectorAll('#recent-toggle-more').length, 1);
  assert.equal(arrow.getAttribute('aria-expanded'), 'false');
  assert.equal(arrow.getAttribute('aria-label'), '展开更多日期');
  assert.equal(section.lastElementChild, arrow);
  assert.equal(section.querySelector('#recent-more-dates')?.childElementCount, 0, 'Deferred groups are not constructed until opened');
  const opened = spatialRecentSection(groups, { ...options, moreDatesOpen: true });
  assert.deepEqual(renderedKeys(opened), ['pinned-today', 'pinned-old', 'today', 'yesterday', 'older', 'interval']);
  assert.equal(new Set(renderedKeys(opened)).size, 6);
  assert.equal(opened.querySelector('#recent-toggle-more')?.getAttribute('aria-label'), '收起更多日期');
  assert.equal(opened.querySelector('[data-recent-kind="undated"] strong')?.textContent, '本时间段');
  assert.equal(opened.querySelector('[data-recent-kind="undated"]')?.hasAttribute('data-date'), false);
  assert.doesNotMatch(opened.outerHTML, /条会话|还有|data-period-range/);
}));

test('without pinned/today/yesterday the newest actual date is the default, including historic periods', () => withDom(() => {
  const groups = [
    { key: 'first', date: '2026-10-02', records: [record('first')] },
    { key: 'newest', date: '2026-10-08', records: [record('newest')] },
    { key: 'interval', date: null, records: [record('interval')] },
  ];
  const section = spatialRecentSection(groups, recentOptions(view()));
  assert.deepEqual(renderedKeys(section), ['newest']);
  assert.equal(section.querySelector('strong')?.textContent, '2026-10-08');
  const opened = spatialRecentSection(groups, { ...recentOptions(view()), moreDatesOpen: true });
  assert.deepEqual(renderedKeys(opened), ['newest', 'first', 'interval']);
}));

test('same-day evidence separated by uncertain records merges into one real date without duplicate rows', () => withDom(() => {
  const newer = record('newer'), interval = record('interval'), older = record('older');
  const groups = recentDisplayGroups([{ date: '2026-11-04', records: [older, newer] }], [interval],
    new Map([['newer', { rank: 0 }], ['interval', { rank: 1 }], ['older', { rank: 2 }]]), 0);
  const section = spatialRecentSection(groups, { ...recentOptions(view()), moreDatesOpen: true });
  const bands = Array.from(section.querySelectorAll('.spatial-date-band'));
  assert.deepEqual(renderedKeys(section), ['newer', 'older', 'interval']);
  assert.deepEqual(bands.map(band => band.getAttribute('data-date')), ['2026-11-04', null]);
  assert.equal(new Set(Array.from(section.querySelectorAll('[aria-controls]'), node => node.getAttribute('aria-controls'))).size, 3);
}));

test('recent pagination constructs bounded batches using count-free controls', () => withDom(() => {
  const members = records('history', 40), key = 'recent:local-profile:primary:today';
  const groups = [{ key: '2026-11-04', date: '2026-11-04', records: members }];
  const state = view();
  for (const limit of [9, 33, 57]) {
    state.dateLimits[key] = limit;
    const section = spatialRecentSection(groups, recentOptions(state));
    assert.deepEqual(renderedKeys(section), members.slice(0, limit).map(item => item.key));
    if (limit < members.length) {
      assert.equal(section.querySelector('.spatial-date-more')?.textContent, '显示更多');
      assert.equal(section.querySelector('.spatial-date-more')?.getAttribute('data-spatial-date-more'), key);
    } else assert.equal(section.querySelector('.spatial-date-more'), null);
    assert.equal(section.querySelector('#recent-toggle-more'), null);
  }
}));

test('saved group disclosure reveals focused records beyond the batch while preserving unrelated state', () => withDom(() => {
  const targetKey = 'recent:local-profile:primary:today', otherKey = 'recent:local-profile:primary:yesterday';
  const members = records('restore', 60);
  const groups = [
    { key: '2026-11-04', date: '2026-11-04', records: members },
    { key: '2026-11-03', date: '2026-11-03', records: [record('other-date')] },
  ];
  const saved = view({ expandedProject: 'saved-project', collapsedDates: [targetKey, otherKey], dateLimits: { [targetKey]: 33 } });
  saveSpatialView(saved);
  const restored = readSpatialView();
  assert.deepEqual(restored, saved);
  const collapsed = spatialRecentSection(groups, recentOptions(restored));
  assert.deepEqual(Array.from(collapsed.querySelectorAll<HTMLElement>('.spatial-date-content'), content => content.hidden), [true, true]);
  assert.equal(collapsed.querySelector('.spatial-date-summary'), null);
  const focused = spatialRecentSection(groups, recentOptions(restored, members[40]!.key));
  const bands = Array.from(focused.querySelectorAll('.spatial-date-band'));
  assert.equal(bands[0]!.querySelector<HTMLElement>('.spatial-date-content')!.hidden, false);
  assert.equal(bands[1]!.querySelector<HTMLElement>('.spatial-date-content')!.hidden, true);
  assert.ok(renderedKeys(bands[0]!).includes(members[40]!.key));
  assert.equal(renderedKeys(bands[0]!).length, 57);
  assert.equal(bands[0]!.querySelector('.spatial-date-more')?.textContent, '显示更多');
  assert.deepEqual(restored.collapsedDates, [otherKey]);
  assert.equal(restored.expandedProject, 'saved-project');
  saveSpatialView(restored);
  assert.deepEqual(renderedKeys(spatialRecentSection(groups, recentOptions(readSpatialView()))), renderedKeys(focused));
}));

test('focused older evidence opens the remaining-date region without moving or duplicating its record', () => withDom(() => {
  const groups = [
    { key: 'today', date: '2026-11-04', records: [record('today')] },
    { key: 'older', date: '2026-11-01', records: [record('older')] },
  ];
  const section = spatialRecentSection(groups, recentOptions(view(), 'older'));
  assert.equal(section.querySelector('#recent-toggle-more')?.getAttribute('aria-expanded'), 'true');
  assert.deepEqual(renderedKeys(section), ['today', 'older']);
}));
