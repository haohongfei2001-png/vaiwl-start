# VAIWL Start Free V1 实施状态

唯一实现线：`codex/free-v1-implementation`。合同：`VAIWL-START-FREE/1.0`。

## 本轮 M0 恢复（2026-11-02）

恢复基线：`a6697b0496f9adaef17495b786712ad50fa49e65`，远端 PR #1 为 Open/Draft；基线 Actions `41361304201` 为 SUCCESS，两个交付 artifact 均未过期。当前代码提交由本文件所属 Git 提交与包内 `build.json` 定位；后续同 SHA 机器回执不能用工作期 dirty 回执替代。

本轮修复了真实断点：Project SPA 路由通知、固定 parser 有限 hydration 等待、身份单 reader/路由失效、BFCache suspend/resume、来源状态绑定与30秒期限、Start 目标文档/路由冻结、reload/绕行/迟到错误/关闭和旧 HELLO 竞争。未更改 12-store 数据层、冻结首页布局、历史导入或 Free/Pro 边界。

新增正式构建中的 `source-check.html` 受控入口，位于设置的来源详情内。只采固定来源，严格导出脱敏白名单；每个预定步骤一次、整轮30分钟，无开关提升来源权威。结束、过期、worker中断或撤权均停止并清理本轮密钥。结构选取只限已知元数据边界，不读正文或文字。唯一用户操作组见 [M0_CONTROLLED_CHECK.zh-CN.md](M0_CONTROLLED_CHECK.zh-CN.md)。

| 来源 | 本轮可验证增量 | 真实状态 |
|---|---|---|
| M0-A | 不再永久缓存；主体/roster 可作本轮匿名对照，切换迟到结果拒绝 | BLOCKED：仍没有独立当前 workspace 语义来源 |
| M0-B | Project SPA 与延迟渲染可进入原严格候选 parser；同名身份可比较 | BLOCKED：缺 Start 现场结构与已证 scope，候选仍 UNKNOWN |
| M0-C | 受控选取仅输出结构；普通路由/空值/无 badge 均不推断 | BLOCKED：没有已证明的正向 NONE 来源 |
| M0-D | Start 意图已实际绑定目标文档/route epoch；竞争失效收口 | BLOCKED：缺独立当前会话身份和加载成功证据，零 OpenDay |

当前会话 Browser 连接返回需要 originating browser context，不能访问用户 Mac；未执行真实账号、Mac Chrome/Edge 取证。真实来源未提升，原生点击和地址栏入口未宣称通过。独立源码审查结论只允许作为 SOURCE_GATE_BLOCKED 开发候选交付。

## 当前阶段

`SOURCE_GATE_BLOCKED`；可加载的受限目录开发候选已经实现。M1、M2 和 M3 中不依赖未证来源的链路已通过本地自动化验证；完整 Free V1 未验收。

- 设计基线已从 GitHub 核对：`8df711c40dd6fdcff7893f2170526d629f601254`。
- main 保持 `ebd6cd5705a1a56a3cafae3eda27537379098c81`，不合并或发布。
- 原 VAIWL PR #16 已只读核对：`11aa3622d215afe7482ec3ad1cf83ca49332ab1f`；相比冻结基线只新增拒绝诊断，没有新的 Start 账号/NONE 来源。
- 已核对并保留原窄 session-only reader、Project 元数据解析及30日日历函数的固定源码依据。

## M0 来源门

| 能力 | 状态 | 原因 |
|---|---|---|
| session-only principal/roster 候选 | 离线通过，真实未验 | 两个已知固定GET，仅受控内存，不输出响应/凭证 |
| 当前 workspace/context | BLOCKED | roster/default/null 不证明当前选中空间 |
| 正向 PROJECT | BLOCKED | 原有限 DOM parser 可移植，但 Start 当前 scope 及现场结构仍待证 |
| 正向 NONE | BLOCKED | 无经现场验证的明确原生 NONE 或纯元数据来源 |
| 精确会话成功抵达 | BLOCKED | URL 或侧栏链接不证明当前会话加载；无正文的当前标识区尚未实证 |
| 地址栏主动性 | 禁用 | 独立双浏览器门未执行 |

以上能力不得由测试 fixture、页面自报 verified、缺失字段或历史时间开启。源门失败不阻塞历史候选目录/网站/纯模型开发，但完整 Free V1 仍未验收。

## 已验证阶段

- M0 候选读取/隐私/限定 Project parser：9 项有效测试通过；jsdom 可见性为模拟，非实机。
- M1 领域模型：8 项测试通过，含继承时间向量、URL 混淆、归属冲突重放、严格证据配对。
- M1 IndexedDB：11 项测试通过，含双页面 CAS、关闭重开、500 条候选仅解析一条、scope 隔离、墓碑、午夜日键和事务中途 quota 回滚。
- 独立非作者源码审查发现的归属冲突重放、NONE/PROJECT 来源配对、非 ready scope 写入均已修复并复核。
- 完整类型检查已通过。运行：`npm run typecheck`、`npm test`。
- 此次阶段提交以前的基线为设计 SHA；精确提交与构建关联由 Git commit、后续 build.json 和 CI 回执记录，避免自指 SHA。

## 集成阶段

- 第一阶段已持久化：`7dd46d05a287d9416ff0d6f50c278fe9564a3fcf`；唯一 [Draft PR #1](https://github.com/haohongfei2001-png/vaiwl-start/pull/1)。
- M2 已按冻结设计接通生产 IndexedDB/worker：Project、NONE、UNKNOWN、scope 选择、无日期、5/+12、旧项、30日切换、网站完整操作、搜索与键盘。
- M3 已实现真实 history API 分段/饱和/200条原子写入/checkpoint；页面关闭后可续导。两阶段打开可正常导航到真实浏览器 tab；无可信抵达来源时不提交 OpenDay。原生会话意图与地址栏来源仍未启用。
- 源码与运行时白名单审计通过；生产没有合成数据开关、远程依赖、正文接口、iframe 或跨扩展通道。
- 当前补强测试：36 项 unit/domain/IDB/source/IPC；37 项实际隔离浏览器检查（基础17、导入恢复8、隐私9、存储故障3）；61 项实际扩展 UI。真实历史 API 使用明确标注的测试权限变体，生产安装权限另行验证，详见 TEST_RECORDS。
- 性能：同一隔离机器、2000 会话/20 项目、20次新文档与20次搜索，分页修正后首屏p95约135ms，搜索含呈现p95约70ms。原宽搜索一次渲染2000条曾失败，已改100/+100且验证全部2000条可达；正式数值以同SHA机器回执为准。
- 修复并回归：重复OPEN、多来源归属冲突重放、同步别名遮蔽本地历史、旧文档绑定删除、权限同步重开收录、后台OPEN的revision发布、pending batch续导入口、手势开始晚于渲染排程的竞态。
- 源码文件由根负责人统一提交。CI与包内回执绑定每次实际SHA；本文件不把开发期dirty工作树回执冒充最终构建证据。Actions结果以同SHA检查记录为准。

## M4 证据补强

- 第二阶段提交 `c590b1b0728e0f9a8e57c9d9445921972c4247e7` 的 [GitHub CI](https://github.com/haohongfei2001-png/vaiwl-start/actions/runs/41358767084) 两个作业均通过；当时同SHA干净包为33 unit /13 browser /42 UI。
- 后续对照冻结验收补齐了实际浏览器网站留存、离线、257条导入中断续跑、慢身份不阻塞首屏、真实iframe拒绝、原生IDB故障恢复、完整列表/过滤/拖放/键盘验证。当前工作期数量见上；最终以交付包同SHA回执为准。
- 修正验收证据生成：具体断言逐项对应，不再用文件整体通过推定复合条件；视觉回执必须显式提供，缺失则NOT_RUN。不会根据测试名称包含某ID就认定已覆盖。
- T04无日期打开、T07真实指针/Chromium IME安全点及T08跨午夜历史段已补充实际浏览器断言；实际 Mac/Edge、原生权限和真实来源不由合成实验替代。

## 下一项

完整产品仍需真实来源与实际设备验收，并完成冻结验收表中未完整覆盖的组合场景：在 Mac Chrome/Edge 取得 current-context、明确 NONE、限定 P 与当前会话成功抵达的元数据证据，然后以新证据修订固定 profile，执行四条真实连续旅程。本轮唯一最小操作组已实现在 M0_CONTROLLED_CHECK.zh-CN.md 和扩展受控核验页。无新来源证据时不继续放宽选择器/猜接口，不把 UNKNOWN 改为 NONE。main 和原 VAIWL PR #16 保持未修改。

## 性能修复与最终候选门

第三阶段 `8878287042c981ca114185326f2910b583b34d8e` 的功能CI通过，搜索呈现p95=123.7ms超过100ms，原始失败完整保存在 `docs/evidence/performance-8878287.json`。独立A/B与trace将额外耗时定位到实时全屏backdrop模糊。只将原3px模糊转移到稳定背景块，保留遮罩色、布局、搜索分页和计时口径；配对诊断65.1→30.6ms，见 performance-rendering-diagnosis.json。正式生产脚本工作期复验31.6ms，最终成绩仍以干净提交的CI/包内回执为准。

最终打包拒绝脏工作树、落后HEAD的dist或任何同SHA失败回执；性能FAIL与文件级FAIL显式进入验收汇总，不会被BLOCKED掩盖。视觉审查单独绑定最终构建。

## M0 实现阶段的确切回执

正式实现提交：`264b01faa1a278f6f9a0c047a709e966df04ad97`。该提交的本地干净构建通过75项unit、51项实际隔离浏览器检查（含14项新增来源恢复）、61项UI、8项隐私审计和5项性能检查；2000会话/20项目、20样本首屏p95=131.6ms，搜索呈现p95=31.8ms。

同提交GitHub运行 `41406773477` 的类型/领域/打包作业成功，浏览器作业在既有搜索重开测试失败；此前51项浏览器检查（含来源14）均通过。失败原文与针对性复核结论保留于 `docs/evidence/m0-ci-264b01f-ui-failure.json`。未查明唯一生产根因；同SHA局部复核和本地61项UI均通过，不能把CI失败抹去。

后续收口仅补齐该测试的既定快捷键前提同步和失败状态，并将新增source-recovery回执接入统一工程门；不改产品UI、键盘行为、超时或验收阈值。最终交付提交的CI和`build.json`将独立绑定最终SHA；本段是前一实现阶段的真实记录，不把264b的本地回执冒充后续构建回执。
