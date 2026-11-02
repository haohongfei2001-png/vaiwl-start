import { CHECK_STEPS, SOURCE_CHECK_PROTOCOL, type CheckStep } from '../shared/source-check.js';
const names: Record<CheckStep, [string, string]> = {
  'A-baseline': ['A · 当前账号与空间', '选择测试会话所在标签。勾选结构采样，自然打开账号/工作空间菜单，悬停当前选中项后按指定组合键。没有可安全选取的当前状态就跳过。'],
  'B-project': ['B · Project P', '打开 P 的原生项目主页，选中其测试标签后采样。沿用正式标题/成员解析器，不需要勾选结构采样。'],
  'B-conflict': ['B · 同名对照 Q', '打开 Q 的原生项目主页。里面应有与 C 同名但 ID 不同的测试会话。采样只比较本轮别名。'],
  'C-none': ['C · 无项目测试 N', '打开 N，自然查看原生归属菜单。只有明确表达“当前没有项目”的状态才值得选取；普通 /c/ 地址或没有 badge 都不算。找不到就跳过。'],
  'D-start': ['D · 从 Start 首次打开 C', '先从 Start 首页点击 C，页面到达后在 60 秒内回来选择该标签并采样。默认不勾选结构采样，以核对本次意图与目标文档。'],
  'D-repeat': ['D · 当天重复打开 C', '再次从 Start 点击同一 C，60 秒内回来采样。没有独立抵达来源时，报告仍不会声称 OpenDay 已成立。'],
  'D-refresh': ['D · 仅刷新 C', '只刷新刚才的 ChatGPT 会话标签，不再从 Start 点击；回来选择刷新后的标签采样，检查旧意图不被复用。'],
  'A-switch': ['A · 切换账号或空间对照', '有已授权的另一账号或空间时，自然切换后，在同名测试对象页面采样。没有第二环境就留空。roster 一样或不同都不能自证当前空间。'],
};
const order: CheckStep[] = ['A-baseline', 'B-project', 'B-conflict', 'C-none', 'D-start', 'D-repeat', 'D-refresh', 'A-switch'];
function el<T extends HTMLElement = HTMLElement>(id: string) { return document.getElementById(id) as T; }
let current: any = null, busy = false;
async function request(command: string, payload: Record<string, unknown> = {}) {
  const reply = await chrome.runtime.sendMessage({ protocol: SOURCE_CHECK_PROTOCOL, command, payload });
  if (!reply?.ok) throw Error(reply?.code || 'PROBE_UNAVAILABLE'); return reply.data;
}
const messages: Record<string, string> = { PERMISSION_REQUIRED: '请先回 Start 连接 ChatGPT，并开启继续收录。', PROBE_BUDGET_USED: '这一步已使用，或上一步仍在进行；不重复消耗同一来源。', PROBE_ALREADY_STARTED: '本浏览器会话已有核验，继续现有记录即可。', PROBE_EXPIRED: '本轮已结束或过期，请导出已有结果并停止。', PROBE_NOT_STARTED: '请先开始本轮核验。', STALE_DOCUMENT: '页面或权限已经变化，本次结果未接纳。' };
function note(value: string) { el('message').textContent = value; }
function instruction() { const step = el<HTMLSelectElement>('step').value as CheckStep; el('instruction').textContent = names[step][1]; el<HTMLInputElement>('pick').checked = ['A-baseline', 'C-none', 'A-switch'].includes(step); }
async function refresh() {
  const status = await request('STATUS'); current = status;
  el('connection').textContent = status.connected && status.captureEnabled ? 'ChatGPT 观察权限已连接。' : '还未连接：请先回 Start 设置中连接 ChatGPT。';
  el('build').textContent = `构建 ${status.buildSha}`;
  const select = el<HTMLSelectElement>('target'), previous = select.value; select.replaceChildren();
  status.tabs.forEach((tab: any, i: number) => { const o = document.createElement('option'); o.value = String(tab.tabId); o.textContent = `ChatGPT 标签 ${i + 1} · ${tab.routeKind === 'project' ? 'Project 主页' : tab.routeKind === 'conversation' ? '会话页面' : '其他页面'}`; select.append(o); });
  if ([...select.options].some(o => o.value === previous)) select.value = previous;
  const run = status.report;
  el<HTMLButtonElement>('begin').disabled = !!run || !status.connected || !status.captureEnabled;
  el<HTMLButtonElement>('capture').disabled = busy || !run || run.ended || !status.tabs.length;
  el('results').replaceChildren();
  for (const entry of run?.entries || []) { const li = document.createElement('li'); li.textContent = `${names[entry.step as CheckStep][0]}：${entry.state === 'captured' ? '已采集候选，尚非来源证明' : entry.state === 'running' ? '采集中' : '已阻断'} · ${entry.code}${entry.sample ? ` · ${entry.sample.identity.code} · ${entry.sample.project.code}` : ''}${entry.openChain ? ` · ${entry.openChain.state}` : ''}`; el('results').append(li); }
  el('status').textContent = `四项来源均保持 BLOCKED。${run ? (run.ended ? '本轮已结束。' : `本轮已使用 ${run.entries.length}/${CHECK_STEPS.length} 个固定步骤。`) : ''}`;
}
for (const step of order) { const option = document.createElement('option'); option.value = step; option.textContent = names[step][0]; el('step').append(option); }
el('step').addEventListener('change', instruction); instruction();
function browserInfo() { const ua = navigator.userAgent, edge = ua.match(/Edg\/(\d+(?:\.\d+){1,3})/), chrome = ua.match(/Chrome\/(\d+(?:\.\d+){1,3})/); return { family: edge ? 'Edge' : chrome ? 'Chrome' : 'Unknown', version: edge?.[1] || chrome?.[1] || '0.0' }; }
document.addEventListener('click', event => {
  if (!event.isTrusted || !(event.target instanceof HTMLButtonElement)) return;
  const id = event.target.id;
  void (async () => {
    if (id === 'begin') await request('BEGIN', { browser: browserInfo() });
    if (id === 'show-target') { const tabId = Number(el<HTMLSelectElement>('target').value); if (el<HTMLSelectElement>('target').value) await chrome.tabs.update(tabId, { active: true }); }
    if (id === 'capture') {
      if (busy) return; busy = true; el<HTMLButtonElement>('capture').disabled = true;
      const tabId = Number(el<HTMLSelectElement>('target').value), step = el<HTMLSelectElement>('step').value;
      const pickStructure = el<HTMLInputElement>('pick').checked;
      note(pickStructure ? '正在准备核验。测试标签右上角出现提示后，再按其指引选取；完成后回到此页。' : '正在读取允许的元数据结构与导航绑定…');
      if (pickStructure) await chrome.tabs.update(tabId, { active: true });
      try { await request('CAPTURE', { step, tabId, pickStructure }); note('本步已结束。失败不自动重试；可以继续下一对照或直接导出。'); }
      finally { busy = false; }
    }
    if (id === 'end') { await request('END'); note('已结束。可导出本轮已有结果。'); }
    if (id === 'export') {
      const report = await request('EXPORT'), blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }), url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `vaiwl-start-source-check-${report.buildSha.slice(0, 12)}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); note('脱敏报告已导出。');
    }
    await refresh();
  })().catch(error => { busy = false; note(messages[error.message] || `本次已停止：${/^[A-Z_]+$/.test(error.message) ? error.message : 'PROBE_UNAVAILABLE'}`); void refresh().catch(() => {}); });
});
void refresh().catch(() => note('无法读取核验状态。请确认扩展已经重新加载。'));
