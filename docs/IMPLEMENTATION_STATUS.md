# VAIWL Start · 本地工作空间纠偏

## 当前：P1 自动历史采集授权修复（2026-11-03）

独立审查在 `5ad87bab060d321754cc65d073ac8736ea35b47e` 确认自动 history 监听绕过暂停、ChatGPT 断开和迟到撤权。现已为自动路径接入独立提交入口、私有持久代际与 worker 身份、即时事务中止和最终事务准入；手动导入仍使用原入口。没有增加数据库版本/store或更改Project模型、标题、活动、双模式、书签。三个旧版生产反例均明确失败，修复后新增15项生产worker与9项存储专项通过。完整CI另暴露首次session暂时失败被误发布为匿名身份的问题，仅修正错误分类并新增2项生产collector回归；本地完整199项单元通过。隔离浏览器正反证、完整CI及交付包以当前提交同SHA回执为准。详见 [P1修复说明](P1_AUTOMATIC_HISTORY.md)。

本轮仍保持Draft、不合并、不发布、不覆盖用户Mac。旧版文档中“未发现P0/P1”的结论不再适用于5ad87bab；修复后候选须通过新自动历史工程门才能进入合并复审。

## 前一阶段：Chrome Local-first RC 与首次自动恢复（2026-11-03）

从已实机验证的 `6bc0b29b848edcf7e6b5293c24fd5d957f0b3515` 继续。真实原生 Project 本地组织已取得 `REAL_NATIVE_PROJECT_PASS`；两条明确成员、稳定项目身份、无重复、关闭标签及 Start 重开持久化已通过。本轮继承该证据，不重新认证 Workspace，也不重跑用户历史、D1 和 30 天专项。

隔离生产扩展实测确认并修复 Reload 后已有 ChatGPT 文档未恢复收录的缺陷。新增安装/升级/启动及权限变化恢复、串行最新偏好读取、一次有界重试，14 项专项覆盖不依赖开关切换的自动生效。源适配器、身份合同、数据库和页面布局不变。完整候选范围、回执、审查与回退限制见 [Chrome RC 说明](CHROME_LOCAL_RC.zh-CN.md)。实际交付 SHA/结果以同 SHA CI 和包内回执为准，不把 dirty 本地验证作为交付包。

## 上一阶段：原生 Project 本地稳定组织（2026-11-03）

本轮从远端 `e21d7144b164b262c558a1fabbcbb32ac2eefe7c` 继续，按用户授权的[第13号修订](free-v1/13-NATIVE-PROJECT-LOCAL-AMENDMENT.md)取消“完整 Workspace 认证是所有本地 Project 组织前置”的限制。下文旧 `PROJECT_BLOCKED` 和单次候选键描述属于此前阶段，不代表当前本地组织能力。

生产已接通 `HELLO → LOCAL_IDENTITY → OBSERVE → observeLocalProject → LocalObservedProject/本地关系 → Start项目卡`。增加安全slug路由、多种独立无正文适配器、稳定主体/文档边界、空项目、增量成员、改名/搜索/旧成员保留。完整账号认证与全量同步继续独立未完成，`confirmObservation()` 未接收弱证明。

原数据库v1/12stores、目录key、历史/活动、D1标题和生活/书签继承；新项目保存在settings前缀行。不同主体的相同会话ID使用独立本地记录，冲突关系保留而不自动搬移。该阶段最初浏览器连接不可用；后续6bc0b29的真实Mac来源与本地组织已经通过，以本文件顶部状态为准。

合同：`VAIWL-START-FREE/1.0 / 2026-11-03-native-experience`。唯一分支：`codex/free-v1-implementation`，Draft PR #1。

## 书签与生活模式候选（2026-11-03）

当前新增修订为 `2026-11-03-life-bookmarks`，见[合同](free-v1/12-LIFE-BOOKMARKS-AMENDMENT.md)。已实现官方favicon、按实际宽度默认单行/受限展开/分层文件夹、持久双模式、跨页不强制同步、生活零工作区投影及异步过期保护。新权限仅favicon/search，书签仍可选。

本轮开始核对dd8d8051；工作期间远端推进至a8e54d01，已正常fast-forward继承全部Project增量观察源码和测试，没有覆盖远端成果。源码、边界单元及独立审查修正已集成；同SHA真实浏览器结论以新增life-bookmarks/edge-life-bookmarks回执及PR #1最终回执为准。当前构建文档不把尚未执行的CI或用户Mac验收写成PASS。完整实现、验证边界和审查见[专项记录](evidence/life-bookmarks-20261103/REPORT.md)。

## 原生 Project 收口裁决（2026-11-03）

**正式原生归属：`PROJECT_BLOCKED`。已完成可独立修复的候选增量采集，不把候选工程通过写成正式 Project 通过。**

当前生产链路只有 `HELLO → OBSERVE/SOURCE_STATUS → localProjectCandidate`；`currentContext/projectMembership/positiveNone` 仍未认证，`confirmObservation()` 没有生产调用。缺少当前文档的 active principal + active workspace 稳定来源、当前真实 Project 元数据结构，以及把两者绑定后提交正式归属的生产接线。不是打开能力常量即可修复，也没有证据认定现有严格 DOM 解析器错误。

本轮修复正常浏览的持续观察：页面晚于旧 2.22 秒窗口加载、首次空列表后出现成员、改名/新增/局部重绘均可增量收录。去重只用允许的元数据，纯重排/预览变化不反复写库；DOM 变化不重复请求 session。SPA 复用已知旧 panel 时，仅改标题或部分成员链接不能把旧成员归到新项目。过期路由、STOP、停采、撤权仍由现有文档绑定及事务边界拒绝。既有目录不因成员暂不可见而删除。

空 Project 能提取空候选，但现有候选按会话存储，尚无独立持久空项目卡；不同观察继续隔离，不合并为正式归属。当前受支持列表仍有原有 256 个 DOM 成员上限和 200 条 IPC 上限，不宣称完整项目清单。

测试和独立审查范围见 [Project 专项工程记录](evidence/project-observation-20261103/REPORT.md)。本轮继承用户提供的最新 Mac 状态：D1 PASS、历史/活动/书签 PASS、D2 NOT_REPRODUCED；不重新验收。真实 Project 来源无法在本次环境取得，保持 BLOCKED，不要求用户反复执行诊断。

## Edge 原生新标签页 favicon 专项结论（2026-11-03）

**当前仍为 FAIL / BROWSER_NATIVE_NTP_TABSTRIP_LIMITATION_IN_TESTED_VERSION。** 在 macOS Edge 156.0.4314.58 的全新隔离 Profile 中，同一自定义 PNG 在直接扩展入口显示正常，在原生新标签页入口 DOM / favIconUrl 正确而真实标签栏仍为默认图标。两组共18个最小夹具场景排除了静态/动态资源、manifest fallback 与链接更新等原因。普通扩展页跳转能恢复图标，但地址栏显示扩展 URL，未采纳为正式修复。结论限定于被测版本，不宣称 Edge 永久不支持。

本轮只增加真实标签栏像素测试、证据与状态修正；生产实现和正式要求未降低。旧 headless / DOM 图标 PASS 不能替代本项。详见 [专项证据与替代方案](evidence/edge-favicon-20261103/REPORT.md)；新门为 `npm run test:edge-tabstrip`，已知失败保持 FAIL/退出码1。普通 CI 成功不解除本项阻断。

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

上述为 D1 开发阶段记录。当前按用户本轮提供的最新结论继承真实 Mac D1 PASS；本轮未重跑该验收，未修改标题裁决或用户 IndexedDB。

## D2 会话跳回 ChatGPT 首页（当前 NOT_REPRODUCED）

用户本轮给出的最新对照为 NOT_REPRODUCED，覆盖之前缺少导航链时的 BLOCKED 状态；本轮按要求继承，不重开诊断、不改导航。NOT_REPRODUCED 不是已定位并修复根因，也不作为当前可复现的交付阻断。之前不完整导航证据留在 Git 历史中。

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
