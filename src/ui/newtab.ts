import { initNativeExperience } from './native-experience.js';
import { initSettingsView, type SettingsPage } from './settings-view.js';
import { HOME_MODE_KEY, homeMode as normalizeHomeMode, type HomeMode } from '../domain/home-mode.js';
import type { HomeTheme } from '../domain/home-theme.js';
import { initHomeTheme } from './home-theme.js';
import { initHomePreferences } from './home-preferences.js';
import { mountProjectLayout } from './project-layout.js';
import { readSpatialView, saveSpatialView, spatialColumns, spatialPanelId, spatialProjectGrid, spatialProjectSection, spatialRecentSection, SPATIAL_DATE_ROWS, SPATIAL_DATE_STEP, SPATIAL_PROJECT_ROWS, SPATIAL_PROJECT_STEP } from './spatial-home.js';
import type { ConversationRecord, WebsiteShortcut, OpenDisposition, ImportCheckpoint } from '../../contracts/free-v1.js';
import type { CatalogSnapshot } from '../storage/repository.js';
import { projectCatalog, searchCatalog, searchProjects, type CandidateProjectCard, type LocalObservedProjectCard } from '../domain/projection.js';
import { createFreeViewSession, dayLabel, reanchorFreeSegment } from '../domain/time.js';
import { request, subscribeRevision } from '../shared/client.js';
import { element as el, icon, byId, button, isEditing, allowedWebsiteUrl, dateTime } from './dom.js';
import { readView, saveView, SafeRendering, preservePosition } from './view-state.js';
import { recentDisplayGroups, type RecentDisplayGroup } from './recent-groups.js';

interface UISnapshot extends CatalogSnapshot {
  capabilities: { chatgpt: boolean; history: boolean; captureEnabled?: boolean; startNavigationActivity?: boolean; localProjectCandidates?: boolean; sourceGate: string; reasons?: string[]; sourceStatus?: { code: string; profileId: string } | null };
  build: { sha: string; version: string; sourceGate: string; adapterVersion: string };
}
type Filter = 'all' | 'project' | 'none';
interface DisplayProject { key: string; nativeTitle: string | null; canonicalUrl: string; stableRank?: number }
const view = readView();
const spatialView = readSpatialView();
let activeHomeTheme: HomeTheme = 'classic';
let lastSpatialColumns = spatialColumns(window.innerWidth, activeHomeTheme);
const isModernTheme = () => activeHomeTheme !== 'classic';
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
let recentMoreOpen = view.recentMoreOpen === true;
let currentRecentGroups: RecentDisplayGroup[] = [];
let pinsBusy = false;
let pinsVisibleLimit = SEARCH_PAGE_SIZE;
let calendarTimer: ReturnType<typeof setTimeout> | undefined;
let projectLayouts: ReturnType<typeof mountProjectLayout>[] = [];
let toastTimer: ReturnType<typeof setTimeout> | undefined;
let refreshSequence = 0;
let mutationRunning = false;
let importPumping = false;
let stopped = false;
let activeJobId: string | null = null;
let settingsWorkspaceAccess = false;
let unsubscribeSettings: (() => void) | null = null;
let settingsVisit = 0;
let permissionSequence = 0;
let connectionBusy = false;
let importStarting = false;
let timezoneDirty = false;
let timezoneEdit = 0;
function workspaceAccessAllowed(): boolean {
  return homeMode === 'workspace' || homeMode === 'life' && settingsWorkspaceAccess;
}
const openingRecords = new Set<string>();
const filterLabels: Record<Filter, string> = { all: '全部', project: '项目', none: '最近' };

function persistView(): void {
  if (homeMode !== 'workspace' || modeLoading) return;
  view.selectedScope = selectedScope; view.recentMoreOpen = recentMoreOpen; view.scrollY = window.scrollY;
  workspaceScrollY = view.scrollY; saveView(view);
  saveSpatialView(spatialView);
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
  const fromSettings = byId<HTMLDialogElement>('settings-dialog').open && ['sites-dialog', 'import-dialog', 'removed-dialog', 'clear-dialog'].includes(id);
  if (!fromSettings) for (const other of document.querySelectorAll<HTMLDialogElement>('dialog[open]')) if (other !== dialog) other.close();
  if (!dialog.open) dialog.showModal();
}
function closeDialog(id: string): void { byId<HTMLDialogElement>(id).close(); }
function fail(error: unknown, target?: string): void {
  if (!workspaceAccessAllowed()) return;
  const code = error instanceof Error ? error.message : String(error);
  const message = /REVISION|revision|CONFLICT/i.test(code) ? '记录已被另一标签页更新，请重试这次操作。'
    : /PERMISSION|permission/i.test(code) ? '还没有对应权限。可以在设置中重新连接。'
    : /QUOTA|quota/i.test(code) ? '本地存储空间不足。已有记录仍保留，请释放空间后重试。'
    : /URL|url|VALID/i.test(code) ? '请检查填写的信息，网址须为不带账号密码的 HTTP(S) 地址。'
    : '未能确认操作结果，请重新打开设置检查后重试。';
  if (settingsView.isOpen || byId<HTMLDialogElement>('import-dialog').open) {
    const location = target || (byId<HTMLDialogElement>('clear-dialog').open ? 'clear-status' : byId<HTMLDialogElement>('import-dialog').open ? 'import-status' : 'settings-status');
    settingsView.showStatus(message, true, location);
  } else toast(message);
}

/** Keep date labels honest across local midnight without collecting new activity. */
function updateCalendar(): boolean {
  if (homeMode !== 'workspace' || !snapshot) return false;
  const next = createFreeViewSession({ now: new Date().toISOString(), timeZone: snapshot.settings.libraryTimeZone, H: homePreferences.value.periodDays });
  const previous = calendar;
  if (previous && previous.H === next.H && previous.T === next.T && previous.Z === next.Z) return false;
  if (previous) view.k = reanchorFreeSegment(view.k, previous, next);
  calendar = next; if (previous) recentMoreOpen = false;
  return true;
}
function scheduleCalendarTick(): void {
  clearTimeout(calendarTimer);
  if (homeMode !== 'workspace' || document.hidden || stopped) return;
  calendarTimer = setTimeout(() => {
    if (homeMode !== 'workspace' || stopped) return;
    safe.renderAfterPending(() => {
      if (homeMode === 'workspace' && updateCalendar()) { renderWorkspace(); persistView(); }
      scheduleCalendarTick();
    });
  }, 60_000 - Date.now() % 60_000);
}

async function refresh(immediate = false): Promise<UISnapshot | undefined> {
  if (!workspaceAccessAllowed() || stopped) return;
  const sequence = ++refreshSequence;
  const requestedModeEpoch = modeEpoch;
  const requestedScope = selectedScope;
  const received = await request('SNAPSHOT', selectedScope ? { selectedScope } : {}) as UISnapshot;
  if (sequence !== refreshSequence || stopped || requestedScope !== selectedScope || !workspaceAccessAllowed() || requestedModeEpoch !== modeEpoch) return;
  const apply = () => {
    if (!workspaceAccessAllowed() || requestedModeEpoch !== modeEpoch || sequence !== refreshSequence || requestedScope !== selectedScope || snapshot && received.revision < snapshot.revision) return;
    snapshot = received;
    if (!selectedScope || (selectedScope !== 'unassigned' && !received.scopes.some(scope => scope.key === selectedScope))) selectedScope = received.settings.selectedScope || 'unassigned';
    if (homeMode === 'workspace') {
      view.selectedScope = selectedScope;
      updateCalendar(); scheduleCalendarTick();
    }
    render();
  };
  // A life page can explicitly visit workspace settings without constructing its home.
  if (homeMode === 'life') apply(); else safe.render(apply, immediate || !snapshot);
  return received;
}

async function mutate(command: string, payload: Record<string, unknown>, after?: () => void): Promise<boolean> {
  if (!snapshot || !workspaceAccessAllowed()) return false;
  if (mutationRunning) { if (settingsView.isOpen) settingsView.showStatus('正在保存，请稍候。'); renderSettings(); return false; }
  mutationRunning = true;
  const origin = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const saveControls = [...document.querySelectorAll<HTMLButtonElement>('#timezone-form button[type=submit],#confirm-clear,#save-site')];
  for (const control of saveControls) { control.disabled = true; control.setAttribute('aria-busy', 'true'); }
  try {
    await request(command, { ...payload, expectedRevision: snapshot.revision });
    let refreshed = true;
    try { await refresh(true); } catch { refreshed = false; }
    if (workspaceAccessAllowed()) {
      after?.();
      if (!refreshed) {
        const notice = '操作已完成，页面暂未刷新。请重新打开设置。';
        if (settingsView.isOpen) settingsView.showStatus(notice, true); else toast(notice);
      }
    }
    return true;
  } catch (error) { fail(error); await refresh().catch(() => {}); return false; }
  finally {
    mutationRunning = false;
    for (const control of saveControls) { control.disabled = false; control.removeAttribute('aria-busy'); }
    if (settingsView.isOpen) renderSettings();
    if (origin?.isConnected && origin.getClientRects().length && document.activeElement === document.body) origin.focus({ preventScroll: true });
  }
}

function title(record: ConversationRecord): string { return record.nativeTitle || '未命名会话'; }
function membershipLabel(record: ConversationRecord): string {
  if (!snapshot) return '最近';
  return searchCatalog(snapshot, '', selectedScope || 'unassigned').find(result => result.record.key === record.key)?.path || '最近';
}

function conversationRow(record: ConversationRecord): HTMLElement {
  const link = el('a', { class: 'conversation-open', href: record.canonicalUrl, 'data-record-key': record.key,
    'data-focus-key': `record:${record.key}`, 'aria-label': `在 ChatGPT 中打开：${title(record)}`, title: title(record) },
  [el('span', { class: 'conversation-title' }, [title(record)])]);
  const menu = button('', { class: 'icon-button record-menu', 'data-record-menu': record.key, 'data-focus-key': `details:${record.key}`, 'aria-label': `${title(record)}的详情与移除` }, 'more');
  return el('div', { class: 'conversation-row' }, [link, menu]);
}

interface DisplayCard { project: DisplayProject; recent: ConversationRecord[]; older: ConversationRecord[]; undated: ConversationRecord[]; sortTime: number | null; attributes?: Record<string, string> }
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

function earlierProjects(cards: DisplayCard[]): HTMLElement {
  if (renderingFocusRecordKey && cards.some(card => [...card.recent, ...card.older, ...card.undated].some(record => record.key === renderingFocusRecordKey))) view.earlierProjectsOpen = true;
  const expanded = view.earlierProjectsOpen;
  const list = spatialProjectGrid(cards, { view: spatialView, row: conversationRow, columns: spatialColumns(window.innerWidth, activeHomeTheme), focusedRecord: renderingFocusRecordKey });
  list.id = 'earlier-projects-content';
  list.hidden = !expanded;
  return el('section', { class: 'earlier-projects', 'aria-label': '更早' }, [
    button('更早', { id: 'earlier-projects-toggle', class: 'earlier-projects-toggle', 'aria-expanded': String(expanded), 'aria-controls': list.id }, 'chevron'), list]);
}

function workspaceHeading(): HTMLElement {
  const title = el('h1', isModernTheme() ? { class: 'sr' } : {}, ['工作区']);
  const titleGroup = isModernTheme() ? el('div', { class: 'spatial-heading-title' }, [title]) : null;
  const heading = el('div', { class: 'board-heading' }, [titleGroup || title]);
  if (snapshot && snapshot.scopes.length > 0) {
    const scopeSelect = el('select', { class: 'scope-selector', id: 'scope-selector', 'aria-label': '选择本地资料库' });
    for (const scope of snapshot.scopes) scopeSelect.append(el('option', { value: scope.key }, [scope.label || '已保存的资料库']));
    scopeSelect.append(el('option', { value: 'unassigned' }, ['此浏览器']));
    scopeSelect.value = selectedScope || 'unassigned'; (titleGroup || heading).append(scopeSelect);
  }
  const filters = el('div', { class: 'segment', role: 'tablist', 'aria-label': '筛选会话' });
  for (const filter of Object.keys(filterLabels) as Filter[]) {
    const control = button(filterLabels[filter], { role: 'tab', 'data-filter': filter, 'data-focus-key': `filter:${filter}`, 'aria-selected': String(view.filter === filter), tabindex: view.filter === filter ? 0 : -1 });
    filters.append(control);
  }
  heading.append(filters);
  if (calendar) heading.append(el('nav', { class: 'spatial-period', 'aria-label': '时段导航' }, [
    button('', { class: 'icon-button', id: 'period-newer', 'aria-label': '更新时段', title: '更新时段', disabled: view.k === 0 }, 'chevron'),
    button('', { class: 'icon-button', id: 'period-older', 'aria-label': '更早时段', title: '更早时段' }, 'chevron'),
  ]));
  if (!isModernTheme()) heading.append(el('a', { class: 'new-chat', href: 'https://chatgpt.com/', 'aria-label': '在 ChatGPT 中开始新对话' }, ['新对话', icon('external')]));
  return heading;
}

/** One reversible mode action; each theme keeps its own visual treatment. */
function renderThemeChrome(heading?: HTMLElement): void {
  const modern = isModernTheme();
  const controls = byId('theme-controls');
  controls.replaceChildren(...(modern && homeMode === 'workspace' && heading ? [heading] : []));
  controls.hidden = !modern || homeMode !== 'workspace' || !heading;
  byId('mode-toggle').hidden = false;
  byId('theme-new-chat').hidden = !modern || homeMode !== 'workspace';
  byId('search-trigger').hidden = modern && homeMode === 'life';
}

function firstUse(): HTMLElement {
  return el('section', { class: 'first-use' }, [el('div', { class: 'brand-mark', 'aria-hidden': 'true' }, [el('i'), el('i'), el('i'), el('i')]),
    el('h1', {}, ['让对话留在手边。']), el('p', {}, ['把浏览过的 ChatGPT 会话保存在这里。', el('br'), '关掉浏览器标签，下一次也能接着开始。']),
    el('div', { class: 'first-actions' }, [el('a', { class: 'primary', href: 'https://chatgpt.com/' }, ['打开 ChatGPT', icon('external')]), button('导入浏览历史', { class: 'secondary', id: 'first-import' })]),
    el('p', { class: 'quiet' }, ['也可以先使用浏览器书签，按自己的节奏开始。']),
    button('连接 ChatGPT，继续收录会话链接', { class: 'text-button', id: 'first-connect' })]);
}

function disposeProjectLayouts(): void {
  for (const layout of projectLayouts) layout.dispose();
  projectLayouts = [];
}
function layoutProjects(): void {
  for (const grid of document.querySelectorAll<HTMLElement>('.spatial-project-grid:not([hidden])')) {
    projectLayouts.push(mountProjectLayout(grid, {
      mode: homePreferences.value.projectLayout, theme: activeHomeTheme,
      schedule: work => safe.renderAfterPending(() => { if (homeMode === 'workspace' && grid.isConnected && !stopped) work(); }),
    }));
  }
}

function renderWorkspace(): void {
  if (homeMode !== 'workspace' || !snapshot || !calendar) return;
  updateCalendar(); disposeProjectLayouts();
  document.documentElement.dataset.homeTheme = activeHomeTheme;
  const content = byId('workspace-content'); content.setAttribute('aria-busy', 'false');
  if (!snapshot.conversations.length && !snapshot.projects.length && !snapshot.localProjects?.length && !snapshot.importJobs.length && !snapshot.scopes.length) {
    currentRecentGroups = []; renderThemeChrome(); content.replaceChildren(firstUse()); byId('history-rail').hidden = true; return;
  }
  const projection = projectCatalog(snapshot, { ...calendar, k: view.k, selectedScope: selectedScope || 'unassigned' });
  const focused = (document.activeElement as HTMLElement | null)?.dataset.focusKey;
  renderingFocusRecordKey = focused?.startsWith('record:') ? focused.slice(7) : focused?.startsWith('details:') ? focused.slice(8) : null;
  const showProjects = view.filter === 'all' || view.filter === 'project';
  const showRecent = view.filter === 'all' || view.filter === 'none';
  const cards: DisplayCard[] = [...projection.projects, ...projection.localProjects.map(localCard), ...projection.candidateProjects.map(candidateCard)].sort(cardOrder);
  const groups = recentDisplayGroups([...projection.dates, ...projection.pendingDates], projection.segmentOnly, projection.displayTimes, view.k);
  currentRecentGroups = groups;
  const heading = workspaceHeading();
  renderThemeChrome(isModernTheme() ? heading : undefined);
  content.replaceChildren(...(isModernTheme() ? [] : [heading]));
  if (showProjects && cards.length) content.append(spatialProjectSection(cards, {
    view: spatialView, row: conversationRow, columns: spatialColumns(window.innerWidth, activeHomeTheme), focusedRecord: renderingFocusRecordKey,
  }));
  if (showRecent && groups.length) content.append(spatialRecentSection(groups, {
    view: spatialView, row: conversationRow, scope: selectedScope || 'unassigned', focusedRecord: renderingFocusRecordKey,
    label: dateLabel, pinnedKeys: homePreferences.value.recentPinnedKeys, today: dayLabel(calendar.T), moreDatesOpen: recentMoreOpen,
  }));
  const hasRecords = showProjects && cards.length || showRecent && groups.length;
  if (!hasRecords) content.append(el('section', { class: 'period-empty' }, [el('h2', {}, ['这一段没有记录']), el('p', {}, ['可以继续向前翻，也可以搜索全部会话和项目。']), button('搜索全部', { class: 'text-button', id: 'empty-search' }, 'search')]));
  const older = [...projection.undatedProjects, ...projection.undatedLocalProjects.map(localCard), ...projection.undatedCandidateProjects.map(candidateCard)].sort(cardOrder);
  if (showProjects && view.k === 0 && older.length) content.append(earlierProjects(older));

  renderRail(); layoutProjects(); renderingFocusRecordKey = null;
}

function renderRail(): void {
  byId('history-rail').replaceChildren(); byId('history-rail').hidden = true;
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

/** Pins are explicit display preferences; only genuine recent records can enter. */
function renderPins(): void {
  if (homeMode !== 'workspace' || !snapshot) return;
  const list = byId('pins-list');
  const focusedKey = (document.activeElement as HTMLElement | null)?.dataset.focusKey;
  const scrollTop = list.scrollTop;
  const query = byId<HTMLInputElement>('pins-search').value.trim().toLocaleLowerCase();
  const pins = new Set(homePreferences.value.recentPinnedKeys);
  const eligible = searchCatalog(snapshot, '', selectedScope || 'unassigned')
    .filter(result => !result.project && !result.localProject && !result.candidateProject);
  const eligibleKeys = new Set(eligible.map(result => result.record.key));
  const current = new Map(currentRecentGroups.flatMap(group => group.records.map(record => [record.key, record] as const)).filter(([key]) => eligibleKeys.has(key)));
  const records = [...current.values(), ...eligible.filter(result => pins.has(result.record.key) && !current.has(result.record.key)).map(result => result.record)]
    .filter(record => !query || title(record).toLocaleLowerCase().includes(query) || record.canonicalUrl.toLocaleLowerCase().includes(query));
  list.replaceChildren(...records.slice(0, pinsVisibleLimit).map(record => {
    const checked = pins.has(record.key);
    const toggle = el('input', { type: 'checkbox', 'data-recent-pin': record.key, 'data-focus-key': `pin:${record.key}`, checked, disabled: pinsBusy });
    return el('label', { class: 'pin-choice', title: title(record) }, [toggle,
      el('span', { class: 'pin-choice-text' }, [el('strong', {}, [title(record)]), el('small', {}, [current.has(record.key) ? checked ? '已置顶' : '当前页面的会话' : '已置顶 · 其他时段'])]), icon('pin')]);
  }));
  if (!records.length) list.append(el('p', { class: 'pin-empty' }, [query ? '没有找到符合条件的会话' : '当前没有可置顶的会话']));
  if (records.length > pinsVisibleLimit) list.append(button('展开更多', { id: 'pins-more', class: 'text-button', 'data-focus-key': 'pins-more' }));
  list.scrollTop = scrollTop;
  if (focusedKey?.startsWith('pin:')) list.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(focusedKey)}"]`)?.focus({ preventScroll: true });
}
async function toggleRecentPin(key: string, checked: boolean): Promise<void> {
  if (homeMode !== 'workspace' || pinsBusy) return;
  const eligible = currentRecentGroups.some(group => group.records.some(record => record.key === key));
  if (checked && !eligible) { renderPins(); return; }
  const keys = new Set(homePreferences.value.recentPinnedKeys);
  if (checked) keys.add(key); else keys.delete(key);
  const epoch = modeEpoch;
  pinsBusy = true; renderPins(); byId('pins-status').textContent = '';
  const saved = await homePreferences.setPinnedKeys([...keys]);
  pinsBusy = false;
  if (homeMode !== 'workspace' || modeEpoch !== epoch) return;
  renderPins();
  byId('pins-status').textContent = saved ? checked ? '已置顶。' : '已取消置顶。' : '置顶偏好未能保存，请重试。';
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
  if (!workspaceAccessAllowed() || !snapshot) return;
  const connected = snapshot.capabilities.chatgpt;
  byId('connection-label').textContent = connected ? '已连接' : '未连接';
  const connect = byId<HTMLButtonElement>('connect-chatgpt');
  connect.textContent = connectionBusy ? '请稍候…' : connected ? '断开' : '连接';
  connect.disabled = connectionBusy;
  byId('chatgpt-permission-note').hidden = connected;
  const capture = byId<HTMLInputElement>('capture-enabled');
  capture.checked = connected && snapshot.settings.captureEnabled;
  capture.disabled = !connected || mutationRunning || connectionBusy;
  byId('capture-label').textContent = !connected ? '请先连接 ChatGPT' : capture.checked ? '正在收录' : '已暂停';
  byId('revoke-history').hidden = !snapshot.capabilities.history;
  byId('history-permission-row').hidden = !snapshot.capabilities.history;
  const job = latestJob();
  byId('history-import-label').textContent = !job ? '找回浏览过的会话' : importStateLabel(job.state);
  byId('settings-import').textContent = job && ['running', 'paused', 'partial', 'permission-revoked'].includes(job.state) ? '查看' : '导入';
  if (!timezoneDirty) byId<HTMLInputElement>('time-zone').value = snapshot.settings.libraryTimeZone;
  byId('removed-count').textContent = snapshot.tombstones.length ? '可恢复已移除的会话' : '没有已移除的会话';
  byId('source-description').textContent = '会话目录与已观察到的项目关系保存在本机。完整账号空间认证和全量同步尚未完成。';
  byId('source-details').textContent = [snapshot.capabilities.sourceGate, ...(snapshot.capabilities.reasons || []), snapshot.capabilities.sourceStatus?.code || '', `构建：${snapshot.build.sha}`, `版本：${snapshot.build.version}`, `适配器：${snapshot.build.adapterVersion}`].filter(Boolean).join('\n');
}
function importStateLabel(state: string): string {
  return ({ running: '正在导入', paused: '已暂停', partial: '部分完成', complete: '已完成', cancelled: '已取消', 'permission-revoked': '历史权限已撤销' } as Record<string, string>)[state] || '导入记录';
}

function latestJob(): CatalogSnapshot['importJobs'][number] | undefined {
  if (!snapshot) return undefined;
  return snapshot.importJobs.find(job => job.id === activeJobId) || [...snapshot.importJobs].sort((a, b) => b.endTimeMs - a.endTimeMs)[0];
}

function renderImport(): void {
  const area = byId('import-progress'); const job = latestJob();
  const pending = !!job && !!(job.pendingIntervals.length || job.pendingCandidates?.length);
  const managingJob = !!job && (job.state === 'running' || pending && ['paused', 'partial', 'permission-revoked'].includes(job.state));
  const startControl = byId<HTMLButtonElement>('confirm-import');
  const focusWasStart = document.activeElement === startControl;
  const focused = area.contains(document.activeElement) ? document.activeElement as HTMLButtonElement : null;
  const focusedAction = focused ? ['importPause', 'importResume', 'importCancel', 'importAuthorizeResume'].find(key => focused.dataset[key]) : undefined;
  // Keep the unsent options in the DOM, but do not offer a new job beside
  // controls that manage a resumable checkpoint. Explicit cancellation
  // restores the new-import form without discarding the saved checkpoint.
  byId('import-options').hidden = managingJob;
  byId('import-permission-note').hidden = !!snapshot?.capabilities.history;
  startControl.hidden = managingJob;
  startControl.textContent = job ? snapshot?.capabilities.history ? '新建导入' : '授权并新建导入' : snapshot?.capabilities.history ? '开始导入' : '授权并导入';
  startControl.disabled = importStarting || managingJob;
  if (!job) { area.replaceChildren(); return; }
  const stateLabel = importStateLabel(job.state);
  const start = new Date(job.startTimeMs).toLocaleDateString('zh-CN');
  const end = new Date(job.endTimeMs).toLocaleDateString('zh-CN');
  area.replaceChildren(el('strong', {}, [stateLabel]), el('p', {}, [`${start}—${end}`]));
  if (job.state === 'partial' || job.saturatedIntervals.length) area.append(el('p', {}, ['部分历史未能读取，已导入的会话已保留。']));
  const actions = el('div', { class: 'import-actions' });
  if (job.state === 'running') actions.append(button('暂停', { class: 'secondary', 'data-import-pause': job.id }));
  if (['paused', 'partial', 'cancelled', 'permission-revoked'].includes(job.state) && pending) {
    const needsGrant = job.state === 'permission-revoked' || !snapshot?.capabilities.history;
    const label = job.state === 'cancelled' ? '继续上次导入' : '继续';
    actions.append(button(`${needsGrant ? '授权并' : ''}${label}`, { class: 'secondary', [needsGrant ? 'data-import-authorize-resume' : 'data-import-resume']: job.id, disabled: importStarting }));
  }
  if (managingJob) actions.append(button('取消本次导入', { class: 'text-button', 'data-import-cancel': job.id }));
  if (job.state === 'permission-revoked') {
    area.append(el('p', {}, ['已导入的会话仍保留。授权后可继续剩余部分。']));
  }
  area.append(actions);
  if ((focused || managingJob && focusWasStart) && byId<HTMLDialogElement>('import-dialog').open && document.activeElement === document.body) {
    const replacement = focused && focusedAction ? [...actions.querySelectorAll<HTMLButtonElement>('button')].find(node => node.dataset[focusedAction] === focused.dataset[focusedAction]) : null;
    (replacement || actions.querySelector<HTMLButtonElement>('button:not(:disabled)') || byId('import-title')).focus({ preventScroll: true });
  }
}

function renderRemoved(): void {
  if (!snapshot) return;
  const list = byId('removed-list');
  const restoreFocus = list.contains(document.activeElement);
  list.replaceChildren(...snapshot.tombstones.map(tombstone => el('div', { class: 'removed-row' }, [el('span', {}, [`已移除的会话 · ${dateTime(tombstone.removedAt, snapshot!.settings.libraryTimeZone)}`]), button('恢复收录', { class: 'secondary', 'data-restore-record': tombstone.key })])));
  if (!snapshot.tombstones.length) list.append(el('p', { class: 'field-help' }, ['当前资料库没有已移除的会话。']));
  if (restoreFocus && byId<HTMLDialogElement>('removed-dialog').open && document.activeElement === document.body) (list.querySelector<HTMLButtonElement>('button') || byId('removed-dialog').querySelector<HTMLButtonElement>('[data-close]'))?.focus({ preventScroll: true });
}

function render(): void {
  if (!workspaceAccessAllowed()) return;
  document.documentElement.dataset.homeTheme = activeHomeTheme;
  if (homeMode === 'workspace') { renderSites(); renderWorkspace(); }
  else if (byId<HTMLDialogElement>('sites-dialog').open) renderSites();
  nativeExperience.refresh();
  if (settingsView.isOpen) renderSettings();
  if (byId<HTMLDialogElement>('sites-dialog').open) renderEditor();
  if (byId<HTMLDialogElement>('search-dialog').open) renderSearch();
  if (byId<HTMLDialogElement>('import-dialog').open) renderImport();
  if (byId<HTMLDialogElement>('removed-dialog').open) renderRemoved();
  if (homeMode === 'workspace' && byId<HTMLDialogElement>('pins-dialog').open) renderPins();
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

async function connectChatGPT(event: Event, disconnect = false, enableCapture = false): Promise<void> {
  if (!event.isTrusted || connectionBusy || !workspaceAccessAllowed()) return;
  connectionBusy = true; settingsView.showStatus('', false, 'workspace-status');
  const requestedModeEpoch = modeEpoch;
  // Call request/remove synchronously in the actual user gesture, before any await.
  const permission: chrome.permissions.Permissions = { permissions: ['scripting', 'webNavigation'], origins: ['https://chatgpt.com/*'] };
  try {
    const grant = disconnect ? chrome.permissions.remove(permission) : chrome.permissions.request(permission);
    renderSettings();
    const accepted = await grant; await request('PERMISSIONS_SYNC', !disconnect && accepted && enableCapture ? { enableCapture: true } : {}); await refresh(true);
    if (byId<HTMLDialogElement>('settings-dialog').open) renderSettings();
    if (workspaceAccessAllowed() && requestedModeEpoch === modeEpoch) {
      const text = !accepted ? '未更改连接权限。' : disconnect ? '已断开，已有会话仍保留。' : '已连接。';
      if (settingsView.isOpen) settingsView.showStatus(text, !accepted, 'workspace-status'); else toast(text);
    }
  } catch (error) { fail(error, 'workspace-status'); }
  finally { connectionBusy = false; renderSettings(); }
}

async function revokeHistory(event: Event): Promise<void> {
  const control = byId<HTMLButtonElement>('revoke-history');
  if (!event.isTrusted || control.disabled || !workspaceAccessAllowed()) return;
  control.disabled = true; control.setAttribute('aria-busy', 'true');
  settingsView.showStatus('', false, 'workspace-status');
  try {
    await chrome.permissions.remove({ permissions: ['history'] });
    const stillGranted = await chrome.permissions.contains({ permissions: ['history'] });
    await request('PERMISSIONS_SYNC', {}); await refresh(true);
    if (workspaceAccessAllowed()) settingsView.showStatus(stillGranted ? '历史权限未撤销，请重试。' : '已撤销历史权限，已导入的会话仍保留。', stillGranted, 'workspace-status');
  } catch (error) { fail(error, 'workspace-status'); }
  finally { control.disabled = false; control.removeAttribute('aria-busy'); renderSettings(); }
}

async function startImport(event: Event): Promise<void> {
  if (!event.isTrusted || importStarting || byId('confirm-import').hidden || !workspaceAccessAllowed()) return;
  importStarting = true; settingsView.showStatus('', false, 'import-status'); renderImport();
  const requestedModeEpoch = modeEpoch;
  try {
    const grant = chrome.permissions.request({ permissions: ['history'] });
    if (!await grant) { if (workspaceAccessAllowed() && requestedModeEpoch === modeEpoch) settingsView.showStatus('未授予历史权限，尚未开始导入。', true, 'import-status'); return; }
    await request('PERMISSIONS_SYNC', {});
    const result = await request('IMPORT_START', { range: byId<HTMLSelectElement>('import-range').value, includeSynced: byId<HTMLInputElement>('include-synced').checked }) as { jobId?: string; id?: string; job?: { id: string } };
    activeJobId = result?.jobId || result?.id || result?.job?.id || null;
    if (!workspaceAccessAllowed() || requestedModeEpoch !== modeEpoch) return;
    selectedScope = 'unassigned';
    if (homeMode === 'workspace') { view.k = 0; view.filter = 'all'; }
    await refresh(true); renderImport(); void pumpImport();
  } catch (error) { fail(error, 'import-status'); }
  finally { importStarting = false; if (workspaceAccessAllowed()) renderImport(); }
}

async function resumeImportPermission(event: Event, jobId: string): Promise<void> {
  if (!event.isTrusted || importStarting || !workspaceAccessAllowed()) return;
  importStarting = true; settingsView.showStatus('', false, 'import-status');
  const epoch = modeEpoch;
  try {
    const grant = chrome.permissions.request({ permissions: ['history'] });
    renderImport();
    if (!await grant) { settingsView.showStatus('未授予历史权限，导入进度已保留。', true, 'import-status'); return; }
    await request('PERMISSIONS_SYNC', {});
    await request('IMPORT_RESUME', { jobId });
    if (!workspaceAccessAllowed() || epoch !== modeEpoch) return;
    activeJobId = jobId; await refresh(true); void pumpImport();
  } catch (error) { fail(error, 'import-status'); }
  finally { importStarting = false; if (workspaceAccessAllowed()) renderImport(); }
}

async function pumpImport(): Promise<void> {
  if (!workspaceAccessAllowed() || importPumping || stopped || document.hidden) return;
  importPumping = true;
  const requestedModeEpoch = modeEpoch;
  let stepJobId: string | undefined;
  try {
    let job = latestJob();
    // Let an already-started transaction finish, but do not start another batch
    // in life mode. The persisted job/capture settings are left untouched.
    while (workspaceAccessAllowed() && !stopped && !document.hidden && job?.state === 'running') {
      stepJobId = job.id;
      const response = await request('IMPORT_STEP', { jobId: job.id }) as { job: ImportCheckpoint };
      job = response.job;
      await refresh();
      await new Promise<void>(resolve => setTimeout(resolve, 50));
    }
  } catch (error) {
    let received: UISnapshot | undefined; let refreshFailed = false;
    try { received = await refresh(); } catch { refreshFailed = true; }
    const current = received?.importJobs.find(item => item.id === stepJobId);
    // Pause/cancel/revocation can legitimately reject an older in-flight batch.
    // Report a failure only for the same still-running task, or an unreadable state.
    if (workspaceAccessAllowed() && requestedModeEpoch === modeEpoch && (activeJobId || latestJob()?.id) === stepJobId
      && (refreshFailed || current?.state === 'running')) fail(error);
  }
  finally { importPumping = false; }
}

function changePeriod(delta: number): void {
  view.k = Math.max(0, view.k + delta); recentMoreOpen = false; renderWorkspace(); window.scrollTo(0, 0); persistView();
  announce(view.k === 0 ? '已回到最新时段' : '已切换到相邻时段');
  const preferred = document.getElementById(delta > 0 ? 'period-older' : 'period-newer') as HTMLButtonElement | null;
  (preferred && !preferred.disabled ? preferred : document.getElementById('period-older'))?.focus({ preventScroll: true });
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
  if (control.dataset.spatialExpand) {
    const key = control.dataset.spatialExpand, opening = spatialView.expandedProject !== key;
    spatialView.expandedProject = opening ? key : null; spatialView.projectsCollapsed = false;
    preservePosition(renderWorkspace); persistView();
    if (opening && event.detail === 0) document.getElementById(`${spatialPanelId(key)}-title`)?.focus({ preventScroll: true });
    if (!opening) document.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(`spatial-expand:${key}`)}"]`)?.focus({ preventScroll: true });
    announce(opening ? '已展开项目的其余会话' : '已收起项目会话'); return;
  }
  if (control.dataset.spatialDateToggle) {
    const key = control.dataset.spatialDateToggle;
    spatialView.collapsedDates = spatialView.collapsedDates.includes(key) ? spatialView.collapsedDates.filter(item => item !== key) : [...spatialView.collapsedDates, key];
    preservePosition(renderWorkspace); persistView(); return;
  }
  if (control.dataset.spatialDateMore) {
    const key = control.dataset.spatialDateMore, previousLimit = spatialView.dateLimits[key] || SPATIAL_DATE_ROWS;
    spatialView.dateLimits[key] = previousLimit + SPATIAL_DATE_STEP;
    preservePosition(renderWorkspace); persistView();
    if (!document.querySelector(`[data-spatial-date-more="${CSS.escape(key)}"]`)) {
      document.getElementById(`spatial-date-${encodeURIComponent(key)}`)?.querySelectorAll<HTMLAnchorElement>('a[data-record-key]')[previousLimit]?.focus({ preventScroll: true });
    }
    announce('已显示更多会话'); return;
  }
  if (control.dataset.spatialProjectMore) {
    const key = control.dataset.spatialProjectMore, previousLimit = spatialView.projectLimits?.[key] || SPATIAL_PROJECT_ROWS;
    (spatialView.projectLimits ||= {})[key] = previousLimit + SPATIAL_PROJECT_STEP;
    preservePosition(renderWorkspace); persistView();
    if (!document.querySelector(`[data-spatial-project-more="${CSS.escape(key)}"]`)) {
      document.getElementById(spatialPanelId(key))?.querySelectorAll<HTMLAnchorElement>('a[data-record-key]')[previousLimit]?.focus({ preventScroll: true });
    }
    announce('已显示更多会话'); return;
  }
  if (control.dataset.spatialProjectSearch) {
    const project = snapshot ? searchProjects(snapshot, '', selectedScope || 'unassigned').find(item => item.key === control.dataset.spatialProjectSearch) : null;
    if (project) openSearch(project); return;
  }
  if (control.dataset.older) {
    const key = control.dataset.older; view.older = view.older.includes(key) ? view.older.filter(item => item !== key) : [...view.older, key];
    preservePosition(renderWorkspace); persistView(); return;
  }
  if (control.dataset.more) { const key = control.dataset.more; view.limits[key] = (view.limits[key] || 5) + 12; preservePosition(renderWorkspace); persistView(); return; }
  if (control.dataset.recordMenu) { const record = snapshot?.conversations.find(item => item.key === control.dataset.recordMenu); if (record) showRecord(record); return; }
  if (control.dataset.editSite) {
    const site = snapshot?.shortcuts.find(item => item.id === control.dataset.editSite); if (!site) return;
    siteEditingId = site.id; byId<HTMLInputElement>('site-name').value = site.label; byId<HTMLInputElement>('site-url').value = site.url;
    byId('cancel-site-edit').hidden = false; byId('save-site').textContent = '保存修改'; renderEditor(); byId('site-name').focus(); return;
  }
  if (control.dataset.pinSite) { const site = snapshot?.shortcuts.find(item => item.id === control.dataset.pinSite); if (site) void mutate('SHORTCUT_UPSERT', { shortcut: { id: site.id, label: site.label, url: site.url, pinned: !site.pinned } }); return; }
  if (control.dataset.moveSite) { const id = control.dataset.moveSite; const index = sortedSites().findIndex(site => site.id === id); void mutate('SHORTCUT_MOVE', { id, toIndex: index + Number(control.dataset.direction) }); return; }
  if (control.dataset.removeSite) { void mutate('SHORTCUT_REMOVE', { id: control.dataset.removeSite }, () => { if (siteEditingId === control.dataset.removeSite) clearSiteForm(); }); return; }
  if (control.dataset.importAuthorizeResume) { void resumeImportPermission(event, control.dataset.importAuthorizeResume); return; }
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
    case 'settings-trigger': showDialog('settings-dialog'); settingsView.open(); break;
    case 'legacy-sites': case 'site-edit': case 'add-site': renderSites(); renderEditor(); showDialog('sites-dialog'); if (control.id === 'add-site') byId('site-name').focus(); break;
    case 'cancel-site-edit': clearSiteForm(); break;
    case 'site-toggle': if (snapshot) void mutate('SETTINGS_UPDATE', { patch: { shortcutSectionCollapsed: !snapshot.settings.shortcutSectionCollapsed } }); break;
    case 'show-more-sites': allSitesVisible = !allSitesVisible; renderSites(); break;
    case 'earlier-projects-toggle': view.earlierProjectsOpen = !view.earlierProjectsOpen; preservePosition(renderWorkspace); persistView(); break;
    case 'recent-manage-pins': byId<HTMLInputElement>('pins-search').value = ''; pinsVisibleLimit = SEARCH_PAGE_SIZE; byId('pins-status').textContent = ''; renderPins(); showDialog('pins-dialog'); byId('pins-search').focus(); break;
    case 'recent-toggle-more': recentMoreOpen = !recentMoreOpen; preservePosition(renderWorkspace); document.getElementById('recent-toggle-more')?.focus({ preventScroll: true }); persistView(); break;
    case 'pins-more': pinsVisibleLimit += SEARCH_PAGE_SIZE; renderPins(); break;
    case 'period-newer': changePeriod(-1); break;
    case 'period-older': changePeriod(1); break;
    case 'settings-import': case 'first-import': renderImport(); showDialog('import-dialog'); break;
    case 'confirm-import': void startImport(event); break;
    case 'connect-chatgpt': void connectChatGPT(event, !!snapshot?.capabilities.chatgpt); break;
    case 'first-connect': void connectChatGPT(event, false, true); break;
    case 'revoke-history': void revokeHistory(event); break;
    case 'remove-record': if (currentRecord) { const key = currentRecord.key; void mutate('RECORD_REMOVE', { recordKey: key }, () => { closeDialog('record-dialog'); toast('已从首页移除，ChatGPT 会话仍然保留。', { label: '恢复收录', run: () => { void mutate('RECORD_RESTORE', { recordKey: key }); } }); }); } break;
    case 'show-removed': renderRemoved(); showDialog('removed-dialog'); break;
    case 'clear-local': settingsView.showStatus('', false, 'clear-status'); showDialog('clear-dialog'); byId<HTMLButtonElement>('clear-dialog').querySelector<HTMLButtonElement>('.dialog-foot [data-close]')?.focus(); break;
    case 'confirm-clear': if (event.isTrusted) void mutate('CLEAR_LOCAL', {}, () => { selectedScope = 'unassigned'; timezoneDirty = false; view.k = 0; view.filter = 'all'; view.older = []; view.limits = {}; Object.assign(spatialView, { expandedProject: null, projectsCollapsed: false, collapsedDates: [], dateLimits: {}, projectLimits: {} }); saveSpatialView(spatialView); closeDialog('clear-dialog'); settingsView.showStatus('Start 本地数据已清除。'); void refresh(true).catch(() => {}); }); break;
  }
});

document.addEventListener('auxclick', event => { const target = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[data-record-key]') : null; if (target) void openConversation(event, target); });
document.addEventListener('change', event => {
  const target = event.target as HTMLInputElement | HTMLSelectElement;
  if (target instanceof HTMLInputElement && target.dataset.recentPin) { void toggleRecentPin(target.dataset.recentPin, target.checked); return; }
  if (target.id === 'scope-selector') { selectedScope = target.value; view.k = 0; recentMoreOpen = false; view.older = []; searchProjectKey = null; void refresh(true).catch(fail); persistView(); }
  if (target.id === 'capture-enabled' && target instanceof HTMLInputElement) {
    if (target.checked && !snapshot?.capabilities.chatgpt) { target.checked = false; toast('请先连接 ChatGPT，再开启继续收录。'); return; }
    const enabled = target.checked; target.disabled = true;
    settingsView.showStatus('', false, 'workspace-status');
    void mutate('SETTINGS_UPDATE', { patch: { captureEnabled: enabled } }, () => settingsView.showStatus(enabled ? '已开启收录。' : '已暂停，已有会话仍保留。', false, 'workspace-status'));
  }
});
byId('search-input').addEventListener('input', renderSearch);
byId('pins-search').addEventListener('input', () => { pinsVisibleLimit = SEARCH_PAGE_SIZE; renderPins(); });
byId<HTMLFormElement>('add-site-form').addEventListener('submit', event => {
  event.preventDefault(); const label = byId<HTMLInputElement>('site-name').value.trim(); const url = allowedWebsiteUrl(byId<HTMLInputElement>('site-url').value.trim());
  if (!label || [...label].length > 64 || !url) { byId('site-error').textContent = '请输入名称和不带账号密码的 HTTP(S) 网址。'; byId('site-error').hidden = false; return; }
  byId('site-error').hidden = true;
  const shortcut = siteEditingId ? { id: siteEditingId, label, url } : { label, url };
  void mutate('SHORTCUT_UPSERT', { shortcut }, clearSiteForm);
});
byId('time-zone').addEventListener('input', () => { timezoneDirty = true; timezoneEdit++; settingsView.showStatus('', false, 'timezone-status'); });
byId<HTMLFormElement>('timezone-form').addEventListener('submit', event => {
  event.preventDefault(); const libraryTimeZone = byId<HTMLInputElement>('time-zone').value.trim();
  try { new Intl.DateTimeFormat('en', { timeZone: libraryTimeZone }).format(); }
  catch { settingsView.showStatus('请输入有效时区，如 Asia/Shanghai。', true, 'timezone-status'); return; }
  const edit = timezoneEdit;
  void mutate('SETTINGS_UPDATE', { patch: { libraryTimeZone } }, () => {
    if (edit === timezoneEdit) timezoneDirty = false;
    settingsView.showStatus('时区已保存。', false, 'timezone-status'); renderSettings();
  });
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

window.addEventListener('pagehide', () => { stopped = true; persistView(); clearTimeout(clockTimer); clearTimeout(calendarTimer); disposeProjectLayouts(); });
window.addEventListener('pageshow', event => { stopped = false; if (event.persisted) { if (homeMode === 'life') updateClock(); if (workspaceAccessAllowed()) void refresh().then(() => pumpImport()).catch(fail); } });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { clearTimeout(clockTimer); clearTimeout(calendarTimer); return; }
  if (homeMode === 'life') updateClock();
  if (workspaceAccessAllowed()) void refresh().then(() => pumpImport()).catch(fail);
});
window.addEventListener('resize', () => { if (homeMode === 'workspace' && snapshot) renderSites(); });

const nativeExperience = initNativeExperience({ shortcuts: () => snapshot?.shortcuts ?? [], legacyAvailable: () => workspaceAccessAllowed() && settingsView.isOpen && settingsView.page === 'legacy' && !!snapshot, preserve: preservePosition });

function releaseSettingsWorkspace(): void {
  settingsWorkspaceAccess = false; unsubscribeSettings?.(); unsubscribeSettings = null;
  if (homeMode === 'life') {
    ++refreshSequence;
    clearWorkspaceSurface();
    byId('source-description').textContent = '';
    byId('legacy-count').textContent = '';
    byId('removed-count').textContent = '';
  }
}
async function visitSettings(page: SettingsPage): Promise<void> {
  if (page === 'newtab') { void homeTheme.refresh(); void homePreferences.refresh(); }
  const sequence = ++settingsVisit;
  const needsWorkspace = ['workspace', 'data', 'legacy', 'diagnostics'].includes(page);
  if (!needsWorkspace) { releaseSettingsWorkspace(); settingsView.setLoading(false); nativeExperience.refresh(); return; }
  // Only this explicit navigation can grant the life page a temporary settings view.
  settingsWorkspaceAccess = homeMode === 'life';
  if (homeMode === 'life' && !unsubscribeSettings) unsubscribeSettings = subscribeRevision(() => { if (settingsView.needsWorkspace) void refresh().catch(fail); });
  settingsView.setLoading(!snapshot);
  try {
    await refresh(true);
    if (sequence !== settingsVisit || !settingsView.isOpen || !settingsView.needsWorkspace) return;
    if (!snapshot) { settingsView.loadFailed(); return; }
    settingsView.setLoading(false); renderSettings(); nativeExperience.refresh();
    if (page === 'workspace' && latestJob()?.state === 'running') void pumpImport();
  } catch { if (sequence === settingsVisit && settingsView.isOpen) settingsView.loadFailed(); }
}
const settingsView = initSettingsView({ onNavigate: page => { void visitSettings(page); }, onClose: () => { ++settingsVisit; releaseSettingsWorkspace(); } });

async function syncSettingsPermissions(): Promise<void> {
  if (!workspaceAccessAllowed() || !snapshot || !settingsView.isOpen) return;
  const sequence = ++permissionSequence;
  try {
    const [chatgpt, history] = await Promise.all([
      chrome.permissions.contains({ permissions: ['scripting', 'webNavigation'], origins: ['https://chatgpt.com/*'] }),
      chrome.permissions.contains({ permissions: ['history'] }),
    ]);
    if (sequence !== permissionSequence || !workspaceAccessAllowed() || !snapshot) return;
    snapshot.capabilities.chatgpt = chatgpt; snapshot.capabilities.history = history; renderSettings();
    if (byId<HTMLDialogElement>('import-dialog').open) renderImport();
  } catch (error) { fail(error); }
}
chrome.permissions.onAdded.addListener(() => { void syncSettingsPermissions(); });
chrome.permissions.onRemoved.addListener(() => { void syncSettingsPermissions(); });
window.addEventListener('focus', () => { if (settingsView.isOpen) { void syncSettingsPermissions(); if (workspaceAccessAllowed()) void refresh().catch(fail); } });

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
  disposeProjectLayouts();
  byId('workspace-content').replaceChildren();
  byId('theme-controls').replaceChildren(); byId('theme-controls').hidden = true;
  byId('history-rail').replaceChildren(); byId('history-rail').hidden = true;
  for (const id of ['search-results', 'record-details', 'removed-list', 'import-progress', 'site-strip', 'site-editor', 'source-details', 'pins-list']) byId(id).replaceChildren();
  byId<HTMLInputElement>('search-input').value = '';
  byId('record-title').textContent = '会话详情';
  currentRecord = null; snapshot = null; currentRecentGroups = [];
  byId<HTMLInputElement>('pins-search').value = ''; byId('pins-status').textContent = ''; clearTimeout(calendarTimer);
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
  releaseSettingsWorkspace();
  for (const dialog of document.querySelectorAll<HTMLDialogElement>('dialog[open]')) dialog.close();
  byId('workspace-content').hidden = true;
  byId('life-content').hidden = true;
  clearWorkspaceSurface(); clearTimeout(clockTimer);
  homeMode = next; modeLoading = next === 'workspace';
  document.documentElement.dataset.homeMode = next;
  document.documentElement.dataset.startReady = next === 'life' ? 'true' : 'false';
  byId('mode-loading').hidden = true;
  const target = next === 'workspace' ? '生活' : '工作';
  const current = next === 'workspace' ? '工作' : '生活';
  const control = byId<HTMLButtonElement>('mode-toggle');
  control.replaceChildren(icon(next === 'workspace' ? 'grid' : 'sun'), el('span', {}, [current]), icon('switch', 'mode-switch-icon'));
  control.setAttribute('aria-label', `当前为${current}模式，切换到${target}`); control.title = `当前为${current}模式，切换到${target}`;
  control.disabled = false;
  renderThemeChrome();
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
    renderThemeChrome();
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

// These preferences belong to the presentation layer, independently of theme,
// native project membership, source timestamps, and the work/life catalog gate.
const homePreferences = initHomePreferences({ onChange: (next, previous) => {
  safe.renderAfterPending(() => {
    document.documentElement.dataset.projectLayout = homePreferences.value.projectLayout;
    if (homeMode !== 'workspace' || !snapshot) return;
    if (next.periodDays !== previous.periodDays) recentMoreOpen = false;
    renderWorkspace(); persistView();
    if (byId<HTMLDialogElement>('pins-dialog').open) renderPins();
  }, true);
} });
document.documentElement.dataset.projectLayout = homePreferences.value.projectLayout;

// Theme is an independent local display preference. Changing it never loads a
// life page's catalog, changes the mode, or mutates a projected relationship.
const homeTheme = initHomeTheme({ onChange: next => {
  activeHomeTheme = next;
  safe.renderAfterPending(() => {
    document.documentElement.dataset.homeTheme = activeHomeTheme;
    lastSpatialColumns = spatialColumns(window.innerWidth, activeHomeTheme);
    if (homeMode === 'workspace' && snapshot) renderWorkspace();
    else renderThemeChrome();
    nativeExperience.refresh();
  }, true);
} });
window.addEventListener('resize', () => {
  const columns = spatialColumns(window.innerWidth, activeHomeTheme);
  if (columns === lastSpatialColumns) return;
  lastSpatialColumns = columns;
  if (homeMode === 'workspace' && spatialView.expandedProject) safe.renderAfterPending(renderWorkspace);
});
// Restore the appearance before workspace construction. Mode stays owned by each
// open tab; theme changes may synchronize without opening any workspace data.
void Promise.all([homeTheme.ready, homePreferences.ready]).then(() => restoreHomeMode());
