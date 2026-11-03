# 数据来源与可靠性验证矩阵

> **当前最高优先修订：[第14号首页与时间投影合同](14-HOME-TIME-PROJECTION-AMENDMENT.md)。** 废止可见待确认/来源等级、严格更早日期证明与独立无日期会话区；完整项目、范围时间证据、最近与全局更早按该合同执行。身份隔离、P1权限及12stores不变。

> **2026-11-03 更新：** [第13号修订](13-NATIVE-PROJECT-LOCAL-AMENDMENT.md)接入 principal-only 本地隔离和多种原生关系适配器。下方旧 M0 认证矩阵只约束完整 AccountScope/PROJECT/NONE，不再阻断本地原生项目组织。固定竞品源码与同 SHA 隔离测试支持本地实现，真实已登录 ChatGPT 来源仍单独记录未核验。

> **当前有效修订：2026-11-02-local-first，用户已批准。** [统一修订合同](10-LOCAL-FIRST-AMENDMENT.md)覆盖原 M0 全局前置门：本地时间组织、Start 主动打开与局部候选项目可独立运行；账号隔离及正式原生归属证明仍保留。`LOCAL_WORKSPACE_READY` 不等于 `FREE_V1_ACCEPTED`。

核查时间：2026-11-02，Asia/Shanghai。证据级别分为 **标准文档核验**、**固定源码核验**、**原产品局部实机记录**、**Start 实机待验**。前三项不自动转化为第四项通过。

## 1. 浏览器 API 能做什么

| 来源 | 可证实字段/事件 | 不能证实 | V1落点 | 核查级别 |
|---|---|---|---|---|
| history.search | URL、可缺标题、最后加载时间、访问/输入次数、历史ID | 当前Project、NONE、账号、发送时间、主动活动 | 未分配历史日期窗；lastVisit不写活动 | 标准文档核验[S1] |
| history.getVisits | visit ID/time/transition；115+ isLocal | 每次浏览的可靠人类意图、网页业务身份 | 来源/覆盖解释，不补活动 | 标准文档核验[S1] |
| history.onVisited | 历史条目出现，可能早于完成加载 | 抵达成功、稳定标题、主动点击 | 候选发现 | 标准文档核验[S1] |
| webNavigation | top frame/documentId/lifecycle/SPA事件/导航qualifier | Project、账号、通用userGesture、正文/应用成功 | 与Start真实意图关联；onCommitted+onCompleted确认导航 | 标准文档核验[S2] |
| tabs.onActivated / window focus | 当前tab/window | 是人点击、脚本、关闭邻tab还是恢复 | 可见性守卫，不写活动 | 标准文档核验[S3] |
| Start自身受信手势 | 指定会话打开意图 | 目标实际可访问、当前账号一致 | 两阶段打开 | 设计已定，Start实机待验 |
| ChatGPT限定链接受信手势 | 精确href、source document | 成功抵达、完整账号/成员关系 | 意图+路由/目标关联 | 固定源码可借鉴，Start实机待验 |
| 本地IDB记录 | 已存字段、来源、时间 | 云端当前全量状态 | 本地持久目录 | 标准文档核验[S4] |

history.search 默认仅24小时、100项，无通用分页cursor；必须明确范围与饱和检测。`history.addUrl()`亦可创建link历史，因此link/typedCount并不是活动证明。[S1]

### 不能绕过的边界

只用标准API与最小权限，无法完整识别所有外部入口的人为主动性。浏览器书签、历史页、切回tab、外站链接等，证据不足时保守漏记活动，目录仍可保留。不新增“每次确认”步骤，不用全站内容监听弥补。

`forward_back`不能直接当人类点击。Chromium官方测试对脚本history.go/back/forward使用该transition qualifier，也可保留FROM_ADDRESS_BAR。[S5] 所以地址栏adapter必须排除历史遍历、reload/start_page、redirect、后台及未激活文档，并通过两个浏览器的反例测试。

## 2. ChatGPT 真实来源矩阵

固定源：`1903b00f774b4fd7f3d15b3669878c32e2c7a9c8`。

| 事实/链路 | 实际发现 | Start裁决 |
|---|---|---|
| 会话ID/URL | url-policy支持/c/uuid和/g/container/c/uuid，containerHint不等于归属 | 适配复用；不凭路径判NONE/Project |
| Project成员区域 | observedProjectAssociation校验exact P route、可见标题叶、tab/panel双向IDREF、限定成员结构和container一致性 | 可拆窄DOM函数；重新证明Start的scope与负例 |
| Project内会话标题 | observedProjectListTitle仅取成员行的text-only标题叶，不回退整行预览；Project名称由observedProjectAssociation中的h1/button标题叶确认 | 适配复用，无正文 |
| 原Project真实结果 | 固定HEAD最新STATUS记录P入口、身份与两成员路径已有局部证据，增强frame/return仍未完成 | 不能标原Free已验收；Start不依赖其挂载 |
| NONE | observed profile moveMenu=':not(*)'；当前实机菜单没有明确“当前无项目”语义，NONE仍BLOCKED | V1生产profile不能默认启用；仅阻断正式NONE，不阻断本地日期窗 |
| 稳定账号 | BrowserLocal identity reader明确拒绝，默认context-unverified/singlePersonalDefault=false | 不可拿私人库解锁或当前profile当account proof |
| session-only身份候选 | read()固定GET /api/auth/session及/backend-api/accounts/check/v4-2023-04-27 | 可独立摘出有限读取；token只RAM；不是官方稳定API |
| 当前workspace | roster只列可访问context；default/null不证明当前选中context | 缺证据保持未分配；绝不默认“个人” |
| 完整会话metadata链 | readCurrentConversation读取完整conversation(s)/ID JSON，最多8MiB | **禁止移植**，即便落库只存元数据 |
| project/directory parser | 当前只产候选，gizmo_id/null都不会自动提升；生产directoryProvider默认关闭 | 不凭parser存在宣称数据接通 |
| 请求头context观察 | 原实现涉及webRequest及exact conversation/body关联 | 不整体移植；不以加权限绕开无正文边界 |

[固定源码清单](evidence/source-manifest.json) 提供每一行依据的精确URL与哈希；[源码审查摘记](evidence/source-inheritance.md)给函数与关系。当前没有稳定官方的“浏览器扩展读取ChatGPT全部Project归属”API作为前提。

## 3. 正式原生来源的独立验收

以下是正式账号/PROJECT/NONE来源的独立核验，不是本地时间组织或Start导航活动的前置。可使用用户已授权的真实受控ChatGPT对象：P项目内C、普通NONE会话N、同名项目Q、另一个账号或workspace的同名对象。只读取本轮允许的元数据。

1. **身份**：从原session-only分支独立摘取两条固定GET及其响应校验；优先同站ISOLATED受控函数。不得让网页决定请求URL或把token放进消息。证明稳定principal、可访问roster和**独立的当前context证据**。只有单一personal条目也不能未经语义验证直接视为当前context；default/null必须拒绝。
2. **P**：只读限定原生Project标题叶、成员链接及panel关系，以实际scope/document/route绑定；旁边历史列表的Q会话必须仍UNKNOWN。scope未证但局部关系可靠时只挂本地候选，禁止授予PROJECT；正式来源可信时逐条生效，不等完整账号目录。不使用原flow/paint挂载代码。
3. **NONE**：两条允许候选路径是“用户自然打开的原生UI明确当前无项目状态”和“经过现场响应结构验证的纯目录/归属元数据”。禁止自动点开菜单、后台批量开页或读取完整会话详情。缺失、未解释null、/c/普通路径不能通过。若需要新内部端点，先在取证中证明响应只包含允许字段与明确语义，再编入固定版本profile；不得猜URL即上线。
4. **账号切换**：旧文档迟到、当前context变化、同名对象及scope不明均拒绝错误合并；历史500项只因其中一个打开确认而关联那一项。
5. **主动打开**：Start受信操作→精确浏览器导航完成→本地OpenDay，加刷新/恢复/错误目标/脚本导航负例；不要求正文成功。原生链接与地址栏各自独立未启用，以实际记录行/事件ID核对，不能借此阻断Start入口。

每条候选来源最多进行一次结构发现与一次有明确新证据的修正验证；没有新的可观测事实，不连续放宽选择器/空值规则。失败记录准确字段/状态原因，仅关闭该未证正式字段，分别记录其来源状态。本地工作空间为 `LOCAL_WORKSPACE_READY`，历史日期投影、合法Start活动和可靠局部候选继续运行；仍不得宣布完整来源或用临时菜单人工逐条维护替代核心自动能力。此次数限制控制无效诊断，不禁止有明确新证据后的正常实施。

## 4. 权限与兼容

| 项目 | 冻结决定 |
|---|---|
| 安装必需 | storage；newtab override无需额外广泛权限 |
| 用户点击连接ChatGPT时 | optional scripting + webNavigation + 精确https://chatgpt.com/* |
| 用户点击导入时 | optional history；浏览器此权限并非按域缩窄，说明范围，落库立即筛选 |
| 不申请 | tabs、cookies、identity、debugger、webRequest、bookmarks、topSites、all_urls、unlimitedStorage |
| 旧chat.openai.com | 只做受支持历史URL别名；不需为此注入旧域 |
| 内容脚本 | 动态注册、ISOLATED、top frame、白名单区域；撤权后停止/卸载观察 |
| 新标签页 | chrome_url_overrides.newtab；不设置浏览器搜索引擎或首页偏好 |
| MV3 | 标准chrome.*、模块service worker、打包本地代码、无远程JS、无iframe |
| 无痕 | incognito:not_allowed；不捕获无痕访问 |
| Edge | 复用Chromium API适配层，检查能力字段；独立侧载与重启验收 |

tabs命名空间的多数创建/导航操作无需tabs权限；精确host权限足以访问匹配站点标签的敏感字段。[S3] Edge官方说明兼容Chromium扩展API并要求实际侧载测试；“Chrome通过”不代表“Edge通过”。[S6]

若其他扩展或企业策略占用了新标签页，说明由用户在浏览器管理；保留扩展图标打开Start，不争抢设置、不自动禁用其他扩展。

## 5. 持久性及失效

service worker可能退出，所有业务状态写IDB；当前浏览器session的随机ID与绑定放storage.session，浏览器重启/扩展Reload使旧pending intent不能被消费。[S4][S7] IDB没有自动云同步；清除普通浏览记录不等于清除扩展数据，卸载扩展可能失去本地数据。[S4]

QuotaExceededError、迁移失败、权限拒绝、未知DOM、身份端点401/挑战、历史范围饱和均产生有界失败状态。现有目录继续可读；不清库、不退回不可信归属、不无限spinner。

## 官方与主源链接

- [S1 Chrome history](https://developer.chrome.com/docs/extensions/reference/api/history)
- [S2 Chrome webNavigation](https://developer.chrome.com/docs/extensions/reference/api/webNavigation)
- [S3 Chrome tabs](https://developer.chrome.com/docs/extensions/reference/api/tabs)
- [S4 Chrome storage and cookies](https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies)
- [S5 Chromium历史遍历反例](https://chromium.googlesource.com/chromium/src/+/cea40aeb03ae04b5194063c8bc0e551cd51ebb0a/content/browser/renderer_host/navigation_controller_impl_browsertest.cc)，检索history.go(-1)。
- [S6 Edge移植指引](https://learn.microsoft.com/en-us/microsoft-edge/extensions/developer-guide/port-chrome-extension)及[API支持表](https://learn.microsoft.com/en-us/microsoft-edge/extensions/developer-guide/api-support)
- [S7 Chrome storage.session](https://developer.chrome.com/docs/extensions/reference/api/storage)及[worker生命周期](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)
- [S8 Chrome页面覆盖](https://developer.chrome.com/docs/extensions/develop/ui/override-chrome-pages)
- [S9 Chrome permissions](https://developer.chrome.com/docs/extensions/reference/api/permissions)
- [S10 Chrome content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)
