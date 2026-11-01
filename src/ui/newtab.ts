import type { ConversationRecord, ProjectRecord, WebsiteShortcut, OpenDisposition, ImportCheckpoint } from '../../contracts/free-v1.js';
import type { CatalogSnapshot } from '../storage/repository.js';
import { projectCatalog, searchCatalog } from '../domain/projection.js';
import { createFreeViewSession, freeWindowFor, dayLabel } from '../domain/time.js';
import { request, subscribeRevision } from '../shared/client.js';
import { element as el, icon, byId, button, isEditing, allowedWebsiteUrl, dateTime } from './dom.js';
import { readView, saveView, SafeRendering, preservePosition } from './view-state.js';

interface UISnapshot extends CatalogSnapshot {
  capabilities: { chatgpt: boolean; history: boolean; captureEnabled?: boolean; sourceGate: string; reasons?: string[]; sourceStatus?: { code: string; profileId: string } | null };
  build: { sha: string; version: string; sourceGate: string; adapterVersion: string };
}
type Filter = 'all' | 'project' | 'none' | 'unknown';
type Card = ReturnType<typeof projectCatalog>['projects'][number];
const view = readView();
const initialScrollY = view.scrollY;
const safe = new SafeRendering();
let snapshot: UISnapshot | null = null;
let calendar: ReturnType<typeof createFreeViewSession> | null = null;
let selectedScope = view.selectedScope;
let currentProject: ProjectRecord | null = null;
let currentRecord: ConversationRecord | null = null;
let siteEditingId: string | null = null;
let siteDragId: string | null = null;
let allSitesVisible = false;
let siteRenderRevision = 0;
let searchFilter: Filter = 'all';
let searchProjectId: string | null = null;
const SEARCH_PAGE_SIZE = 100;
let searchVisibleLimit = SEARCH_PAGE_SIZE;
let searchConditions = '';
let toastTimer: ReturnType<typeof setTimeout> | undefined;
let refreshSequence = 0;
let mutationRunning = false;
let importPumping = false;
let stopped = false;
let activeJobId: string | null = null;
const openingRecords = new Set<string>();
const filterLabels: Record<Filter, string> = { all: '全部', project: '项目', none: '无项目', unknown: '待确认' };

function persistView(): void { view.selectedScope = selectedScope; view.scrollY = window.scrollY; saveView(view); }
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
  const code = error instanceof Error ? error.message : String(error);
  const message = /REVISION|revision|CONFLICT/i.test(code) ? '记录已被另一标签页更新，请重试这次操作。'
    : /PERMISSION|permission/i.test(code) ? '还没有对应权限。可以在设置中重新连接。'
    : /QUOTA|quota/i.test(code) ? '本地存储空间不足。已有记录仍保留，请释放空间后重试。'
    : /URL|url|VALID/i.test(code) ? '请检查填写的信息，网址须为不带账号密码的 HTTP(S) 地址。'
    : '这次操作没有完成，已有数据仍然保留。请重试或重新加载扩展。';
  toast(message);
}

async function refresh(immediate = false): Promise<void> {
  const sequence = ++refreshSequence;
  const requestedScope = selectedScope;
  const received = await request('SNAPSHOT', selectedScope ? { selectedScope } : {}) as UISnapshot;
  if ((!immediate && sequence !== refreshSequence) || stopped || requestedScope !== selectedScope) return;
  const apply = () => {
    if (requestedScope !== selectedScope || snapshot && received.revision < snapshot.revision) return;
    snapshot = received;
    if (!selectedScope || (selectedScope !== 'unassigned' && !received.scopes.some(scope => scope.key === selectedScope))) selectedScope = received.settings.selectedScope || 'unassigned';
    view.selectedScope = selectedScope;
    if (!calendar || calendar.Z !== received.settings.libraryTimeZone) calendar = createFreeViewSession({ now: new Date().toISOString(), timeZone: received.settings.libraryTimeZone });
    render();
  };
  if (immediate || !snapshot) preservePosition(apply); else safe.schedule(apply);
}

async function mutate(command: string, payload: Record<string, unknown>, after?: () => void): Promise<void> {
  if (!snapshot || mutationRunning) return;
  mutationRunning = true;
  try {
    await request(command, { ...payload, expectedRevision: snapshot.revision });
    await refresh(true);
    after?.();
  } catch (error) { fail(error); await refresh().catch(() => {}); }
  finally { mutationRunning = false; }
}

function title(record: ConversationRecord): string { return record.nativeTitle || '未命名会话'; }
function membershipLabel(record: ConversationRecord): string {
  if (record.owner.kind === 'unassigned') return '账号待确认';
  if (record.membership.state === 'NONE') return '无项目';
  if (record.membership.state === 'UNKNOWN') return '归属待确认';
  const scopeKey = record.owner.scopeKey;
  const projectId = record.membership.projectId;
  return snapshot?.projects.find(project => project.scopeKey === scopeKey && project.projectId === projectId)?.nativeTitle || '原生项目';
}

function conversationRow(record: ConversationRecord): HTMLElement {
  const link = el('a', { class: 'conversation-open', href: record.canonicalUrl, 'data-record-key': record.key,
    'data-focus-key': `record:${record.key}`, 'aria-label': `在 ChatGPT 中打开：${title(record)}`, title: title(record) },
  [icon('chat', 'chat-icon'), el('span', { class: 'conversation-title' }, [title(record)]), icon('arrow', 'enter-icon')]);
  const menu = button('', { class: 'icon-button record-menu', 'data-record-menu': record.key, 'data-focus-key': `details:${record.key}`, 'aria-label': `${title(record)}的详情与移除` }, 'more');
  return el('div', { class: 'conversation-row' }, [link, menu]);
}

function projectCard(card: Card): HTMLElement {
  const project = card.project;
  const projectTitle = project.nativeTitle || '未命名项目';
  const expanded = view.older.includes(project.key);
  const limit = view.limits[project.key] || 5;
  const body = el('div', { class: 'project-body' });
  const recent = el('div', { class: 'conversation-list' }, card.recent.slice(0, limit).map(conversationRow));
  if (card.recent.length > limit) recent.append(button('显示更多', { class: 'more-rows', 'data-more': project.key, 'data-focus-key': `more:${project.key}` }));
  if (card.recent.length) body.append(recent);
  if (card.older.length) {
    body.append(button('较早会话', { class: 'history-disclosure', 'data-older': project.key, 'aria-expanded': String(expanded), 'aria-controls': `older-${project.key}`, 'data-focus-key': `older:${project.key}` }, 'chevron'));
    const old = el('div', { class: 'old-list', id: `older-${project.key}` }, [el('div', { class: 'conversation-list' }, card.older.map(conversationRow))]);
    old.hidden = !expanded; body.append(old);
  }
  if (card.undated.length) body.append(el('p', { class: 'project-undated-label' }, ['尚无主动打开记录']), el('div', { class: 'conversation-list' }, card.undated.map(conversationRow)));
  if (!card.recent.length && !card.older.length && !card.undated.length) body.append(el('p', { class: 'project-note' }, ['尚未收录会话，可以打开原生项目。']));
  return el('article', { class: 'project', 'data-project': project.key, 'aria-labelledby': `project-${project.key}` }, [
    el('header', { class: 'project-head' }, [el('span', { class: 'project-symbol' }, [icon('folder')]), el('h3', { id: `project-${project.key}`, title: projectTitle }, [projectTitle]), button('', { class: 'icon-button', 'data-project-menu': project.key, 'data-focus-key': `project-menu:${project.key}`, 'aria-label': `${projectTitle}项目操作` }, 'more')]), body]);
}

function dateLabel(date: string): string {
  if (!calendar) return date;
  if (date === dayLabel(calendar.T)) return '今天';
  if (date === dayLabel(calendar.T - 1)) return '昨天';
  const [year, month, day] = date.split('-').map(Number);
  return `${year !== Number(dayLabel(calendar.T).slice(0, 4)) ? `${year} 年 ` : ''}${month} 月 ${day} 日`;
}

function unknownSection(records: ConversationRecord[], force: boolean): HTMLElement {
  const expanded = force || view.unknownOpen;
  const label = selectedScope === 'unassigned' ? '账号待确认' : '待确认归属';
  const header = force ? el('h2', { class: 'unknown-toggle' }, [icon('info', 'hint-icon'), label])
    : button(label, { class: 'unknown-toggle', id: 'unknown-toggle', 'aria-expanded': String(expanded), 'aria-controls': 'unknown-content' }, 'chevron');
  const note = snapshot?.capabilities.sourceGate === 'SOURCE_GATE_BLOCKED'
    ? '这些链接可以直接打开。当前版本尚未验证账号与项目来源，记录暂时保留在这里。'
    : '这些会话可以正常打开。确认原生项目归属后，它们会出现在对应的位置。';
  const content = el('div', { class: 'unknown-content', id: 'unknown-content' }, [el('p', { class: 'unknown-note' }, [note]), el('div', { class: 'unknown-grid' }, records.map(conversationRow))]);
  content.hidden = !expanded;
  return el('section', { class: 'unknown-section', 'aria-label': label }, [header, content]);
}

function workspaceHeading(): HTMLElement {
  const heading = el('div', { class: 'board-heading' }, [el('h1', {}, ['工作区'])]);
  if (snapshot && snapshot.scopes.length > 0) {
    const scopeSelect = el('select', { class: 'scope-selector', id: 'scope-selector', 'aria-label': '选择本地资料库' });
    for (const scope of snapshot.scopes) scopeSelect.append(el('option', { value: scope.key }, [scope.label || '已保存的资料库']));
    scopeSelect.append(el('option', { value: 'unassigned' }, ['账号待确认的记录']));
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
    el('p', { class: 'quiet' }, ['也可以先添加常用网站，按自己的节奏开始。']),
    button('连接 ChatGPT，继续收录会话链接', { class: 'text-button', id: 'first-connect' })]);
}

function renderWorkspace(): void {
  if (!snapshot || !calendar) return;
  const content = byId('workspace-content'); content.setAttribute('aria-busy', 'false');
  if (!snapshot.conversations.length && !snapshot.projects.length && !snapshot.importJobs.length && !snapshot.scopes.length) {
    content.replaceChildren(firstUse()); byId('history-rail').hidden = true; return;
  }
  const projection = projectCatalog(snapshot, { ...calendar, k: view.k, selectedScope: selectedScope || 'unassigned' });
  content.replaceChildren(workspaceHeading());
  if (selectedScope === 'unassigned' && snapshot.conversations.length) {
    content.append(el('div', { class: 'import-note' }, [icon('info'), el('div', {}, ['历史链接已保留', el('p', {}, ['仅凭浏览记录还不能确认账号和项目归属。这些记录不会增加今天的活跃度。'])]), button('导入更多', { class: 'text-button', id: 'import-more' })]));
  }
  const showProjects = view.filter === 'all' || view.filter === 'project';
  const showNone = view.filter === 'all' || view.filter === 'none';
  if (showProjects && projection.projects.length) content.append(el('section', { 'aria-label': '原生项目' }, [el('div', { class: 'project-grid' }, projection.projects.map(projectCard))]));
  if (showNone && projection.dates.length) content.append(el('section', { class: 'date-section', 'aria-label': '无项目会话' }, [
    el('div', { class: 'section-heading' }, [el('h2', {}, ['无项目'])]), el('div', { class: 'date-grid' }, projection.dates.map(group => el('article', { class: 'date-window' }, [
      el('h3', { 'aria-label': group.date }, [icon('calendar'), dateLabel(group.date)]), el('div', { class: 'conversation-list' }, group.records.map(conversationRow))]))) ]));
  if (showProjects && projection.undatedProjects.length) content.append(el('section', { class: 'undated-section', 'aria-label': '尚无主动打开记录的项目' }, [
    el('h2', {}, ['项目 · 尚无主动打开记录']), el('div', { class: 'project-grid' }, projection.undatedProjects.map(projectCard))]));
  if (showNone && projection.undatedNone.length) content.append(el('section', { class: 'undated-section' }, [el('h2', {}, ['无项目 · 尚无主动打开记录']), el('div', { class: 'unknown-grid' }, projection.undatedNone.map(conversationRow))]));
  const hasDisplayed = (showProjects && projection.projects.length) || (showNone && projection.dates.length);
  if (!hasDisplayed && view.filter !== 'unknown' && !(view.filter === 'all' && selectedScope === 'unassigned' && projection.unknown.length)) {
    content.append(el('section', { class: 'period-empty' }, [el('h2', {}, ['这一段没有记录']), el('p', {}, [view.filter === 'project' ? '还没有已确认项目归属的会话，也可以继续查看相邻 30 天。' : view.filter === 'none' ? '这一段没有已确认无项目的会话。' : '可以继续向前翻，也可以搜索全部本地会话。']), button('搜索全部已知', { class: 'text-button', id: 'empty-search' }, 'search')]));
  }
  if ((view.filter === 'all' || view.filter === 'unknown') && projection.unknown.length) content.append(unknownSection(projection.unknown, view.filter === 'unknown' || selectedScope === 'unassigned'));
  else if (view.filter === 'unknown') content.append(el('p', { class: 'section-empty' }, ['这个资料库没有待确认的会话。']));
  renderRail();
}

function renderRail(): void {
  if (!calendar) return;
  const rail = byId('history-rail'); rail.replaceChildren(); rail.hidden = view.filter === 'unknown' || (selectedScope === 'unassigned' && !snapshot?.conversations.some(record => record.activity));
  if (rail.hidden) return;
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
  if (!snapshot) return;
  const query = byId<HTMLInputElement>('search-input').value.trim();
  const conditions = JSON.stringify([selectedScope, query, searchFilter, searchProjectId]);
  if (conditions !== searchConditions) { searchVisibleLimit = SEARCH_PAGE_SIZE; searchConditions = conditions; }
  const results = searchCatalog(snapshot, query, selectedScope || 'unassigned').filter(result =>
    (!searchProjectId || result.project?.projectId === searchProjectId) && (searchFilter === 'all' || (searchFilter === 'project' ? result.record.membership.state === 'PROJECT' : searchFilter === 'none' ? result.record.membership.state === 'NONE' : result.record.membership.state === 'UNKNOWN')));
  // An empty native project remains reachable even when it has no conversation rows.
  const foundProjectIds = new Set(results.map(result => result.project?.projectId));
  const emptyProjects = searchFilter === 'all' || searchFilter === 'project' ? snapshot.projects.filter(project =>
    project.scopeKey === selectedScope && !foundProjectIds.has(project.projectId) && (!searchProjectId || project.projectId === searchProjectId) &&
    (!query || `${project.nativeTitle || ''} ${project.canonicalUrl}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()))) : [];
  const total = results.length + emptyProjects.length;
  const list = byId('search-results');
  // Query the entire scoped catalog; only materialize the requested slice into DOM.
  const shownConversations = results.slice(0, searchVisibleLimit);
  const shownProjects = emptyProjects.slice(0, Math.max(0, searchVisibleLimit - results.length));
  list.replaceChildren(...shownConversations.map(({ record, path }) => el('a', { class: 'search-result', href: record.canonicalUrl, 'data-record-key': record.key, 'data-focus-key': `search:${record.key}` }, [icon(record.membership.state === 'PROJECT' ? 'folder' : record.membership.state === 'NONE' ? 'chat' : 'info'), el('span', {}, [el('strong', {}, [title(record)]), el('small', {}, [path])]), icon('arrow', 'enter-icon')])));
  for (const project of shownProjects) list.append(el('a', { class: 'search-result', href: project.canonicalUrl }, [icon('folder'), el('span', {}, [el('strong', {}, [project.nativeTitle || '未命名项目']), el('small', {}, ['原生项目 · 打开 ChatGPT'])]), icon('arrow', 'enter-icon')]));
  list.dataset.totalMatches = String(total);
  list.dataset.visibleMatches = String(shownConversations.length + shownProjects.length);
  if (!total) list.append(el('div', { class: 'search-empty' }, [query ? `没有找到“${query}”` : '没有符合条件的本地会话', el('p', { class: 'field-help' }, ['试试原会话标题、项目名称或保存的网址。']), el('div', { class: 'context-links' }, [button('清空条件', { id: 'clear-search' }), el('a', { href: 'https://chatgpt.com/' }, ['前往 ChatGPT 使用原生搜索', icon('external')])])]));
  if (total > searchVisibleLimit) list.append(button('显示更多', { class: 'text-button search-more', id: 'search-more', 'aria-label': '显示更多搜索结果' }));
  for (const control of document.querySelectorAll<HTMLButtonElement>('[data-search-filter]')) control.setAttribute('aria-pressed', String(control.dataset.searchFilter === searchFilter));
}

function openSearch(project?: ProjectRecord): void {
  searchProjectId = project?.projectId || null; searchFilter = project ? 'project' : 'all';
  searchConditions = '';
  byId<HTMLInputElement>('search-input').value = '';
  renderSearch(); showDialog('search-dialog'); byId<HTMLInputElement>('search-input').focus();
}

function renderSettings(): void {
  if (!snapshot) return;
  byId('connection-label').textContent = snapshot.capabilities.chatgpt ? '已授予 ChatGPT 观察权限。可撤销连接，已有目录继续保留。' : '只在你点击连接后申请 ChatGPT 观察权限。';
  byId('connect-chatgpt').textContent = snapshot.capabilities.chatgpt ? '断开' : '连接';
  byId<HTMLInputElement>('capture-enabled').checked = snapshot.settings.captureEnabled;
  byId('revoke-history').hidden = !snapshot.capabilities.history;
  byId<HTMLInputElement>('time-zone').value = snapshot.settings.libraryTimeZone;
  byId('source-description').textContent = snapshot.capabilities.sourceGate === 'SOURCE_GATE_BLOCKED'
    ? '本地目录、历史导入和网站入口可用。账号、项目归属与主动打开来源尚未通过真实验证，当前保持待确认，不生成未经证实的活动。'
    : '只记录可确认的主动打开。刷新、恢复标签和切回已有标签不计作活动。';
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
  renderSites(); renderWorkspace();
  if (byId<HTMLDialogElement>('sites-dialog').open) renderEditor();
  if (byId<HTMLDialogElement>('search-dialog').open) renderSearch();
  if (byId<HTMLDialogElement>('import-dialog').open) renderImport();
  if (byId<HTMLDialogElement>('removed-dialog').open) renderRemoved();
  persistView();
}

function showRecord(record: ConversationRecord): void {
  currentRecord = record; byId('record-title').textContent = title(record);
  const lines: Array<[string, string]> = [ ['归属', membershipLabel(record)], ['保存的网址', record.canonicalUrl],
    ['最近可确认的主动打开', dateTime(record.activity?.lastConfirmedOpenAt || null, snapshot!.settings.libraryTimeZone)],
    ['浏览器最后记录时间', `${dateTime(record.browserLastVisitAt, snapshot!.settings.libraryTimeZone)}（不作为主动活动）`],
    ['访问状态', ({ unverified: '尚未确认', reachable: '上次可访问', 'auth-required': '需要登录', unavailable: '暂时无法访问' })[record.availability]] ];
  if (record.membership.state !== 'UNKNOWN') lines.push(['归属核对时间', dateTime(record.membership.confirmedAt, snapshot!.settings.libraryTimeZone)]);
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
  // Call request/remove synchronously in the actual user gesture, before any await.
  const permission: chrome.permissions.Permissions = { permissions: ['scripting', 'webNavigation'], origins: ['https://chatgpt.com/*'] };
  const grant = disconnect ? chrome.permissions.remove(permission) : chrome.permissions.request(permission);
  try {
    const accepted = await grant; await request('PERMISSIONS_SYNC', !disconnect && accepted ? { enableCapture: true } : {}); await refresh(true);
    if (byId<HTMLDialogElement>('settings-dialog').open) renderSettings();
    toast(disconnect ? '已断开 ChatGPT，已有目录继续保留。' : accepted ? '已连接 ChatGPT。当前来源限制可在设置中查看。' : '未授予连接权限，网站与本地目录仍可使用。');
  } catch (error) { fail(error); }
}

async function startImport(event: Event): Promise<void> {
  if (!event.isTrusted) return;
  const grant = chrome.permissions.request({ permissions: ['history'] });
  try {
    if (!await grant) { toast('未授予历史权限，已有目录和网站仍可使用。'); return; }
    await request('PERMISSIONS_SYNC', {});
    const result = await request('IMPORT_START', { range: byId<HTMLSelectElement>('import-range').value, includeSynced: byId<HTMLInputElement>('include-synced').checked }) as { jobId?: string; id?: string; job?: { id: string } };
    activeJobId = result?.jobId || result?.id || result?.job?.id || null;
    selectedScope = 'unassigned'; view.filter = 'unknown'; view.unknownOpen = true;
    await refresh(true); renderImport(); void pumpImport();
  } catch (error) { fail(error); }
}

async function pumpImport(): Promise<void> {
  if (importPumping || stopped || document.hidden) return;
  importPumping = true;
  try {
    let job = latestJob();
    while (!stopped && !document.hidden && job?.state === 'running') {
      const response = await request('IMPORT_STEP', { jobId: job.id }) as { job: ImportCheckpoint };
      job = response.job;
      await refresh();
      await new Promise<void>(resolve => setTimeout(resolve, 50));
    }
  } catch (error) { fail(error); await refresh().catch(() => {}); }
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
  if (control.dataset.searchFilter) { searchFilter = control.dataset.searchFilter as Filter; searchProjectId = null; renderSearch(); return; }
  if (control.dataset.older) {
    const key = control.dataset.older; view.older = view.older.includes(key) ? view.older.filter(item => item !== key) : [...view.older, key];
    preservePosition(renderWorkspace); persistView(); return;
  }
  if (control.dataset.more) { const key = control.dataset.more; view.limits[key] = (view.limits[key] || 5) + 12; preservePosition(renderWorkspace); persistView(); return; }
  if (control.dataset.projectMenu) {
    currentProject = snapshot?.projects.find(project => project.key === control.dataset.projectMenu) || null;
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
    case 'home': view.k = 0; view.filter = 'all'; renderWorkspace(); window.scrollTo(0, 0); persistView(); break;
    case 'search-trigger': case 'empty-search': openSearch(); break;
    case 'clear-search': searchProjectId = null; searchFilter = 'all'; byId<HTMLInputElement>('search-input').value = ''; renderSearch(); byId('search-input').focus(); break;
    case 'search-more': {
      const list = byId('search-results'); const previousCount = Number(list.dataset.visibleMatches || 0); const scrollTop = list.scrollTop;
      searchVisibleLimit += SEARCH_PAGE_SIZE; renderSearch(); list.scrollTop = scrollTop;
      const firstNew = list.querySelectorAll<HTMLElement>('.search-result')[previousCount];
      firstNew?.focus({ preventScroll: true }); firstNew?.scrollIntoView({ block: 'nearest' }); break;
    }
    case 'project-find': if (currentProject) openSearch(currentProject); break;
    case 'settings-trigger': renderSettings(); showDialog('settings-dialog'); break;
    case 'site-edit': case 'add-site': renderEditor(); showDialog('sites-dialog'); if (control.id === 'add-site') byId('site-name').focus(); break;
    case 'cancel-site-edit': clearSiteForm(); break;
    case 'site-toggle': if (snapshot) void mutate('SETTINGS_UPDATE', { patch: { shortcutSectionCollapsed: !snapshot.settings.shortcutSectionCollapsed } }); break;
    case 'show-more-sites': allSitesVisible = !allSitesVisible; renderSites(); break;
    case 'unknown-toggle': view.unknownOpen = !view.unknownOpen; preservePosition(renderWorkspace); persistView(); break;
    case 'period-newer': changePeriod(-1); break;
    case 'period-older': changePeriod(1); break;
    case 'settings-import': case 'first-import': case 'import-more': renderImport(); showDialog('import-dialog'); break;
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
  if (target.id === 'scope-selector') { selectedScope = target.value; view.k = 0; view.older = []; searchProjectId = null; void refresh(true).catch(fail); persistView(); }
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

window.addEventListener('pagehide', () => { stopped = true; persistView(); });
window.addEventListener('pageshow', event => { stopped = false; if (event.persisted) void refresh().then(() => pumpImport()).catch(fail); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) { void refresh().then(() => pumpImport()).catch(fail); } });
window.addEventListener('resize', () => { if (snapshot) renderSites(); });
subscribeRevision(() => { void refresh().catch(fail); });

void refresh(true).then(() => {
  window.scrollTo(0, initialScrollY);
  document.documentElement.dataset.startReady = 'true';
  const job = latestJob(); if (job?.state === 'running') { activeJobId = job.id; void pumpImport(); }
}).catch(() => {
  byId('workspace-content').setAttribute('aria-busy', 'false');
  const retry = button('重新读取本地目录', { class: 'secondary' }); retry.addEventListener('click', () => { void refresh(true).catch(fail); });
  byId('workspace-content').replaceChildren(el('section', { class: 'loading-error' }, [el('h1', {}, ['暂时无法打开本地目录']), el('p', {}, ['已有数据没有被清除。可重试读取，或在扩展管理页重新加载。']), retry]));
});
