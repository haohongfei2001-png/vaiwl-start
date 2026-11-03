# VAIWL Start — 原 VAIWL Free 继承审查

审查日期：2026-11-02（Asia/Shanghai）。只读基线：`haohongfei2001-png/Virtual-AI-Workspace-Layer` PR #16，HEAD `1903b00f774b4fd7f3d15b3669878c32e2c7a9c8`，Open / Draft；base `docs/vaiwl-v28-core-mechanisms-20261012`。未修改原仓库，未运行测试。本结论由本次取得的固定 SHA 文件与精确评论支撑，不使用旧记忆代替源码。

## 1. 决定性继承结论

1. 原 Free 的“窗口”在数据层主要是 ConversationRef/会话行，浏览器真实标签不是其持久身份。真实 Project 以 `(scope, nativeProjectId)` 标识，Conversation 以 `(scope, nativeConversationId)` 标识，同名不合并。
2. 活跃并非次数、频次或指数衰减得分。`projectFreeActivity()` 形成时间证据决策，`aggregateFreeActivity()` 按有效最新活动时间降序；父 Project 继承已确认成员中的最新决策。原代码已有独立 `local-recent-use`，不能把打开转换为 UserSendEvent。
3. 默认 30 天的计算可直接继承纯函数；Start 对“主动打开、每日去重、无项目按日生成虚拟窗口”的新语义是用户本轮明确裁决，须以独立 OpenActivity 数据合同实现，不能假称原仓库已经实现每日去重。
4. PROJECT / NONE / UNKNOWN 三态及证据分层必须保留。`/c/`、无 projectId、未命中成员列表都不能证明 NONE。
5. 原视觉可继承：白底、中性层次、项目卡轻边界、下属会话分支线、紧凑行、左侧展开旧窗口、右缘上下区间入口。新标签页无需移植原 ChatGPT 宿主的侧栏、读取区、返回四格、popover/flow 挂载与掩蔽逻辑。
6. 原真实 Project 界面挂载尚未通过，不能继承为成功。原 STATUS 最新节已承认 Project 原生入口/身份和两条成员路径有真实证据，但 `frame=0 / return=0`，与数据发现层分开；NONE 仍 BLOCKED。

## 2. 30 天机制：确切公式与交互

来源：`src/data/free-time-policy.mjs`，`src/navigation/projection.mjs`，`docs/CORE_MECHANISMS_V2_8.md` §4，`docs/CORE_FLOW_V2_7.md` §2–3。

- `localDay(instant, Z)` 通过 IANA 时区格式化出当地年/月/日，再编码为日期序号。不是直接拿 UTC 日期，也不是减 30×24 小时。
- `createFreeViewSession({now,timeZone,H=30,policyRevision=0})` 返回冻结 `{H,T,Z,policyRevision}`。
- `freeSegmentFor(value,session)`：若无效或未来日期返回 null，否则 `floor((T − localDay(value,Z))/H)`。
- `freeWindowFor(k,session)`：`end = T+1−Hk`，返回 `[end−H, end)`，即 `W(k)=[T+1−H(k+1), T+1−Hk)`。
- H 的现有手动选项 `{7,14,30,60,90}`，默认 30；本轮 Start 可把 V1 固定 30 作为冻结界面口径，但不得另造自然月算法。全库密度自动 H 在原项目已明确后置，不是首版需要重建的门槛。
- 当前段 k=0 没有向上按钮，也不保留禁用占位；下箭头到 k+1，上箭头到 k−1。空段不暗跳；普通滚轮、PageUp/Down、方向键、浏览器 Back/Forward 不被劫持为时间翻页。
- 旧历史 ViewSession 固定 H/T/Z；跨午夜或另一标签改偏好不重新解释旧 k。安全重新进入时可建立新 Session，明确手动换 H 按对象/日期锚重定位。
- Project 在一个显示段只出现一次，segment 取最新有效成员；其旧会话仍在父卡内部展开，不能把同一 Project 拷贝到多个历史段。
- 父卡 `current` 是与父 segment 相同的成员；`old` 为 segment 更大的成员；`unknown` 为 null。无时间对象不硬塞到最老段。

自动 H 历史算法仅记录来源以免开发者误造：`loss(n)=2*max(0,n−10)+max(0,5−n)`；按真实 Project ID 去重计数；候选先最小 loss，平局保当前 H，否则最小 `abs(log(H/Hcurrent))`，再靠近 30。收益门槛 `max(2,0.25*oldLoss)`，从零带回对象的门槛 1；全部同样稀疏/拥挤保当前 H。最多每七当地日评估、两次同方向建议、十四日最短驻留、安全进入才应用。此为已实现后置算法，Start 不应因“保留活跃算法”误扩首版为自适应系统。

## 3. 活跃与排序：源码行为

来源：`src/data/free-activity.mjs`。

`projectFreeActivity(snapshot,evidence,session,now)` 要求 evidence scope 与 snapshot scope 相同。严格发送事件必须是核验本人/角色、committed new-send、有 message/branch、有效原始时间；冲突不挑较晚值。日期区间跨段、旧活动覆盖不完整等形成 provisional；这些严格发送链不是 Start Free 无正文版的输入。

`local-recent-use` 来自 codecVersion 3 的可信源，`usedAt` 必须不晚于 observedAt/当前时间。若它比现有候选活动新，则生成独立 provisional、reason=`local-recent-use`；没有 sentAt/ACK。原模型每 C 仅最新使用快照，重复 action 不续；没有每天一事件的现成实现。

`aggregateFreeActivity()` 的比较键是 `[candidateDay===null, parsed(candidateTime)||0]`，有日期在前、时间降序。相同时间/无日期时 comparator 返回 0，保输入稳定次序；之后仅在同 source/domain/batch 且相同时间键的槽位中按 `nativeOrder.rank` 排序，避免不可传递比较器。规范文字提及稳定 ID，Start 必须为自己的输入指定稳定 ordinal/ID 作最终平局，不假称原函数本身已按 ID 排序。

父 Project 对已确认成员做相同排序、选首个有日期成员。无日期成员不能抹掉已有正向近期证据。空 Project 不制造活动；若成员时间不充分，父卡旧历史结论保 provisional。NONE 按每个 C 自身活动投影；UNKNOWN 独立可达，不能给任何 P 贡献活跃。

Start 推荐适配：保持原纯分段/父卡聚合/稳定排序，输入改为独立 `OpenDay` 与 `lastExplicitOpenedAt`，明确每天去重的单位是 `(scope,C,calendarDay)`，次数不参与新评分。是否一天内后续主动打开更新 lastExplicitOpenedAt 由 Start 正式合同统一决定，不从原代码推断；绝不补送消息事件或补历史“主动访问”。

## 4. 数据模型与证据合同

来源：`docs/DATA_MODEL.md`，`src/data/free-projection.mjs`，`src/data/native-facts.mjs`。

| 对象 | 可继承合同 | Start 需要适配 |
|---|---|---|
| Project | exact native ID + scope；原名与路由是字段，名字不是身份 | 本地独立表，不从虚拟主题或日期窗口造 Project |
| Conversation | exact native C ID + scope；URL alias、原名/availability 分开 | 浏览历史未带 scope，须以未归属导入记录暂存，不能默认套当前账号 |
| Membership | PROJECT 正向成员证据；NONE 正向无项目证据；UNKNOWN 原因/lastConfirmed | 当前确认与 last-known 分开；冲突不可最后到包者获胜；用户视觉位置不能回写原生事实 |
| Native fact witness | source/profile/version/observedAt/revision/freshness/revocation | profile 声明本身不是认证；内容脚本不能自报 verified 后直接入库 |
| ViewSession | H/T/Z/revision 与展开/容量/anchor/scroll | 新标签页会话级快照与持久偏好分开，多页并发不能互改历史语义 |
| 活动决策 | 纯投影，可重算，不写回 membership 或原始事件 | 新 OpenActivity 是产品活跃，不冒称 ChatGPT 新发送/更新时间 |
| UNKNOWN 可达性 | 所有合法已知引用有搜索/独立区入口；无 spinner 无限等待 | 本地找已知标题/项目，不能承诺全 ChatGPT 历史搜索 |

`freeProjection()` 可读 last-known 事实但区分 current / last-known；缺失/过期/矛盾按字段处理。不存在“缺一个字段就删除整条”捷径；明确 unavailable/revoked 与未观察到分开。此实现依赖旧 native source/admission/schema，不能整函数脱离其 owner 直接复制并让 Start 伪造 admission。

## 5. 无正文可移植的数据读取链与真实阻断

### 5.1 已有纯 DOM Project 通路

`src/host/native-surface-boundary.mjs::observedProjectAssociation()` 使用：当前 exact Project route、唯一可见 Project 标题叶、选中 tab 与 panel 双向 IDREF、唯一节点、SECTION/OL/LI 成员结构、至少一条 member link 重复该 Project container；冲突 container 拒绝。`observedProjectListTitle()` 只读第一 text-only DIV 标题，明确不回退到预览、整行 textContent。`surface-discovery.mjs` 对该已证成员区域产出 PROJECT claim；旁边普通历史列表仅 UNKNOWN。

正式 `CHATGPT_OBSERVED_PROFILE` revision 12：`memberAssociation='route-linked-project-panel-v1'`、`liveVerified:false`、`regions.moveMenu=':not(*)'`。所以 profile 不是完成认证标签；P 结构实机局部证据也不升级整套 profile 为通过。空项目和未出现 container-linked member 的项目需保守候选/UNKNOWN，不能按标题合并。

`url-policy.mjs::createURLPolicy()` 能安全识别 `/c/<uuid>` 与 `/g/<container>/c/<uuid>`，后者 containerHint 本身不证明归属。原 Worker 给 Project 解析器配置 `^g-p-[0-9a-f]{32}$`；分享/临时/未知 query 单独处理。该模块可移植校验骨架，Start 的 `chat.openai.com` 旧历史别名需要单独显式合同，不能无脑替换主机或删除语义 query。

### 5.2 身份链是现成候选，不是现成生产成功能力

`src/runtime/session-provider.mjs::createSessionProvider().read()` 在无 current 参数时固定 GET `/api/auth/session` 与 `/backend-api/accounts/check/v4-2023-04-27`，credentials include、no-store、redirect:error，有 6 秒截止、响应 MIME/长度/状态检查。`sessionCredentials()` 取 user.id/expires/accessToken，token 只内存，不出结果；`sessionContexts()` 解码 account_id/structure/access。这些是 ChatGPT 内部端点，应作为版本化可失败适配器，不能称官方稳定 API。

roster 只证明可访问空间，不证明当前空间。`scope-authority.mjs::inspectIdentity()` 只有已经证实的 single-personal 语义或当前 request-context receipt 才选 context。默认 `extension/config.mjs` 明确 `chatgpt-context-unverified`、`singlePersonalDefault:false`。`sessionContexts()` 已有真实 cookie-only default.account_id=null 的拒绝类别，绝不能把 default 当稳定 ID。

当前正式 BrowserLocal `extension/content-entry.mjs` 强制 `currentBody:null, visibleNavigationOnly:true`，身份 reader 抛 `local-mode-has-no-identity-reader`；`host-worker-runtime.mjs` 同样禁止该模式网络身份源。BrowserLocal 私人库的人为解锁不是稳定 account proof。现有 `browser-request-context.mjs` 能旁观 `ChatGPT-Account-ID` 头，但其完整授权还依赖 exact conversation/body association，Project request profile 仅 loopback。因此不能把它整体当作 Start 无正文 scope 实现。

### 5.3 必须禁止直接移植的“metadata”链

`readCurrentConversation()` 实际 GET `/backend-api/conversation(s)/<id>` 完整 raw JSON（最多 8MiB），随后 `conversation-metadata.mjs` 抽消息/作者/时间/谱系。只保留元数据不等于没有读取正文；该链不符合 Start 本轮“不采集正文”，应从依赖图与生产请求白名单排除。

`project-metadata.mjs` / `conversation-directory-metadata.mjs` 只生成候选，注释明确 matching gizmo_id 也不发 PROJECT/NONE/时间/作者/预览声明；目录生产 provider 默认禁用。不能仅因存在 parser 宣称目录、归属和账号源已可用。

### 5.4 Codex 首个竖切的明确门

先做与界面挂载无关的最小来源实验：窄 session-only 身份读取 + 可验证的当前 context；真实项目成员标题/ID/P关系；正向 NONE 的自然菜单状态或经过真实验证且不含正文的纯 metadata。只读所需元数据，不加载完整 conversation endpoint、不主动打开菜单、不批量开页。取得稳定 scope 与 P/NONE 成功/反例才能启用生产 profile；来源失败以 UNKNOWN/未分配导入降级，不阻塞已存链接可达。

稳定账号与 NONE 未证明时，能交付来源受限候选，但不能宣布完整 Free V1。首页摆出两个漂亮分区不能替代这两项数据能力。Start 可完全绕开原宿主挂载阻断；这并不会自动解决身份与 NONE 来源阻断。

## 6. 视觉可继承项与宿主耦合

正式原件：`design/approved/v2.7/VAIWL_v2.7/prototype-v2.7.html`。白底 `#fff`、side `#f9f9f9`、text `#171717`、muted `#646464`、line `#e5e5e5`、hover `#f3f3f3`、selected `#ececec`；系统字体 14px/1.5；标题/图标/轻底的容器层次；branch 低对比分支线。最终样式多段覆盖，应阅读完整级联，不能只截第一个 CSS block。

正式交互：主页项目卡不整卡折叠，初始 5 行预览、+12 增量可达末尾；“显示更多”处理未显示完的近期行，“较早窗口”只处理真正旧成员，左侧箭头；未知时间单独语义，不作为旧项。原项目不常驻日期/来源/计数条。Start 的 NONE 今天/昨天/日期标题是本轮用户新增要求，不应拿旧“无日期条”误删必要按日窗口标签。

不能直接移植：ChatGPT native sidebar、workspace/sidebar 双 frame handshake、四格返回原生编辑器、flow wrapper/paint/50ms mask 证明、popover 释放、body selection/片段、消息 ACK、模型工具、原生输入风险控制、scope lease/Host 网络调度整套 UI。这些承担宿主改造成本，新标签页独立文档无需它们。

## 7. 可复用模块清单

| 分级 | 文件 / 函数 | 决策 |
|---|---|---|
| 直接移植纯函数并保来源 | `src/navigation/projection.mjs::instant/localDay` | 只摘纯日期函数；不要导入其中 synthetic 原型 `project/latestSend` |
| 直接移植纯函数并保来源 | `src/data/free-time-policy.mjs::createFreeViewSession/freeSegmentFor/freeWindowFor/relocateFreeSegment` | 默认30、固定会话；自适应策略不启用 |
| 适配后复用 | `src/data/free-activity.mjs::aggregateFreeActivity` | 保父子唯一段/稳定时间排序；换独立 OpenActivity 输入；不能依赖旧发送proof |
| 适配后复用 | `src/host/url-policy.mjs` | 保exact origin/path/query防混淆，补历史域别名与持久canonical合同 |
| 适配后复用 | `native-surface-boundary.mjs` 的两个窄 Project 函数 | 只读白名单标题/ID/关系，去宿主mask/挂载依赖；实机负面语义复验 |
| 候选，先竖切 | `session-provider.mjs` session-only read，`session-identity.mjs` | 拆掉完整conversation及消息解析import；需要真实账号/context证明 |
| 概念/断言复用 | `free-projection.mjs`, `native-facts.mjs`, DATA_MODEL | 三态、witness、last-known、scope/C主键、撤权/冲突，不能伪造旧admission |
| 视觉/交互规范复用 | v2.7正式HTML + INTERACTION_SPEC | 继承中性层次/紧凑行/旧项左展开，按新标签页重新布局 |
| 不移植 | content-session、adapter/controller挂载、frame owner、body/ACK/profile、旧完整IDB状态 | 新建精简Start模块；不携带原宿主未验收和无关百万行证据 |

## 8. 状态证据与读取边界

STATUS 文件 1.45MB：contents工具返回空，raw工具失败，最终 Git blob `7f316651098ba2f7024d17a07a04e864159e16b6` 返回解码正文；本次只审其顶部最新相关节，不审历史整本。最新段仍为 `SOURCE_FIXED / OFFLINE_PASS`、`Project NOT_VERIFIED`、`FREE_NOT_ACCEPTED / NOT_RELEASE_READY`；原生P入口与两成员路径局部成功、NONE阻断分别记录。

本次读取精确评论 6559537916（旧指纹停止回执）、最新页评论 6559778675 与 6559952204（同 SHA 隔离升级试验已执行成功，但不能替代 Mac）。固定 HEAD 与远程最新评论未包含用户在当前连续上下文给出的后续实机“有效 Reload 已解决指纹，仍 wrapper-paint 拒绝”回执；应把后者标为用户提供的新事实，不反写历史远程文档状态。

## 9. 固定来源入口

所有源码 URL：`https://github.com/haohongfei2001-png/Virtual-AI-Workspace-Layer/blob/1903b00f774b4fd7f3d15b3669878c32e2c7a9c8/<上述相对路径>`。

- [PR #16](https://github.com/haohongfei2001-png/Virtual-AI-Workspace-Layer/pull/16)
- [机制规范](https://github.com/haohongfei2001-png/Virtual-AI-Workspace-Layer/blob/1903b00f774b4fd7f3d15b3669878c32e2c7a9c8/docs/CORE_MECHANISMS_V2_8.md)
- [时间纯函数](https://github.com/haohongfei2001-png/Virtual-AI-Workspace-Layer/blob/1903b00f774b4fd7f3d15b3669878c32e2c7a9c8/src/data/free-time-policy.mjs)
- [活跃决策与聚合](https://github.com/haohongfei2001-png/Virtual-AI-Workspace-Layer/blob/1903b00f774b4fd7f3d15b3669878c32e2c7a9c8/src/data/free-activity.mjs)
- [正式视觉](https://github.com/haohongfei2001-png/Virtual-AI-Workspace-Layer/blob/1903b00f774b4fd7f3d15b3669878c32e2c7a9c8/design/approved/v2.7/VAIWL_v2.7/prototype-v2.7.html)
- [P成员窄读取](https://github.com/haohongfei2001-png/Virtual-AI-Workspace-Layer/blob/1903b00f774b4fd7f3d15b3669878c32e2c7a9c8/src/host/native-surface-boundary.mjs)
- [身份provider](https://github.com/haohongfei2001-png/Virtual-AI-Workspace-Layer/blob/1903b00f774b4fd7f3d15b3669878c32e2c7a9c8/src/runtime/session-provider.mjs)
- [身份schema](https://github.com/haohongfei2001-png/Virtual-AI-Workspace-Layer/blob/1903b00f774b4fd7f3d15b3669878c32e2c7a9c8/src/host/session-identity.mjs)
- [原STATUS](https://github.com/haohongfei2001-png/Virtual-AI-Workspace-Layer/blob/1903b00f774b4fd7f3d15b3669878c32e2c7a9c8/docs/STATUS.md)

本地缓存文件的 SHA256、Git blob SHA、固定源码 URL 见相邻 `source-manifest.json`。缓存仅本轮审查参考，不应把原整个仓库/历史证据复制进新 Start 仓库。
