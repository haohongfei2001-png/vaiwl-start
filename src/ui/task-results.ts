import { byId, element as el, button } from './dom.js';
import type { TaskSnapshot, TaskView, ResultView } from '../tasks/types.js';
const PROTOCOL='vaiwl-tasks/1';
const permissions:chrome.permissions.Permissions={permissions:['scripting','alarms'],origins:['https://chatgpt.com/*']};
async function request(command:string,fields:Record<string,unknown>={}) {
  const result=await chrome.runtime.sendMessage({protocol:PROTOCOL,command,...fields});
  if(!result?.ok)throw Error(result?.code || 'SYNC_UNAVAILABLE');return result.data;
}
const time=(value:string|null)=>value ? new Intl.DateTimeFormat('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(value)) : '尚未同步';
const output=(task:TaskView)=>task.lastValuableResult || task.latestAvailableResult;
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
  SOURCE_UNAVAILABLE:'ChatGPT 来源暂时不可用，已保留本地成果。',
  RATE_LIMITED:'ChatGPT 暂时限制请求，本次同步已停止。',
  PARTIAL_LIST:'已读取当前页面的任务。来源还有未读取的分页，列表并非全部。',
  STALE_DOCUMENT:'账户或页面已变化，等待重新同步。',
  SYNC_INTERRUPTED:'上次同步因浏览器后台停止而中断，已有成果仍保留。',
  DISABLED:'同步已停止。',
};
export function initTaskResults() {
  let mode:'workspace'|'life'|null=null,settingsOpen=false,epoch=0,busy=false;
  let data:TaskSnapshot|null=null,expanded=false,detail:TaskView|null=null,detailsResult:ResultView|null=null;
  const root=byId('tasks-home'),settings=byId('task-settings');
  const modal=byId<HTMLDialogElement>('task-result-dialog');
  const clearModal=byId<HTMLDialogElement>('task-clear-dialog');
  const allowed=()=>mode==='workspace'||settingsOpen;
  const settingsStatus=byId('tasks-settings-status');
  function clearPrivate(){data=null;detail=null;detailsResult=null;root.replaceChildren();root.hidden=true;byId('tasks-selection').replaceChildren();
    for(const id of ['task-result-body','task-result-meta','task-result-warning','tasks-sync-status','tasks-coverage','tasks-settings-status'])byId(id).textContent='';
    byId('task-result-title').textContent='任务结果';byId('task-result-links').replaceChildren();if(modal.open)modal.close();if(clearModal.open)clearModal.close();}
  function syncLabel(s:TaskSnapshot):string {
    if(!s.settings.enabled)return '同步已关闭 · 本地缓存';
    if(!s.permission)return '访问权限已撤销 · 本地缓存';
    if(s.sync.status==='syncing')return '正在同步…';
    if(s.sync.status==='error')return '同步未完成 · 上次成功 '+time(s.sync.succeededAt);
    return (s.settings.automatic?'后台页面自动同步':'访问 ChatGPT 时同步')+' · '+time(s.sync.succeededAt);
  }
  function renderHome(){
    root.replaceChildren();root.hidden=mode!=='workspace'||!data?.settings.showWidget||!data?.principal||!data.tasks.length;
    if(root.hidden||!data)return;
    const chosen=data.tasks.filter(t=>t.selected);
    const candidates=chosen.filter(t=>output(t)).sort((a,b)=>(output(b)!.createdAt||'').localeCompare(output(a)!.createdAt||''));
    const featured=candidates.find(t=>!!t.lastValuableResult)||candidates[0];
    const head=el('div',{class:'tasks-strip'});
    head.append(el('div',{class:'tasks-label'},[el('h2',{},['定时任务']),el('span',{class:'tasks-sync'},[syncLabel(data)])]));
    if(featured){const r=output(featured)!;const preview=button('',{class:'task-featured','aria-label':'查看任务结果：'+featured.title});
      const kept=r.runId!==featured.latestAvailableResult?.runId||r.revision!==featured.latestAvailableResult?.revision;
      preview.append(el('strong',{},[featured.title]),el('span',{},[data.settings.preview?r.preview:'查看完整执行结果']),el('small',{},[(kept?'保留的重要成果；最近输出：':'')+status(featured)+' · '+time(r.createdAt)]));
      preview.addEventListener('click',()=>{void showDetail(featured.key);});head.append(preview);
    }else head.append(el('span',{class:'tasks-empty'},[chosen.length?'等待收录所选任务的实际输出':'在设置中选择要展示的任务']));
    const toggle=button(expanded?'收起':'展开',{class:'text-button','aria-expanded':String(expanded),'aria-label':expanded?'收起定时任务':'展开定时任务'});toggle.addEventListener('click',()=>{expanded=!expanded;renderHome();});head.append(toggle);root.append(head);
    if(expanded){const list=el('div',{class:'tasks-list'});
      for(const task of chosen){const r=task.latestAvailableResult,row=button('',{class:'task-row','aria-label':'查看任务结果：'+task.title});row.append(el('span',{class:'task-row-title'},[task.title]),el('span',{class:'task-excerpt'},[r&&data.settings.preview?r.preview:status(task)]),el('small',{},[status(task)+(r?' · '+time(r.createdAt):'')+(task.nextRunAt?' · 下次 '+time(task.nextRunAt):'')]));row.addEventListener('click',()=>{void showDetail(task.key,'latest');});list.append(row);}
      const foot=el('div',{class:'task-list-footer'},[el('span',{},[data.sync.code?errors[data.sync.code]||'本次同步未完成，已有成果仍保留。':'显示已收录的最终输出；业务结果以正文为准。'])]);
      const sync=button(data.settings.automatic?'立即同步':'打开 ChatGPT 同步',{class:'text-button',disabled:busy||!data.settings.enabled});sync.addEventListener('click',()=>{void action('SYNC');});foot.append(sync);list.append(foot);root.append(list);
    }
  }
  function renderSettings(){
    settings.hidden=!settingsOpen;if(!settingsOpen||!data)return;
    byId<HTMLInputElement>('tasks-enabled').checked=data.settings.enabled;
    byId<HTMLInputElement>('tasks-widget').checked=data.settings.showWidget;
    byId<HTMLInputElement>('tasks-preview').checked=data.settings.preview;
    byId<HTMLSelectElement>('tasks-mode').value=data.settings.automatic?'temporary':'visit';
    byId('tasks-sync-status').textContent=syncLabel(data)+(data.sync.code?'。'+(errors[data.sync.code]||'已有成果仍保留。'):'');
    byId<HTMLButtonElement>('tasks-sync-now').disabled=busy||!data.settings.enabled;
    for(const selector of ['tasks-enabled','tasks-widget','tasks-preview','tasks-mode'])byId<HTMLInputElement>(selector).disabled=busy;
    const list=byId('tasks-selection');list.replaceChildren();
    if(!data.principal){byId('tasks-coverage').textContent='';list.append(el('p',{class:'settings-note'},['首次开启后同步任务列表，再选择首页展示的任务。']));return;}
    for(const t of data.tasks){const input=el('input',{type:'checkbox',checked:t.selected,disabled:busy||!t.readable,'aria-label':'展示任务：'+t.title});
      input.addEventListener('change',()=>{if(!data)return;const selected=new Set(data.tasks.filter(x=>x.selected).map(x=>x.key));input.checked?selected.add(t.key):selected.delete(t.key);if(selected.size>10){input.checked=false;settingsStatus.textContent='一次最多选择十项，以减少后台页面加载。';return;}void configure({selected:[...selected]});});
      list.append(el('label',{class:'task-choice'},[input,el('span',{},[el('strong',{},[t.title]),el('small',{},[t.readable?(t.enabledState==='enabled'?'已启用':t.enabledState==='disabled'?'未启用':'启用状态未知')+' · '+status(t):'此类型暂未接入结果，可在 ChatGPT 查看'])])]));}
    byId('tasks-coverage').textContent=data.completeList?'已读完本次来源返回的三个任务分类。':'仅显示已读取范围；未读取的分页不会视为任务删除。';
  }
  async function refresh(){if(!allowed())return;const at=epoch;try{const next=await request('SNAPSHOT') as TaskSnapshot;if(at!==epoch||!allowed())return;if(data?.principal!==next.principal&&detail){clearPrivate();}data=next;renderHome();renderSettings();}catch{if(at===epoch&&allowed()){settingsStatus.textContent='暂时无法读取本地任务成果，请重试。';}}}
  async function action(command:string,fields:Record<string,unknown>={}){if(busy||!allowed())return;busy=true;renderSettings();const at=epoch;try{await request(command,fields);if(at!==epoch||!allowed())return;settingsStatus.textContent='';await refresh();}catch(e){if(at===epoch&&allowed())settingsStatus.textContent=errors[e instanceof Error?e.message:'']||'操作未完成，已有成果仍保留。';}finally{busy=false;if(at===epoch&&allowed())renderSettings();}}
  const configure=(patch:Record<string,unknown>)=>action('CONFIGURE',{patch});
  async function showDetail(key:string,which='valuable'){const at=epoch;try{const t=await request('DETAIL',{key}) as TaskView;if(at!==epoch||mode!=='workspace')return;detail=t;detailsResult=which==='latest'?t.latestAvailableResult:output(t);const r=detailsResult;
    const different=!!t.lastValuableResult && (t.lastValuableResult.runId!==t.latestAvailableResult?.runId || t.lastValuableResult.revision!==t.latestAvailableResult?.revision);
    byId('task-result-version-label').hidden=!different;
    byId<HTMLSelectElement>('task-result-version').value=which==='latest'?'latest':'valuable';
    byId('task-result-title').textContent=t.title;byId('task-result-body').textContent=r?.bodyText||'尚未收录这项任务的最终输出。';
    byId('task-result-meta').textContent=[different&&which!=='latest'?'保留的重要成果；最近输出：'+status(t):status(t),r?'成果产生于 '+time(r.createdAt):'',t.resultSyncedAt?'来源读取于 '+time(t.resultSyncedAt):'',t.recordedStatus==='unknown'?'来源未提供调度运行状态':'运行状态：'+t.recordedStatus,t.nextRunAt?'下次运行：'+time(t.nextRunAt):'来源未提供下次运行时间'].filter(Boolean).join(' · ');
    const links=byId('task-result-links');links.replaceChildren(el('a',{href:t.sourceUrl,target:'_blank',rel:'noopener noreferrer'},['在 ChatGPT 查看原始来源']));
    if(r)for(const url of r.sourceUrls.slice(0,20)){try{const u=new URL(url);if(!['https:','http:'].includes(u.protocol)||u.username||u.password)continue;links.append(el('a',{href:url,target:'_blank',rel:'noopener noreferrer'},[u.hostname]));}catch{}}
    byId<HTMLSelectElement>('task-classification').disabled=!r;byId<HTMLSelectElement>('task-classification').value=r?.classification?.outcome||'';
    byId('task-result-warning').textContent=r?.contentTruncated?'来源正文不完整，请打开原始来源。':'正文按原样保存，链接仅来自正文中明确的网址。';
    if(!modal.open)modal.showModal();
  }catch{if(at===epoch)settingsStatus.textContent='暂时无法读取这条结果。';}}
  byId('task-result-close').addEventListener('click',()=>modal.close());
  modal.addEventListener('close',()=>{detail=null;detailsResult=null;byId('task-result-title').textContent='任务结果';for(const id of ['task-result-body','task-result-meta','task-result-warning'])byId(id).textContent='';byId('task-result-links').replaceChildren();});
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
  return {setContext(next:'workspace'|'life'|null,showSettings=false){epoch++;mode=next;settingsOpen=showSettings;settings.hidden=!settingsOpen;if(!allowed())clearPrivate();else {if(next!=='workspace'){root.replaceChildren();root.hidden=true;if(modal.open)modal.close();}void refresh();}}};
}
