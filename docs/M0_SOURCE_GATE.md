# M0 · 真实来源门

合同：`VAIWL-START-FREE/1.0`。日期：2026-11-02（Asia/Shanghai）。

**状态：SOURCE_GATE_BLOCKED。** 已实现无正文候选读取、严格 Project DOM 解析和失败边界；没有取得 Start 自身真实账号、当前空间、正向 NONE 或当前会话抵达的实机认证。本文件不能替代与最终 build SHA 绑定的验收记录。

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

准备已授权浏览器和用户自选合成对象：Project P 内 C、普通无项目 N、同名 Q，以及另一账号／workspace。不要使用私人正文取证，不自动打开菜单或批量打开聊天。先记录候选完整 build SHA、浏览器版本、系统版本、适配器 ID 和权限状态。

1. 侧载同 SHA 候选；从 Start 点击连接。确认只请求 ChatGPT 的可选权限。身份诊断只记录固定失败码，不输出原 session JSON、邮箱或 token。
2. 在已打开的合成页面确认 principal 稳定；同时取得独立当前 context 的真实语义证据。roster、昵称和 default/null 不足。切 A→B 后旧 A 文档必须不能继续写入。
3. 打开 P 的原生项目主页。只验证限定标题、成员、tab/panel 关系。P 的成员 C 成立；旁边同名 Q 的历史链接不得归 P；不同 Project 名和会话名不能互换。
4. 正向 NONE 只允许用户自然打开的原生 UI 明确表达当前对象无项目，或现场证明只含允许字段、且语义明确的窄 metadata 来源。若没有此证据，保持 BLOCKED；不能猜新 URL、解释 null 或放宽选择器。
5. 对 active 文档和确切会话路由取得不读正文的当前标题／对象标识证据，然后才实现并启用抵达 profile。一次 Start 点击及一次原生会话点击应各有唯一意图—抵达链；刷新、恢复、tab 激活、脚本导航必须零活动。
6. Chrome 与 Edge 独立执行；一个浏览器或 headless Chromium 通过不能代表另一个。记录每条判定的 PASS/FAIL/BLOCKED/NOT_RUN 和确切 SHA。

每种候选来源最多一次结构发现，只有明确新事实时再做一次修正验证。无新证据则停止试探并保存准确失败原因。公开证据仅含合成/脱敏断言、固定状态码和事件 ID；不要上传真实标题、账号标识或页面快照。

## 源码证据

完整固定 URL 和双哈希在既有 `docs/free-v1/evidence/source-manifest.json`。本轮重新读取的上述文件均匹配该清单。原 PR #16 在本轮核对为 `11aa3622d215afe7482ec3ad1cf83ca49332ab1f`，其相对设计继承基线的新增是 Project 挂载拒绝诊断，没有补齐 current context 或 NONE。原仓保持只读。
