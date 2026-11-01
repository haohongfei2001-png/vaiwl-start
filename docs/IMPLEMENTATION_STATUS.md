# VAIWL Start Free V1 实施状态

唯一实现线：`codex/free-v1-implementation`。合同：`VAIWL-START-FREE/1.0`。

## 当前阶段

`SOURCE_GATE_BLOCKED`；M0 候选读取与 M1 本地数据核心已实现并通过离线测试，正在接通正式首页与浏览器工程链。

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

## 下一项

完成 M2 正式首页、M3 有界历史导入和禁用来源的生产接线；随后 M4 隔离浏览器和双浏览器实机交接。每个阶段更新本文件并提交。
