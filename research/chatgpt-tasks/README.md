# ChatGPT 定时任务与 AI 结果接入裁决

日期：2026-11-04（Asia/Shanghai）。整体状态：**PARTIAL_INTEGRATION_VERIFIED**。

## 结论

原有 ChatGPT 任务、真实运行和实际 AI 正文已经通过本次会话的授权 Automations 工具读到；不是模拟数据，也不是只有任务名称。尚未验证普通 Chrome/Edge 扩展怎样持续取得同一来源。本轮交付隔离的数据处理 PoC、合成回归、真实输入回放记录及本裁决，不将内部工具的读取能力包装成生产扩展接入，不在正式首页增加模拟卡片。

本轮没有修改、重新运行、暂停或重建用户的现有任务。真实任务内容不进入本公开仓库。

## 1. 当前正式工程

读取的 main：`7dfba31cc8942d0c8c7a49c950697cf404dd1ea0`。已读 AGENTS.md、#16 全主题规范、#00 合同入口、#12 生活模式合同、manifest、首页、设置、采集、身份和存储实现。

- main 最新提交是 PR #5 的规范文档合并；不是主题运行时完成证明。
- 检查时 PR #6 是四主题 R1–R6 的未合并候选，head `5342d75acf9ea06225886755484779f9e0e6ccb3`，其 Actions run 41841947032 成功。
- PR #4 是向旧开发分支保留的设置候选；相同设置工作已通过 #2 进入 main。
- manifest 模板为 `contracts/manifest.example.json`。必需 storage/favicon/search，可选 history/scripting/webNavigation/bookmarks 和 chatgpt.com host；没有 alarms。
- 现有 IndexedDB `vaiwl-start` version 1 / 12 stores 不改。任务成果未来使用独立数据库。
- 首页/设置共享文件正在被 #6 修改，本研究文件独立，不与主题候选竞争写入。

基线链接：[main](https://github.com/haohongfei2001-png/vaiwl-start/commit/7dfba31cc8942d0c8c7a49c950697cf404dd1ea0)、[PR #6](https://github.com/haohongfei2001-png/vaiwl-start/pull/6)、[规范](../../docs/free-v1/16-HOME-THEME-DESIGN-GUARDRAILS.md)。

## 2. 真实实验与证据边界

### 已完成的真实读取

通过当前 ChatGPT 授权工具：

1. 读取任务列表，返回 25 条记录，cursor=null；其中 1 条 is_enabled=true。这里的 25 是**当前工具可见范围**，尚未与浏览器当前登录账户的 Scheduled 页面逐条核对，不能称为所有账户或所有工作区的总任务数。
2. 读取 7 个真实任务的详情，取得真实运行和完整文字，包含启用及未启用任务；实际抽样运行的 recorded_status 均为 completed。
3. 对一个启用任务进行两次单独读取，记录请求开始时间。两次 task ID、run ID、result.created_at 和正文相同。正文有 519 个 JavaScript 字符，content_truncated=false。
4. 找到 run ID、结果 run_id 一致且结果时间晚于本次 started_at 的样本，关联不依赖任务标题。
5. 找到真实反例：平台 recorded_status=completed、is_failure_message=false，但正文明确说明业务写入失败。故 completed 不能直接映射为“任务目标成功”或“有重要新信息”。
6. 部分较旧任务有正文但 chat_ref=null。应显示正文，不凭空生成“原始完整结果”链接。
7. 已精确搜索连接 Gmail 中来自 OpenAI 域、主题为任务/监控的通知候选，返回 0 条。先前较宽搜索命中了支持邮件与营销邮件，不能把它们当作任务通知证据。这不证明用户未开启通知，也不证明其他账户或邮箱没有通知。

两次读取时间（请求开始，UTC）：2026-11-04T15:08:05.906Z、2026-11-04T15:08:15.901Z。结果归属于此前已完成的真实运行，时间不应标成此次同步时新产生。

### 没有完成的真实验证

- 浏览器工具初始化返回：`Browser access requires the originating browser context.`
- 本地命令执行工具返回：`No usable execution environment is available.`
- 因此未读取登录页 DOM、未观察网页实际网络请求、未取得可供扩展调用的确切端点或认证要求。
- 未在真实 Chrome/Edge 中验证关闭任务页后的后台读取、临时页同步、账号切换、权限撤销、数据库重启恢复。
- 未观察同一任务在本轮产生一个新运行，也未改变真实任务启用状态；这些变化的回归是合成故障注入。
- 未抽到平台 recorded_status=no_update/failed/in_progress 的真实样本；不把测试夹具当成这些状态的真实平台证据。

这不是权限被用户拒绝，也不是 ChatGPT 平台已被证明无法接入。缺的是可连接到已登录页面的执行环境。无需再次索取读取任务/结果的授权；本轮用户已明确授权。

### 公开证据如何复查

`evidence.json` 只记录脱敏实验结果、来源类型、边界与验证状态。真实任务名、任务/运行/会话 ID、正文和邮箱地址不写入公开 GitHub。用户私有会话的工具输出保留原始观察，聊天交付可提供按返回 chat_ref 构造的会话入口，但本轮未点击核验可达性。测试文件的样本明确为合成；模块以真实样本执行的回放与合成测试分开报告。

## 3. 官方渠道核对

| 渠道 | 已证实事实 | 结论 |
| --- | --- | --- |
| Scheduled 原生页面 | 官方说明能查看 active/paused、next run、latest result 与 run history。[S1] | 网页接入首选入口；页面实际字段/请求仍需登录实测。 |
| 内部 Automations 工具 | 本轮读到原有任务与真实正文。 | 真实数据来源成立；未获得将该内部工具交给独立扩展调用的正式接口。 |
| Agents API automations | 文档列出 API project 的 automations、invocations 和 session events。[S3] | 适用于 API 自动化；不能用 API key 推导可读取原有消费者 ChatGPT 任务。 |
| 企业 Compliance API | 官方任务文档声明覆盖 scheduled tasks；平台限 Enterprise/Edu 与授权 workspace Admin key。[S2][S5] | 不是个人 Pro 的可用前提。 |
| 共享链接/账户导出 | 共享任务不含过去结果；个人聊天共享链接不会自动包含后来消息；不能作为持续结果流。[S4] | 不作为主同步方案。 |
| 原生 Push | Chrome notifications.getAll 只读取本 app/extension 的通知。[S10] | 加 notifications 权限不能读取 ChatGPT 网站或 App 推送。 |
| 官方邮件 | 官方支持 Email 通知；没有文档保证每次运行都有邮件、完整正文或稳定 task/run ID。[S2] | 可以辅助发现更新；本轮未取得真实通知样本，不能作为已验证正文来源。 |
| 自有 MCP 同步服务 | 官方支持已授权 MCP 的读写工具；写动作受确认设置约束，任务需要批准时可能暂停。[S2][S11] | 可研究一次性给原任务添加结果推送，尚未证明无人值守可靠。 |

OAuth 授权 ChatGPT 调用一个自有服务，不等于授权该服务反向读取所有 ChatGPT 任务。MCP 推送不应通过把写操作标成只读来跳过确认。本轮不新增云服务、不改用户原任务、不额外重跑研究。

## 4. 正式产品最值得验证的路线

**推荐：原生任务来源适配器 + 扩展后台同步 + 独立本地成果缓存。**

### A. 首选正常会话的后台请求

先在已授权登录页面观察真实只读请求，识别任务 ID、run ID、输出、账户范围及分页。再在隔离扩展中验证相同只读来源能否由 Service Worker 使用正常浏览器会话请求。

Chrome 官方允许有 host permission 的扩展后台跨源请求；正常网络请求有机会携带相关 cookie。[S6][S7] 这提供可验证的技术路径，**不保证 ChatGPT 的实际端点接受它**。只用浏览器正常认证，不读取/导出 cookie、不提取 bearer token、不假设私有端点存在。

通过后：浏览器运行时可周期同步，无需打开 ChatGPT 任务页。浏览器关闭或设备睡眠时不保证刷新；下次打开首页先显示准确标记的缓存，再同步。

### B. 可靠的次优路线：短暂后台页

若正常后台请求不能取得来源，验证由扩展创建非激活的 ChatGPT 原生任务/结果标签，content script 读取正常页面已经展示或加载的数据，再关闭自己创建的标签。

这条路线不要求用户常驻任务页，但**同步时实际上打开了页面**。必须一次性说明这种行为，不操纵用户正在工作的标签，不假装“完全没有页面”。需验证后台页真实加载、分页/虚拟列表、结果完整性及关联。页面要求前台可见或交互时，不能谎称后台方案通过。

### C. 最低可用退化：正常访问时自动收录

用户自然打开 Scheduled 或已关联任务结果时自动同步；首页显示最近一次已验证成果和同步时间。不能保证未访问内容自动刷新，不能把同步滞后称为任务失败。恢复动作是一个“打开 ChatGPT 同步”入口，避免让用户每次复制正文。

### D. 第二条长期路线：原任务推送到自有服务

在用户原有任务末尾一次性添加受支持的 `save_task_result` 调用，推送规范化结果，扩展按游标读取。计划/暂停仍由原生元数据同步。它不需要重建原任务，但需要部署服务、连接授权、修改任务指令并真实验证无人值守写入及幂等性。先验证一条选定任务，不能一次改动全部任务。消费者账户自有插件能力及跨运行审批持久性未证明，不能作为本轮已可用答案。

## 5. 权限方案

| 权限 | 具体用途与裁决 |
| --- | --- |
| storage | 已有；设置、同步状态与独立 IndexedDB 相关能力。 |
| alarms | 若周期同步获证则新增；启动时检查并补建，不能靠 worker 常驻计时器。 |
| chatgpt.com host | 已有可选 host 能力；开启“读取定时任务与结果”时单独说明新增正文用途并授权。 |
| scripting | 已有可选能力；仅 DOM/临时页或动态采集器需要。 |
| tabs | 通常无需新增：已有匹配 host 权限可读取匹配标签属性；创建标签本身不要求 tabs。[S9] |
| webNavigation | 现有可选权限，可复用必要事件；不作为任务组件额外必需项，先验证路由观察是否足够。 |
| cookies/debugger/webRequest/notifications | 当前候选不需要。通知权限不提供跨站读取能力。 |
| 自有同步服务域 | 只有选择独立服务路线时才请求精确 host；不得使用 all_urls。 |

浏览器技术的权限能力不能代替来源授权。新增任务正文功能不得悄悄沿用旧“只采集会话目录”的同意。现有生产 manifest 与权限逻辑本轮未改。正式接入时旧目录采集器继续保持 metadata-only；新模块只读取用户授权的任务与相应结果，独立审计其消息类型、来源范围与正文用途。不能全局删除旧脚本中禁止会话正文的审计来让新模块过关，也不能把旧范围当成用户此次新增能力的否决理由。

## 6. 数据、语义和可靠性

### 最小模型

- Task：provider、profile/account scope、sourceTaskId、title、enabled、原始 schedule、IANA timezone、sourceNextRunAt（可空）、task/chat 入口、sourceUpdatedAt、lastObservedAt。
- Run：taskKey、sourceRunId、scheduledFor、startedAt、completedAt、原始 recordedStatus、最后观察版本。
- Result：runKey、source result/message ID 或版本、createdAt、正文、原始引用、已验证 HTTP(S) 来源、truncated、requiresUserAction、isFailureMessage、原始入口、语义与语义证据。
- Sync：scope、请求开始/成功时间、游标/覆盖范围、login/offline/source_changed 等状态。
- 独立保留 latestRun、latestAvailableResult、lastValuableResult，不能用一个 lastResult 同时代表三者。

任务键必须含 provider+profile/accountScope+taskId，运行键再加 runId。标题只用于显示。未知账户不合并到已绑定账户；首次正常连接建立边界，不要求每一行都重新进行账户认证。切换时代次失效，旧请求不得落入新账户。

本轮内部工具没有返回可交给扩展复用的用户身份句柄；真实回放使用临时实验 scope，不把它当成真实浏览器账号隔离证明。

### 四种目标状态及必要的未知语义

| 场景 | 用户展示 | 旧重要成果 |
| --- | --- | --- |
| 本次确有新成果且语义有证据 | 有新结果 | 更新 |
| 本次明确无新信息/平台 no_update | 本次无新内容（保留原始平台语义） | 保留 |
| 平台失败或正文/结构化语义已证实业务失败 | 执行遇到问题 | 保留；失败正文可展开 |
| 未取得本次输出、仍在运行、同步失效 | 等待结果/尚未同步 | 保留并显示原日期 |

另需支持“已有输出，是否有新信息未判定”。这是诚实表达信息不足，不是凭空增加任务流程。completed+正文只允许标为有输出；is_failure_message=false 也不能保证业务成功。语义分类可来自提供商结构化字段、用户明确判断，或以后可审核的摘要/分类适配器；不能凭“未发现”关键词、没有邮件或旧结果复用判定。

no_update 在内部工具合同中是完成且抑制输出；这不能被无限扩大为“没有任何客观新事实”。界面措辞应贴合可证明的“本次无新报告”。首次尚无重要成果时，可展示最近可读正文及“有结果”，无需用户先手工分类才能看到价值。

### 同步与去重

- 同一次真实读取重复导入：一个任务、一个运行、一个内容版本；只刷新同步时间。
- 同一 run ID 可能重试；最新正文必须同时匹配 run ID 且 createdAt 不早于当前 startedAt，才可归属于当前尝试。
- 同 run 新正文修订更新版本，不创建虚构新运行；乱序旧快照不得回退状态。采样时间应取请求开始而非迟到响应到达时间。
- 完成、失败、无更新与同步失败互相独立。拉取失败不改写上游任务状态。
- 禁用只改变调度元数据，保留历史。is_enabled=false 不足以区分主动暂停、已结束或平台自动停用。
- 列表消失不自动删除；只有来源明确给出完整分页覆盖且确认删除，才更新可见性。
- next_run_time=null 保留为空。若后续使用成熟 RRULE 库本地推算，只能标为预计；不能用 last_run_time+24h 冒充来源安排。
- 原始时间存 UTC，保留源 IANA timezone，显示使用用户时区；来源完成时间与同步时间分别呈现。
- 浏览器重启与 worker 退出依靠独立 IndexedDB 保留；alarm 启动检查恢复。睡眠不会被 alarm 唤醒，不能承诺实时。[S7][S8]
- 正文默认纯文本；富文本需可信 Markdown 解析与消毒，不用 AI 文本 innerHTML。长结果先显示摘要/摘录，全文按需读取。首版可直接使用原 AI 结果的摘要段或如实标明“结果摘录”，无需额外付费模型调用；不能把简单截断声称为重新生成的摘要。
- 真实结果含仅在原聊天可解析的 citation token。拿到正文不代表已拿到来源 URL；保留原文，预览可去掉不可解析标记，不能把 token 编造成链接。原聊天引用可用时提供原入口。
- 结果正文不写 storage.sync。清缓存不删除 ChatGPT 原任务或历史。
- 新增 taskSyncEnabled 与现有会话 captureEnabled 分开；隐藏组件和停用同步是不同设置。停用任务同步时失效其正在进行的请求，不擅自撤销其他已开启功能仍使用的共享 host 权限；用户撤销 host 时则同步停止所有依赖该权限的读取与迟到写入。

## 7. 首页产品方案

独立“定时任务”组件位于书签区下方、项目/最近区之前，沿用现有共享容器、字体、边框和主题变量。默认折叠为约 64–80 CSS px 的紧凑横条（设计目标，非实测尺寸）：

- 左：定时任务与来源范围明确的任务数。
- 中：最近可读且优先值得阅读的一至两行成果，不仅显示“执行完成”。
- 右：成果产生时间/已验证下次运行时间、小展开箭头；同步滞后时明确给出同步时间。
- 点击摘要即可读详情/原结果，不要求先展开列表再逐卡寻找。
- 展开采用紧凑行：名称与计划、最近结果两行、状态与原入口；限制初始展开高度，保留列表内滚动，不挤碎首页四列项目结构。
- 不在此创建另一套任务；编辑/暂停入口引导回 ChatGPT。
- “任务总数”来自成功读取的同一作用域、去重后的明确列表范围；不得把未启用/已结束统计相加当总数，不显示项目/会话数。

设置包括：显示组件、是否预览摘要、选择展示的任务、手动同步/清本地缓存。工作模式默认允许已授权内容；生活模式默认完全不读取/返回任务标题、摘要、计数、tooltip 或通知。用户明确挑选生活任务是后续独立设置，不能自动猜测任务所属生活。

### R1–R6 检查

| 规则 | 方案检查 | 本轮运行时验收 |
| --- | --- | --- |
| R1 无项目/窗口数 | PASS；只设计独立任务数，本轮用户明确允许 | NOT_TESTED；没有生产 UI 改动 |
| R2 无首页时间跨度条 | PASS；只用单次成果时间/下次计划，保留现有导航 | NOT_TESTED |
| R3 单一工作/生活切换 | PASS；复用现有模式开关，不增加第二处 | NOT_TESTED |
| R4 项目右上角唯一 + | PASS；不进入项目卡头部 | NOT_TESTED |
| R5 最近分组合同 | PASS；任务不改变最近投影 | NOT_TESTED |
| R6 两种项目布局 | PASS；独立横条不参与项目补位，两布局照旧 | NOT_TESTED |

不能把本表的设计检查当成 Chrome/Edge 像素或交互通过。

## 8. 隔离 PoC 的范围

`result-model.mjs` 是纯数据模型：真实形状的记录归一、运行/结果关联、去重、修订、语义证据、旧重要成果保留、作用域投影和生活模式隐藏。测试数据明确为合成。它没有 fetch、cookie/token 读取、DOM 采集或生产 UI，也不是可安装的连接器。

独立审查实际复现并要求修复三个定向问题：同 run ID 失败重试误伤旧重要成果；部分字段缺失清掉已有运行证据；按旧计划时间排序掩盖更晚实际开始的重试。修复应将成果绑定到所属尝试，保留缺失字段已有证据，并优先按实际尝试开始时间选择最新运行。这三项已在代码提交 eed7119a631a3590c605a586481122deb572cca1 修复，独立审查原样重放三条反例均通过；原 34 项保留，新增 7 项，总计 41/41。

测试可独立执行：`node --test research/chatgpt-tasks/result-model.test.mjs`。研究 CI 只监听本目录和自身工作流，不修改原有 CI、构建包或 manifest。真实读取回放在会话执行环境中进行，公开材料只保存脱敏布尔结论。实现提交 eed7119a631a3590c605a586481122deb572cca1 的 Node CI [41856345988](https://github.com/haohongfei2001-png/vaiwl-start/actions/runs/41856345988) 为 41/41 PASS、0 FAIL、0 SKIPPED。修复后重新回放同一对真实读取，11 项检查通过；7 个真实任务的正文与运行关联全部保持一致。报告提交之后的最终分支 CI 另在 PR 回执核对。

## 9. 下一次真实浏览器实验应一次收敛

需要的环境：可被执行工具连接的 Chrome/Edge，已经正常登录用户 ChatGPT；隔离的开发扩展及本地工作目录。已有研究授权足够，不需要让用户提供密码、token、抓包文件或手工复制结果。

1. 在 Scheduled 页面用真实任务定位任务 ID、运行、结果与非敏感账户边界。只记录业务字段，不记录请求认证头。
2. 验证原生请求/页面对最新结果和历史结果的覆盖；抽取实际正文及可用来源 URL。
3. 同一来源放到隔离扩展 Service Worker 中，只依赖正常浏览器会话；关闭任务页，分别试同步和重启。
4. 后台请求不成立则只试一次正常后台临时页；仍不成立则定为访问时同步，并明确新鲜度上限。
5. 对测试任务做一次启用/停用及两账户切换；保护真实生产任务。重复读同一结果、同 run 重试、真实新运行、撤权迟到写入分别验证。
6. 通过后再将独立模块接入首页，继承 #6 的共享主题实现；只需新增任务适配器、独立缓存、同步控制与紧凑组件。
7. 读取后比对实际用户任务/运行/正文，不以 CI 替代平台接入证据。

未能连接浏览器时停止来源实验，不反复执行同一失败调用，也不继续猜测端点。

## 10. 长期维护与独立判断

| 方案 | 相对维护成本（工程判断） | 典型故障与恢复 |
| --- | --- | --- |
| 正式消费者读取接口（若将来提供） | 低至中 | 版本/限流/授权；遵循版本合同与重试 |
| 原生结构化响应 | 中至高 | 字段/认证/路由变化；schema 校验、适配器停用、保留缓存 |
| DOM + 临时页 | 高 | UI改版、语言、分页、虚拟列表、后台不加载；局部解析器更新或退回访问同步 |
| 邮件辅助 | 中 | 无邮件/延迟/正文不完整/关联不足；只能触发核对，不编造运行状态 |
| 自有 MCP 推送 | 初始高，稳定后可控 | 授权/审批/推送丢失/服务运行；幂等收件、游标拉取、原任务对账 |

不承诺固定“每月几小时”维护，因为私有来源尚未完成第一次浏览器验证。把 provider adapter 与缓存/UI 分开，可以将页面变动局限在采集层。未来其他 AI 提供商只输出统一任务/运行/结果，不需要重写首页。

### 对八个问题的回答

1. 能否读原有任务：**本轮授权内部工具已能；扩展直接读取未验证。**
2. 能否读真实结果：**能，已读完整正文与运行关联；来源链接恢复未完整证明。**
3. 能否无需常驻页面自动同步：**MV3 有实现机制；ChatGPT 实际来源和正常认证是否适用未证实。**
4. 额外权限：**周期同步预计新增 alarms，复用有明确新用途授权的 chatgpt.com host/scripting；通常不用 tabs/cookies/debugger。**
5. 最值得产品化：**原生任务适配器 + 后台正常会话请求优先，临时页次之；自有 MCP 推送为独立备选。**
6. 可达程度与平台限制：**任务/运行/文字可表达；缺失 next_run、opaque引用、业务语义和登录/私有来源变化必须如实处理。**
7. 能否立即交付可用扩展版：**不能在缺少浏览器来源证明时宣称可用；本轮已能交付独立处理模型与验证。下一优先工作是唯一剩余的来源连接实验，然后接 UI。**
8. 维护成本：**结构化来源中至高，DOM更高；缓存、失效提示、适配器替换和访问时同步可控制影响，不能保证免维护。**

## 官方参考资料

- [S1 Scheduled 页面、结果和历史](https://developers.openai.com/training/walkthroughs/scheduled-tasks)
- [S2 ChatGPT Tasks、通知、连接器及批准](https://help.openai.com/en/articles/10291617-scheduled-tasks-in-chatgpt)
- [S3 API project automations 与 session output](https://developers.openai.com/api/docs/guides/agents-api/sessions/automations)
- [S4 共享任务和会话的边界](https://help.openai.com/en/articles/7925741-sharing-conversations-and-scheduled-tasks-in-chatgpt)
- [S5 Compliance 平台适用范围](https://help.openai.com/en/articles/9261474-openai-compliance-platform-for-enterprise-and-edu-customers)
- [S6 扩展跨源网络请求](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests)
- [S7 扩展存储与 cookie 规则](https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies)
- [S8 alarms 生命周期与设备睡眠](https://developer.chrome.com/docs/extensions/reference/api/alarms)
- [S9 tabs 权限](https://developer.chrome.com/docs/extensions/reference/api/tabs)
- [S10 notifications 边界](https://developer.chrome.com/docs/extensions/reference/api/notifications)
- [S11 自有 MCP 工具与确认](https://developers.openai.com/api/docs/guides/custom-mcp-server)
- [S12 Chrome 扩展移植到 Edge](https://learn.microsoft.com/en-us/microsoft-edge/extensions/developer-guide/port-chrome-extension)
