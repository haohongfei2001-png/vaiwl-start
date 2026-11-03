import { initNativeExperience } from './native-experience.js';
import { HOME_MODE_KEY, homeMode as normalizeHomeMode, type HomeMode } from '../domain/home-mode.js';
import type { ConversationRecord, WebsiteShortcut, OpenDisposition, ImportCheckpoint } from '../../contracts/free-v1.js';
import type { CatalogSnapshot } from '../storage/repository.js';
import { projectCatalog, searchCatalog, searchProjects, type CandidateProjectCard, type LocalObservedProjectCard } from '../domain/projection.js';
import { createFreeViewSession, freeWindowFor, dayLabel } from '../domain/time.js';
import { request, subscribeRevision } from '../shared/client.js';
import { element as el, icon, byId, button, isEditing, allowedWebsiteUrl, dateTime } from './dom.js';
import { readView, saveView, SafeRendering, preservePosition } from './view-state.js';

interface UISnapshot extends CatalogSnapshot {
  capabilities: { chatgpt: boolean; history: boolean; captureEnabled?: boolean; startNavigationActivity?: boolean; localProjectCandidates?: boolean; sourceGate: string; reasons?: string[]; sourceStatus?: { code: string; profileId: string } | null };
  build: { sha: string; version: string; sourceGate: string; adapterVersion: string };
}
type Filter = 'all' | 'project' | 'none';
interface DisplayProject { key: string; nativeTitle: string | null; canonicalUrl: string; stableRank?: number }
const view = readView();
const initialScrollY = view.scrollY;
const safe = new SafeRendering();
let homeMode: HomeMode | null = null;
let modeEpoch = 0;
let modeSaveSequence = 0;
let modeLoading = false;
let modeSaveQueue = Promise.resolve();
let unsubscribeWorkspace: (() => void) | null = null;
let workspaceScrollY = initialScrollY;
let clockTimer: ReturnType<typeof setTimeout> | undefined;
let snapshot: UISnapshot | null = null;
let calendar: ReturnType<typeof createFreeViewSession> | null = null;
let selectedScope = view.selectedScope;
let currentProject: DisplayProject | null = null;
let currentRecord: ConversationRecord | null = null;
let siteEditingId: string | null = null;
let siteDragId: string | null = null;
let allSitesVisible = false;
let siteRenderRevision = 0;
let searchFilter: Filter = 'all';
let searchProjectKey: string | null = null;
const SEARCH_PAGE_SIZE = 100;
let searchVisibleLimit = SEARCH_PAGE_SIZE;
let searchConditions = '';
let renderingFocusRecordKey: string | null = null;
let toastTimer: ReturnType<typeof setTimeout> | undefined;
let refreshSequence = 0;
let mutationRunning = false;
let importPumping = false;
let stopped = false;
let activeJobId: string | null = null;
const openingRecords = new Set<string>();
const filterLabels: Record<Filter, string> = { all: '全部', project: '项目', none: '最近' };

function persistView(): void {
  if (homeMode !== 'workspace' || modeLoading) return;
  view.selectedScope = selectedScope; view.scrollY = window.scrollY;
  workspaceScrollY = view.scrollY; saveView(view);
}
function announce(message: string): void { byId('live').textContent = message; }
function toast(message: string, action?: { label: string; run: () => void }): void {
  const node = byId('toast');
  node.replaceChildren(document.createTextNode(message));
  if (action) { const control = button(action.label); control.addEventListener('click', action.run, { once: true }); node.append(control); }
  node.hidden = false;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { node.hidden = true; }, action ? 8000 : 4500);
}
function showDialog(id: string): void {
  const dialog = byId<HTMLDialogElement>(id);
  for (const other of document.querySelectorAll<HTMLDialogElement>('dialog[open]')) if (other !== dialog) other.close();
  if (!dialog.open) dialog.showModal();
}
function closeDialog(id: string): void { byId<HTMLDialogElement>(id).close(); }
function fail(error: unknown): void {
  if (homeMode !== 'workspace') return;
  const code = error instanceof Error ? error.message : String(error);
  const message = /REVISION|revision|CONFLICT/i.test(code) ? '记录已被另一标签页更新，请重试这次操作。'
    : /PERMISSION|permission/i.test(code) ? '还没有对应权限。可以在设置中重新连接。'
    : /QUOTA|quota/i.test(code) ? '本地存储空间不足。已有记录仍保留，请释放空间后重试。'
    : /URL|url|VALID/i.test(code) ? '请检查填写的信息，网址须为不带账号密码的 HTTP(S) 地址。'
    : '这次操作没有完成，已有数据仍然保留。请重试或重新加载扩展。';
  toast(message);
}

async function refresh(immediate = false): Promise<void> {
  if (homeMode !== 'workspace' || stopped) return;
  const sequence = ++refreshSequence;
  const requestedModeEpoch = modeEpoch;
  const requestedScope = selectedScope;
  const received = await request('SNAPSHOT', selectedScope ? { selectedScope } : {}) as UISnapshot;
  if (sequence !== refreshSequence || stopped || requestedScope !== selectedScope || homeMode !== 'workspace' || requestedModeEpoch !== modeEpoch) return;
  const apply = () => {
    if (homeMode !== 'workspace' || requestedModeEpoch !== modeEpoch || sequence !== refreshSequence || requestedScope !== selectedScope || snapshot && received.revision < snapshot.revision) return;
    snapshot = received;
    if (!selectedScope || (selectedScope !== 'unassigned' && !received.scopes.some(scope => scope.key === selectedScope))) selectedScope = received.settings.selectedScope || 'unassigned';
    view.selectedScope = selectedScope;
    if (!calendar || calendar.Z !== received.settings.libraryTimeZone) calendar = createFreeViewSession({ now: new Date().toISOString(), timeZone: received.settings.libraryTimeZone });
    render();
  };
  safe.render(apply, immediate || !snapshot);
}

async function mutate(command: string, payload: Record<string, unknown>, after?: () => void): Promise<void> {
  if (!snapshot || mutationRunning) return;
  mutationRunning = true;
  try {
    await request(command, { ...payload, expectedRevision: snapshot.revision });
    await refresh(true);
    if (homeMode === 'workspace') after?.();
  } catch (error) { fail(error); await refresh().catch(() => {}); }
  finally { mutationRunning = false; }
}

function title(record: ConversationRecord): string { return record.nativeTitle || '未命名会话'; }
function membershipLabel(record: ConversationRecord): string {
  if (!snapshot) return '最近';
  return searchCatalog(snapshot, '', selectedScope || 'unassigned').find(result => result.record.key === record.key)?.path || '最近';
}

function conversationRow(record: ConversationRecord): HTMLElement {
  const link = el('a', { class: 'conversation-open', href: record.canonicalUrl, 'data-record-key': record.key,
    'data-focus-key': `record:${record.key}`, 'aria-label': `在 ChatGPT 中打开：${title(record)}`, title: title(record) },
  [icon('chat', 'chat-icon'), el('span', { class: 'conversation-title' }, [title(record)]), icon('arrow', 'enter-icon')]);
  const menu = button('', { class: 'icon-button record-menu', 'data-record-menu': record.key, 'data-focus-key': `details:${record.key}`, 'aria-label': `${title(record)}的详情与移除` }, 'more');
  return el('div', { class: 'conversation-row' }, [link, menu]);
}

interface DisplayCard { project: DisplayProject; recent: ConversationRecord[]; older: ConversationRecord[]; undated: ConversationRecord[]; sortTime: number | null; attributes?: Record<string, string> }
/** Every supported native relationship uses one visual component. Identity remains in domain keys. */
function projectCard(card: DisplayCard): HTMLElement {
  const project = card.project, key = project.key, name = project.nativeTitle || '未命名项目';
  const focusIndex = renderingFocusRecordKey ? card.recent.findIndex(record => record.key === renderingFocusRecordKey) : -1;
  if (focusIndex >= (view.limits[key] || 5)) view.limits[key] = 5 + Math.ceil((focusIndex + 1 - 5) / 12) * 12;
  if (renderingFocusRecordKey && [...card.older, ...card.undated].some(record => record.key === renderingFocusRecordKey) && !view.older.includes(key)) view.older.push(key);
  const expanded = view.older.includes(key), limit = view.limits[key] || 5;
  const body = el('div', { class: 'project-body' });
  if (card.recent.length) {
    const rows = el('div', { class: 'conversation-list' }, card.recent.slice(0, limit).map(conversationRow));
    if (card.recent.length > limit) rows.append(button('显示更多', { class: 'more-rows', 'data-more': key, 'data-focus-key': `more:${key}` }));
    body.append(rows);
  }
  // Compatibility with an older projection never drops a member or duplicates it.
  const seen = new Set(card.recent.map(record => record.key));
  const older = [...card.older, ...card.undated].filter(record => { if (seen.has(record.key)) return false; seen.add(record.key); return true; });
  if (older.length) {
    body.append(button('更早', { class: 'history-disclosure', 'data-older': key, 'aria-expanded': String(expanded), 'aria-controls': `older-${key}`, 'data-focus-key': `older:${key}` }, 'chevron'));
    const old = el('div', { class: 'old-list', id: `older-${key}` }, [el('div', { class: 'conversation-list' }, older.map(conversationRow))]);
    old.hidden = !expanded; body.append(old);
  }
  if (!card.recent.length && !older.length) body.append(el('a', { class: 'empty-project-link', href: project.canonicalUrl }, ['打开项目', icon('external')]));
  return el('article', { class: 'project', 'data-project': key, ...card.attributes, 'aria-labelledby': `project-${key}` }, [
    el('header', { class: 'project-head' }, [el('span', { class: 'project-symbol' }, [icon('folder')]),
      el('h3', { id: `project-${key}`, title: name }, [name]),
      button('', { class: 'icon-button', 'data-project-menu': key, 'data-focus-key': `project-menu:${key}`, 'aria-label': `${name}项目操作` }, 'more')]), body]);
}
function localCard(card: LocalObservedProjectCard): DisplayCard { return { ...card, attributes: { 'data-local-project': card.project.key } }; }
function candidateCard(card: CandidateProjectCard): DisplayCard { return { ...card, project: { ...card.candidate, key: `candidate:${card.candidate.key}`, stableRank: card.stableRank }, attributes: { 'data-candidate-project': card.candidate.key } }; }
function cardOrder(a: DisplayCard, b: DisplayCard): number {
  return (b.sortTime ?? -Infinity) - (a.sortTime ?? -Infinity)
    || (a.project.stableRank ?? 0) - (b.project.stableRank ?? 0) || a.project.key.localeCompare(b.project.key);
}

function dateLabel(date: string): string {
  if (!calendar) return date;
  if (date === dayLabel(calendar.T)) return '今天';
  if (date === dayLabel(calendar.T - 1)) return '昨天';
  const [year, month, day] = date.split('-').map(Number);
  return `${year !== Number(dayLabel(calendar.T).slice(0, 4)) ? `${year} 年 ` : ''}${month} 月 ${day} 日`;
}

function recentSection(groups: Array<{ date: string | null; records: ConversationRecord[] }>): HTMLElement {
  return el('section', { class: 'date-section recent-section', 'aria-label': '最近' }, [
    el('div', { class: 'section-heading' }, [el('h2', {}, ['最近'])]),
    el('div', { class: 'date-grid' }, groups.map(group => {
      const key = `recent:${selectedScope}:${group.date || `period-${view.k}`}`;
      const focusIndex = renderingFocusRecordKey ? group.records.findIndex(record => record.key === renderingFocusRecordKey) : -1;
      if (focusIndex >= (view.limits[key] || 5)) view.limits[key] = 5 + Math.ceil((focusIndex + 1 - 5) / 12) * 12;
      const limit = view.limits[key] || 5;
      const list = el('div', { class: 'conversation-list' }, group.records.slice(0, limit).map(conversationRow));
      if (group.records.length > limit) list.append(button('显示更多', { class: 'more-rows', 'data-more': key, 'data-focus-key': `more:${key}`, 'aria-label': '显示更多会话' }));
      const period = calendar ? freeWindowFor(view.k, calendar) : null;
      const label = group.date ? dateLabel(group.date) : period ? `${period.start}—${dayLabel(calendar!.T - 30 * view.k)}` : '最近';
      return el('article', { class: 'date-window', ...(group.date ? { 'data-date': group.date } : { 'data-period': String(view.k) }) }, [
        el('h3', { 'aria-label': group.date || label }, [icon('calendar'), label]), list]);
    }))]);
}
function earlierProjects(cards: DisplayCard[]): HTMLElement {
  if (renderingFocusRecordKey && cards.some(card => [...card.recent, ...card.older, ...card.undated].some(record => record.key === renderingFocusRecordKey))) view.earlierProjectsOpen = true;
  const expanded = view.earlierProjectsOpen;
  const list = el('div', { class: 'project-grid', id: 'earlier-projects-content' }, cards.map(projectCard));
  list.hidden = !expanded;
  return el('section', { class: 'earlier-projects', 'aria-label': '更早' }, [
    button('更早', { id: 'earlier-projects-toggle', class: 'earlier-projects-toggle', 'aria-expanded': String(expanded), 'aria-controls': list.id }, 'chevron'), list]);
}

function workspaceHeading(): HTMLElement {
  const heading = el('div', { class: 'board-heading' }, [el('h1', {}, ['工作区'])]);
  if (snapshot && snapshot.scopes.length > 0) {
    const scopeSelect = el('select', { class: 'scope-selector', id: 'scope-selector', 'aria-label': '选择本地资料库' });
    for (const scope of snapshot.scopes) scopeSelect.append(el('option', { value: scope.key }, [scope.label || '已保存的资料库']));
    scopeSelect.append(el('option', { value: 'unassigned' }, ['此浏览器']));
    scopeSelect.value = selectedScope || 'unassigned'; heading.append(scopeSelect);
  }
  const filters = el('div', { class: 'segment', role: 'tablist', 'aria-label': '筛选会话' });
  for (const filter of Object.keys(filterLabels) as Filter[]) filters.append(button(filterLabels[filter], { role: 'tab', 'data-filter': filter, 'data-focus-key': `filter:${filter}`, 'aria-selected': String(view.filter === filter), tabindex: view.filter === filter ? 0 : -1 }));
  heading.append(filters, el('a', { class: 'new-chat', href: 'https://chatgpt.com/', 'aria-label': '在 ChatGPT 中开始新对话' }, ['新对话', icon('external')]));
  return heading;
}

function firstUse(): HTMLElement {
  return el('section', { class: 'first-use' }, [el('div', { class: 'brand-mark', 'aria-hidden': 'true' }, [el('i'), el('i'), el('i'), el('i')]),
    el('h1', {}, ['让对话留在手边。']), el('p', {}, ['把浏览过的 ChatGPT 会话保存在这里。', el('br'), '关掉浏览器标签，下一次也能接着开始。']),
    el('div', { class: 'first-actions' }, [el('a', { class: 'primary', href: 'https://chatgpt.com/' }, ['打开 ChatGPT', icon('external')]), button('导入浏览历史', { class: 'secondary', id: 'first-import' })]),
    el('p', { class: 'quiet' }, ['也可以先使用浏览器书签，按自己的节奏开始。']),
    button('连接 ChatGPT，继续收录会话链接', { class: 'text-button', id: 'first-connect' })]);
}

function renderWorkspace(): void {
  if (homeMode !== 'workspace' || !snapshot || !calendar) return;
  const content = byId('workspace-content'); content.setAttribute('aria-busy', 'false');
  if (!snapshot.conversations.length && !snapshot.projects.length && !snapshot.localProjects?.length && !snapshot.importJobs.length && !snapshot.scopes.length) {
    content.replaceChildren(firstUse()); byId('history-rail').hidden = true; return;
  }
  const projection = projectCatalog(snapshot, { ...calendar, k: view.k, selectedScope: selectedScope || 'unassigned' });
  const focused = (document.activeElement as HTMLElement | null)?.dataset.focusKey;
  renderingFocusRecordKey = focused?.startsWith('record:') ? focused.slice(7) : focused?.startsWith('details:') ? focused.slice(8) : null;
  content.replaceChildren(workspaceHeading());
  const showProjects = view.filter === 'all' || view.filter === 'project';
  const showRecent = view.filter === 'all' || view.filter === 'none';
  const cards: DisplayCard[] = [...projection.projects, ...projection.localProjects.map(localCard), ...projection.candidateProjects.map(candidateCard)].sort(cardOrder);
  if (showProjects && cards.length) content.append(el('section', { 'aria-label': '项目' }, [el('div', { class: 'project-grid' }, cards.map(projectCard))]));
  const dates = new Map<string, ConversationRecord[]>();
  for (const group of [...projection.dates, ...projection.pendingDates]) {
    const rows = dates.get(group.date) || []; rows.push(...group.records); dates.set(group.date, rows);
  }
  const groups: Array<{ date: string | null; records: ConversationRecord[] }> = [...dates.entries()].sort(([a], [b]) => b.localeCompare(a)).map(([date, rows]) => ({ date, records: rows.sort((a, b) => projection.displayTimes.get(a.key)!.rank - projection.displayTimes.get(b.key)!.rank) }));
  if (projection.segmentOnly.length) groups.push({ date: null, records: projection.segmentOnly });
  if (showRecent && groups.length) content.append(recentSection(groups));
  const hasRecords = showProjects && cards.length || showRecent && groups.length;
  if (!hasRecords) content.append(el('section', { class: 'period-empty' }, [el('h2', {}, ['这一段没有记录']), el('p', {}, ['可以继续向前翻，也可以搜索全部会话和项目。']), button('搜索全部', { class: 'text-button', id: 'empty-search' }, 'search')]));
  const older = [...projection.undatedProjects, ...projection.undatedLocalProjects.map(localCard), ...projection.undatedCandidateProjects.map(candidateCard)].sort(cardOrder);
  if (showProjects && view.k === 0 && older.length) content.append(earlierProjects(older));

  renderRail(); renderingFocusRecordKey = null;
}

function renderRail(): void {
  if (homeMode !== 'workspace' || !calendar) return;
  const rail = byId('history-rail'); rail.replaceChildren(); rail.hidden = false;
  const rangeLabel = (k: number) => { const range = freeWindowFor(k, calendar!); return `${range.start}—${dayLabel(calendar!.T - 30 * k)}`; };
  if (view.k > 0) rail.append(button('', { id: 'period-newer', 'aria-label': `更新的 30 天，${rangeLabel(view.k - 1)}`, title: `更新的 30 天 · ${rangeLabel(view.k - 1)}` }, 'up'));
  rail.append(button('', { id: 'period-older', 'aria-label': `更早的 30 天，${rangeLabel(view.k + 1)}`, title: `更早的 30 天 · ${rangeLabel(view.k + 1)}` }, 'down'));
}

function sortedSites(): WebsiteShortcut[] { return [...(snapshot?.shortcuts || [])].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)); }
function siteMark(site: WebsiteShortcut): HTMLElement { return el('span', { class: 'site-favicon', 'aria-hidden': 'true' }, [site.icon.kind === 'builtin' ? icon('globe') : site.icon.value]); }
function renderSites(): void {
  if (!snapshot) return;
  const revision = ++siteRenderRevision;
  const collapsed = snapshot.settings.shortcutSectionCollapsed;
  const sites = sortedSites().filter(site => !collapsed || site.pinned);
  const toggle = byId('site-toggle'); toggle.setAttribute('aria-expanded', String(!collapsed)); toggle.replaceChildren(icon(collapsed ? 'chevron' : 'down'), '常用网站');
  const strip = byId('site-strip'); strip.classList.toggle('expanded', allSitesVisible || collapsed);
  strip.replaceChildren(...sites.map(site => el('a', { class: `site-link${site.pinned ? '' : ' unpinned'}`, href: site.url, title: site.url, 'aria-label': `打开 ${site.label}` }, [siteMark(site), el('span', { class: 'site-title' }, [site.label])])));
  if (!sites.length) strip.append(el('p', { class: 'sites-empty' }, [collapsed ? '尚未固定网站。' : '把常用的网站放在这里。']));
  strip.append(button('', { class: 'add-site', id: 'add-site', 'aria-label': '添加网站', title: '添加网站' }, 'plus'));
  document.getElementById('show-more-sites')?.remove();
  requestAnimationFrame(() => {
    if (collapsed || !snapshot || revision !== siteRenderRevision) return;
    document.getElementById('show-more-sites')?.remove();
    if (strip.scrollHeight > strip.clientHeight + 1 || allSitesVisible) strip.after(button(allSitesVisible ? '收起更多网站' : '更多网站', { class: 'text-button sites-overflow-button', id: 'show-more-sites' }));
  });
}

function renderEditor(): void {
  byId('site-editor').replaceChildren(...sortedSites().map((site, index, sites) => {
    const row = el('div', { class: `edit-site-row${siteEditingId === site.id ? ' site-editing' : ''}`, draggable: 'true', 'data-drag-site': site.id }, [
      el('span', { class: 'drag-handle', 'aria-hidden': 'true' }, [icon('drag')]), siteMark(site),
      button(site.label, { class: 'edit-site-name', 'data-edit-site': site.id, title: '编辑名称与网址' }),
      button('', { class: `icon-button${site.pinned ? ' pinned' : ''}`, 'data-pin-site': site.id, 'data-focus-key': `pin:${site.id}`, 'aria-pressed': String(site.pinned), 'aria-label': `${site.pinned ? '取消固定' : '固定'} ${site.label}` }, 'pin'),
      button('', { class: 'icon-button', 'data-move-site': site.id, 'data-direction': -1, 'data-focus-key': `up:${site.id}`, disabled: index === 0, 'aria-label': `向前移动 ${site.label}` }, 'up'),
      button('', { class: 'icon-button', 'data-move-site': site.id, 'data-direction': 1, 'data-focus-key': `down:${site.id}`, disabled: index === sites.length - 1, 'aria-label': `向后移动 ${site.label}` }, 'down'),
      button('', { class: 'icon-button', 'data-remove-site': site.id, 'aria-label': `移除 ${site.label}` }, 'trash')]);
    return row;
  }));
}

function renderSearch(): void {
  if (homeMode !== 'workspace' || !snapshot) return;
  const query = byId<HTMLInputElement>('search-input').value.trim();
  const conditions = JSON.stringify([selectedScope, query, searchFilter, searchProjectKey]);
  if (conditions !== searchConditions) { searchVisibleLimit = SEARCH_PAGE_SIZE; searchConditions = conditions; }
  const projectKey = (result: ReturnType<typeof searchCatalog>[number]) => result.project?.key || result.localProject?.key || (result.candidateProject ? `candidate:${result.candidateProject.key}` : null);
  const results = searchCatalog(snapshot, query, selectedScope || 'unassigned').filter(result => {
    const key = projectKey(result);
    return (!searchProjectKey || key === searchProjectKey) && (searchFilter === 'all' || (searchFilter === 'project' ? key !== null : key === null));
  });
  const foundProjectKeys = new Set(results.map(projectKey));
  const projectResults = searchFilter === 'all' || searchFilter === 'project' ? searchProjects(snapshot, query, selectedScope || 'unassigned')
    .filter(project => !foundProjectKeys.has(project.key) && (!searchProjectKey || project.key === searchProjectKey))
    .map(project => ({ project, path: '打开项目' })) : [];
  const total = results.length + projectResults.length;
  const list = byId('search-results');
  // Query the entire scoped catalog; only materialize the requested slice into DOM.
  const shownConversations = results.slice(0, searchVisibleLimit);
  const shownProjects = projectResults.slice(0, Math.max(0, searchVisibleLimit - results.length));
  list.replaceChildren(...shownConversations.map(({ record, path, localProject, project, candidateProject }) => el('a', { class: 'search-result', href: record.canonicalUrl, 'data-record-key': record.key, 'data-focus-key': `search:${record.key}` }, [icon(project || localProject || candidateProject ? 'folder' : 'chat'), el('span', {}, [el('strong', {}, [title(record)]), el('small', {}, [path])]), icon('arrow', 'enter-icon')])));
  for (const { project, path } of shownProjects) list.append(el('a', { class: 'search-result', href: project.canonicalUrl }, [icon('folder'), el('span', {}, [el('strong', {}, [project.nativeTitle || '未命名项目']), el('small', {}, [path])]), icon('arrow', 'enter-icon')]));
  list.dataset.totalMatches = String(total);
  list.dataset.visibleMatches = String(shownConversations.length + shownProjects.length);
  if (!total) list.append(el('div', { class: 'search-empty' }, [query ? `没有找到“${query}”` : '没有符合条件的本地会话', el('p', { class: 'field-help' }, ['试试原会话标题、项目名称或保存的网址。']), el('div', { class: 'context-links' }, [button('清空条件', { id: 'clear-search' }), el('a', { href: 'https://chatgpt.com/' }, ['前往 ChatGPT 使用原生搜索', icon('external')])])]));
  if (total > searchVisibleLimit) list.append(button('显示更多', { class: 'text-button search-more', id: 'search-more', 'aria-label': '显示更多搜索结果' }));
  for (const control of document.querySelectorAll<HTMLButtonElement>('[data-search-filter]')) control.setAttribute('aria-pressed', String(control.dataset.searchFilter === searchFilter));
}

function openSearch(project?: DisplayProject): void {
  if (homeMode === 'life') { byId('life-search-input').focus(); return; }
  if (homeMode !== 'workspace') return;
  searchProjectKey = project?.key || null; searchFilter = project ? 'project' : 'all';
  searchConditions = '';
  byId<HTMLInputElement>('search-input').value = '';
  renderSearch(); showDialog('search-dialog'); byId<HTMLInputElement>('search-input').focus();
}

function renderSettings(): void {
  if (homeMode !== 'workspace' || !snapshot) return;
  byId('connection-label').textContent = snapshot.capabilities.chatgpt ? '已授予 ChatGPT 观察权限。可撤销连接，已有目录继续保留。' : '只在你点击连接后申请 ChatGPT 观察权限。';
  byId('connect-chatgpt').textContent = snapshot.capabilities.chatgpt ? '断开' : '连接';
  byId<HTMLInputElement>('capture-enabled').checked = snapshot.settings.captureEnabled;
  byId('revoke-history').hidden = !snapshot.capabilities.history;
  byId<HTMLInputElement>('time-zone').value = snapshot.settings.libraryTimeZone;
  const capture = snapshot.capabilities.chatgpt && snapshot.settings.captureEnabled;
  const activity = capture && snapshot.capabilities.startNavigationActivity === true
    ? '从 Start 主动打开会话并完成目标导航后记录当天活动；刷新、恢复和后台加载不计入。'
    : '连接 ChatGPT 并开启继续收录后，才会记录新的主动打开活动。';
  const projects = capture && snapshot.capabilities.localProjectCandidates === true
    ? '直接观察到的原生项目与会话关系会稳定保存在本机。'
    : '已有目录和本地项目继续保留；重新连接后继续观察原生关系。';
  byId('source-description').textContent = `本地历史可按日期浏览，浏览日期不计活跃。${activity}${projects}完整账号空间认证与全量同步尚未完成。`;
  byId('source-details').textContent = [snapshot.capabilities.sourceGate, ...(snapshot.capabilities.reasons || []), snapshot.capabilities.sourceStatus?.code || '', `构建：${snapshot.build.sha}`, `版本：${snapshot.build.version}`, `适配器：${snapshot.build.adapterVersion}`].filter(Boolean).join('\n');
}

function latestJob(): CatalogSnapshot['importJobs'][number] | undefined {
  if (!snapshot) return undefined;
  return snapshot.importJobs.find(job => job.id === activeJobId) || [...snapshot.importJobs].sort((a, b) => b.endTimeMs - a.endTimeMs)[0];
}

function renderImport(): void {
  const area = byId('import-progress'); const job = latestJob();
  byId('confirm-import').textContent = snapshot?.capabilities.history ? '开始导入' : '授权并导入';
  if (!job) { area.replaceChildren(); return; }
  const states: Record<string, string> = { running: '正在导入', paused: '导入已暂停', partial: '已导入可读取部分', complete: '已完成所选范围', cancelled: '导入已取消', 'permission-revoked': '历史权限已撤销' };
  const start = new Date(job.startTimeMs).toLocaleDateString('zh-CN');
  const end = new Date(job.endTimeMs).toLocaleDateString('zh-CN');
  area.replaceChildren(el('strong', {}, [states[job.state] || '导入状态']), el('p', {}, [`${start}—${end} · 已保留 ${job.acceptedCandidates} 条候选`]), el('p', {}, ['范围仅限浏览器当前可读取的历史；不代表完整账号历史。']));
  if (job.state === 'partial' || job.saturatedIntervals.length) area.append(el('p', {}, ['部分时间段无法完整读取，已保留现有结果；不会把覆盖不完整标记为全量。']));
  const actions = el('div', { class: 'import-actions' });
  if (job.state === 'running') actions.append(button('暂停', { class: 'secondary', 'data-import-pause': job.id }));
  if (['paused', 'partial', 'cancelled'].includes(job.state) && (job.pendingIntervals.length || job.pendingCandidates?.length)) actions.append(button('继续', { class: 'secondary', 'data-import-resume': job.id }));
  if (job.state === 'running' || job.state === 'paused') actions.append(button('取消本次导入', { class: 'text-button', 'data-import-cancel': job.id }));
  area.append(actions);
}

function renderRemoved(): void {
  if (!snapshot) return;
  const list = byId('removed-list');
  list.replaceChildren(...snapshot.tombstones.map(tombstone => el('div', { class: 'removed-row' }, [el('span', {}, [`已移除的会话 · ${dateTime(tombstone.removedAt, snapshot!.settings.libraryTimeZone)}`]), button('恢复收录', { class: 'secondary', 'data-restore-record': tombstone.key })])));
  if (!snapshot.tombstones.length) list.append(el('p', { class: 'field-help' }, ['当前资料库没有已移除的会话。']));
}

function render(): void {
  if (homeMode !== 'workspace') return;
  renderSites(); nativeExperience.refresh(); renderWorkspace();
  if (byId<HTMLDialogElement>('sites-dialog').open) renderEditor();
  if (byId<HTMLDialogElement>('search-dialog').open) renderSearch();
  if (byId<HTMLDialogElement>('import-dialog').open) renderImport();
  if (byId<HTMLDialogElement>('removed-dialog').open) renderRemoved();
  persistView();
}

function showRecord(record: ConversationRecord): void {
  currentRecord = record; byId('record-title').textContent = title(record);
  const lines: Array<[string, string]> = [ ['位置', membershipLabel(record)], ['保存的网址', record.canonicalUrl],
    ['最近可确认的主动打开', dateTime(record.activity?.lastConfirmedOpenAt || null, snapshot!.settings.libraryTimeZone)],
    ['浏览器最后记录时间', `${dateTime(record.browserLastVisitAt, snapshot!.settings.libraryTimeZone)}（不作为主动活动）`] ];
  byId('record-details').replaceChildren(...lines.flatMap(([name, value]) => [el('dt', {}, [name]), el('dd', {}, [value])]));
  showDialog('record-dialog');
}

async function openConversation(event: MouseEvent, link: HTMLAnchorElement): Promise<void> {
  if (event.defaultPrevented || event.altKey || (event.type === 'auxclick' && event.button !== 1) || (event.type === 'click' && event.button !== 0)) return;
  event.preventDefault();
  if (!event.isTrusted || !snapshot) return;
  const recordKey = link.dataset.recordKey;
  if (!recordKey) return;
  let disposition: OpenDisposition = 'same-tab';
  if (event.ctrlKey || event.metaKey || event.button === 1) disposition = event.shiftKey ? 'new-foreground-tab' : 'new-background-tab';
  else if (event.shiftKey) disposition = 'new-window';
  await dispatchOpen(recordKey, disposition, event.button === 1 ? 'auxclick' : event.detail === 0 ? 'keyboard' : 'click');
}

async function dispatchOpen(recordKey: string, disposition: OpenDisposition, gesture: 'click' | 'keyboard' | 'auxclick'): Promise<void> {
  if (openingRecords.has(recordKey)) return;
  openingRecords.add(recordKey);
  try {
    await request('OPEN', { recordKey, disposition, gesture });
    if (disposition !== 'same-tab' && !stopped) await refresh();
  }
  catch (error) { fail(error); }
  finally { openingRecords.delete(recordKey); }
}

async function connectChatGPT(event: Event, disconnect = false): Promise<void> {
  if (!event.isTrusted) return;
  const requestedModeEpoch = modeEpoch;
  // Call request/remove synchronously in the actual user gesture, before any await.
  const permission: chrome.permissions.Permissions = { permissions: ['scripting', 'webNavigation'], origins: ['https://chatgpt.com/*'] };
  const grant = disconnect ? chrome.permissions.remove(permission) : chrome.permissions.request(permission);
  try {
    const accepted = await grant; await request('PERMISSIONS_SYNC', !disconnect && accepted ? { enableCapture: true } : {}); await refresh(true);
    if (byId<HTMLDialogElement>('settings-dialog').open) renderSettings();
    if (homeMode === 'workspace' && requestedModeEpoch === modeEpoch) toast(disconnect ? '已断开 ChatGPT，已有目录继续保留。' : accepted ? '已连接 ChatGPT，可以继续收录并记录主动打开。' : '未授予连接权限，网站与本地目录仍可使用。');
  } catch (error) { fail(error); }
}

async function startImport(event: Event): Promise<void> {
  if (!event.isTrusted) return;
  const requestedModeEpoch = modeEpoch;
  const grant = chrome.permissions.request({ permissions: ['history'] });
  try {
    if (!await grant) { if (homeMode === 'workspace' && requestedModeEpoch === modeEpoch) toast('未授予历史权限，已有目录和网站仍可使用。'); return; }
    await request('PERMISSIONS_SYNC', {});
    const result = await request('IMPORT_START', { range: byId<HTMLSelectElement>('import-range').value, includeSynced: byId<HTMLInputElement>('include-synced').checked }) as { jobId?: string; id?: string; job?: { id: string } };
    activeJobId = result?.jobId || result?.id || result?.job?.id || null;
    if (homeMode !== 'workspace' || requestedModeEpoch !== modeEpoch) return;
    selectedScope = 'unassigned'; view.k = 0; view.filter = 'all';
    await refresh(true); renderImport(); void pumpImport();
  } catch (error) { fail(error); }
}

async function pumpImport(): Promise<void> {
  if (homeMode !== 'workspace' || importPumping || stopped || document.hidden) return;
  importPumping = true;
  try {
    let job = latestJob();
    // Let an already-started transaction finish, but do not start another batch
    // in life mode. The persisted job/capture settings are left untouched.
    while (homeMode === 'workspace' && !stopped && !document.hidden && job?.state === 'running') {
      const response = await request('IMPORT_STEP', { jobId: job.id }) as { job: ImportCheckpoint };
      job = response.job;
      await refresh();
      await new Promise<void>(resolve => setTimeout(resolve, 50));
    }
  } catch (error) { if (homeMode === 'workspace') fail(error); await refresh().catch(() => {}); }
  finally { importPumping = false; }
}

function changePeriod(delta: number): void {
  view.k = Math.max(0, view.k + delta); renderWorkspace(); window.scrollTo(0, 0); persistView();
  announce(view.k === 0 ? '最近 30 天' : '已切换到相邻的 30 天');
  (document.getElementById(delta > 0 ? 'period-older' : 'period-newer') || document.getElementById('period-older'))?.focus({ preventScroll: true });
}

function clearSiteForm(): void {
  siteEditingId = null; byId<HTMLFormElement>('add-site-form').reset(); byId('site-error').hidden = true;
  byId('cancel-site-edit').hidden = true; byId('save-site').textContent = '添加网站'; renderEditor();
}

function chooseFilter(filter: Filter): void {
  view.filter = filter; preservePosition(renderWorkspace); persistView();
  document.querySelector<HTMLButtonElement>(`[data-filter="${filter}"]`)?.focus({ preventScroll: true });
}

document.addEventListener('click', event => {
  const target = event.target instanceof Element ? event.target : null;
  const link = target?.closest<HTMLAnchorElement>('a[data-record-key]');
  if (link) { void openConversation(event, link); return; }
  const control = target?.closest<HTMLButtonElement>('button'); if (!control || control.disabled) return;
  if (control.dataset.close) { closeDialog(control.dataset.close); return; }
  if (control.dataset.filter) { chooseFilter(control.dataset.filter as Filter); return; }
  if (control.dataset.searchFilter) { searchFilter = control.dataset.searchFilter as Filter; searchProjectKey = null; renderSearch(); return; }
  if (control.dataset.older) {
    const key = control.dataset.older; view.older = view.older.includes(key) ? view.older.filter(item => item !== key) : [...view.older, key];
    preservePosition(renderWorkspace); persistView(); return;
  }
  if (control.dataset.more) { const key = control.dataset.more; view.limits[key] = (view.limits[key] || 5) + 12; preservePosition(renderWorkspace); persistView(); return; }
  if (control.dataset.projectMenu) {
    currentProject = snapshot ? searchProjects(snapshot, '', selectedScope || 'unassigned').find(project => project.key === control.dataset.projectMenu) || null : null;
    if (currentProject) { byId('project-title').textContent = currentProject.nativeTitle || '未命名项目'; for (const id of ['project-native', 'project-new']) byId<HTMLAnchorElement>(id).href = currentProject.canonicalUrl; showDialog('project-dialog'); } return;
  }
  if (control.dataset.recordMenu) { const record = snapshot?.conversations.find(item => item.key === control.dataset.recordMenu); if (record) showRecord(record); return; }
  if (control.dataset.editSite) {
    const site = snapshot?.shortcuts.find(item => item.id === control.dataset.editSite); if (!site) return;
    siteEditingId = site.id; byId<HTMLInputElement>('site-name').value = site.label; byId<HTMLInputElement>('site-url').value = site.url;
    byId('cancel-site-edit').hidden = false; byId('save-site').textContent = '保存修改'; renderEditor(); byId('site-name').focus(); return;
  }
  if (control.dataset.pinSite) { const site = snapshot?.shortcuts.find(item => item.id === control.dataset.pinSite); if (site) void mutate('SHORTCUT_UPSERT', { shortcut: { id: site.id, label: site.label, url: site.url, pinned: !site.pinned } }); return; }
  if (control.dataset.moveSite) { const id = control.dataset.moveSite; const index = sortedSites().findIndex(site => site.id === id); void mutate('SHORTCUT_MOVE', { id, toIndex: index + Number(control.dataset.direction) }); return; }
  if (control.dataset.removeSite) { void mutate('SHORTCUT_REMOVE', { id: control.dataset.removeSite }, () => { if (siteEditingId === control.dataset.removeSite) clearSiteForm(); }); return; }
  if (control.dataset.restoreRecord) { void mutate('RECORD_RESTORE', { recordKey: control.dataset.restoreRecord }, () => toast('已恢复到本地目录。')); return; }
  for (const [attribute, command] of [['importPause', 'IMPORT_PAUSE'], ['importResume', 'IMPORT_RESUME'], ['importCancel', 'IMPORT_CANCEL']] as const) {
    if (control.dataset[attribute]) { void request(command, { jobId: control.dataset[attribute] }).then(() => refresh(true)).then(() => { renderImport(); void pumpImport(); }).catch(fail); return; }
  }
  switch (control.id) {
    case 'home': if (homeMode === 'workspace') { view.k = 0; view.filter = 'all'; renderWorkspace(); } window.scrollTo(0, 0); persistView(); break;
    case 'search-trigger': case 'empty-search': openSearch(); break;
    case 'clear-search': searchProjectKey = null; searchFilter = 'all'; byId<HTMLInputElement>('search-input').value = ''; renderSearch(); byId('search-input').focus(); break;
    case 'search-more': {
      const list = byId('search-results'); const previousCount = Number(list.dataset.visibleMatches || 0); const scrollTop = list.scrollTop;
      searchVisibleLimit += SEARCH_PAGE_SIZE; renderSearch(); list.scrollTop = scrollTop;
      const firstNew = list.querySelectorAll<HTMLElement>('.search-result')[previousCount];
      firstNew?.focus({ preventScroll: true }); firstNew?.scrollIntoView({ block: 'nearest' }); break;
    }
    case 'project-find': if (currentProject) openSearch(currentProject); break;
    case 'settings-trigger': renderSettings(); showDialog('settings-dialog'); break;
    case 'legacy-sites': case 'site-edit': case 'add-site': renderEditor(); showDialog('sites-dialog'); if (control.id === 'add-site') byId('site-name').focus(); break;
    case 'cancel-site-edit': clearSiteForm(); break;
    case 'site-toggle': if (snapshot) void mutate('SETTINGS_UPDATE', { patch: { shortcutSectionCollapsed: !snapshot.settings.shortcutSectionCollapsed } }); break;
    case 'show-more-sites': allSitesVisible = !allSitesVisible; renderSites(); break;
    case 'earlier-projects-toggle': view.earlierProjectsOpen = !view.earlierProjectsOpen; preservePosition(renderWorkspace); persistView(); break;
    case 'period-newer': changePeriod(-1); break;
    case 'period-older': changePeriod(1); break;
    case 'settings-import': case 'first-import': renderImport(); showDialog('import-dialog'); break;
    case 'confirm-import': void startImport(event); break;
    case 'connect-chatgpt': void connectChatGPT(event, !!snapshot?.capabilities.chatgpt); break;
    case 'first-connect': void connectChatGPT(event); break;
    case 'revoke-history': if (event.isTrusted) void chrome.permissions.remove({ permissions: ['history'] }).then(() => request('PERMISSIONS_SYNC', {})).then(() => refresh(true)).then(renderSettings).catch(fail); break;
    case 'remove-record': if (currentRecord) { const key = currentRecord.key; void mutate('RECORD_REMOVE', { recordKey: key }, () => { closeDialog('record-dialog'); toast('已从首页移除，ChatGPT 会话仍然保留。', { label: '恢复收录', run: () => { void mutate('RECORD_RESTORE', { recordKey: key }); } }); }); } break;
    case 'show-removed': renderRemoved(); showDialog('removed-dialog'); break;
    case 'clear-local': showDialog('clear-dialog'); break;
    case 'confirm-clear': if (event.isTrusted) void mutate('CLEAR_LOCAL', {}, () => { selectedScope = 'unassigned'; view.k = 0; view.filter = 'all'; view.older = []; view.limits = {}; closeDialog('clear-dialog'); toast('Start 本地数据已清除。'); void refresh(true); }); break;
  }
});

document.addEventListener('auxclick', event => { const target = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[data-record-key]') : null; if (target) void openConversation(event, target); });
document.addEventListener('change', event => {
  const target = event.target as HTMLInputElement | HTMLSelectElement;
  if (target.id === 'scope-selector') { selectedScope = target.value; view.k = 0; view.older = []; searchProjectKey = null; void refresh(true).catch(fail); persistView(); }
  if (target.id === 'capture-enabled' && target instanceof HTMLInputElement) {
    if (target.checked && !snapshot?.capabilities.chatgpt) { target.checked = false; toast('请先连接 ChatGPT，再开启继续收录。'); return; }
    void mutate('SETTINGS_UPDATE', { patch: { captureEnabled: target.checked } });
  }
});
byId('search-input').addEventListener('input', renderSearch);
byId<HTMLFormElement>('add-site-form').addEventListener('submit', event => {
  event.preventDefault(); const label = byId<HTMLInputElement>('site-name').value.trim(); const url = allowedWebsiteUrl(byId<HTMLInputElement>('site-url').value.trim());
  if (!label || [...label].length > 64 || !url) { byId('site-error').textContent = '请输入名称和不带账号密码的 HTTP(S) 网址。'; byId('site-error').hidden = false; return; }
  byId('site-error').hidden = true;
  const shortcut = siteEditingId ? { id: siteEditingId, label, url } : { label, url };
  void mutate('SHORTCUT_UPSERT', { shortcut }, clearSiteForm);
});
byId<HTMLFormElement>('timezone-form').addEventListener('submit', event => {
  event.preventDefault(); const libraryTimeZone = byId<HTMLInputElement>('time-zone').value.trim();
  try { new Intl.DateTimeFormat('en', { timeZone: libraryTimeZone }).format(); }
  catch { toast('请输入有效的 IANA 时区，例如 Asia/Shanghai。'); return; }
  void mutate('SETTINGS_UPDATE', { patch: { libraryTimeZone } }, () => { toast('时区已更新，历史活动日记录保持不变。'); renderSettings(); });
});

document.addEventListener('keydown', event => {
  // Browser address/search/navigation shortcuts are intentionally untouched.
  if (event.isComposing) return;
  const search = byId<HTMLDialogElement>('search-dialog');
  if (search.open && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
    const rows = [...search.querySelectorAll<HTMLElement>('.search-result,#search-more')]; if (!rows.length) return;
    event.preventDefault(); const index = rows.indexOf(document.activeElement as HTMLElement); const next = event.key === 'ArrowDown' ? Math.min(rows.length - 1, index + 1) : Math.max(0, index - 1); rows[next]!.focus(); return;
  }
  if (search.open && event.key === 'Enter' && document.activeElement === byId('search-input')) {
    const first = search.querySelector<HTMLAnchorElement>('a[data-record-key]');
    if (first && event.isTrusted) { event.preventDefault(); if (!event.repeat) void dispatchOpen(first.dataset.recordKey!, event.ctrlKey || event.metaKey ? 'new-background-tab' : event.shiftKey ? 'new-window' : 'same-tab', 'keyboard'); } return;
  }
  const filter = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('[data-filter]') : null;
  if (filter && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
    event.preventDefault(); const values = Object.keys(filterLabels) as Filter[]; let index = values.indexOf(view.filter);
    index = event.key === 'Home' ? 0 : event.key === 'End' ? values.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : values.length - 1)) % values.length;
    chooseFilter(values[index]!); return;
  }
  if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && !isEditing(event.target) && !document.querySelector('dialog[open]')) { event.preventDefault(); openSearch(); }
});

byId('site-editor').addEventListener('dragstart', event => {
  const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-drag-site]') : null;
  siteDragId = target?.dataset.dragSite || null; if (siteDragId && event.dataTransfer) { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', siteDragId); }
});
byId('site-editor').addEventListener('dragover', event => { const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-drag-site]') : null; if (siteDragId && target) { event.preventDefault(); target.classList.add('drag-over'); } });
byId('site-editor').addEventListener('dragleave', event => { (event.target as Element).closest?.('[data-drag-site]')?.classList.remove('drag-over'); });
byId('site-editor').addEventListener('drop', event => {
  event.preventDefault(); const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-drag-site]') : null; const id = siteDragId; siteDragId = null;
  if (id && target?.dataset.dragSite && target.dataset.dragSite !== id) void mutate('SHORTCUT_MOVE', { id, toIndex: sortedSites().findIndex(site => site.id === target.dataset.dragSite) });
  for (const row of document.querySelectorAll('.drag-over')) row.classList.remove('drag-over');
});
byId('site-editor').addEventListener('dragend', () => { siteDragId = null; for (const row of document.querySelectorAll('.drag-over')) row.classList.remove('drag-over'); });

window.addEventListener('pagehide', () => { stopped = true; persistView(); clearTimeout(clockTimer); });
window.addEventListener('pageshow', event => { stopped = false; if (event.persisted) { if (homeMode === 'life') updateClock(); else void refresh().then(() => pumpImport()).catch(fail); } });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { clearTimeout(clockTimer); return; }
  if (homeMode === 'life') updateClock();
  else if (homeMode === 'workspace') void refresh().then(() => pumpImport()).catch(fail);
});
window.addEventListener('resize', () => { if (homeMode === 'workspace' && snapshot) renderSites(); });

const nativeExperience = initNativeExperience({ shortcuts: () => snapshot?.shortcuts ?? [], openSettings: () => { renderSettings(); showDialog('settings-dialog'); }, preserve: preservePosition });

function updateClock(): void {
  clearTimeout(clockTimer);
  if (homeMode !== 'life' || document.hidden || stopped) return;
  const now = new Date();
  const clock = byId<HTMLTimeElement>('life-clock');
  clock.textContent = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(now);
  clock.dateTime = now.toISOString();
  byId('life-date').textContent = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }).format(now);
  // One visible-page update per minute; no timer runs for a hidden life page.
  clockTimer = setTimeout(updateClock, 60_000 - (Date.now() % 60_000));
}

function clearWorkspaceSurface(): void {
  byId('workspace-content').replaceChildren();
  byId('history-rail').replaceChildren(); byId('history-rail').hidden = true;
  for (const id of ['search-results', 'record-details', 'removed-list', 'import-progress', 'site-strip', 'site-editor', 'source-details']) byId(id).replaceChildren();
  byId<HTMLInputElement>('search-input').value = '';
  for (const id of ['project-native', 'project-new']) byId(id).removeAttribute('href');
  byId('record-title').textContent = '会话详情'; byId('project-title').textContent = '项目';
  currentProject = null; currentRecord = null; snapshot = null;
  byId('toast').hidden = true; byId('live').textContent = '';
  clearTimeout(toastTimer);
}

async function loadWorkspace(epoch: number, scrollY: number): Promise<void> {
  try {
    await refresh(true);
    if (homeMode !== 'workspace' || modeEpoch !== epoch) return;
    modeLoading = false; window.scrollTo(0, scrollY); persistView();
    document.documentElement.dataset.startReady = 'true';
    const job = latestJob(); if (job?.state === 'running') { activeJobId = job.id; void pumpImport(); }
  } catch {
    if (homeMode !== 'workspace' || modeEpoch !== epoch) return;
    modeLoading = false;
    byId('workspace-content').setAttribute('aria-busy', 'false');
    const retry = button('重新读取本地目录', { class: 'secondary' });
    retry.addEventListener('click', () => { void loadWorkspace(modeEpoch, workspaceScrollY); });
    byId('workspace-content').replaceChildren(el('section', { class: 'loading-error' }, [el('h1', {}, ['暂时无法打开本地目录']), el('p', {}, ['已有数据没有被清除。可以重试，也可以继续使用生活首页。']), retry]));
    document.documentElement.dataset.startReady = 'true';
  }
}

function applyHomeMode(next: HomeMode): void {
  persistView();
  ++refreshSequence; // Invalidate responses and queued SafeRendering callbacks.
  unsubscribeWorkspace?.(); unsubscribeWorkspace = null;
  for (const dialog of document.querySelectorAll<HTMLDialogElement>('dialog[open]')) dialog.close();
  byId('workspace-content').hidden = true;
  byId('life-content').hidden = true;
  clearWorkspaceSurface(); clearTimeout(clockTimer);
  homeMode = next; modeLoading = next === 'workspace';
  document.documentElement.dataset.homeMode = next;
  document.documentElement.dataset.startReady = next === 'life' ? 'true' : 'false';
  byId('mode-loading').hidden = true;
  const target = next === 'workspace' ? '生活' : '工作空间';
  const control = byId<HTMLButtonElement>('mode-toggle');
  control.replaceChildren(icon(next === 'workspace' ? 'sun' : 'grid'), el('span', {}, [target]));
  control.setAttribute('aria-label', `切换到${target}`); control.title = `切换到${target}，新标签页将沿用此模式`;
  control.disabled = false;
  byId('home').setAttribute('aria-label', next === 'life' ? '回到生活首页' : '回到工作区首页');
  const search = byId('search-trigger');
  search.setAttribute('aria-label', next === 'life' ? '搜索网页，页面非编辑状态按斜杠键' : '搜索所有本地会话，页面非编辑状态按斜杠键');
  search.querySelector('.search-label')!.textContent = next === 'life' ? '搜索网页' : '搜索会话与项目';
  byId('mode-status').textContent = ''; byId('mode-save-retry').hidden = true; byId('mode-load-retry').hidden = true;
  nativeExperience.refresh();
  window.scrollTo(0, 0);
  if (next === 'life') { byId('life-content').hidden = false; updateClock(); }
  else {
    const content = byId('workspace-content'); content.hidden = false; content.setAttribute('aria-busy', 'true');
    content.replaceChildren(el('section', { class: 'mode-loading', role: 'status' }, ['正在打开本地记录…']));
    unsubscribeWorkspace = subscribeRevision(() => { void refresh().catch(fail); });
    void loadWorkspace(modeEpoch, workspaceScrollY);
  }
}

async function chooseHomeMode(next: HomeMode): Promise<void> {
  const saveSequence = ++modeSaveSequence;
  if (homeMode !== next) { ++modeEpoch; applyHomeMode(next); }
  const control = byId('mode-toggle'); control.setAttribute('aria-busy', 'true');
  byId('mode-status').textContent = ''; byId('mode-save-retry').hidden = true;
  // Serialize this page's rapid clicks; never write a catalog/settings snapshot.
  const save = modeSaveQueue.then(() => chrome.storage.local.set({ [HOME_MODE_KEY]: next }));
  modeSaveQueue = save.catch(() => {});
  try { await save; }
  catch {
    if (saveSequence === modeSaveSequence) {
      byId('mode-status').textContent = '当前页面已切换，但默认模式未能保存。';
      byId('mode-save-retry').hidden = false;
    }
  } finally { if (saveSequence === modeSaveSequence) control.setAttribute('aria-busy', 'false'); }
}

async function restoreHomeMode(): Promise<void> {
  const epoch = ++modeEpoch;
  byId('mode-load-retry').hidden = true; byId('mode-status').textContent = '';
  try {
    const stored = await chrome.storage.local.get(HOME_MODE_KEY);
    if (epoch !== modeEpoch || stopped) return;
    applyHomeMode(normalizeHomeMode(stored[HOME_MODE_KEY]));
  } catch {
    if (epoch !== modeEpoch || stopped) return;
    // A failed read is not a missing key. Never reveal a private workspace speculatively.
    byId('mode-loading').hidden = true;
    byId('mode-status').textContent = '暂时无法读取首页偏好。可以重新读取，或点击“生活”继续浏览。';
    byId('mode-load-retry').hidden = false;
    byId<HTMLButtonElement>('mode-toggle').disabled = false;
    document.documentElement.dataset.startReady = 'true';
  }
}

byId('mode-toggle').addEventListener('click', () => { void chooseHomeMode(homeMode === 'life' ? 'workspace' : 'life'); });
byId('mode-save-retry').addEventListener('click', () => { if (homeMode) void chooseHomeMode(homeMode); });
byId('mode-load-retry').addEventListener('click', () => { void restoreHomeMode(); });
byId('life-search-form').addEventListener('submit', event => {
  event.preventDefault();
  if (!event.isTrusted || homeMode !== 'life') return;
  const text = byId<HTMLInputElement>('life-search-input').value.trim(); if (!text) return;
  byId('life-search-status').textContent = '';
  if (!chrome.search?.query) { byId('life-search-status').textContent = '当前浏览器暂不可用页面搜索，请使用地址栏。'; return; }
  void chrome.search.query({ text, disposition: 'CURRENT_TAB' }).catch(() => {
    byId('life-search-status').textContent = '搜索暂未打开，输入已保留。请重试或使用地址栏。';
  });
});

// No storage.onChanged subscription for HOME_MODE_KEY: an open tab owns its mode.
void restoreHomeMode();
