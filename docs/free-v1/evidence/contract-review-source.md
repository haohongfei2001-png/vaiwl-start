# VAIWL Start Free V1 · 继承与数据合同独立复核

审查范围：`00-READ-ME-FIRST.md`、`01-PRODUCT-SPEC.md`、`03-DATA-CONTRACT.md`、`09-DECISIONS.md`、`contracts/free-v1.ts`。只读审查，未修改正式文件、未跑测试。审查时 04–07 尚未生成，不将其视为已审；root 已通知备份/恢复将退出首版必需范围，故不把当前过渡文字重复列为新问题。

依据：本次固定 SHA `1903b00f774b4fd7f3d15b3669878c32e2c7a9c8` 的原仓源码审查，见 `source-inheritance.md` 与 `source-manifest.json`。

## 结论

原仓继承口径通过：30当地日历日公式、项目单段、旧成员留父卡、无日期可达、稳定时间排序、没有频次评分、NONE/UNKNOWN区分，以及原宿主挂载/账号/NONE未通过的事实均正确。文档明确区分 DESIGN_READY、SOURCE_GATE_PASS、实现与真实验收，没有冒领原 Free 通过。

正式交接前仍需关闭以下两项具体合同差额；它们不要求重做产品设计。

## SR-01 · 重要：staging 候选首次归入账号时，本次主动活动的落点未定义

位置：03 §1、§5步骤4–5；类型 `CandidateResolution`、`OpenIntent`。

`OpenIntent.targetRecordKey` 在用户从“账号待确认”点击时为 staging key。到达后若已经证明账号 A，规范要求建立 A 的 scoped record，并禁止将旧 staging 的访问/活动批量迁给 A，但步骤5只是“更新 conversation.activity”，没有指明本次新 open 应落哪个 key。类型也没有 arrived 后的 `resolvedRecordKey`。开发者可能把本次活动记到 staging、在 A 再记一次，或因为“不转移旧活动”丢掉本次活动。

建议冻结：`targetRecordKey` 保留用户点击的来源；arrived 后根据当前已证 scope 得出 `resolvedRecordKey`。同一个事务创建/更新 A 的 scoped record、建立 candidateLink、消费 intent，**本次新活动仅写 resolvedRecordKey**。旧 staging 的历史访问/旧活动/归属不迁移；expectedScope 非空且不一致直接拒绝。若身份仍未证，明确选择“只收录 staging，不提交确认活动”或“仅未分配本地活动，永不充当已证账号活动”其中一条，并在正文和类型一致表达。

最小验收：从同一 staging 候选分别以 A、B 打开；每次只给已证目标 scope 新增一个当天单位，旧导入访问不被接管；intent 重放不让 staging 与 scoped 双计数。

## SR-02 · 重要：不得把 cached 一概当被动访问

位置：03 §5步骤4，“当前已提交且非prerender/cached的文档/SPA会话路由”。

`cached` 没有在合同中定义，容易被实现为拒绝 HTTP 缓存命中或正常前后页缓存恢复。缓存来源不决定是否主动；核心判据应是用户意图与精确到达的因果关联。被动恢复必须拒绝，但一次确证用户点击触发的缓存页面抵达仍可有效。

建议写成：目标文档必须处于可接受的 active lifecycle，未激活 prerender 不计；HTTP 缓存不是排除理由。单纯 BFCache/会话恢复/前台激活不产生新意图，不能据此记活动；若有效独立用户意图确实与同一目标恢复关联，按同一到达合同判断。不要发明“缓存=被动”的捷径。

最小验收：Start 真点击后从 HTTP 缓存到达应正常计一次；无意图自动恢复仍为零；未激活 prerender 为零。

## 已核对而无需修改的重点

- `W(k)=[T+1−30(k+1), T+1−30k)` 与11月2日示例正确；不是自然月或30×24小时。
- 同日重开只更新最后时刻、日单位仍1，是本轮明确的新Open合同，未假称原发送事件机制已有该功能。
- 日期窗口是NONE展示容器，不伪造Project或浏览器窗口。
- Project按成员最新活动选唯一段；旧子项不另造项目卡；未知日期不塞旧段。
- 频次不打分，稳定rank/ID兜底是Start的明确实现选择，和原函数时间排序语义兼容。
- 原源码的session-only身份链标为待验证；完整conversation response被明确排除；没有把BrowserLocal解锁当账号证明。
- SOURCE_GATE要求真实scope、P、NONE及主动证据；典型全UNKNOWN不能冒称完整Free。
- 浏览历史导入不生成OpenDay，不把当前账号接管整个导入批次。

后续 04/05/06/07 的最高优先复核点：须保持“窄session读取只是候选、roster不是当前context证据”，且不得因NONE缺源转而启用完整conversation JSON或主动读取聊天正文。该点在当前已读正式文件中正确。

## 第二轮：04/05 来源、架构与范围复核

已只读核对 `04-SOURCE-RELIABILITY.md` 和 `05-ARCHITECTURE-AND-REUSE.md`。没有发现新增的实机通过冒领、虚构源码文件或为了补NONE而读取完整会话响应的要求。M0被明确写成可以 `SOURCE_GATE_BLOCKED` 的真实来源门，不把定义一个接口当作已经解决数据；P/身份/NONE失败后仍可并行完成本地目录和首页，符合实际依赖。权限表没有预先加webRequest、cookies、debugger等来移植原复杂身份链；在当前证据下不必扩权限。

### SR-03 · 重要准确性修正：Project标题与Project内会话标题混写

04 §2矩阵行“Project标题 | observedProjectListTitle仅取text-only标题叶”映射错误。实际源码 `observedProjectListTitle(document,node,root)` 校验 SECTION/OL/LI/A 关系后读取成员行的第一text-only DIV，其输出是**Project内会话标题**。Project名称的 `h1 > button`（或唯一纯SPAN叶）读取位于 `observedProjectAssociation()` 内。应将该行改成“Project内会话标题”，另明示P名称由association读取，避免实现者把首个会话名当Project名。

05中 `src/runtime/session-provider.mjs::read` 是 `createSessionProvider(...).read()` 返回的方法，不是顶层命名导出；建议标全调用形态以便Codex精确摘取。该点是表述精确性，不是机制缺陷。

### M0 仍须保留的真实依赖

当前无正文、无webRequest的冻结权限下，session-only固定读取是已存在的候选实现，但独立“当前context”来源尚未落实为已验证字段。04已明确roster/default/null不能补证，并允许在来源门发现/失败；这是可执行的受限发现任务，不能在后续总结中改成“身份已接通”。若独立context来源发现失败，scope保持未分配而非自动个人context。NONE同理；未知内部端点只能在证明响应属于允许元数据后编入版本化profile，不能通过猜conversation端点来关闭M0。

就04/05目前文字而言，以上依赖已经显式列出，不构成需重新讨论产品定位的设计阻断。此前SR-01/SR-02由root计划修正，本轮不重复列项。

## 最终有限复核：已发现差额全部关闭

仅复核上述指定修订，未扩大源码审查、未跑测试。

| 项目 | 复核结果 | 已见修改 |
|---|---|---|
| SR-01 staging首次绑定与本次活动落点 | CLOSED | 03 §5步骤5明确immutable targetRecordKey、resolvedRecordKey、committedRecordKey及同一IDB事务；本次活动仅落resolved record，旧候选历史/活动不搬；类型同步加入两个落点字段。身份仍未证明确留staging，不冒称已证scope活动。 |
| SR-02 缓存导航语义 | CLOSED | 03 §5步骤4明确active lifecycle、未激活prerender拒绝、HTTP缓存不决定主动性、有真实意图的active BFCache按同一规则验证、无意图恢复为零。 |
| SR-03 标题函数映射 | CLOSED | 04 §2已改“Project内会话标题”，同时注明Project名称由observedProjectAssociation的h1/button标题叶确认。 |
| session-provider方法形态 | CLOSED | 05复用表已改为createSessionProvider(...).read()，不再暗示顶层export read。 |

**收口结论：本审查范围内无遗留阻断或重要修正。** 这仅证明设计合同的源码继承、证据口径和已指出差额闭合；不提升M0真实scope/NONE来源能力，不代替生产实现与Chrome/Edge实机验收。
