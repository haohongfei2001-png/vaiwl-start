# 数据合同与状态转换

> **当前有效修订：2026-11-02-local-first，用户已批准。** [统一修订合同](10-LOCAL-FIRST-AMENDMENT.md)覆盖原 M0 全局前置门：本地时间组织、Start 主动打开与局部候选项目可独立运行；账号隔离及正式原生归属证明仍保留。`LOCAL_WORKSPACE_READY` 不等于 `FREE_V1_ACCEPTED`。

规范类型见 `contracts/free-v1.ts`。TypeScript 不能替代运行时校验：跨上下文消息、未来备份文件和网页字段全部要精确字段白名单、长度/URL/日期限制、判别联合校验。未知额外字段拒绝；输入不能自己声明 verified、scope、source authority。

## 1. 身份与主键

同一已证账号的主键是 `(provider, principalKey, contextKey, conversationId)`；Project 同理使用 projectId。四个分量采用有长度边界的编码再哈希，禁止字符串直接拼接歧义。哈希用于稳定键，不声称能匿名化数据。

未确认账号的记录使用 `(localProfileKey, provider, conversationId)` staging 主键。它仅合并该浏览器目录中的相同 URL 身份候选；不证明历史访问属于同一个账号。后续证明账号 A 后新建 A 的 scoped record，建立 CandidateResolution 链接，不把过去所有访问、活动或归属迁给 A。若账号 B 也存在同一 ID，两条 scoped record 保持独立。

同名不能合并；完整浏览器历史 item id、tabId、页面标题、Project 名、URL slug 都不是业务主键。浏览器 session 内 tabId 是瞬时路由标识，重启后不得继承。

## 2. 允许保存的字段

允许：稳定会话与项目 ID、受支持 URL、标题、账号/context 的本地稳定键与必要显示标签、明确成员关系及精简来源见证、活动日期/时刻、浏览器导入时间与覆盖、网站快捷项、用户界面状态。标题最大512个Unicode标量，URL最大8192字节，导入标签按纯文本渲染。

禁止：用户/AI 消息、输入框、草稿、完整 HTML、DOM 外层快照、完整接口响应、Cookie、持久 token、邮件地址、附件、消息预览、通用按键记录。身份端点若返回凭证，只在受控读取闭包内短暂使用并丢弃；不进消息通道、日志、备份或 IndexedDB。不请求完整 conversation detail 后再声称“只保留元数据”。

## 3. IndexedDB v1

数据库 `vaiwl-start`，version=1。service worker 为业务写入唯一入口；新标签页可通过受控查询读，内容脚本无数据库读取能力。多新标签页并发写由 IDB 事务 + revision CAS 处理，不靠一个可能被销毁的内存 mutex。

| store | keyPath / 主键 | 索引 | 说明 |
|---|---|---|---|
| scopes | key | state | 只含已验证 principal/context；未分配不是假账号 |
| conversations | key | [ownerKey, conversationId] unique；[ownerKey,lastActiveAt]；[ownerKey,membershipState]；[ownerKey,projectId] | 实现可将派生索引字段平铺，必须和规范嵌套字段同事务更新 |
| projects | key | [scopeKey,projectId] unique | 只保留 observed-only 成员覆盖 |
| witnesses | id | [scopeKey,sourceDomain] | 仅当前字段来源及有限冲突摘要，不存原始数据 |
| candidateLinks | [candidateRecordKey,scopedRecordKey] | candidateRecordKey | 逐条链接，不转移旧历史所有权 |
| openDays | [recordKey,timeZone,localDate] | [recordKey,lastOpenedAt] | 每会话每日一个活动单位 |
| openIntents | id | state；expiresAt | 持久的短期两阶段意图，默认60秒有效 |
| shortcuts | id | [order,id] | pinned仅决定折叠可见，所有项共用用户顺序 |
| tombstones | key | removedAt | 防止本地删除后被后台重导入 |
| importJobs | id | state | 可中断、恢复、覆盖不完整可见 |
| settings | singleton key | 无 | 资料库时区、显示状态和schemaVersion |
| revisions | singleton key | 无 | 当前提交版本与schema迁移版本 |

`storage.session` 只放随机 browserSessionId、当前绑定、scopeEpoch 和短缓存；不是业务目录。`storage.local` 只用于少量启动/迁移标记。没有 storage.sync。升级必须原子迁移；失败保留旧库、报可操作错误，禁止清空库重试。

书面规范中的 `[ownerKey,lastActiveAt]` 对应平铺派生字段：ownerKey 为 scope key 或 `unassigned:<localProfileKey>`；无活动不进入时间索引，用稳定 rank 查询无日期部分。绝不以 null/undefined/boolean 作为不合法 IDB key。

本次修订不改变数据库 version/store/index。会话允许可选 `localProjectCandidate`；已有 v1 记录缺少该字段可直接读取。该字段 key 隔离 Profile/session/binding/observationId/Project ID，不进入正式 projects 表；形状与边界见修订合同第5节。`browserLastVisitAt` 仅供待确认日期投影，仍不进入活动索引。

## 4. 归属归约

| 输入与前态 | 后态 | 强制规则 |
|---|---|---|
| 只有历史 URL / 标题 | UNKNOWN / scope-unverified | 可按浏览日期组织，不推 NONE、不绑定当前账号、不造活动 |
| 未分配记录 + 可靠局部 Project 元数据 | UNKNOWN + localProjectCandidate | 独立候选卡，原 key 不变，不授予正式 PROJECT/scope |
| 已证scope + 会话ID，没有成员证据 | UNKNOWN / no-membership-source | 保留打开与查找 |
| 已证scope + 当前正确P成员区域或已核验窄metadata | PROJECT(P) | 必须匹配会话ID、P ID、scope、文档/route epoch |
| 当前对象明确且经实测有NONE语义的字段/原生状态 | NONE | missing/null/无badge不够 |
| 已确认P后遇到弱/缺字段观察 | 保留上次已确认归属 | 不把“没看到”升级成移出；详情保留confirmedAt |
| 同一当前对象明确从P移到Q/移出 | PROJECT(Q) / NONE | 可比较新证据才替换，原C不复制 |
| P/Q等强证据不可比较或同版本冲突 | UNKNOWN / conflicting-evidence | lastConfirmed仅作历史说明，不继续当最新归属分组 |
| 旧tab、旧document、旧scopeEpoch迟到 | 不更新 | 不按到达时间抢占 |
| 列表中不再出现某对象 | 不删除 | 不把partial库存当完整集合 |
| 明确来源撤销且无其他有效见证 | UNKNOWN / source-revoked | 历史入口保留；账号混淆时禁止写入 |

归属是“上次确认的原生事实”，不是保证当前云端实时状态；离线缓存允许展示，详情显示核对时间。时间流逝本身不制造移出或删除。正向新的可靠变化触发重新分组。UNKNOWN 不能藏在正式 NONE 或旧 P 中；可独立按浏览/活动日期组织，或在有局部证据时进入显式候选项目。

## 5. 主动打开状态机

`issued → navigation-dispatched → arrived → committed`；任意未提交态可转 rejected/expired。

1. 扩展可信界面或隔离内容脚本记录受信click/auxclick/键盘激活的目标。只检查事件类别及目标，不记录键入字符。worker 校验 sender.id、sender.tab、frameId=0、documentId、来源URL与scopeEpoch。页面提供的 isTrusted=true 字段不自证；受信事件检查发生在实际监听器里。
2. worker 生成 operation/intent ID，以本机接收时间建立 issuedAt、issuedTimeZone、issuedLocalDate 和60秒截止，先写入IDB再派发 Start 自有导航。原生链接不拦截真实ChatGPT行为，只做意图与随后导航关联。Start自有导航按修饰键调用最小tabs/windows操作，无批量开页或tab重排。
3. 限定导航链中匹配 browserSessionId、targetTabId、documentId、routeEpoch、精确会话ID。原生中键新tab使用 createdNavigationTarget 的 source tab/frame 与唯一目标匹配；有多个可匹配意图时不猜，记 ambiguous-arrival。同tab SPA 需要route epoch加一后的目标匹配。不能只看URL含某字符串。
4. 当前 Start 路径由首个有效 onCommitted 绑定精确 top-frame document/route，再由 onCompleted 及当前 frame/document/精确会话 URL 确认浏览器导航完成。导航错误、错误目标、登录页重定向、旧文档与被动恢复拒绝；不要求原生标题/正文完整加载来源。confirmationBasis 为 browser-navigation，只表示主动打开。同 URL 应用错误/权限提示仍可能完成导航，因此不能据此设置 reachable 或声称阅读完成。未分配记录可写本地活动；已确认 scope 仍要求当前 owner 证据且 expectedScope 不匹配拒绝。
5. 当前 browser-navigation 路径的 targetRecordKey、resolvedRecordKey、committedRecordKey 指向原未分配记录，不迁移已有活动。提交事务再次检查 captureEnabled，权限/session/epoch变更使旧事件失效。以下逐条账号解析规则仅用于有真实独立 scope 见证的正式路径，不由本地候选或浏览器 URL 自动触发：请求targetRecordKey保持不变。若expectedScopeKey非null，抵达必须匹配该scope；若原请求为未分配候选且抵达证明A，resolvedRecordKey置为A的scoped key；身份仍未证则保持staging key。IDB一个事务创建/更新resolved record、必要时建CandidateResolution、原子消费intent并写committedRecordKey、仅向resolvedRecordKey upsert一条openDays、更新其conversation.activity、增加revision。本次新事件只落一处；候选旧访问/旧活动绝不搬到A。相同intent重放不重复；两tab同日同时打开只有一个活动日，lastOpenedAt取较晚有效时间。
6. 日期在签发时由资料库IANA时区和issuedAt计算并冻结在issuedTimeZone/issuedLocalDate，抵达期间设置变更不得改此键，跨午夜抵达仍归手势发生日；事件若在60秒内跨午夜，不能归导航结束日。时钟后退/超大跳变导致关系不可信时拒绝该活动，不借历史lastVisitTime补算。browser webNavigation.timeStamp 只与同来源时间相互比较，不能和Date.now混算延迟。
7. 浏览器重启或扩展Reload使 browserSessionId 更换；旧intent不能被复用。worker单独休眠/重启保留session值与未过期intent，可继续完成。过期与已消费记录在下次入口/事务批量清理；不保活worker。

原生链接活动当前未启用；未来只对已核验会话导航控件启用，不在整个document上提取任意链接或正文。点击外部普通网页、网站快捷项不进入本活动管道。

## 6. 地址栏分支

仅 fresh `webNavigation.onCommitted`，主frame，documentLifecycle=active，前台活动tab且窗口focused，`from_address_bar`，transitionType在已验typed/generated/keyword白名单，且无 `forward_back`、client/server_redirect、reload/start_page。

全部满足后仍需相同目标/身份抵达确认；使用接收时间作为本地活动起点，不伪造鼠标手势。该adapter默认禁用，Chrome与Edge负例实测通过后才开启。单纯forward_back不能启用：Chromium脚本history.go也能带该qualifier，并可能继承from_address_bar。

## 7. 历史导入

用户明确操作后请求可选history权限。两个域查询各自设置startTime/endTime/maxResults（默认100和24小时不适用），先导入最近90天，再可继续浏览器可读的更早范围；首次也可选全部可读取范围，范围必须可见。候选URL严格检查https host、支持路由、有效会话ID、无凭证/危险编码。`chat.openai.com/c/ID`仅作为旧域已知会话别名规范化；/share、临时聊天、登录、首页、GPT商店及未知路径不混入私有会话。

批大小500，时间范围出现满页则二分；边界重叠并按规范化候选身份去重，避免同毫秒漏项。不假设lastVisitTime是分页游标。最小时间片仍饱和、API异常或用户取消标PARTIAL，不宣称全量。getVisits仅用于分辨isLocal/同步来源与解释覆盖，不能把typedCount/transition当历史主动证明；isLocal缺失保留来源未知。纯同步记录默认不导入，可在导入选项中明确包含；无论何者都不生成OpenDay。

每批查询先在内存过滤非ChatGPT URL，再落库；不存其他网站标题/URL或访问次数。进度与pendingIntervals同事务提交。导入页关闭后允许暂停，下一次打开继续；不后台爬全账户、不自动开几百个聊天。onVisited先于页面完成，只能先建候选，不能据此确认可达或当天活动。

## 8. 删除与未来共享边界

V1不实现备份/恢复/跨扩展数据同步；PortableCatalogV1仅保留未来版本化交换方向。以后实现时仍须排除token/当前授权/intent/tabID，导入文件不能以verified/evidenceId自证活体身份，也不能把导入历史活动当成本机刚发生的新打开。具体恢复交互和迁移策略属于后续合同。

删除本地记录和墓碑同事务，撤销操作恢复原记录与其墓碑状态。已存在CandidateResolution的候选不得在当前资料库因历史重导入而重新露出被删除的A记录；投影与再次解析均检查A墓碑。staging自身删除则抑制该候选重导入；A墓碑不抑制B账号同ID，B必须独立验证后才能显示。用户明确“恢复收录”才解除对应墓碑。权限撤销停止采集，不悄悄删历史。未来与VAIWL本体共享只能通过另行授权、版本化的导入/导出合同；V1无externally_connectable，无跨扩展读库，无后台双向同步。未来Pro存独立overlay与recordKey引用，不能改nativeTitle、membership或activity。
