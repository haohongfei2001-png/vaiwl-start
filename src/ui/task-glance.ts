import { button, element as el, icon } from './dom.js';
import type { ResultView, TaskSnapshot, TaskView } from '../tasks/types.js';

export const preferredOutput = (task: TaskView) => task.lastValuableResult || task.latestAvailableResult;
type Version = 'valuable' | 'latest';

interface Actions {
  detail: (key: string, version: Version) => void;
  sync: () => void;
  source: () => void;
  status: (task: TaskView) => string;
  time: (value: string | null) => string;
}

function newestFeatured(tasks: TaskView[]) {
  const dated = tasks.filter(task => preferredOutput(task)).sort((a, b) => {
    const aResult = preferredOutput(a)!;
    const bResult = preferredOutput(b)!;
    return (bResult.createdAt || bResult.observedAt).localeCompare(aResult.createdAt || aResult.observedAt);
  });
  return dated.find(task => task.lastValuableResult) || dated[0];
}

/** Only exists while a workspace is allowed to display the current account. */
export function createTaskGlance(root: HTMLElement, actions: Actions) {
  const name = el('span', { class: 'task-name' });
  const toggle = button('', { class: 'task-toggle', popovertarget: 'task-panel',
    'aria-haspopup': 'dialog', 'aria-controls': 'task-panel', 'aria-expanded': 'false' });
  toggle.append(el('span', { class: 'task-mark' }, [icon('task-clock')]),
    el('span', { class: 'task-heading' }, [el('small', {}, ['定时任务']), name]), icon('down', 'task-caret'));
  const preview = button('', { class: 'task-featured' });
  const waiting = el('span', { class: 'task-waiting', hidden: true }, ['尚未收录执行结果']);
  const close = button('', { class: 'icon-button', 'aria-label': '关闭任务面板' }, 'close');
  const list = el('div', { class: 'tasks-list' });
  const syncLabel = el('span', { class: 'tasks-sync' });
  const problem = el('span', { class: 'task-problem' });
  const sync = button('', { class: 'text-button' });
  const recover = button('打开 ChatGPT 检查', { class: 'text-button' });
  const panel = el('section', { id: 'task-panel', class: 'task-panel', popover: 'auto', role: 'dialog',
    'aria-labelledby': 'task-panel-title' }, [
    el('header', { class: 'task-panel-head' }, [el('h2', { id: 'task-panel-title' }, ['任务成果']), close]),
    list,
    el('footer', { class: 'task-panel-foot' }, [syncLabel, problem, el('div', { class: 'task-actions' }, [sync, recover])]),
  ]);
  root.append(toggle, preview, waiting, panel);
  let featured: TaskView | undefined;
  let rowOrder: string[] = [];
  let listVersion = '';
  let returnPoint: { key: string; version: Version; inPanel: boolean; scroll: number } | null = null;
  let openingFocus: HTMLElement | null = null;
  const open = () => panel.matches(':popover-open');
  const inList = (key: string, version: string) =>
    Array.from(list.querySelectorAll<HTMLElement>('[data-task-part]')).find(node => node.dataset.key === key && node.dataset.taskPart === version);

  function position() {
    const anchor = root.getBoundingClientRect();
    if (anchor.bottom <= 0 || anchor.top >= innerHeight) {
      if (open()) panel.hidePopover();
      return;
    }
    const width = document.documentElement.clientWidth;
    const left = Math.min(anchor.left, width - Math.min(424, width - 24) - 12);
    panel.style.left = Math.max(12, left) + 'px';
    panel.style.top = Math.max(8, anchor.bottom + 6) + 'px';
    panel.style.maxHeight = Math.min(560, innerHeight - Math.max(8, anchor.bottom + 6) - 12) + 'px';
  }
  function closeToToggle() {
    if (open()) panel.hidePopover();
    toggle.focus({ preventScroll: true });
  }
  panel.addEventListener('beforetoggle', event => {
    const opening = (event as ToggleEvent).newState === 'open';
    toggle.setAttribute('aria-expanded', String(opening));
    if (opening) position();
  });
  panel.addEventListener('toggle', () => {
    if (open()) (openingFocus || list.querySelector<HTMLElement>('.task-row') || close).focus({ preventScroll: true });
    openingFocus = null;
  });
  close.addEventListener('click', closeToToggle);
  panel.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); closeToToggle(); }
  });
  toggle.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown') { event.preventDefault(); if (!open()) panel.showPopover(); }
  });
  function leaveOnFocus(event: FocusEvent) {
    if (open() && event.target instanceof Node && event.target !== toggle && !panel.contains(event.target)) panel.hidePopover();
  }
  function onViewport() { if (open()) position(); }
  document.addEventListener('focusin', leaveOnFocus);
  window.addEventListener('resize', onViewport);
  window.addEventListener('scroll', onViewport);

  function read(key: string, version: Version, inPanel: boolean) {
    returnPoint = { key, version, inPanel, scroll: list.scrollTop };
    actions.detail(key, version);
  }
  preview.addEventListener('click', () => { if (featured) read(featured.key, 'valuable', false); });
  sync.addEventListener('click', actions.sync);
  recover.addEventListener('click', actions.source);

  function resultRow(task: TaskView, r: ResultView | null, version: Version, previews: boolean, label: string) {
    const row = button('', { class: 'task-row', 'data-key': task.key, 'data-task-part': version,
      'aria-label': '查看' + label + '：' + task.title });
    row.append(el('span', { class: 'task-row-line' }, [el('strong', {}, [label]),
      r?.createdAt ? el('time', { datetime: r.createdAt }, [actions.time(r.createdAt)]) : null]));
    if (r && previews) row.append(el('span', { class: 'task-excerpt' }, [r.preview]));
    row.addEventListener('click', () => read(task.key, version, true));
    return row;
  }

  function taskItem(task: TaskView, previews: boolean) {
    const preserved = task.lastValuableResult;
    const latest = task.latestAvailableResult;
    const distinct = preserved && (preserved.runId !== latest?.runId || preserved.revision !== latest?.revision);
    const item = el('article', { class: 'task-item' }, [el('div', { class: 'task-item-head' }, [
      el('h3', {}, [task.title]), el('a', { class: 'task-source', href: task.sourceUrl, target: '_blank',
        rel: 'noopener noreferrer', 'aria-label': '打开原始来源：' + task.title, 'data-key': task.key, 'data-task-part': 'source' }, ['原始来源', icon('external')]),
    ])]);
    if (distinct) item.append(resultRow(task, preserved, 'valuable', previews, '保留的重要成果'));
    if (latest) item.append(resultRow(task, latest, 'latest', previews, distinct ? '最近一次输出' : '执行结果'));
    const status = actions.status(task);
    item.append(el('p', { class: 'task-run' }, [[status,
      task.lastRunAt && '最近运行 ' + actions.time(task.lastRunAt),
      task.nextRunAt && '下次 ' + actions.time(task.nextRunAt)].filter(Boolean).join(' · ')]));
    return item;
  }

  function updateList(chosen: TaskView[], data: TaskSnapshot) {
    // A background read may reorder tasks. Keep the reader's place until the panel closes.
    const byKey = new Map(chosen.map(task => [task.key, task]));
    const tasks = open() ? [...new Set([...rowOrder, ...byKey.keys()])].flatMap(key => byKey.get(key) || []) : chosen;
    const version = JSON.stringify([data.settings.preview, !!data.tasks.length, tasks.map(t =>
      [t.key, t.title, t.sourceUrl, t.lastRunAt, t.nextRunAt, actions.status(t), t.latestAvailableResult, t.lastValuableResult])]);
    if (version === listVersion) return;
    listVersion = version;
    rowOrder = tasks.map(t => t.key);
    const focused = list.contains(document.activeElement) ? document.activeElement as HTMLElement : null;
    const scroll = list.scrollTop;
    list.replaceChildren(...tasks.map(t => taskItem(t, data.settings.preview)));
    if (!tasks.length) list.append(el('p', { class: 'task-empty' }, [data.tasks.length ? '可在设置中选择要展示的任务。' : '当前账户还没有已收录的定时任务。']));
    if (focused) (inList(focused.dataset.key || '', focused.dataset.taskPart || '') || close).focus({ preventScroll: true });
    list.scrollTop = scroll;
  }

  return {
    update(data: TaskSnapshot, syncText: string, error: string, needsSource: boolean, busy: boolean) {
      const chosen = data.tasks.filter(t => t.selected);
      featured = newestFeatured(chosen);
      const output = featured && preferredOutput(featured);
      const empty = !data.tasks.length ? '暂无定时任务' : !chosen.length ? '尚未选择任务' : '等待任务成果';
      const firstTask = featured || chosen[0];
      name.textContent = firstTask?.title || empty;
      const syncHint = data.sync.status === 'error' ? '，同步未完成' : data.sync.status === 'syncing' ? '，正在同步' : '';
      toggle.setAttribute('aria-label', '定时任务，展开成果面板' + (firstTask ? '：' + firstTask.title : '') + syncHint);
      waiting.hidden = !!output || !firstTask || !data.settings.preview;
      preview.hidden = !output || !data.settings.preview;
      preview.textContent = preview.hidden ? '' : output!.preview;
      preview.setAttribute('aria-label', '查看完整结果：' + (featured?.title || ''));
      root.dataset.preview = String(!preview.hidden || !waiting.hidden);
      root.dataset.sync = data.sync.status;
      updateList(chosen, data);
      syncLabel.textContent = syncText;
      problem.textContent = error;
      problem.hidden = !error;
      sync.disabled = busy || data.sync.status === 'syncing' || !data.settings.enabled || !!(data.sync.retryAt && Date.parse(data.sync.retryAt) > Date.now());
      sync.textContent = data.settings.automatic ? '立即同步' : '打开 ChatGPT 同步';
      recover.hidden = !needsSource;
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
      } else {
        (preview.offsetWidth ? preview : toggle).focus({ preventScroll: true });
      }
    },
    dispose() {
      if (open()) panel.hidePopover();
      document.removeEventListener('focusin', leaveOnFocus);
      window.removeEventListener('resize', onViewport);
      window.removeEventListener('scroll', onViewport);
      root.replaceChildren();
    },
  };
}
