# M0 · 本地能力与正式来源分开生效

合同修订：**2026-11-02-local-first，用户已批准**。以 [统一修订合同](free-v1/10-LOCAL-FIRST-AMENDMENT.md) 为当前权威；其覆盖原M0共同前置门。本地工作空间代码状态 `LOCAL_WORKSPACE_READY`，不代表真实原生来源或完整 `FREE_V1_ACCEPTED`。

| 能力 | 当前生产语义 | 仍保留的边界 |
|---|---|---|
| 本地历史时间组织 | UNKNOWN按有效browserLastVisitAt进入历史浏览日期窗 | 不推账号/PROJECT/NONE，不回填活动 |
| Start本地主动打开 | 真实手势→onCommitted绑定→onCompleted+精确frame/document→原key OpenDay | 导航失败/错误目标/重放拒绝，提交前权限与事务内captureEnabled复核；不声称阅读或自动设置reachable |
| 局部Project候选 | 严格局部ID、名称、成员信息挂在原未分配UNKNOWN记录 | 候选key隔离Profile/session/binding/observationId/projectId，不跨观察合并，不写正式Project资产 |
| 已确认账号资料库活动 | 继续要求当前owner与expectedScope匹配 | 不能把本地账号未知活动写入已确认账号库 |
| 正式账号/current context | 尚无本次新的真实来源通过证据 | roster/default/null不自证当前空间 |
| 正式Project/NONE | 未取得正式来源的记录仍UNKNOWN；可信正式证据可逐条生效 | 候选/标题相似/缺badge/普通URL不成为认证归属 |
| 原生链接、地址栏活动 | 独立未启用入口 | 不再阻断Start自身入口 |

最少实机验收是保留已有目录并看日期窗、一次真实Start打开与同日去重、刷新不记、自然Project浏览可否形成候选、关闭重开后保留。已有source-check是历史辅助材料，不是本地工作空间必经步骤，也不在本轮新增诊断器。

以下保留旧基线来源事实、固定源码和历史失败原因以便追溯；其中“独立正文加载来源”“全部门先行”“唯一下一步为结构诊断”的旧产品裁决均已被本修订替代。当前字段的状态以以上表格、实施状态和同SHA验收记录为准。

---

# 旧来源研究记录（669f756基线；历史资料）

合同：`VAIWL-START-FREE/1.0`。日期：2026-11-02（Asia/Shanghai）。

**历史基线状态：SOURCE_GATE_BLOCKED；此状态不再是本地功能的总开关。** 已实现无正文候选读取、严格 Project DOM 解析和失败边界；没有取得 Start 自身真实账号、当前空间、正向 NONE 或当前会话抵达的实机认证。本文件不能替代与最终 build SHA 绑定的验收记录。

## 本轮恢复结论

从 `a6697b0496f9adaef17495b786712ad50fa49e65` 修复来源接线与生命周期，profile revision=2；四项真实来源仍 BLOCKED。生产构建新增一次性 `source-check.html` 核验入口，步骤与停止条件统一以 [M0_CONTROLLED_CHECK.zh-CN.md](M0_CONTROLLED_CHECK.zh-CN.md) 为准。本会话未连接用户真实 Mac，未发生实机账号/空间/归属/抵达认证。

新增诊断只返回固定结构、失败码和本轮 HMAC 关联别名。原始身份不跨 IPC；随机别名不能变成 scope。后台再次校验每个嵌套字段、run/capture、权限、文档和路由；导出不含随机密钥。诊断与业务来源门完全分开，既有五个能力开关继续 false。

Start 路径的代码断点已修复：首次真实导航持久绑定目标 document/route；没有独立已加载对象来源时仍不调用 commitArrival。Project SPA 现在能触发严格 parser，并对同一固定结构做最多5次、总计约2.22秒的有限 hydration 检查，不拓展选择器。账号状态按路由重新读取，BFCache 恢复重新 HELLO，不由恢复本身产生打开意图。

## 已实现与生产开关

| 能力 | 已实现内容 | 本候选实际状态 |
|---|---|---|
| principal 候选 | 两条固定 session-only GET、响应校验、RAM 内 token 生命周期 | 可在连接授权后读取枚举结果；候选身份不跨 IPC，不建立 scope |
| 当前 context | 保留独立能力门 | BLOCKED；roster/default/null/单一 personal 均不认定当前空间 |
| PROJECT 候选 | 固定原生 Project 标题与成员 DOM 结构解析 | 纯候选函数，`projectMembership=false`；不写生产原生归属 |
| 正向 NONE | 保留独立能力门 | BLOCKED；`positiveNone=false`，无来源选择器启用 |
| 当前会话抵达 | 保留独立能力门 | BLOCKED；`arrival=false`，URL或侧栏链接不算抵达证明 |
| 地址栏活动 | 保留独立能力门 | 未做双浏览器反例验收，`addressBar=false` |

全部能力开关为打包常量；没有网页、URL 参数、运行时配置或合成数据开启可信能力的通路。候选读取不产生 verified/scope/NONE/OpenDay。未知账号目录可以导入、搜索和打开，但不能宣称普通会话已正确划入 NONE 或准确记录主动活动。

## 身份读取的精确边界

来源为原 VAIWL 固定提交 `1903b00f774b4fd7f3d15b3669878c32e2c7a9c8` 的 `src/host/isolated-session-reader.mjs` 与 `src/host/session-identity.mjs`，独立适配到 `src/collectors/chatgpt/identity.ts`，没有导入完整 session-provider、conversation 或消息解析链。

只允许以下固定请求，均为同站 ISOLATED 执行：

1. `GET https://chatgpt.com/api/auth/session`，最多 256 KiB。
2. `GET https://chatgpt.com/backend-api/accounts/check/v4-2023-04-27`，最多 1 MiB。

请求固定 `credentials:include`、`cache:no-store`、`redirect:error`、JSON Accept；第二条使用第一条的内存 token。响应必须是精确 URL、200、application/json，无挑战／重定向。headers 与流式字节均有限额，UTF-8 严格解码，6 秒单调时钟截止，取消、时钟倒退、过期或失效结构均拒绝。传输未清理完不会允许同一 reader 并发重入。

`readSessionStatus()` 检查固定站点 origin，仅返回 `{state, code, profileId}`。内部候选的 principalId、contexts、expiresAt 不能送入 runtime 消息或持久化；token、邮箱和原响应不进入返回值、日志或数据库。候选成功的唯一对外状态是 `current-context-unproven`，不是账号核验通过。

`accounts.accounts[key].account.account_id` 是 roster 身份；别名 default 只有与 canonical 条目完全一致才忽略，不能选择当前空间。孤立 `default.account_id=null` 返回 `default-null-context-id`。不可访问／停用条目不进入候选 roster。未证明 current context 时，不生成 verified scope。

## Project 解析的精确边界

来源为同一固定提交的 `src/host/native-surface-boundary.mjs::observedProjectAssociation/observedProjectListTitle` 与观察 profile。新实现只保留限定结构与 title-only 读取，去掉宿主挂载、正文区域、输入与布局修改依赖。

- exact Project route + 唯一可见 Project boundary。
- 唯一 `h1 > button` 标题，只接受直接文字或唯一纯 SPAN。
- 当前选中 tab 和 panel 的双向 IDREF 必须各自指向唯一节点。
- 成员结构为 panel → SECTION → OL → LI → A，最多 256 个。
- 至少一条成员 URL 重复当前 Project container；任何冲突 container、隐藏／过期 panel、错误结构或重复会话 ID 都拒绝。
- 成员名只取 wrapper 的第一个 text-only DIV。第二个 DIV 可能是消息预览，永不读取；失败时不回退整行、body 或其他文本。
- 旁边历史列表的会话不参与本 Project 的成员证明。

即使候选解析成功，仍缺独立当前 scope 与实机认证，不能写入 PROJECT。没有 badge、未发现成员、普通 `/c/` 和未知/null 字段都不能写 NONE。Project 列表也不能证明某个 conversation 页面当前已经加载成功。

## 本轮离线验证

运行：`node --import tsx tests/unit/collectors.test.ts`。

该套测试覆盖固定请求及输出白名单、default/null 和别名冲突、401/挑战/重定向/MIME、流式超限/非法 UTF-8、取消/过期/单调时钟倒退、origin 与错误脱敏、Project 名与成员名分离、预览/body getter 禁读、13 种结构／关系负例、普通会话不得产生 Project/NONE。

DOM 使用 jsdom；由于 jsdom 没有排版引擎，测试显式提供受控 geometry，再验证 hidden/style/aria 与结构边界。**这不是实际 Chrome/Edge 可见性、真实 ChatGPT 或真实账号测试。** 测试通过不改变上述生产开关。最终 test 数量、build SHA 和 CI 结果以同提交验收记录为准。

## 最小 Mac 实机验证

只执行 [M0_CONTROLLED_CHECK.zh-CN.md](M0_CONTROLLED_CHECK.zh-CN.md) 中的一组操作。新入口不要求用户提供开发者工具输出。只有真实新证据支持语义来源后，才允许修改固定 profile；当前结构/匿名对照结果本身不能开启任何门。

## 未解阻断与唯一工程裁决

共同缺口是“允许读取范围内，具有明确语义、当前对象身份和生命周期的独立元数据见证”。A缺当前空间；B还依赖A及现场成员结构；C缺正向NONE；D缺独立已加载会话身份。不能用URL、默认账号、用户声明、列表缺失或AI推断补齐。

| 路径 | 判断与停止条件 |
|---|---|
| 继续原生页面证据 | 唯一推荐的下一步是本包的一次受控结构发现；已有严格P parser可复用，但A/C语义仍须独立证明。没有新有效字段/状态即停止，不扩大selector/日志。 |
| 寻找合法稳定元数据能力 | 只接受已证只含允许字段、明确当前scope和归属语义的能力；未发现已获准可直接接通的新能力，不猜端点、不请求完整conversation。 |
| 调整产品范围 | 可以单独决定受限目录产品的范围，但这将改变用户目标，不能由本轮擅自执行，更不能重标完整Free V1通过。 |

**推荐：保留已修复代码，完成一次受控原生元数据核验；若仍无语义来源，停止页面试探，将完整Free V1持续保持BLOCKED，等待合法的明确元数据能力或用户另行决定范围。** 不投入下一轮猜选器工程。

## 源码证据

完整固定 URL 和双哈希在既有 `docs/free-v1/evidence/source-manifest.json`。本轮重新读取的上述文件均匹配该清单。原 PR #16 在本轮核对为 `11aa3622d215afe7482ec3ad1cf83ca49332ab1f`，其相对设计继承基线的新增是 Project 挂载拒绝诊断，没有补齐 current context 或 NONE。原仓保持只读。
