# Free V1 · 同提交验证与真实来源边界

当前合同修订：`2026-11-03-native-experience`。本文件说明验证范围；交付包的 `build.json`、`verification/*.json` 及对应GitHub Actions是实际SHA和最终结果依据，不能引用另一提交的绿色结果。

## 书签与持久生活模式（2026-11-03）

新增书签测宽/空名/层级/失败回退的单元测试，以及 `tests/browser/life-bookmarks.mjs` 实装专项；旧 native-experience 的全隐藏折叠断言按当前单行合同更新，CRUD/迁移/原树不变检查保留。测试通过与截图均绑定实际 `build.json` 的SHA。独立审查发现并修复：同模式保存重试废弃正在加载工作区、空标题书签被网址替代、书签重绘丢焦点、迟到连接提示出现在生活模式。记录在专项报告。

当前执行环境无法连接用户本机浏览器，浏览器官方下载返回非ZIP，未宣称本地实装成功。正式CI继续原有全部回归，增加Chrome系专项和独立Microsoft Edge专项。首次a193296e的Edge专项43 PASS/1缩放自动化BLOCKED，Chrome新增专项在Reload后台观测失败；已修正验收驱动并保留严格新worker/零SNAPSHOT断言，失败历史详见专项报告。最终结果以原PR #1同SHA回执为准，不以单元/DOM测试冒充实装、不以CI替代用户日常Profile验收。历史Edge原生标签栏favicon故障独立保留。

## Project 候选增量采集专项（2026-11-03）

正式原生 Project 裁决仍为 **PROJECT_BLOCKED**；本轮修复可证实的有限采样缺口，不放宽账号/成员来源要求。完整原因和覆盖矩阵见 [专项记录](evidence/project-observation-20261103/REPORT.md)。

新增 `tests/unit/project-observer.test.ts` 的 11 组时序/隐私测试，以及 `tests/browser/project-observation.mjs` 的真实扩展构建隔离 Chromium 流程。后者接入既有 CI；同 SHA 回执为 `project-observation-validation.json`，打包校验并收录该回执。所有网页及 session 响应明确为合成数据，真实原生来源不得由这些测试填成 PASS。

本地环境没有 Chromium executable；官方下载返回非 ZIP，未执行成功浏览器基线，因此没有宣称 baseline RED。针对旧代码的迟到/后续更新反例已有明确源码依据；本轮最终浏览器结论必须读取同 SHA CI 新脚本的实际结果。

D1、原目录/活动/书签 PASS 与 D2 NOT_REPRODUCED 按用户本轮最新状态继承；下方更早的“待实机/D2 BLOCKED”描述仅是开发历史，不覆盖本条当前状态。没有重跑用户真实资料库或重新导入历史。

## Edge 标签栏专项：真实 FAIL，不由页面层 PASS 替代（2026-11-03）

基线7372bd17 clean build，Mac Edge 156.0.4314.58，全新独立 Profile。生产同一紫色PNG：直接入口真实标签栏256逻辑像素，原生入口0；页面图标两者均正确。两组最小夹具共18场景保留完整整窗截图、DOM/tabs元数据、地址栏值与哈希，证据见 [专项报告](evidence/edge-favicon-20261103/REPORT.md)。

新增 `tests/browser/edge-tabstrip.mjs` + macOS窗口/像素helper：直接紫色正例、原生首次、原生UI改青色、再次打开、独立浏览器重启后的原生入口、重启后直接青色正例。每项两次真实标签栏截图；DOM/存储/PNG解码与标签栏结果分别记录；FAIL退出1，基础设施ERROR/BLOCKED退出2。仅常规CI变绿不得表述为此项通过。同SHA专用门回执另附PR #1，保持Draft。

旧 `native-experience.mjs` 为headless并直接打开扩展URL，其href断言与网页截图均不覆盖浏览器标签栏。本轮没有修改或移除这些已通过的断言，也没有以恢复缓存/重装/修改用户真实Profile作为修复。没有再做本地书签、D1或历史目录专项。

## 本次新增覆盖

原生体验测试运行真实扩展页面和真实书签API，含三种偏好、拒绝分支、实际撤权、显式去重迁移、标题与图标持久化、实际扩展Reload、恶意图片拒绝、统一来源渲染。`native-experience-validation.json`为Chromium；`edge-native-validation.json`仅在实际Edge执行时产生，不伪装CI环境。

`native-upgrade-validation.json`从已批准6dfed27实际旧代码创建数据库，在隔离Profile填充12个store，再同路径换新代码。核对同ID、所有store内容完全一致、墓碑和去重关系、旧shortcut可达及重启留存。它不是用户真实资料库已被更新的证明。

本轮真实测试失败记录：旧领域夹具把“无日期”记录同时设置为有浏览时间，不再符合新展示合同，改为真正两种时间均缺失，并另加history-only日期断言；旧UI来源标题/选择器改为统一区域；原测试在Mac用Control点击引发右键语义，改为Mac Meta /其他平台Control；排序夹具改用过去时间；紧凑书签头部缩短页面后，原固定scrollY=500接近滚动下限，保留精确锚点断言并建立100px可滚动余量，未放宽1px/1000ms判定或删除用例。主测试仍67项。

## D1 标题覆盖回归

2026-11-03 修复 discoverCandidates() 对通用浏览器标题的错误覆盖。新增测试覆盖具体标题遇到 ChatGPT/空白/其他已识别通用标题、同等级具体标题更新、更高可信度原生标题、缺失标题填充、URL alias 去重、重复访问与导入交错、Project 成员标题、事务中断重试，以及标题更新前后的原题搜索。标题写入统一应用于历史候选、到达元数据与认证观察路径。真实 Mac 回归仍待修复包原位安装后执行。

## 自动验证

| 层 | 本轮覆盖 | 真实边界 |
|---|---|---|
| TypeScript与单元 | 当前110项，包含D1标题可信度与搜索回归、日期投影、564合成历史、30日/DST、IDB持久化、账号/资料库隔离、墓碑、候选快照、导航失败与提交竞态 | 注入的browser端口、fake-indexeddb、受控jsdom geometry |
| 已安装Chromium | 真实安装生产扩展代码，历史导入/恢复、权限和IPC、Start可信中键点击、onCompleted、同日重开、刷新与关闭标签留存 | 网络站点和账号响应是显式合成夹具，不是真实ChatGPT |
| 正式UI | 原首页、30日上下段、空段不跳、旧成员、搜索、网站与6项本地历史/候选流程 | 564条目录为合成；不能代替用户已有564条的升级验证 |
| 隐私审计 | 最小权限、生产依赖、无正文端点/整页文本、无token/邮箱/预览持久化、hash对应 | 不以静态检查代替真实来源认证 |
| 性能 | 2000会话/20项目，20次首屏与20次搜索 | 既有p95门槛首屏500ms、搜索反馈100ms未放宽 |
| 验收矩阵 | L01–L12新增独立本地能力；S/O/T/D/U继续按证据层映射 | 带L的真实设备/来源项保持BLOCKED，绿色CI不等于FREE_V1_ACCEPTED |

测试结果只在`buildSha`和`dirty`与当前构建一致时收录。打包拒绝dirty工作树与同构建失败回执。用户手势由真正的浏览器输入触发；页面脚本伪造的click不能产生OpenIntent。

## 实现阶段真实失败保留

- 提交：`80ed8939e27df52a06446877cbf8e590c91ef00d`。
- [CI41449102208](https://github.com/haohongfei2001-png/vaiwl-start/actions/runs/41449102208)：domain/package成功，installed Chromium作业在UI-empty-adjacent-segment失败。
- 这是本轮产品回归：无日期入口错误抑制空段提示。已修为只看当前段有日期的组，并强化原断言，未扩大超时或删除测试。
- [固定失败回执](evidence/local-first-ci-80ed8939.json)。后续CI成功不能覆盖这次失败事实。

## 当前能力语义

浏览器导航完成确认主动打开；不确认阅读、正文或业务请求成功，不将availability自动升级为reachable。历史lastVisitAt只影响历史浏览窗口，不写OpenDay。局部Project观察始终是候选，UNKNOWN不能借此变成PROJECT/NONE或归入某已确认账号。

已认证scope的活动仍要求当前owner证据；未知本地活动不随账号绑定自动搬移。撤权/停止采集和文档/session失效都必须阻止旧事件提交。数据库schema仍为v1/12 store，旧数据无迁移。

## 最少真实Mac证据

1. 原位更新后，用户已有目录数量不减少，出现浏览日期窗口，跨段和旧会话搜索可用。
2. Start真实打开一条会话产生本地当日活动；同日再开仍一个活动日，刷新不造活动。
3. 正常浏览Project时检验当前结构能否形成标记候选；关闭标签和正常重启后目录、网站与活动仍保留。

这些实机项未记录时不能标PASS；不需要新增诊断器、发送消息或重新导入全部历史。原生Project/NONE认证与Edge设备兼容继续独立验收。

旧669f基线测试和来源诊断已保留在Git历史中，仅作为旧合同记录，不再是本地工作空间的整体开关。

## a054508阶段回执

新增扩展Reload测试在Mac和CI均失败，原因是测试先等待Playwright第二次serviceworker事件，再打开扩展页；MV3惰性唤醒且Worker包装对象可复用，因此等待条件不成立。直接唤醒扩展页也曾遇到重载期间ERR_BLOCKED_BY_CLIENT。最终改用用户实际使用的chrome://extensions原生“重新加载”按钮，等待该扩展LOADED/ENABLED事件，再验证worker timeOrigin改变、页面就绪及设置保留。保持Reload检查和15秒等待上限。Edge额外套件保留完整浏览器重启检查，未声称完成Edge原生管理页Reload。失败日志保存在docs/evidence/native-reload-test-a054508.txt。

同SHA本地导入恢复检查曾有一次计数断言失败（当次未输出各分项，不能声称已定位根因）；增加诊断重放后观察到job=1、accepted=257、processed=257、pending=0、intervals=0、snapshot=257、raw=257并通过。该首次失败保持记录，不据一次重放宣称根治。最终CI及后续重复结果以PR回执为准。

后续已定位上述导入回执的测试根因：固定版本运行器中`page.waitForFunction(async () => false)`仅19ms就返回false，而没有等待超时。原测试因此在末尾区间仍running时放行；失败时实际已保存257/257条、只剩1个空区间，未发生会话丢失。用显式await后轮询已解析真值的有界helper替换导入、隐私及新偏好测试共4处异步条件，保留原30秒限制和完整终态断言；该修复没有修改生产导入逻辑。

修复等待逻辑后的3次独立导入恢复重放均通过8项检查，均为257条完整终态；不再把首次失败归因于目录损失或导入算法。最终干净SHA仍重新执行全部流水线。
## D1 本地修复验证（待 CI 复核）

- 实际基线：远端分支已从用户提供的 6dfed27 前进至 38bcafb；本地工作区已快进至该远端 HEAD 后实施修复。
- npm run typecheck：PASS。
- npm test：110/110 PASS（含4组新增D1回归测试）。
- D2 跳回首页：保持 BLOCKED；本轮未取得完整 Chrome 导航事件链，未修改导航架构。
