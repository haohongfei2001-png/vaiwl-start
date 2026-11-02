# VAIWL Start · 本地工作空间纠偏

合同：`VAIWL-START-FREE/1.0 / 2026-11-03-native-experience`。唯一分支：`codex/free-v1-implementation`，Draft PR #1。

## 已实现的产品行为

- 工作空间统一项目→窗口。UNKNOWN只有一个待归属日期区，不按主动打开/历史浏览分组。PROJECT/NONE和候选仍遵守原证据、Profile/账号边界。
- 展示排序取同记录有效浏览时间与已确认打开时间的较新者，拒绝同日未来时间；只在详情保留来源差异。Start手势经过精确浏览器导航完成后写原记录OpenDay，同日去重；刷新、恢复、无意图采集不造活动。
- 受限原生Project面板观察保留为明确的本地候选，ID/名称/已观察成员可用；不伪装成已认证账号或原生归属，不跨观察合并。
- 数据库名、version=1、12个store、旧key、网站、墓碑及导入checkpoint保留；没有清空或重建现有用户数据。
- 原首页视觉、30日历日公式和浏览器原生导航保留。无AI、云服务或新诊断页面。

- 原生书签为首页网站入口，按需bookmarks权限及一次性三种显示偏好；原始书签只在用户确认迁移时create，不自动移动或删除。旧shortcuts完整保留在设置兼容区。
- 标签页名称与favicon独立设置，Chrome/Edge及常用界面语言默认；本地近似图标而非内部资源。PNG/JPEG/WebP≤1MiB/2048px、重编码128px PNG；本地持久化，不改安装身份和内部Logo。
- 新偏好使用独立chrome.storage.local键；没有数据库版本或store变更。清除全部Start数据时同步清除这些偏好，但不删除浏览器原生书签。

代码能力标记：`LOCAL_WORKSPACE_READY`。这不是完整 `FREE_V1_ACCEPTED`，也不声称真实ChatGPT已认证Project/NONE。

## D1 标题覆盖缺陷修复（2026-11-03）

真实 Mac Chrome 验收已确认：同一会话 ID 的有效原标题被浏览器历史通用标题 ChatGPT 覆盖，随后原题搜索返回 0。根因位于 Repository.discoverCandidates()：此前只保护 native-label，相同 browser-history 来源的新值可以无条件覆盖旧值；chrome.history.onVisited 和历史导入都会进入该写入路径。

修复合同：
- 空白、空值及已识别的通用 ChatGPT 页面标题不构成有效会话标题，不能覆盖已有标题。
- 标题来源按 native-label > browser-history > unknown 排序；更高可信度可更新较低可信度，同等级有效标题仍可更新，避免永久冻结旧标题。
- 新记录与重复观察共用同一会话 ID；历史刷新保留既有 owner、membership、canonical URL、stableRank、activity、首次发现时间和 Project 候选。
- commitArrival 与 confirmObservation 也使用相同标题裁决，避免其他写入路径绕过保护。
- 不修改现有 IndexedDB schema，不重导入历史。

回归测试新增于 tests/unit/storage.test.ts：通用标题/空值保护、同等级有效标题更新、原生标题优先级、URL alias 去重、原题搜索、重复访问与历史导入交错、Project 成员标题保护、事务中断及重试。当前本地 TypeScript 检查通过，110 项单元测试通过。

本修复尚需同 SHA CI、正式开发包哈希核验和 PR 更新；在这些结果完成前不标记为正式交付。真实 Mac 原位回归尚未执行，原有 IndexedDB 未被修改。

## D2 会话跳回 ChatGPT 首页（独立 BLOCKED）

实机证据仅证明 Start 首次发出的目标 URL 与原会话身份匹配，之后页面跳回 ChatGPT 根页面；没有保存该次导航的完整逐事件 URL/redirect 链、Chrome error/commit/completed 事件序列或目标文档内容。因此无法区分 ChatGPT 登录/应用路由重定向、服务端响应、浏览器导航替换或其他运行时因素。本轮只读核对 open-broker.ts 和 navigation.ts：Start 使用已存 intent.targetUrl 调用 chrome.tabs.update；后续仅对活动顶层 ChatGPT 会话 URL 做身份绑定。现有证据不足以确定跳转根因，本轮没有修改导航行为，D2 保持 BLOCKED。

## 能力限制

| 能力 | 当前状态 |
|---|---|
| 本地历史时间组织 | 已接生产投影，升级后直接作用于既有记录 |
| 未分配记录Start活动 | 已接onCommitted/onCompleted、错误拒绝与事务内去重 |
| 已确认scope活动 | 仍需当前owner证明；不向未知当前账号的资料库写活动 |
| 局部Project | 原生结构匹配时收录明确候选，不是完整项目清单 |
| 认证账号/原生Project/NONE | 未获得新的实机来源认证，继续保留独立限制 |
| 用户真实564条目录原位更新 | 不用合成564条测试替代；以实际Mac回执为准 |

## 验证与已修失败

实现阶段提交 `80ed8939e27df52a06446877cbf8e590c91ef00d` 的95项单元、类型、隐私、基础安装扩展、导入恢复、来源与存储检查通过；CI41449102208在空时间段UI断言真实失败。

根因和修复见 [失败记录](evidence/local-first-ci-80ed8939.json)：独立无日期入口被错误计入当前段，修复只改变空段判定，原断言保留并加强。

当前提交的最终结果必须取自对应GitHub Actions、`build.json`与包内同SHA回执；不得挪用实现阶段结果或旧669f候选。详见 [测试说明](TEST_RECORDS.md)。

## 实机与交付

[安装说明](INSTALL.zh-CN.md)已改成保留现有目录的原位更新和3组最少产品核验，不再要求先完成旧M0诊断。PR始终Draft，main不合并，商店不发布，原VAIWL仓库只读。

[当前合同修订](free-v1/11-NATIVE-EXPERIENCE-AMENDMENT.md)逐项说明每次放宽的数据语义、安全条件与误判风险。
