import { byId, element as el, button, allowedWebsiteUrl } from './dom.js';
import { createTaskGlance, preferredOutput as output } from './task-glance.js';
import type { TaskSnapshot, TaskView, ResultView } from '../tasks/types.js';
const PROTOCOL = 'vaiwl-tasks/1';
const permissions: chrome.permissions.Permissions = { permissions: ['scripting', 'alarms'], origins: ['https://chatgpt.com/*'] };
async function request(command: string, fields: Record<string, unknown> = {}) {
  const result = await chrome.runtime.sendMessage({ protocol: PROTOCOL, command, ...fields });
  if (!result?.ok) throw Error(result?.code || 'SYNC_UNAVAILABLE');
  return result.data;
}
const timeFormat = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const time = (value: string | null) => value && Number.isFinite(Date.parse(value)) ? timeFormat.format(new Date(value)) : '尚无记录';
function status(task: TaskView): string {
  if (task.recordedStatus === 'failed') return '最近一次运行遇到问题';
  if (task.recordedStatus === 'no_update') return '本次无新报告';
  const result = task.latestAvailableResult;
  if (result?.isFailureMessage || result?.classification?.outcome === 'failed') return '最近一次输出遇到问题';
  if (result?.classification?.outcome === 'no_new_information') return '已标记为无新信息';
  if (result?.classification?.outcome === 'new_information') return '已标记重要成果';
  return result ? '已收录输出' : task.readable ? '尚未收录结果' : '此类型暂未接入结果';
}
const errors: Record<string, string> = {
  PERMISSION_REQUIRED: '需要重新允许访问 ChatGPT，已保存的成果仍保留。',
  IDENTITY_UNAVAILABLE: '请打开 ChatGPT，确认当前登录账户。',
  SOURCE_TIMEOUT: '本次连接未完成，稍后会再检查。',
  SOURCE_CHANGED: '暂时无法读取 ChatGPT 的最新内容，已有成果仍保留。',
  LOGIN_REQUIRED: '请登录 ChatGPT，登录后继续更新。',
  VERIFICATION_REQUIRED: '需要在 ChatGPT 完成验证，之后会继续更新。',
  SOURCE_FORBIDDEN: 'ChatGPT 暂时无法访问，请打开页面确认。',
  NETWORK_ERROR: '网络暂时不可用，恢复后会继续更新。',
  SOURCE_UNAVAILABLE: 'ChatGPT 暂时不可用，稍后会再检查。',
  RATE_LIMITED: '更新暂缓，稍后会自动继续。',
  PARTIAL_LIST: '还有部分任务尚未读取，已有成果仍保留。',
  STALE_DOCUMENT: '登录账户或来源页面已变化，正在等待重新连接。',
  SYNC_INTERRUPTED: '上次更新中断，稍后会再检查。',
  DISABLED: '同步已关闭。',
};
export function initTaskResults() {
  let mode: 'workspace' | 'life' | null = null, settingsOpen = false, epoch = 0, busy = false;
  let data: TaskSnapshot | null = null, detail: TaskView | null = null, detailsResult: ResultView | null = null;
  let glance: ReturnType<typeof createTaskGlance> | undefined;
  let detailOrder = 0, selectionVersion = '', localError = '';
  let refreshInFlight: Promise<void> | null = null, refreshQueued = false, hiddenDirty = false, homeNudged = false;
  const root = byId('tasks-home'), settings = byId('task-settings');
  const modal = byId<HTMLDialogElement>('task-result-dialog');
  const clearModal = byId<HTMLDialogElement>('task-clear-dialog');
  const allowed = () => mode === 'workspace' || settingsOpen;
  const settingsStatus = byId('tasks-settings-status');
  function hideGlance() { glance?.dispose(); glance = undefined; root.hidden = true; }
  function clearPrivate() {
    detailOrder++; data = null; detail = null; detailsResult = null; selectionVersion = ''; localError = ''; hideGlance();
    byId('tasks-selection').replaceChildren();
    for (const id of ['task-result-body', 'task-result-meta', 'task-result-warning', 'task-result-diagnostics', 'tasks-sync-status', 'tasks-coverage', 'tasks-settings-status']) byId(id).textContent = '';
    byId('task-result-title').textContent = '任务结果'; byId('task-result-links').replaceChildren();
    if (modal.open) modal.close(); if (clearModal.open) clearModal.close();
  }
  const readLabel = (task: TaskView) => task.readOutcome === 'updated' ? '此次收录了新输出' : task.readOutcome === 'unchanged' ? '已重新读取，暂无新输出' : task.readOutcome === 'empty' ? '本次来源未返回完整正文，已有成果仍保留' : '已保存的来源正文';
  const needsSource = () => !!data?.sync.code && ['LOGIN_REQUIRED', 'VERIFICATION_REQUIRED', 'SOURCE_FORBIDDEN', 'IDENTITY_UNAVAILABLE', 'PERMISSION_REQUIRED'].includes(data.sync.code);
  function syncLabel(snapshot: TaskSnapshot): string {
    const lastRead = snapshot.tasks.filter(task => task.selected && task.readable && task.resultSyncedAt).map(task => task.resultSyncedAt!).sort().at(-1) || null;
    const saved = lastRead ? '上次读取 ' + time(lastRead) : '尚未读取成果';
    if (!snapshot.settings.enabled) return '同步已关闭 · ' + saved;
    if (!snapshot.permission) return '等待访问授权';
    if (snapshot.sync.status === 'syncing') return lastRead ? '正在检查更新 · ' + saved : '正在读取任务';
    if (snapshot.sync.status === 'error') return lastRead ? saved : '连接尚未完成';
    if (lastRead) return (Date.now() - Date.parse(lastRead) > 86400000 ? '较久未更新 · ' : '') + '最近读取 ' + time(lastRead);
    return snapshot.completeList ? '已连接 · 等待任务成果' : '正在准备任务成果';
  }
  function renderHome() {
    if (mode !== 'workspace' || !data?.settings.showWidget || (!data.settings.enabled && (!data.principal || !data.tasks.length))) { hideGlance(); return; }
    root.hidden = false;
    glance ??= createTaskGlance(root, {
      detail: (key, version, result) => { void showDetail(key, version, result); },
      sync: () => { void action('SYNC'); },
      source: () => { if (data && !data.permission) void connect(); else void action('OPEN_SOURCE'); },
      status, time,
    });
    const error = localError || (data.sync.code ? errors[data.sync.code] || '本次更新未完成，已有成果仍保留。' : '');
    glance.update(data, syncLabel(data), error, needsSource(), busy);
  }
  function renderSettings() {
    settings.hidden = !settingsOpen;
    if (!settingsOpen || !data) return;
    byId<HTMLInputElement>('tasks-enabled').checked = data.settings.enabled;
    byId<HTMLInputElement>('tasks-widget').checked = data.settings.showWidget;
    byId<HTMLInputElement>('tasks-preview').checked = data.settings.preview;
    byId<HTMLSelectElement>('tasks-mode').value = data.settings.automatic ? 'temporary' : 'visit';
    byId('tasks-sync-status').textContent = syncLabel(data) + (data.sync.code ? '。' + (errors[data.sync.code] || '已有成果仍保留。') : '');
    const sync = byId<HTMLButtonElement>('tasks-sync-now');
    sync.disabled = busy || data.sync.status === 'syncing' || !data.settings.enabled || !!(data.sync.retryAt && Date.parse(data.sync.retryAt) > Date.now());
    sync.textContent = data.settings.automatic ? '检查更新' : '打开 ChatGPT';
    sync.hidden = needsSource();
    let recover = document.getElementById('tasks-recover');
    if (!recover) {
      recover = button('打开 ChatGPT', { id: 'tasks-recover', class: 'secondary' });
      recover.addEventListener('click', () => { if (data && !data.permission) void connect(); else void action('OPEN_SOURCE'); });
      sync.after(recover);
    }
    recover.textContent = data.permission ? '打开 ChatGPT' : '重新允许访问';
    recover.hidden = !needsSource();
    if (data.sync.retryAt && Date.parse(data.sync.retryAt) > Date.now()) byId('tasks-sync-status').textContent += ' 预计下次检查 ' + time(data.sync.retryAt) + '。';
    for (const selector of ['tasks-enabled', 'tasks-widget', 'tasks-preview', 'tasks-mode']) byId<HTMLInputElement>(selector).disabled = busy;
    const version = JSON.stringify([data.principal, busy, data.tasks.map(task => [task.key, task.title, task.selected, task.readable, task.enabledState, status(task)])]);
    if (version !== selectionVersion) {
      selectionVersion = version;
      const list = byId('tasks-selection');
      const focused = list.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.taskKey : null;
      const scroll = list.scrollTop;
      list.replaceChildren();
      if (!data.principal || !data.tasks.length) list.append(el('p', { class: 'settings-note' }, [!data.principal ? '连接 ChatGPT 后，便可选择关注的任务。' : data.completeList ? '还没有任务。可先在 ChatGPT 创建定时任务。' : '任务读取后会出现在这里。']));
      for (const task of data.tasks) {
        const input = el('input', { type: 'checkbox', checked: task.selected, disabled: busy || !task.readable, 'aria-label': '展示任务：' + task.title, 'data-task-key': task.key });
        input.addEventListener('change', () => {
          if (!data) return;
          const selected = new Set(data.tasks.filter(item => item.selected).map(item => item.key));
          input.checked ? selected.add(task.key) : selected.delete(task.key);
          if (selected.size > 10) { input.checked = false; settingsStatus.textContent = '最多关注十项任务，取消一项后即可选择新的任务。'; return; }
          void configure({ selected: [...selected] });
        });
        const caption = !task.readable ? '此类任务请在 ChatGPT 查看' : task.enabledState === 'disabled' ? '任务未启用 · 已保存的成果仍可阅读' : status(task);
        list.append(el('label', { class: 'task-choice' }, [input, el('span', {}, [el('strong', {}, [task.title]), el('small', {}, [caption])])]));
      }
      list.scrollTop = scroll;
      if (focused) Array.from(list.querySelectorAll<HTMLInputElement>('input')).find(input => input.dataset.taskKey === focused)?.focus({ preventScroll: true });
    }
    byId('tasks-coverage').textContent = !data.completeList && data.tasks.length ? '当前仅显示已读取的任务；可在 ChatGPT 打开其余任务以收录。' : '';
  }
  function nudgeHome() {
    if (homeNudged || mode !== 'workspace' || !data?.settings.enabled || !data.settings.automatic) return;
    homeNudged = true;
    // The worker decides whether cached data is due; rendering never waits for a source page.
    void request('HOME_OPEN').catch(() => {});
  }
  async function refresh(): Promise<void> {
    if (!allowed()) return;
    refreshQueued = true;
    if (refreshInFlight) return refreshInFlight;
    refreshInFlight = (async () => {
      while (refreshQueued && allowed()) {
        refreshQueued = false;
        const at = epoch;
        try {
          const next = await request('SNAPSHOT') as TaskSnapshot;
          if (at !== epoch || !allowed()) continue;
          if (data && data.principal !== next.principal) clearPrivate();
          data = next;
          renderHome(); renderSettings(); nudgeHome();
        } catch {
          if (at === epoch && allowed()) settingsStatus.textContent = '暂时无法读取本地任务成果，请重试。';
        }
      }
    })();
    try { await refreshInFlight; } finally { refreshInFlight = null; }
  }
  async function action(command: string, fields: Record<string, unknown> = {}) {
    if (busy || !allowed()) return;
    busy = true; localError = ''; renderHome(); renderSettings();
    const at = epoch;
    try {
      await request(command, fields);
      if (at !== epoch || !allowed()) return;
      settingsStatus.textContent = '';
      if (command === 'CLEAR_CACHE') clearPrivate();
      await refresh();
    } catch (error) {
      if (at === epoch && allowed()) {
        localError = errors[error instanceof Error ? error.message : ''] || '操作未完成，已有成果仍保留。';
        settingsStatus.textContent = localError;
      }
    } finally { busy = false; if (at === epoch && allowed()) { renderHome(); renderSettings(); } }
  }
  const configure = (patch: Record<string, unknown>) => action('CONFIGURE', { patch });
  async function showDetail(key: string, which = 'valuable', requested?: { runId: string; revision: number }) {
    const at = epoch, order = ++detailOrder, principal = data?.principal;
    try {
      const task = await request('DETAIL', { key, ...requested }) as TaskView;
      if (order !== detailOrder || at !== epoch || mode !== 'workspace' || !principal || data?.principal !== principal) return;
      detail = task; detailsResult = requested ? task.requestedResult || null : which === 'latest' ? task.latestAvailableResult : output(task);
      const result = detailsResult;
      const different = !!task.lastValuableResult && (task.lastValuableResult.runId !== task.latestAvailableResult?.runId || task.lastValuableResult.revision !== task.latestAvailableResult?.revision);
      const currentVersion = which === 'latest' ? task.latestAvailableResult : output(task);
      const frozen = !!result && !!requested && (result.runId !== currentVersion?.runId || result.revision !== currentVersion?.revision);
      const versionSelect = byId<HTMLSelectElement>('task-result-version');
      versionSelect.querySelector('[value="opened"]')?.remove();
      if (frozen) versionSelect.prepend(el('option', { value: 'opened' }, ['当前打开的成果']));
      byId('task-result-version-label').hidden = !different && !frozen;
      versionSelect.value = frozen ? 'opened' : which === 'latest' ? 'latest' : 'valuable';
      byId('task-result-title').textContent = task.title;
      byId('task-result-body').textContent = result?.bodyText || '尚未收录这项任务的最终输出。';
      byId('task-result-meta').textContent = [result?.classification?.outcome === 'new_information' ? '已标记的重要成果' : '', result?.createdAt ? '生成于 ' + time(result.createdAt) : ''].filter(Boolean).join(' · ');
      byId('task-result-diagnostics').textContent = [status(task), task.enabledState === 'disabled' ? '任务未启用' : '', task.lastRunAt ? '最近运行 ' + time(task.lastRunAt) : '', task.nextRunAt ? '计划下次运行 ' + time(task.nextRunAt) : '', task.resultSyncedAt ? '本地读取 ' + time(task.resultSyncedAt) : '', readLabel(task)].filter(Boolean).join(' · ');
      const links = byId('task-result-links'); links.replaceChildren();
      const source = allowedWebsiteUrl(task.sourceUrl);
      if (source) links.append(el('a', { href: source, target: '_blank', rel: 'noopener noreferrer' }, ['在 ChatGPT 查看原始来源']));
      if (result) for (const url of result.sourceUrls.slice(0, 20)) {
        const safe = allowedWebsiteUrl(url);
        if (safe) links.append(el('a', { href: safe, target: '_blank', rel: 'noopener noreferrer' }, [new URL(safe).hostname]));
      }
      byId<HTMLSelectElement>('task-classification').disabled = !result;
      byId<HTMLSelectElement>('task-classification').value = result?.classification?.outcome || '';
      byId('task-result-warning').hidden = !result?.contentTruncated;
      byId('task-result-warning').textContent = result?.contentTruncated ? '这份正文尚不完整，可在 ChatGPT 查看完整内容。' : '';
      if (!modal.open) { byId('task-result-diagnostics').closest('details')!.open = false; modal.showModal(); }
    } catch {
      if (at === epoch) { localError = '暂时无法打开这份成果，请稍后再试。'; settingsStatus.textContent = localError; renderHome(); glance?.restoreFocus(); }
    }
  }
  byId('task-result-close').addEventListener('click', () => modal.close());
  modal.addEventListener('close', () => {
    if (modal.open) return;
    detailOrder++; detail = null; detailsResult = null;
    byId('task-result-title').textContent = '任务结果';
    for (const id of ['task-result-body', 'task-result-meta', 'task-result-warning', 'task-result-diagnostics']) byId(id).textContent = '';
    byId('task-result-links').replaceChildren();
    if (mode === 'workspace') glance?.restoreFocus();
  });
  byId('task-result-version').addEventListener('change', () => { if (detail) void showDetail(detail.key, byId<HTMLSelectElement>('task-result-version').value); });
  byId('task-classification').addEventListener('change', () => {
    if (!detail || !detailsResult) return;
    const key = detail.key, which = byId<HTMLSelectElement>('task-result-version').value;
    const selectedResult = { runId: detailsResult.runId, revision: detailsResult.revision };
    void action('CLASSIFY', { key, ...selectedResult, outcome: byId<HTMLSelectElement>('task-classification').value }).then(() => { if (detail?.key === key) void showDetail(key, which, selectedResult); });
  });
  async function connect() {
    try {
      // Keep the permission request inside the user's explicit click or switch gesture.
      const granted = await chrome.permissions.request(permissions);
      if (!granted) { settingsStatus.textContent = '尚未允许访问，任务连接保持原状。'; await refresh(); return; }
      await configure({ enabled: true });
      if (data?.settings.enabled && data.settings.automatic) await action('SYNC');
      else if (data?.settings.enabled && !data.principal) await action('OPEN_SOURCE');
    } catch { settingsStatus.textContent = '连接未完成，请重试。'; }
  }
  byId('tasks-enabled').addEventListener('change', () => {
    if (!byId<HTMLInputElement>('tasks-enabled').checked) void configure({ enabled: false }); else void connect();
  });
  byId('tasks-widget').addEventListener('change', () => { void configure({ showWidget: byId<HTMLInputElement>('tasks-widget').checked }); });
  byId('tasks-preview').addEventListener('change', () => { void configure({ preview: byId<HTMLInputElement>('tasks-preview').checked }); });
  byId('tasks-mode').addEventListener('change', () => { void configure({ automatic: byId<HTMLSelectElement>('tasks-mode').value === 'temporary' }); });
  byId('tasks-sync-now').addEventListener('click', () => { void action('SYNC'); });
  byId('tasks-clear').addEventListener('click', () => clearModal.showModal());
  byId('tasks-clear-cancel').addEventListener('click', () => clearModal.close());
  byId('tasks-clear-confirm').addEventListener('click', () => { void action('CLEAR_CACHE').then(() => clearModal.close()); });
  chrome.runtime.onMessage.addListener((message, sender) => {
    if (sender.id !== chrome.runtime.id || message?.protocol !== PROTOCOL || message.event !== 'changed' || !allowed()) return;
    if (message.privacyChanged) { epoch++; clearPrivate(); }
    if (document.visibilityState === 'hidden') { hiddenDirty = true; return; }
    void refresh();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !allowed()) return;
    homeNudged = false;
    if (hiddenDirty) { hiddenDirty = false; void refresh(); } else nudgeHome();
  });
  return {
    setContext(next: 'workspace' | 'life' | null, showSettings = false) {
      if (mode === next && settingsOpen === showSettings) return;
      epoch++; mode = next; settingsOpen = showSettings; settings.hidden = !settingsOpen;
      if (!allowed()) { refreshQueued = false; clearPrivate(); }
      else { if (next !== 'workspace') { hideGlance(); if (modal.open) modal.close(); } void refresh(); }
    },
  };
}
