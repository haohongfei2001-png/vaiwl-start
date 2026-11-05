import { button, element as el, icon } from './dom.js';
import type { ResultView, TaskSnapshot, TaskView } from '../tasks/types.js';

export const preferredOutput = (task: TaskView) => task.lastValuableResult || task.latestAvailableResult;
type Version = 'valuable' | 'latest';
interface Actions {
  detail: (key: string, version: Version, result?: { runId: string; revision: number }) => void;
  sync: () => void;
  source: () => void;
  status: (task: TaskView) => string;
  time: (value: string | null) => string;
}

function newestFeatured(tasks: TaskView[]) {
  const dated = tasks.filter(task => preferredOutput(task)).sort((a, b) => {
    const first = preferredOutput(a)!;
    const second = preferredOutput(b)!;
    return (second.createdAt || second.observedAt).localeCompare(first.createdAt || first.observedAt);
  });
  return dated.find(task => task.lastValuableResult) || dated[0];
}
function safeSource(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'chatgpt.com' && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
const shortTimeFormat = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' });
function shortTime(value: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return '';
  const date = new Date(value);
  const now = new Date();
  return date.toDateString() === now.toDateString() ? date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : shortTimeFormat.format(date);
}

/** The only retained UI state is the current account's visible, lightweight snapshot. */
export function createTaskGlance(root: HTMLElement, actions: Actions) {
  const name = el('span', { class: 'task-name' });
  const generated = el('time', { class: 'task-featured-time' });
  const toggle = button('', { class: 'task-toggle', popovertarget: 'task-panel',
    'aria-haspopup': 'dialog', 'aria-controls': 'task-panel', 'aria-expanded': 'false' });
  toggle.append(el('span', { class: 'task-mark' }, [icon('task-clock')]),
    el('span', { class: 'task-heading' }, [el('small', {}, ['AI 成果']), name]), generated, icon('down', 'task-caret'));
  const preview = button('', { class: 'task-featured' });
  const waiting = el('span', { class: 'task-waiting', hidden: true }, ['任务运行后，成果会出现在这里']);
  const close = button('', { class: 'icon-button', 'aria-label': '关闭任务面板' }, 'close');
  const list = el('div', { class: 'tasks-list' });
  const updated = button('有更新 · 查看', { class: 'task-updated text-button', hidden: true });
  const syncLabel = el('span', { class: 'tasks-sync' });
  const problem = el('span', { class: 'task-problem', hidden: true });
  const sync = button('', { class: 'text-button' });
  const recover = button('打开 ChatGPT', { class: 'text-button' });
  const panel = el('section', { id: 'task-panel', class: 'task-panel', popover: 'auto', role: 'dialog', tabindex: -1,
    'aria-labelledby': 'task-panel-title' }, [
    el('header', { class: 'task-panel-head' }, [el('h2', { id: 'task-panel-title' }, ['AI 最近的成果']), updated, close]),
    list,
    el('footer', { class: 'task-panel-foot' }, [
      el('div', { class: 'task-panel-status' }, [syncLabel, problem]),
      el('div', { class: 'task-actions' }, [sync, recover]),
    ]),
  ]);
  root.append(toggle, preview, waiting, panel);
  let featured: TaskView | undefined;
  let listVersion = '';
  let pending: TaskSnapshot | null = null;
  let returnPoint: { key: string; version: Version; inPanel: boolean; scroll: number } | null = null;
  let openingFocus: HTMLElement | null = null;
  let keyboardOpen = false;
  const open = () => panel.matches(':popover-open');
  const inList = (key: string, version: string) =>
    Array.from(list.querySelectorAll<HTMLElement>('[data-task-part]')).find(node => node.dataset.key === key && node.dataset.taskPart === version);

  function position() {
    const anchor = root.getBoundingClientRect();
    if (anchor.bottom <= 0 || anchor.top >= innerHeight) { if (open()) panel.hidePopover(); return; }
    const width = document.documentElement.clientWidth;
    const top = Math.max(8, anchor.bottom + 8);
    panel.style.left = Math.max(12, Math.min(anchor.left, width - Math.min(520, width - 24) - 12)) + 'px';
    panel.style.top = top + 'px';
    panel.style.maxHeight = Math.max(0, Math.min(640, innerHeight - top - 12)) + 'px';
  }
  function applyPending() {
    const next = pending;
    pending = null;
    updated.hidden = true;
    if (next) renderContent(next);
  }
  function closeToToggle() {
    returnPoint = null;
    if (open()) panel.hidePopover();
    applyPending();
    toggle.focus({ preventScroll: true });
  }
  panel.addEventListener('beforetoggle', event => {
    const opening = (event as ToggleEvent).newState === 'open';
    toggle.setAttribute('aria-expanded', String(opening));
    if (opening) position();
  });
  panel.addEventListener('toggle', () => {
    if (open()) (openingFocus || (keyboardOpen ? list.querySelector<HTMLElement>('.task-row') || close : panel)).focus({ preventScroll: true });
    else if (!returnPoint?.inPanel) applyPending();
    openingFocus = null;
    keyboardOpen = false;
  });
  close.addEventListener('click', closeToToggle);
  panel.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); closeToToggle(); }
  });
  toggle.addEventListener('click', event => { keyboardOpen = event.detail === 0; });
  toggle.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown') { event.preventDefault(); keyboardOpen = true; if (!open()) panel.showPopover(); }
  });
  function leaveOnFocus(event: FocusEvent) {
    if (open() && event.target instanceof Node && event.target !== toggle && !panel.contains(event.target)) panel.hidePopover();
  }
  function onViewport() { if (open()) position(); }
  document.addEventListener('focusin', leaveOnFocus);
  window.addEventListener('resize', onViewport);
  window.addEventListener('scroll', onViewport, { passive: true });

  function read(key: string, version: Version, inPanel: boolean, result?: ResultView) {
    returnPoint = { key, version, inPanel, scroll: list.scrollTop };
    actions.detail(key, version, result ? { runId: result.runId, revision: result.revision } : undefined);
  }
  preview.addEventListener('click', () => { if (featured) read(featured.key, 'valuable', false, preferredOutput(featured) || undefined); });
  sync.addEventListener('click', actions.sync);
  recover.addEventListener('click', actions.source);
  updated.addEventListener('click', () => {
    applyPending();
    list.scrollTop = 0;
    (list.querySelector<HTMLElement>('.task-row') || close).focus({ preventScroll: true });
  });

  function resultRow(task: TaskView, result: ResultView, version: Version, previews: boolean, label: string) {
    const row = button('', { class: 'task-row', 'data-key': task.key, 'data-task-part': version,
      'aria-label': '查看' + (label || '完整结果') + '：' + task.title });
    if (label) row.append(el('span', { class: 'task-result-label' }, [label]));
    row.append(el('span', { class: 'task-excerpt' }, [previews ? result.preview || '查看完整结果' : '查看完整结果']));
    if (label && result.createdAt) row.append(el('time', { class: 'task-row-time', datetime: result.createdAt }, [actions.time(result.createdAt)]));
    row.addEventListener('click', () => read(task.key, version, true, result));
    return row;
  }
  function taskItem(task: TaskView, previews: boolean) {
    const preserved = task.lastValuableResult;
    const latest = task.latestAvailableResult;
    const shown = preferredOutput(task);
    const distinct = !!(preserved && (preserved.runId !== latest?.runId || preserved.revision !== latest?.revision));
    const item = el('article', { class: 'task-item' }, [el('div', { class: 'task-item-head' }, [
      el('h3', {}, [task.title]), !distinct && shown?.createdAt ? el('time', { datetime: shown.createdAt }, [actions.time(shown.createdAt)]) : null,
    ])]);
    if (distinct && preserved) item.append(resultRow(task, preserved, 'valuable', previews, '已标记的重要成果'));
    if (latest) item.append(resultRow(task, latest, 'latest', previews, distinct ? '最近一次输出' : ''));
    if (!shown) item.append(el('p', { class: 'task-awaiting' }, [task.readable ? '还没有可读成果。任务运行后会自动收录。' : '可在 ChatGPT 查看此任务。']));
    const status = actions.status(task);
    const unusual = !shown || task.recordedStatus === 'failed' || task.recordedStatus === 'no_update' || latest?.isFailureMessage || latest?.classification?.outcome === 'failed' || latest?.classification?.outcome === 'no_new_information';
    const source = safeSource(task.sourceUrl);
    item.append(el('div', { class: 'task-item-foot' }, [
      el('span', { class: 'task-run' }, [[task.enabledState === 'disabled' ? '任务未启用' : '', unusual ? status : preserved && !distinct ? '已标记重要成果' : ''].filter(Boolean).join(' · ')]),
      source ? el('a', { class: 'task-source', href: source, target: '_blank', rel: 'noopener noreferrer',
        'aria-label': '打开原始来源：' + task.title, 'data-key': task.key, 'data-task-part': 'source' }, ['在 ChatGPT 查看', icon('external')]) : null,
    ]));
    return item;
  }
  function contentVersion(data: TaskSnapshot) {
    return JSON.stringify([data.settings.preview, data.settings.enabled, data.completeList, !!data.tasks.length,
      data.tasks.filter(t => t.selected).map(t => [t.key, t.title, t.sourceUrl, t.readable, t.enabledState, t.recordedStatus,
        t.latestAvailableResult && [t.latestAvailableResult.runId, t.latestAvailableResult.revision, t.latestAvailableResult.createdAt, t.latestAvailableResult.preview, t.latestAvailableResult.classification],
        t.lastValuableResult && [t.lastValuableResult.runId, t.lastValuableResult.revision, t.lastValuableResult.createdAt, t.lastValuableResult.preview]])]);
  }
  function renderContent(data: TaskSnapshot) {
    const chosen = data.tasks.filter(t => t.selected);
    featured = newestFeatured(chosen);
    const output = featured && preferredOutput(featured);
    const first = featured || chosen[0];
    const empty = !data.settings.enabled ? '连接 ChatGPT' : data.sync.code === 'LOGIN_REQUIRED' ? '请登录 ChatGPT' : data.sync.code === 'VERIFICATION_REQUIRED' ? '请在 ChatGPT 确认' : data.sync.status === 'error' && !data.tasks.length ? '等待连接 ChatGPT' : !data.completeList && !data.tasks.length ? '正在准备成果' : !data.tasks.length ? '还没有定时任务' : !chosen.length ? '选择关注的任务' : '等待任务成果';
    name.textContent = first?.title || empty;
    toggle.setAttribute('aria-label', '定时任务，展开成果面板' + (first ? '：' + first.title : ''));
    generated.textContent = shortTime(output?.createdAt || null);
    generated.hidden = !generated.textContent;
    if (output?.createdAt) generated.setAttribute('datetime', output.createdAt); else generated.removeAttribute('datetime');
    waiting.hidden = !!output || !first || !data.settings.preview;
    preview.hidden = !output || !data.settings.preview;
    preview.textContent = preview.hidden ? '' : output!.preview;
    preview.setAttribute('aria-label', '查看完整结果：' + (featured?.title || ''));
    root.dataset.preview = String(!preview.hidden || !waiting.hidden);
    const version = contentVersion(data);
    if (version === listVersion) return;
    listVersion = version;
    const focused = list.contains(document.activeElement) ? document.activeElement as HTMLElement : null;
    const scroll = list.scrollTop;
    list.replaceChildren(...chosen.map(task => taskItem(task, data.settings.preview)));
    if (!chosen.length) {
      const title = !data.principal && data.sync.status === 'error' ? '连接后即可查看成果' : data.tasks.length ? '把关心的任务放在这里' : !data.settings.enabled ? '让 AI 的成果来到首页' : data.completeList ? '还没有定时任务' : '等待第一次读取';
      const description = !data.principal && data.sync.status === 'error' ? '打开 ChatGPT 恢复连接后，会继续收录任务成果。' : data.tasks.length ? '在设置中选择要展示的任务。' : !data.settings.enabled ? '在设置中连接 ChatGPT，查看已有定时任务的成果。' : data.completeList ? '在 ChatGPT 创建任务后，成果会自动出现在这里。' : '首次连接后会读取已有任务；期间可以继续使用首页。';
      list.append(el('div', { class: 'task-empty' }, [el('strong', {}, [title]), el('p', {}, [description])]));
    }
    if (focused) (inList(focused.dataset.key || '', focused.dataset.taskPart || '') || close).focus({ preventScroll: true });
    list.scrollTop = scroll;
  }
  return {
    update(data: TaskSnapshot, syncText: string, error: string, needsSource: boolean, busy: boolean) {
      if (contentVersion(data) === listVersion) { pending = null; updated.hidden = true; }
      if ((open() || returnPoint?.inPanel) && listVersion && contentVersion(data) !== listVersion) {
        pending = data;
        updated.hidden = false;
      } else if (!pending || !open()) renderContent(data);
      root.dataset.sync = needsSource ? 'attention' : data.sync.status;
      syncLabel.textContent = syncText;
      problem.textContent = error;
      problem.hidden = !error;
      sync.disabled = busy || data.sync.status === 'syncing' || !data.settings.enabled || !!(data.sync.retryAt && Date.parse(data.sync.retryAt) > Date.now());
      sync.textContent = data.settings.automatic ? '检查更新' : '打开 ChatGPT';
      sync.hidden = needsSource;
      recover.hidden = !needsSource;
      recover.textContent = data.permission ? '打开 ChatGPT' : '重新允许访问';
    },
    restoreFocus() {
      const point = returnPoint;
      returnPoint = null;
      if (!point || root.hidden || document.querySelector('dialog[open]')) return;
      if (point.inPanel) {
        openingFocus = inList(point.key, point.version) || close;
        if (!open()) panel.showPopover();
        list.scrollTop = point.scroll;
        openingFocus.focus({ preventScroll: true });
      } else (preview.offsetWidth ? preview : toggle).focus({ preventScroll: true });
    },
    dispose() {
      pending = null;
      returnPoint = null;
      if (open()) panel.hidePopover();
      document.removeEventListener('focusin', leaveOnFocus);
      window.removeEventListener('resize', onViewport);
      window.removeEventListener('scroll', onViewport);
      root.replaceChildren();
    },
  };
}
