# 给 Codex 的正式开发指令

你接任 **VAIWL Start Free V1** 唯一实现负责人。本轮直接开发已经冻结的产品，不再重新讨论定位、另做UI方案或扩大为浏览器项目。

## 仓库与权威

- 唯一可写产品仓库：`haohongfei2001-png/vaiwl-start`。
- 设计分支：`design/free-v1-20261102`。开始先取远端最新状态与该分支的实际SHA。
- 从这条设计分支建立 `codex/free-v1-implementation`（若已存在先接管已有进度，不另建竞争实现）。不要把尚未合入main的设计文件漏掉。
- 按顺序读 `docs/free-v1/00-READ-ME-FIRST.md`、01–06、`contracts/free-v1.ts`、`contracts/manifest.example.json`、09。
- 打开 `design/free-v1/prototype.html`，核对desktop/search/first-install/history-import/narrow预览。HTML是设计样稿，不可直接作为生产扩展。
- 原仓 `haohongfei2001-png/Virtual-AI-Workspace-Layer` 只读。继承基线为 `1903b00f774b4fd7f3d15b3669878c32e2c7a9c8`。开始核对PR#16新HEAD；仅对与身份/归属/纯时间函数直接相关的新差异增量核查，禁止重读全仓和全部评论。不得改原仓。
- 合同版本 `VAIWL-START-FREE/1.0`。当前用户新指令优先于此文；原仓宿主挂载与消息审计不自动成为Start要求。

## 必须先完成的实际技术竖切

先按04与05的M0实现一个最小新MV3包，验证**无需正文的稳定principal＋当前context＋正确Project成员＋正向NONE＋一次主动打开**。

已知事实不要重新绕圈：

1. 原Free的30日纯函数、最新活动排序与v2.7视觉可以继承。
2. 原BrowserLocal没有生产稳定identity reader；roster不证明当前context。
3. 原Project入口/成员有局部实机证据，宿主挂载尚未通过；Start不需要那套挂载。
4. 原正向NONE仍BLOCKED，普通/c/与没有badge绝不够。
5. `readCurrentConversation()`读取完整消息JSON，禁止直接或间接进入Start。

先摘出session-only已知固定GET和有限响应检查，不导入完整conversation/消息解析依赖；token仅在受控函数内存。以原限定Project DOM关系为候选，严格核验scope。NONE只有现场验证的明确原生状态或不含正文的窄metadata才可开启；不得编造端点、当前context或null语义。

真实源不可访问时，把准确缺口与最短复现持久化，关闭未证明能力，继续完成不依赖它的本地目录/首页/网站/纯模型。没有新证据时停止反复放宽选择器或增加诊断额度。所有典型会话长期UNKNOWN的版本不是完整Free V1，不能通过改完成标准把它变PASS。

## 冻结实现

- Chrome/Edge新标签页；真实ChatGPT始终在正常浏览器tab打开。
- 只记录会话ID/标题/URL、原生Project关系、必要身份键、主动打开与网站快捷项；无聊天正文、AI回复、草稿、附件、整页DOM、完整conversation响应。
- 项目下一行就是一条会话；NONE按最后确认主动打开日形成日期窗口；UNKNOWN和账号未分配独立可达。
- 活动来自正向意图＋精确到达。同会话每日一个OpenDay；同日最后时刻可更新。不用history.lastVisitTime、tab激活、刷新、恢复、自动后台加载伪造活跃。不写UserSendEvent。
- 请求staging记录首次抵达确认账号A时，本次活动只写resolvedRecordKey=A；旧候选历史不迁移。预期A却到B则拒绝。
- 默认当前Start标签打开，修饰键遵循原生习惯；不移动/重排/批量/自动复用其他真实tab。
- 固定30个当地日历日、P单段、旧成员留父卡、空段不跳、k=0无上箭头。沿用纯函数，不自行发明活跃评分。
- UI遵循正式样稿：白底、轻灰P头、紧凑会话行、左侧旧项、5/+12、右缘上下30天；不增加网页左栏、大搜索引擎框、统计仪表盘或AI入口。
- 网站新增/固定/排序/折叠；固定只保留折叠时可见，用户order不被重新排列。
- 不拦截Cmd/Ctrl+K/L等原生地址栏操作。站内搜索点击或页面非编辑状态的`/`开启。
- IndexedDB事务、scope隔离、sessionId/documentId/routeEpoch、幂等打开与导入checkpoint必须真实实现。worker可自然退出。
- 仅storage安装必需；ChatGPT连接和history按用户动作分别请求可选权限。无需tabs/cookies/webRequest/debugger/all_urls。
- 不开发Pro、AI API、跨扩展实时同步、备份恢复UI或全量服务器爬取。共享只保留版本化接口。

## 实施与验证

按M0来源竖切→M1纯模型/IDB/目录→M2完整首页→M3真实采集/活动→M4双浏览器连续验收执行。纯函数可并行，远端代码保持唯一writer。

运行与变更风险相符的有效测试：源/权限/正文禁止链、scope竞态、活动去重、午夜/DST/30日边界、IDB重启、URL混淆、历史饱和、真实P/NONE与Chrome/Edge旅程。复用旧不变量，不复制原仓所有测试/诊断历史。只有明确新风险或必要gate才增加测试；不要为了数量做镜像测试。

所有验收按06记录PASS/FAIL/BLOCKED/NOT_RUN，绑定实际build SHA。样稿验证不能填写为扩展或真实ChatGPT通过。最终交付可加载开发ZIP、安装说明、核心实际流程证据和准确剩余阻断；保持Draft PR，不合并main、不发布商店、不部署网站。

## 执行纪律与上下文预算

先完成工作再报告，不反复请求已经授权的可逆研发确认。确实缺少账号现场或必要权限时，只提出一项能解锁来源门的具体动作，并说明它会验证什么。

不读取全仓、整本STATUS或全部PR评论；单次文件输出≤150行、日志只输出摘要/失败定位。长任务每完成一个可验证阶段就提交工作分支并更新一份`docs/IMPLEMENTATION_STATUS.md`，记录HEAD、已完成/失败、下一项和复现命令。不创建并行第二套计划；为验证和交付预留上下文。中断时留下可继续的代码、测试回执和工作树状态，不能只留口头总结。

完成之后用用户能听懂的语言说明：现在首页真正能做什么、真实数据取得了什么、哪些入口的活动能准确记录、哪里还有来源限制。不要以架构术语或一个绿色CI代替产品结果。
