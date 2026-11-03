# Free V1 · 同提交验证与真实来源边界

## 当前专项：自动历史采集 P1（2026-11-03）

审查基线5ad87bab的三个生产worker反例已作为回归固定：暂停且保留history、断开ChatGPT且保留history、getVisits挂起期间撤销history。在隔离旧源码快照上三项均明确FAIL（每项实际新增1、期望0）；当前生产worker+Repository专项15/15、存储事务专项9/9通过。本地完整 `npm run verify`：TypeScript、197/197单元、构建和隐私审计PASS。没有将本地dirty构建作为正式交付。

新增 `automatic-history.mjs` 通过真实chrome.history.onVisited验证正反路径、实际可选权限撤销、显式UI导入和完整浏览器重启；同脚本要求干净5ad基线先在指定暂停断言失败，再验证当前候选。两份同SHA回执已接入CI及打包，自动历史PASS成为acceptance工程门。最终实装结论以提交后的CI和包内回执为准。

本次本地执行环境没有可用Chromium；官方安装下载返回Site Unavailable，系统包准备也不可用。因此本地没有实装PASS，完整安装专项交由GitHub Actions隔离Chromium执行。未访问用户Mac或覆盖日常安装。三份反向源码审查均未发现本次生产差异剩余阻断；范围、代际/事务机制及回退限制见 [P1修复说明](P1_AUTOMATIC_HISTORY.md)。

现有基础浏览器和导入恢复测试的准备条件曾依赖已确认的越权自动入库，现改为真实history.search/getVisits验证种子存在，并新增暂停/未连接时目录为空断言；原手动导入数量、恢复、去重、活动和持久化断言全部保留。

首轮正式 CI [41632026138](https://github.com/haohongfei2001-png/vaiwl-start/actions/runs/41632026138) 的197单元、基础浏览器18项、导入恢复9项及Edge作业通过；新专项在干净基线证据门失败。实际旧版生产安装和正常开启正例均PASS，暂停后改写历史的指定反例明确FAIL，但测试把整个node_modules软链接到旧worktree，旧版`node_modules/`忽略规则不匹配该软链接，使构建dirty=true。修正为被忽略的真实依赖目录，并在构建前断言worktree为空；保留dirty=false和唯一指定反例失败的全部要求，没有降低证据门或修改生产源码来通过此失败。最终以修正后的同SHA完整CI为准。

第二轮 [41632554788](https://github.com/haohongfei2001-png/vaiwl-start/actions/runs/41632554788) 的新自动历史专项14/14和干净旧版反证通过，37项Project本地组织、25项观察也通过；原启动专项在首次session503后恢复Project8失败。定向执行未修改生产collector复现：首次200正常OBSERVE=1，首次503随后200却发布null→principal并永久封锁同一面板，OBSERVE=0。该错误分类在旧源码已存在；先前通过可能受ROUTE事件交错影响，这是时序推断，当前无ROUTE反例则已确定复现。不将增加等待当修复。最小修改仅去掉“已有principal才拒绝暂时失败”的前置条件，不发布虚构匿名身份；保留真实401/空会话的身份切换和旧面板隔离。新增两项生产bundle回归修前1FAIL/1PASS、修后全PASS，完整本地verify199/199通过。原启动脚本、超时、Project解析器、身份模型和observer防护均未改动，继续要求完整同SHA CI通过。

## 前一专项：首次自动恢复与 Chrome RC 集成（2026-11-03）

继承6bc0b29的真实Mac `REAL_NATIVE_PROJECT_PASS`（Chrome 156.0.8078.80 / macOS 27.0），本地回执已核对；不上传私人标题、项目ID、URL、正文或截图。D1/历史/活动/书签已有实机证据继续继承。下面较早阶段的“真实来源未核验”不是当前状态。

干净基线的实际扩展在Reload后未自动观察已打开Project的迟到成员；同一专项在修复后14/14通过。新增7项单元反例，当前173项；生产仅改后台恢复与串行权限协调，不改页面、来源解析、数据库或标题裁决。新 `project-startup-validation.json` 已接入正式CI、验收矩阵与开发包。一次瞬时注册失败的新增反例先失败，再由一次250ms有界重试修复；另检查重试期间暂停不会重新注入。

隔离生产扩展测试区分“存储已写入”与“Start卡片可见”。原较早成员默认折叠不视为丢失。首次原生权限弹窗接受未由headless测试冒称通过；普通worker消息不触发全页面重注入。完整覆盖、审查边界和回退风险见 [Chrome RC说明](CHROME_LOCAL_RC.zh-CN.md)。最终精确SHA、全部门结果及包哈希以同SHA CI/包内回执为准。

## 上一专项：原生 Project 本地稳定组织（2026-11-03）

合同为[第13号修订](free-v1/13-NATIVE-PROJECT-LOCAL-AMENDMENT.md)，生产基线 `e21d7144`。新增多适配器、principal-only、稳定本地项目模型/投影及同文档身份切换测试；新真实安装浏览器专项 `tests/browser/native-project-grouping.mjs`，回执 `native-project-grouping-validation.json`、截图 `native-project-grouping.png` 已接入同SHA CI与开发包。只有实际回执标PASS的步骤才视为通过；没有本地Chromium可执行文件，不把未启动的浏览器写成通过。

独立审查推动实际修复：独立主体索引避免跨账号同ID覆盖；按边界保护墓碑；同文档换账号旧面板阻断与新面板恢复；新面板不能沿用旧主体去重缓存；瞬时session失败不复用旧主体写入、也不永久阻断正常面板。审查另实际复现并修复“新侧栏+旧主面板”混合批次跨主体错误，所有成员及名称来源共同参与隔离。原history/activity/正式归属路径保留。

首次集成单元为137/144，7个旧collector测试仍使用旧两请求和空OBSERVE协议。更新mock以验证新增LOCAL_IDENTITY token/代际并保留全部生命周期断言；正常本地路径改为单次session读取，不访问accounts。新增真实同文档身份切换反例，不用reload替代。原diagnostic两请求测试仍保留。最终单元数、实装检查数、浏览器版本及包哈希以同SHA CI/PR回执为准。

真实来源：本轮已实际读取两个指定开源项目固定SHA的元数据相关源码；本机Browser连接返回缺少originating browser context，因此当前已登录ChatGPT样本仍未核验。该真实来源限制独立列为P11，不关闭已实现的本地组织能力。无新增诊断器，不要求用户重导历史或重复完整Free V1验收。

首次同SHA CI `2142631c4dac49e557866a6c23c6b15b086491df` / [41605913182](https://github.com/haohongfei2001-png/vaiwl-start/actions/runs/41605913182)：166单元、构建/审计/打包、既有浏览器17+8+9+18+25+3及新增Project实装37项通过，Microsoft Edge继承生活/书签job成功。Chromium后续完整UI在 `UI-source-limit-visible` 失败：断开连接说明漏掉完整认证/全量同步未完成的明确声明，旧断言仍要求原单一归属措辞。修复为始终显示“完整账号空间认证与全量同步尚未完成”，同时断言本地项目仍保留、断开后不承诺新增活动。未删除检查；本次仅产品说明/对应断言/本记录变化，最终同SHA完整CI结果见原PR回执。

后续 `3cb4c4b4613465283040ddb19e41a90121731c26` / [41606440416](https://github.com/haohongfei2001-png/vaiwl-start/actions/runs/41606440416) 的类型/单元/审计/包与Chromium完整job通过（包括新增37项Project、原25项观察和67项UI）。继承Edge生活/书签job两次在同一缩放夹具初始化点失败：directPage先以1440px完成初始化，再改760px，collapsedRow只等旧visibleCount>0，读到了CSS已缩窄、ResizeObserver/RAF尚未更新hidden的中间状态。独立源码审查确认此测宽链及其生产代码未被Project修改。停止重试，仅将该直接页面夹具的760px设定前移至导航前；既有真实resize、实际setZoom、单行几何、inert及全部断言/超时保持不变。没有修改书签功能或Edge favicon；新提交的同SHACI和包结果继续见原PR回执。

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

## 2026-11-03 · 首页信息架构与时间范围投影

在17695ae的P1修复之上实施第14号合同：统一项目卡与最近、完整保留无日期成员、全局更早保留空/无时间项目、删除首页技术分类/常驻横条/书签重复设置，Chrome原生页脚仅设置内提供官方用户操作。新增纯时间范围推断与可选原生语义元数据采集，来源、身份和活动事实保持分离。数据库v1/12stores、P1代际/撤权检查不变。

本地Types、全单元、生产build和privacy audit已完成，确切计数与最终SHA以同构建artifacts/unit-validation.json及GitHub CI为准。独立审查已修复：不足锚覆盖直接历史、native顺序压过更晚Start打开、未来/倒退值借旧锚、scoped新记录拷贝旧时间事实，以及异步refresh回包绕过手势保护；保留新增反例。

新增home-workspace实装门进入Chrome/Edge CI，产出完整目录对照、主体隔离、搜索打开、pointer/drag/IME、生产collector时间推断/失效及内容区截图；其数据与ChatGPT页面为明确合成样本，不是用户私人目录。容器尝试下载Playwright浏览器时所得文件不是有效ZIP，因此本地没有执行实装，不把单元绿灯当浏览器通过。最终实际CI、失败修复和制品链接记录于原Draft PR #1。

真实用户Mac原位安装/旧新个人数据对照、Chrome原生页脚开关点击、Edge原生标签栏favicon、新时间适配器当前真实ChatGPT可用性保持独立未验收；不合并main、不发布、不卸载清库。第14号合同、平台来源及独立审查见docs/free-v1/14-HOME-TIME-PROJECTION-AMENDMENT.md和docs/evidence/home-workspace-20261103/。

### 首轮同SHA实装与针对性修正

`ddccfb9` / CI 41638415669：Types/domain/package成功，233/233单元；Chrome基础18、导入恢复9、自动历史P1 14通过。Chrome privacy在旧“无日期缓存会话应在首页可见”的选择器处FAIL；按第14号合同改为准确URL的全历史搜索，保留原3秒和session pending断言。Edge生活/书签44通过；新增home专项在设置dialog两个data-close按钮的模糊定位处FAIL，改为精确关闭设置名称。原失败日志与制品保留。

真实截图发现未配置书签时仍出现“选择显示方式”的重复设置引导，已删除该首页分支，设置里的显示偏好/权限申请保留。最近的interval-only行补按领域rank与精确日期行共同分组，防止可靠相对顺序被UI置底。新增回归；没有放宽安全条件或删除测试。独立浏览器步骤现在在build成功后全部运行，即使较早专项失败也保留其他专项的实际结果，任何失败仍使CI失败。

### 第二轮同SHA实装与精确失败修复

`fb536c7` / CI 41639391138：Types/domain/package与236项单元通过。Chrome基础18、导入9、P1自动历史14、隐私9、来源18、Project观察25、本地Project37、启动14、存储故障3、原生体验44、升级6、性能5均通过；生活/书签记录45 PASS与1原生NTP缩放BLOCKED，该已知平台自动化限制不冒称通过。

Chrome和Edge的新首页专项都完成前31项，随后在合成原生时间页面未取得成员而FAIL。夹具标题形状不符合现有支持语义；改用共享HTML的明确标签及标题/预览结构，单元和浏览器读取同源夹具。没有放宽生产标题解析器、身份或权限检查。

Chrome完整UI在564历史日期组断言FAIL。统一“最近”组件后，资料库切换的旧区域仍存在，原waitFor立即返回而后台SNAPSHOT尚未更新。独立领域与UI复核在普通/午夜两种时刻均得到30组、每日6条；实装测试改为等待此夹具独有的staging记录，保留30组、564全库、分页、只读与搜索原断言，并记录各分项实际值。新增跨94日/4区间的真实领域→UI整合回归。最终浏览器结论仍以修复后同SHA执行为准。

第14号H01–H14已接入正式验收脚本；同时修正旧矩阵中三类已更名UI检查的引用，避免通过记录被误报NOT_RUN。所有个人设备、真实时间来源与原生浏览器界面限制保持独立。
