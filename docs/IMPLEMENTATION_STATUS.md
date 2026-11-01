# VAIWL Start Free V1 实施状态

唯一实现线：`codex/free-v1-implementation`。合同：`VAIWL-START-FREE/1.0`。

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
- M1 领域模型：7 项测试通过，含继承时间向量、URL 混淆、归属冲突重放、严格证据配对。
- M1 IndexedDB：9 项测试通过，含双页面 CAS、关闭重开、500 条候选仅解析一条、scope 隔离、墓碑、午夜日键和事务中途 quota 回滚。
- 独立非作者源码审查发现的归属冲突重放、NONE/PROJECT 来源配对、非 ready scope 写入均已修复并复核。
- 完整类型检查已通过。运行：`npm run typecheck`、`npm test`。
- 此次阶段提交以前的基线为设计 SHA；精确提交与构建关联由 Git commit、后续 build.json 和 CI 回执记录，避免自指 SHA。

## 集成阶段

- 第一阶段已持久化：`7dd46d05a287d9416ff0d6f50c278fe9564a3fcf`；唯一 [Draft PR #1](https://github.com/haohongfei2001-png/vaiwl-start/pull/1)。
- M2 已按冻结设计接通生产 IndexedDB/worker：Project、NONE、UNKNOWN、scope 选择、无日期、5/+12、旧项、30日切换、网站完整操作、搜索与键盘。
- M3 已实现真实 history API 分段/饱和/200条原子写入/checkpoint；页面关闭后可续导。两阶段打开可正常导航到真实浏览器 tab；无可信抵达来源时不提交 OpenDay。原生会话意图与地址栏来源仍未启用。
- 源码与运行时白名单审计通过；生产没有合成数据开关、远程依赖、正文接口、iframe 或跨扩展通道。
- 当前有效测试：33 项 unit/domain/IDB/source/IPC；13 项实际隔离浏览器集成；42 项实际扩展 UI。真实历史 API 使用明确标注的测试权限变体，生产安装权限另行验证，详见 TEST_RECORDS。
- 性能：同一隔离机器、2000 会话/20 项目、20次新文档与20次搜索，分页修正后首屏p95约135ms，搜索含呈现p95约70ms。原宽搜索一次渲染2000条曾失败，已改100/+100且验证全部2000条可达；正式数值以同SHA机器回执为准。
- 修复并回归：重复OPEN、多来源归属冲突重放、同步别名遮蔽本地历史、旧文档绑定删除、权限同步重开收录、后台OPEN的revision发布、pending batch续导入口、手势开始晚于渲染排程的竞态。
- 源码文件由根负责人统一提交。CI与包内回执绑定每次实际SHA；本文件不把开发期dirty工作树回执冒充最终构建证据。Actions结果以同SHA检查记录为准。

## 下一项

剩余决定性工作只有真实来源与实际设备验收：在 Mac Chrome/Edge 取得 current-context、明确 NONE、限定 P 与当前会话成功抵达的元数据证据，然后以新证据修订固定 profile，执行四条真实连续旅程。最小步骤在 INSTALL.zh-CN.md 与 M0_SOURCE_GATE.md。无新来源证据时不继续放宽选择器/猜接口，不把 UNKNOWN 改为 NONE。main 和原 VAIWL PR #16 保持未修改。
