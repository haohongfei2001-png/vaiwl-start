# VAIWL Start Free V1 · 冻结设计入口

合同：**VAIWL-START-FREE/1.0**  
定稿日期：2026-11-02（Asia/Shanghai）  
交付性质：产品、交互、数据与工程设计；不是生产扩展或真实浏览器验收通过声明。

## 唯一目标

在 Chrome / Edge 新标签页中，把用户实际浏览过的 ChatGPT 会话保存为可持续进入的本地目录，沿用真实 Project 与会话组织方式。关闭浏览器标签后，会话入口仍存在。Free 不依赖模型 API。

本轮不开发生产扩展，不修改原 VAIWL，不合并 main，不发布。设计材料放在新仓库独立设计分支。以后实现只以本合同和当前用户的新指示为准；原仓库中宿主挂载、正文、发送 ACK、Pro 的要求不能自动扩展到 Start。

## 阅读顺序与权威

1. [冻结产品规格](01-PRODUCT-SPEC.md)：做什么、什么算完成。
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

**历史导入不能补造 Project、NONE、账号或主动活动。** 导入先进入独立待确认目录，用户仍可搜索、打开。后续仅按每一条会话的真实证据绑定账号和归属。

**真实元数据链是首个开发门。** 原源码的 BrowserLocal 默认不提供稳定账号身份，生产 NONE 通路仍未证明；完整会话 JSON 读取会包含正文，禁止移植。先验证无需正文的 principal/context、PROJECT、NONE，再宣布核心数据能力完成。可并行完成首页和本地目录，但不能用样稿或 UNKNOWN 降级冒充完整 Free V1。

## 阶段名称

- `DESIGN_READY`：六项设计交付齐全、交叉审查完成。
- `SOURCE_GATE_PASS`：新扩展自身在真实受支持环境中证明账号、PROJECT、NONE 和主动打开证据链。
- `IMPLEMENTATION_READY_FOR_LIVE`：实现与离线合同通过，真实验收尚未完成。
- `FREE_V1_ACCEPTED`：规定的 Chrome 与 Edge 真实旅程、数据与视觉门均通过。

不要使用一个模糊的“已完成”覆盖上述阶段。
