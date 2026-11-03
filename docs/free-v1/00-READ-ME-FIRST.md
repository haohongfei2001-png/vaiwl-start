# VAIWL Start Free V1 · 当前合同入口

> **新增有效修订：2026-11-03-life-bookmarks。** [第12号合同](12-LIFE-BOOKMARKS-AMENDMENT.md)批准持久生活/工作空间双模式、官方favicon与单行原生书签架；本修订优先于下方历史UI/权限描述。


> **当前有效修订：2026-11-02-local-first，用户已批准。** [统一修订合同](10-LOCAL-FIRST-AMENDMENT.md)覆盖原 M0 全局前置门：本地时间组织、Start 主动打开与局部候选项目可独立运行；账号隔离及正式原生归属证明仍保留。`LOCAL_WORKSPACE_READY` 不等于 `FREE_V1_ACCEPTED`。

合同：**VAIWL-START-FREE/1.0**  
定稿日期：2026-11-02（Asia/Shanghai）  
交付性质：持续有效的产品、交互、数据与工程合同；实现、自动测试与实机通过状态见正式实施/验收记录。

## 唯一目标

在 Chrome / Edge 新标签页中，把用户实际浏览过的 ChatGPT 会话保存为可持续进入的本地目录，沿用真实 Project 与会话组织方式。关闭浏览器标签后，会话入口仍存在。Free 不依赖模型 API。

本轮直接修改合同与正式代码，继续 `codex/free-v1-implementation` 与 Draft PR #1；不修改原 VAIWL，不合并 main，不发布。原仓宿主挂载、正文、发送 ACK、Pro 要求不能扩展到 Start。本地时间组织和主动打开按本次已批准修订执行。

## 阅读顺序与权威

1. 先读 [本地工作空间修订](10-LOCAL-FIRST-AMENDMENT.md)，再读 [产品规格](01-PRODUCT-SPEC.md)：做什么、什么算完成。
2. [首页与交互](02-INTERACTION-DESIGN.md) 和 [可操作设计样稿](../../design/free-v1/prototype.html)。样稿中的全部数据均为合成示例。
3. [数据合同](03-DATA-CONTRACT.md) 和 [TypeScript 合同](../../contracts/free-v1.ts)。文字定义不变量，类型定义字段形状。
4. [来源与可靠性](04-SOURCE-RELIABILITY.md)：标准 API、已读源码、仍需真实验收的边界。
5. [架构与复用](05-ARCHITECTURE-AND-REUSE.md)。
6. [验收标准](06-ACCEPTANCE.md)。
7. **[CODEX-START.md](07-CODEX-START.md)**：直接交给开发者执行。
8. [证据登记](08-EVIDENCE-REGISTER.md) 与 [决策记录](09-DECISIONS.md)。

冲突处理：当前用户指令 > 本合同正文与类型约束 > 可操作样稿 > 旧仓历史规范。样稿为视觉和交互参考，不是元数据适配器、活动算法或浏览器导航的生产实现。

## 已核对的来源基线

- 原仓库：`haohongfei2001-png/Virtual-AI-Workspace-Layer`。
- PR #16：读取时 open、Draft，未合并。
- 冻结源码：`1903b00f774b4fd7f3d15b3669878c32e2c7a9c8`。
- 新仓库原 main：`ebd6cd5705a1a56a3cafae3eda27537379098c81`，原内容仅 README。
- 35 份来源文件的固定 URL、Git blob SHA、SHA-256 见 `evidence/source-manifest.json`。

## 定稿中的四个关键判断

**活动是最近一次可证实的主动打开时间。** 每会话每天一条活动日记录；同日重开更新最后打开时刻，不增加第二个活动日。不把打开伪造成 UserSendEvent，不增加频次权重分数。

**30 天算法真实继承。** 按固定 IANA 时区的本地日历日连续分段，不按自然月或 30×24 小时。项目只出现在最新成员所属段；旧成员仍在项目内。

**历史导入不能补造 Project、NONE、账号或主动活动。** 导入进入本地历史，并按有效浏览日期形成“历史浏览／归属待确认”窗口；浏览时间不写活动。用户可跨30天浏览、搜索与打开。后续只按每条真实证据确认归属，旧本地活动不迁到其他账号。

**各能力独立生效。** 本地时间窗不需要账号或 NONE 证明；Start 真实手势与精确浏览器导航完成可向未分配记录写 OpenDay。可靠局部 Project 观察可形成明确标记的候选。正式账号、PROJECT、NONE 仍逐条保留证据要求，完整会话 JSON 仍禁止读取。

## 阶段名称

- `DESIGN_READY`：六项设计交付齐全、交叉审查完成。
- `LOCAL_WORKSPACE_READY`：本地时间组织、Start 导航活动和局部候选能力在代码层可独立运行，实机状态另记。
- `SOURCE_GATE_PASS`：正式账号、原生 PROJECT/NONE 来源各自真实验证通过；不再作为本地能力共同前置。
- `IMPLEMENTATION_READY_FOR_LIVE`：实现与离线合同通过，真实验收尚未完成。
- `FREE_V1_ACCEPTED`：规定的 Chrome 与 Edge 真实旅程、数据与视觉门均通过。

不要使用一个模糊的“已完成”覆盖上述阶段。
