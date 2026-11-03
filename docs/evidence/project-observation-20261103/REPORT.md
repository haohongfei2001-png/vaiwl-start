# Project 识别收口：实际能力、增量修复与剩余来源条件

日期：2026-11-03（Asia/Shanghai）。正式分支 `codex/free-v1-implementation`，原 Draft PR #1。实施基线 `dd8d8051136b9bbcff72975cdcc0e698a3fbaa1a`；该基线 GitHub Actions `41543264426` 两项作业成功，Edge 原生 favicon 独立失败继承。

## 裁决

**`PROJECT_BLOCKED`：正式原生 Project 识别仍未完成。** 本轮实际修复正常浏览期间的候选增量观察、过期面板防护及诊断结束后的观察恢复。不能把候选能力或合成浏览器通过写成正式 Project 可用。

本轮用户提供的最新实机状态为：D1 PASS、历史目录/活动/书签 PASS、D2 NOT_REPRODUCED。本轮继承，不重跑、不重新导入、不替换用户日常安装、不合并 main、不发布。

## 1. 根本阻断来自哪里

当前生产代码链路是：

`原生 Project 路由和严格 DOM → HELLO 文档绑定 → OBSERVE → 未分配会话.localProjectCandidate`

它并没有进入：

`当前账号及 workspace 身份见证 → 同一文档/路由/身份生命周期中的成员见证 → 正式 projects / PROJECT membership`

证据：

- `src/collectors/chatgpt/profile.ts` 的 `currentContext`、`projectMembership`、`positiveNone` 仍为 `false`，`liveVerified=false`。
- `identity.ts` 的现有固定 session reader 能取得 principal 和可访问账号空间 roster，但 production `readStatus()` 只返回候选/失败状态。roster/default/唯一 personal 不是当前文档所选 workspace 的证明；`default.account_id=null` 不能构造稳定 scope。
- `service-worker.ts::collectorCommand` 只接受 `HELLO`、`OBSERVE`、`SOURCE_STATUS`；成功候选返回 `membership: UNKNOWN`。
- `repository.ts::confirmObservation()` 已有正式写入约束，但在 `src` 下没有生产调用；测试注入不等于正式接线。

所以，即使真实 DOM 完全匹配，旧候选也不可能自动成为正式 Project。缺少真实样本不能被重述为“解析器一定错误”；单改 capability 常量也不能修复缺少身份来源和生产 admission 的问题。

## 2. 当前可以提取并保存什么

| 信息 | 当前来源与条件 | 实际保存位置 / 语义 |
|---|---|---|
| Project ID | 既有严格 `/g/g-p-<32小写hex>/project` 路由 | `localProjectCandidate.projectId`，不作为账号证明 |
| Project 名称 | 唯一可见原生边界内 `h1 > button` 的受限标题叶 | `localProjectCandidate.nativeTitle` |
| 成员 conversation ID、URL | 已关联的选中 tab/panel 内严格成员列表链接 | 现有 staging conversation record，仍 UNKNOWN |
| 成员标题 | 成员 wrapper 第一 DIV 的纯标题叶 | `conversation.nativeTitle`；第二 DIV 预览不读取 |
| 候选组 | Profile + browserSession + document binding + observation + Project ID | 同一次局部观察的候选 key；不跨观察合并 |
| 当前账号空间 | 尚无认证来源 | 不创建 `AccountScope` / 正式 `ProjectRecord` |
| 正式成员删除、NONE | 尚无正向来源；列表是 observed-only | 不由当前页面缺失推断，不删除已保存目录 |

DB 名、v1、12 store、主键、历史日期、OpenDays、墓碑、候选解析关系没有迁移或重建。没有添加权限或网络端点，也没有接入正文或完整 conversation JSON。

## 3. 已实施的代码修复

### A：可确认的有限采样缺口

旧 `knownProject()` 在累计 0 / 120 / 420 / 1020 / 2220 ms 尝试，第一次解析成功即结束，之后不观察 DOM 更新。由此可确定：晚于采样窗口的面板、空列表稍后出现成员、首次成功后的改名/新增/后续局部渲染，都可能永久漏收直到下次路由。

新增 `src/collectors/chatgpt/project-observer.ts`，由 `content-entry.ts` 正常观察入口接入：

- 仅在当前受支持 Project 路由存在时监听；沿用原严格解析器，不增加宽泛 selector fallback。
- 120 ms 固定合并窗口、单一发送在途；发送期间的新变化合并成随后一次最新快照。
- 只按 Project/成员 ID、名称和 canonical URL 去重；成员顺序规范化，重复重绘与预览变化不反复写库。
- 成功 ack 后才记已保存快照；临时 IPC 失败自动重试一次，没有无限重试/轮询。
- DOM 变化不重新读取 session。路由变化才走原身份状态刷新。
- ROUTE、pagehide/BFCache、STOP、停采、撤权通过现有绑定和生命周期失效；停止后的迟到回执不恢复采集。
- 合法诊断临时占用采集器后恢复正常观察；畸形诊断请求不能占用生命周期或触发额外 session 请求。

### A：已知旧 SPA 面板不能直接成为新 Project 候选

浏览器路由可能已从 P 变为 Q，React 却仍显示 P 的标题/成员。新观察器保留同一 document 内上次严格解析得到的 panel 引用。跨 Project 复用这张旧 panel 时，仅改标题或只更新一条链接都不能让整表归到 Q。

允许恢复候选观察的条件是：面板被替换，或原解析器确认**完整已解析列表的每条成员原链接**都显式关联当前 Q。后者在原 256 成员解析上限内、截断 IPC 到 200 条之前计算；空列表不构成全表关联。`metadata.ts` 只额外返回已验证 panel 和此布尔值，原解析条件、诊断 `containerLinked` 和候选 IPC 均未放宽。

这阻止已知的旧面板过渡，不证明其他未见过的 SPA 结构、同 URL 账号切换或正式身份。来源不足仍保持候选/UNKNOWN。

### B / C / D：不伪造的边界

- **B 解析器兼容问题：未证实。** 没有当前已登录真实 Project 元数据样本，因此不猜改 DOM 结构。
- **C 来源接线：确有缺口。** 现有正式写入原语没有生产入口；但缺少可信 current workspace 来源时，无法安全制造需要传给该入口的身份见证。
- **D 实际来源访问：本轮 BLOCKED。** 本机 Browser 工具返回缺少 originating browser context；独立 cloud ChatGPT 首页实际显示登录/免费注册，没有可读取的已登录 Project 样本。没有要求用户操作诊断器，也没有尝试绕过登录或读取未授权接口。

## 4. 候选与正式归属的准确区别

严格路由、标题、panel 和成员结构全部匹配时，生成局部候选并保存到未分配记录；不匹配就不生成候选，原记录继续 UNKNOWN。候选从来不升级为 NONE 或 PROJECT。

将来生成正式 Project 必须有同一当前文档的 active principal + active workspace 稳定身份、绑定的原生项目及成员见证，以及生产 admission。当前这条链路未完成，所以本版本没有任何真实场景被宣称已认证 PROJECT。正式 NONE 也没有启用。

空 Project 可解析为零成员候选，但现有候选按会话记录保存，尚无独立持久空项目卡。分页/移除/虚拟化导致本次少见一名成员时，只保留新局部观察，不推断删除；较早记录仍保留上次候选。因既有合同不跨观察合并，同名项目的不同观察可能形成多个明确候选卡。不能将它冒充正式完整项目清单。

## 5. 测试与失败记录

### 本地实现树验证

- `npm run verify`：TypeScript、**121/121 单元/领域/事务测试**、真实生产构建、8 项隐私/权限/依赖审计通过。这是提交前 dirty 实现树结果；最终 clean SHA 以 CI 与构建回执为准。
- 新增 `tests/unit/project-observer.test.ts`：**11/11**，使用受控计时器，不靠长睡眠。body/documentElement/preview 的 textContent/innerHTML/outerHTML 设抛错哨兵，私密读取次数全部为 0。
- 新增真实构建浏览器门 `tests/browser/project-observation.mjs`，接入现有 CI，结果写 `project-observation-validation.json`，打包检查并收录同构建回执。

| 场景 | 工程覆盖 | 正式来源结论 |
|---|---|---|
| 受支持 Project ID、名称、成员提取；空/单/多成员 | 新单元 + 已安装扩展脚本 | 仅合成样本，不认证当前原生结构 |
| 迟到加载、同页成员新增/改名/重排 | 新时序单元 + 浏览器门 | 按原严格 parser 增量运行 |
| 同标题不同 ID、同 ID 重复观察 | 独立身份和去重断言 | 不使用名称作身份 |
| SPA 旧面板、标题先变、混合新旧链接 | 新单元正反例；浏览器实际 pushState | 不由新路由推断全部旧成员已变化 |
| 缺失/空列表、移除/分页 | 目录保留、无 NONE/删除 | 不宣称获得完整删除事件 |
| 账号/资料库/Profile | 继承 scope/事务边界单元；浏览器第二 Profile 与合成账号切换 | 真实当前账号空间仍 BLOCKED |
| STOP、真实撤权、旧 route/document IPC | 生命周期单元 + 实际浏览器绑定/permissions.remove 门 | 不以合成通过替代用户 Profile 实测 |
| UNKNOWN / PROJECT / NONE 隔离 | 不写 projects/scopes/witnesses/OpenDays | 正式归属入口仍关闭 |
| 30 天、搜索、历史与活动保全 | 继承已有合同断言并由既有 CI 自动门验证 | 不重跑已通过的用户全量验收 |

**本轮真实失败及修复：** 第一次完整本地 verify 在既有 malformed-probe 测试失败，121 项中 120 通过。新恢复逻辑对 schema 校验失败也调用 observe，额外发起 session 请求，实际 6 次而预期 2 次。已改为只有通过完整校验并实际取得采集生命周期的 probe 才可恢复，原测试断言未改；最终 verify 121/121 通过。

**浏览器执行边界：** 本地没有 Chromium 可执行文件，官方 Playwright 下载返回 HTML 而不是 ZIP，因此基线浏览器没有启动，不能写 baseline RED。正式 CI 必须实际运行新增门；其结果不可由脚本存在、单元通过或旧 CI 替代。所有 HTTPS 页面及既有 session 响应均为合成夹具，生产 JS 原字节哈希核对；不使用用户的真实 Profile。

## 6. 独立审查

独立只读审查覆盖正式生产 diff、11 项新增单元、浏览器门、既有身份/存储/投影边界。审查实际指出并促成两处修复：SPA 标题/局部链接更新绕过旧面板防护，以及 malformed probe 触发额外身份请求。最终审查及同 SHA CI 结果由 PR 正式回执记录；不把第二个代理的审查说成真实来源验证。

## 7. 完成正式 Project 所缺的具体条件

1. 当前已登录文档所选 **principal + workspace/context** 的稳定元数据来源，含切换时失效规则；不是可访问 roster 或界面昵称。
2. 一份当前真实 Project 的受限元数据结构，确认原生路由、标题叶、成员容器及链接对应关系；无需任何聊天正文。
3. 在以上来源成立后，将身份和成员见证绑定同一 document/route/scope 生命周期，接入正式存储，并完成一次有界实际来源验证。
4. 若要宣称成员被正式移出，还需明确的移出事件或完整集合证明；渲染缺失不够。

这不是增加新的 M0 诊断循环，也不是重新导入用户历史。当前可验证的增量工程已经实施；没有证据时不启用假身份或候选升级。

## 8. 官方概念依据与最终集成建议

OpenAI 官方明确说明 Space 替代 Library，但 Projects 仍独立存在；账号切换与账号内 workspace 切换也不同。因此不能把资料空间卡片当作原生 Project，或用账号空间 roster 代替当前选择：

- [Getting started with Space in ChatGPT](https://help.openai.com/en/articles/20001549-getting-started-with-space-in-chatgpt)
- [Using multiple ChatGPT accounts on web and mobile](https://help.openai.com/en/articles/20001068-using-multiple-chatgpt-accounts-on-web-and-mobile)

这些用户帮助资料不提供稳定 DOM schema 或当前 workspace 元数据读取合同，也不授权新内部接口。

**集成建议：保留本次候选采集修复在原 Draft PR #1，完成同 SHA CI；不合并、不发布、不标 FREE_V1_ACCEPTED。** 除已知 Edge favicon 失败外，真正影响完整 Free V1 交付的仍是正式 current-context / PROJECT / positive-NONE 来源与生产接线；空正式 Project 和真实成员变更验收属于这条未完成链路。用户已确认通过的 D1、历史、活动与书签不重新列为待验收，D2 NOT_REPRODUCED 不重新列为可复现缺陷。
