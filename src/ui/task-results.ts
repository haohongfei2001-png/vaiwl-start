import { byId, element as el, button } from './dom.js';
import { createTaskGlance, preferredOutput as output } from './task-glance.js';
import type { TaskSnapshot, TaskView, ResultView } from '../tasks/types.js';
const PROTOCOL='vaiwl-tasks/1';
const permissions:chrome.permissions.Permissions={permissions:['scripting','alarms'],origins:['https://chatgpt.com/*']};
async function request(command:string,fields:Record<string,unknown>={}) {
  const result=await chrome.runtime.sendMessage({protocol:PROTOCOL,command,...fields});
  if(!result?.ok)throw Error(result?.code || 'SYNC_UNAVAILABLE');return result.data;
}
const time=(value:string|null)=>value ? new Intl.DateTimeFormat('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(value)) : '尚未同步';
function status(task:TaskView):string {
  if(task.recordedStatus==='failed')return '运行失败';
  if(task.recordedStatus==='no_update')return '本次无新报告';
  const result=task.latestAvailableResult;
  if(result?.isFailureMessage||result?.classification?.outcome==='failed')return '本条执行遇到问题';
  if(result?.classification?.outcome==='no_new_information')return '本条无新信息';
  if(result?.classification?.outcome==='new_information')return '已标记重要成果';
  return result ? '已收录输出' : task.readable ? '尚未收录结果' : '此类型暂未接入结果';
}
const errors:Record<string,string>={
  PERMISSION_REQUIRED:'需要重新允许任务访问。已有成果仍保留。',
  IDENTITY_UNAVAILABLE:'未确认 ChatGPT 登录账户。请打开任务页完成登录。',
  SOURCE_TIMEOUT:'本次未取得最新来源。已有成果仍保留，可打开任务页同步。',
  SOURCE_CHANGED:'ChatGPT 来源格式发生变化，已保留本地成果。',
  LOGIN_REQUIRED:'ChatGPT 当前未登录，请打开任务页登录。原账户缓存仍保留，确认账户后恢复显示。',
  VERIFICATION_REQUIRED:'ChatGPT 要求 Cloudflare 验证。请打开任务页完成正常验证，再重试同步。',
  SOURCE_FORBIDDEN:'ChatGPT 拒绝了本次读取（403），尚不能确定原因。可打开任务页检查后重试。',
  NETWORK_ERROR:'本次网络请求失败。已有成果仍保留，网络恢复后可重试。',
  SOURCE_UNAVAILABLE:'ChatGPT 来源暂时不可用，已保留本地成果。',
  RATE_LIMITED:'ChatGPT 暂时限制请求，本次同步已停止，最多每 30 分钟重试一次。',
  PARTIAL_LIST:'已读取当前页面的任务。来源还有未读取的分页，列表并非全部。',
  STALE_DOCUMENT:'账户或页面已变化，等待重新同步。',
  SYNC_INTERRUPTED:'上次同步因浏览器后台停止而中断，已有成果仍保留。',
  DISABLED:'同步已停止。',
};
export function initTaskResults() {
  let mode:'workspace'|'life'|null=null,settingsOpen=false,epoch=0,busy=false;
  let data:TaskSnapshot|null=null,detail:TaskView|null=null,detailsResult:ResultView|null=null;
  let glance: ReturnType<typeof createTaskGlance> | undefined;
  let refreshOrder = 0, detailOrder = 0;
  const root=byId('tasks-home'),settings=byId('task-settings');
  const modal=byId<HTMLDialogElement>('task-result-dialog');
  const clearModal=byId<HTMLDialogElement>('task-clear-dialog');
  const allowed=()=>mode==='workspace'||settingsOpen;
  const settingsStatus=byId('tasks-settings-status');
  function hideGlance() {
    glance?.dispose();
    glance = undefined;
    root.hidden = true;
  }
  function clearPrivate(){detailOrder++;data=null;detail=null;detailsResult=null;hideGlance();byId('tasks-selection').replaceChildren();
    for(const id of ['task-result-body','task-result-meta','task-result-warning','tasks-sync-status','tasks-coverage','tasks-settings-status'])byId(id).textContent='';
    byId('task-result-title').textContent='任务结果';byId('task-result-links').replaceChildren();if(modal.open)modal.close();if(clearModal.open)clearModal.close();}
  const readLabel=(t:TaskView)=>t.readOutcome==='updated'?'此次收录了新输出':t.readOutcome==='unchanged'?'已重新读取，暂无新输出':t.readOutcome==='empty'?'本次来源未返回完成正文，已有成果仍保留':'已保存的来源正文';
  const needsSource=()=>!!data?.sync.code&&['LOGIN_REQUIRED','VERIFICATION_REQUIRED','SOURCE_FORBIDDEN','IDENTITY_UNAVAILABLE','SOURCE_TIMEOUT'].includes(data.sync.code);
  function syncLabel(s:TaskSnapshot):string {
    const reads=s.tasks.filter(t=>t.selected&&t.readable&&t.resultSyncedAt);
    const lastRead=reads.map(t=>t.resultSyncedAt!).sort().at(-1)||null;
    const cachedTime=lastRead?' · 上次正文读取 '+time(lastRead):'';
    if(!s.settings.enabled)return '同步已关闭 · 本地缓存'+cachedTime;
    if(!s.permission)return '访问权限已撤销 · 本地缓存'+cachedTime;
    if(s.sync.status==='syncing')return '正在同步…'+cachedTime;
    if(s.sync.status==='error')return '同步未完成 · 本地缓存'+cachedTime;
    const outcome=reads.some(t=>t.readOutcome==='updated')?'已收录新输出':reads.some(t=>t.readOutcome==='empty')?'来源未返回完成正文':reads.length?'已重新读取，暂无新输出':'尚未读取正文';
    return '本地成果 · '+(s.sync.mode==='visit'?'最近访问读取':'最近后台读取')+' '+time(lastRead)+' · '+outcome;
  }
  function renderHome() {
    if (mode !== 'workspace' || !data?.settings.showWidget || !data.principal ||
        (!data.tasks.length && !(data.settings.enabled && data.completeList))) {
      hideGlance();
      return;
    }
    root.hidden = false;
    glance ??= createTaskGlance(root, {
      detail: (key, version) => { void showDetail(key, version); },
      sync: () => { void action('SYNC'); },
      source: () => { void action('OPEN_SOURCE'); },
      status, time,
    });
    const error = data.sync.code ? errors[data.sync.code] || '本次同步未完成，已有成果仍保留。' : '';
    glance.update(data, syncLabel(data), error, needsSource(), busy);
  }
  function renderSettings(){
    settings.hidden=!settingsOpen;if(!settingsOpen||!data)return;
    byId<HTMLInputElement>('tasks-enabled').checked=data.settings.enabled;
    byId<HTMLInputElement>('tasks-widget').checked=data.settings.showWidget;
    byId<HTMLInputElement>('tasks-preview').checked=data.settings.preview;
    byId<HTMLSelectElement>('tasks-mode').value=data.settings.automatic?'temporary':'visit';
    byId('tasks-sync-status').textContent=syncLabel(data)+(data.sync.code?'。'+(errors[data.sync.code]||'已有成果仍保留。'):'');
    byId<HTMLButtonElement>('tasks-sync-now').disabled=busy||data.sync.status==='syncing'||!data.settings.enabled||!!(data.sync.retryAt&&Date.parse(data.sync.retryAt)>Date.now());
    let recover=document.getElementById('tasks-recover');if(!recover){recover=button('打开 ChatGPT 检查',{id:'tasks-recover',class:'text-button'});recover.addEventListener('click',()=>{void action('OPEN_SOURCE');});byId('tasks-sync-now').after(recover);}recover.hidden=!needsSource();
    if(data.sync.retryAt&&Date.parse(data.sync.retryAt)>Date.now())byId('tasks-sync-status').textContent+=' 下次可重试：'+time(data.sync.retryAt)+'。';
    for(const selector of ['tasks-enabled','tasks-widget','tasks-preview','tasks-mode'])byId<HTMLInputElement>(selector).disabled=busy;
    const list=byId('tasks-selection');list.replaceChildren();
    if(!data.principal){byId('tasks-coverage').textContent='';list.append(el('p',{class:'settings-note'},['首次开启后同步任务列表，再选择首页展示的任务。']));return;}
    for(const t of data.tasks){const input=el('input',{type:'checkbox',checked:t.selected,disabled:busy||!t.readable,'aria-label':'展示任务：'+t.title});
      input.addEventListener('change',()=>{if(!data)return;const selected=new Set(data.tasks.filter(x=>x.selected).map(x=>x.key));input.checked?selected.add(t.key):selected.delete(t.key);if(selected.size>10){input.checked=false;settingsStatus.textContent='一次最多选择十项，以减少后台页面加载。';return;}void configure({selected:[...selected]});});
      list.append(el('label',{class:'task-choice'},[input,el('span',{},[el('strong',{},[t.title]),el('small',{},[t.readable?(t.enabledState==='enabled'?'已启用':t.enabledState==='disabled'?'未启用':'启用状态未知')+' · '+status(t):'此类型暂未接入结果，可在 ChatGPT 查看'])])]));}
    byId('tasks-coverage').textContent=data.completeList?'已读完本次来源返回的三个任务分类。':'仅显示已读取范围；未读取的分页不会视为任务删除。';
  }
  async function refresh() {
    if (!allowed()) return;
    const at = epoch, order = ++refreshOrder;
    try {
      const next = await request('SNAPSHOT') as TaskSnapshot;
      if (order !== refreshOrder || at !== epoch || !allowed()) return;
      if (data && data.principal !== next.principal) clearPrivate();
      data = next;
      renderHome();
      renderSettings();
    } catch {
      if (order === refreshOrder && at === epoch && allowed()) settingsStatus.textContent = '暂时无法读取本地任务成果，请重试。';
    }
  }
  async function action(command: string, fields: Record<string, unknown> = {}) {
    if (busy || !allowed()) return;
    busy = true;
    renderHome();
    renderSettings();
    const at = epoch;
    try {
      await request(command, fields);
      if (at !== epoch || !allowed()) return;
      settingsStatus.textContent = '';
      await refresh();
    } catch (error) {
      if (at === epoch && allowed()) settingsStatus.textContent = errors[error instanceof Error ? error.message : ''] || '操作未完成，已有成果仍保留。';
    } finally {
      busy = false;
      if (at === epoch && allowed()) { renderHome(); renderSettings(); }
    }
  }
  const configure=(patch:Record<string,unknown>)=>action('CONFIGURE',{patch});
  async function showDetail(key:string,which='valuable'){const at=epoch, order=++detailOrder, principal=data?.principal;try{const t=await request('DETAIL',{key}) as TaskView;if(order!==detailOrder||at!==epoch||mode!=='workspace'||!principal||data?.principal!==principal)return;detail=t;detailsResult=which==='latest'?t.latestAvailableResult:output(t);const r=detailsResult;
    const different=!!t.lastValuableResult && (t.lastValuableResult.runId!==t.latestAvailableResult?.runId || t.lastValuableResult.revision!==t.latestAvailableResult?.revision);
    byId('task-result-version-label').hidden=!different;
    byId<HTMLSelectElement>('task-result-version').value=which==='latest'?'latest':'valuable';
    byId('task-result-title').textContent=t.title;byId('task-result-body').textContent=r?.bodyText||'尚未收录这项任务的最终输出。';
    byId('task-result-meta').textContent=[different&&which!=='latest'?'保留的重要成果；最近输出：'+status(t):status(t),r?'成果产生于 '+time(r.createdAt):'',t.resultSyncedAt?'本地缓存 · 来源读取于 '+time(t.resultSyncedAt)+' · '+readLabel(t):'',t.recordedStatus==='unknown'?'来源未提供调度运行状态':'运行状态：'+t.recordedStatus,t.nextRunAt?'下次运行：'+time(t.nextRunAt):'来源未提供下次运行时间'].filter(Boolean).join(' · ');
    const links=byId('task-result-links');links.replaceChildren(el('a',{href:t.sourceUrl,target:'_blank',rel:'noopener noreferrer'},['在 ChatGPT 查看原始来源']));
    if(r)for(const url of r.sourceUrls.slice(0,20)){try{const u=new URL(url);if(!['https:','http:'].includes(u.protocol)||u.username||u.password)continue;links.append(el('a',{href:url,target:'_blank',rel:'noopener noreferrer'},[u.hostname]));}catch{}}
    byId<HTMLSelectElement>('task-classification').disabled=!r;byId<HTMLSelectElement>('task-classification').value=r?.classification?.outcome||'';
    byId('task-result-warning').textContent=r?.contentTruncated?'来源正文不完整，请打开原始来源。':'正文按原样保存，链接仅来自正文中明确的网址。';
    if(!modal.open)modal.showModal();
  }catch{if(at===epoch)settingsStatus.textContent='暂时无法读取这条结果。';}}
  byId('task-result-close').addEventListener('click',()=>modal.close());
  modal.addEventListener('close',()=>{if(modal.open)return;detailOrder++;detail=null;detailsResult=null;byId('task-result-title').textContent='任务结果';for(const id of ['task-result-body','task-result-meta','task-result-warning'])byId(id).textContent='';byId('task-result-links').replaceChildren();if(mode==='workspace')glance?.restoreFocus();});
  byId('task-result-version').addEventListener('change',()=>{if(detail)void showDetail(detail.key,byId<HTMLSelectElement>('task-result-version').value);});
  byId('task-classification').addEventListener('change',()=>{if(!detail||!detailsResult)return;const key=detail.key,which=byId<HTMLSelectElement>('task-result-version').value;
    void action('CLASSIFY',{key,runId:detailsResult.runId,revision:detailsResult.revision,outcome:byId<HTMLSelectElement>('task-classification').value}).then(()=>{if(detail?.key===key)void showDetail(key,which);});});
  byId('tasks-enabled').addEventListener('change',()=>{
    const checked=byId<HTMLInputElement>('tasks-enabled').checked;
    if(!checked){void configure({enabled:false});return;}
    // Request immediately inside the explicit user gesture, with the purpose beside it.
    void chrome.permissions.request(permissions).then(async granted=>{if(!granted){settingsStatus.textContent='未获得权限，同步保持关闭。';await refresh();return;}await configure({enabled:true});if(data?.settings.enabled&&data.settings.automatic)await action('SYNC');}).catch(()=>{settingsStatus.textContent='权限申请未完成，请重试。';});
  });
  byId('tasks-widget').addEventListener('change',()=>{void configure({showWidget:byId<HTMLInputElement>('tasks-widget').checked});});
  byId('tasks-preview').addEventListener('change',()=>{void configure({preview:byId<HTMLInputElement>('tasks-preview').checked});});
  byId('tasks-mode').addEventListener('change',()=>{void configure({automatic:byId<HTMLSelectElement>('tasks-mode').value==='temporary'});});
  byId('tasks-sync-now').addEventListener('click',()=>{void action('SYNC');});
  byId('tasks-clear').addEventListener('click',()=>clearModal.showModal());
  byId('tasks-clear-cancel').addEventListener('click',()=>clearModal.close());
  byId('tasks-clear-confirm').addEventListener('click',()=>{void action('CLEAR').then(()=>clearModal.close());});
  chrome.runtime.onMessage.addListener((m,s)=>{if(s.id===chrome.runtime.id&&m?.protocol===PROTOCOL&&m.event==='changed'&&allowed())void refresh();});
  return {setContext(next:'workspace'|'life'|null,showSettings=false){epoch++;mode=next;settingsOpen=showSettings;settings.hidden=!settingsOpen;if(!allowed())clearPrivate();else {if(next!=='workspace'){hideGlance();if(modal.open)modal.close();}void refresh();}}};
}
