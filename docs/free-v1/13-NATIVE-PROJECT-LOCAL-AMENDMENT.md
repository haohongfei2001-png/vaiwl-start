# Free V1 · 原生 Project 本地稳定组织修订

合同 `VAIWL-START-FREE/1.0`；修订 `2026-11-03-native-project-local`。授权来自本轮用户明确的“原生 Project 归属架构纠偏与实际开发”。本修订替换第10/11号修订中单次观察随机键、可靠原生关系只能显示候选的限制；第12号生活/书签功能原样继承。

## 三项独立能力

| 能力 | 产品语义 | 不依赖的条件 |
|---|---|---|
| `NATIVE_PROJECT_LOCAL_GROUPING` | 直接观察到的原生 Project ID、名称和会话关系形成持久本地项目卡，正常浏览持续更新 | 无需完整当前 Workspace 认证或全量成员清单 |
| `ACCOUNT_WORKSPACE_CERTIFICATION` | 可信 principal + 当前选中 workspace + 文档见证产生正式 AccountScope、ProjectRecord 和 PROJECT/NONE | 仍按原强认证路径独立验收 |
| `FULL_PROJECT_SYNC` | 完整成员、分页完成、成员移除和跨账号完整同步 | 本轮不声称完成；成员缺席不是删除或 NONE |

第一项的代码/隔离浏览器通过不能冒称当前真实 ChatGPT 来源通过；后两项未完成也不能否定第一项的实际工程能力。

## 原生关系来源

1. 原生 Project 页面：严格旧面板适配器继续保留；另有独立语义适配器核对唯一原生标题、被选中的 Chats/对话 tab 与双向关联 panel，不依赖固定 DIV/SECTION/OL 层级。标题与会话标题分别读取。
2. 显式 Project 会话路由：`/g/g-p-<32hex>(-安全slug)?/c/<UUID>` 直接表达 ID 关系；普通 `/c/UUID` 或通用 GPT 容器不能据此建立项目关系。未取得安全标题时保存 null，不读取 document.title 或正文补全。
3. 原生侧栏：限定原生导航边界，项目标签只能在同一成员链接携带明确 Project ID 时提供名称。只有名称、相邻历史、资料空间卡片不能建立成员关系。
4. 只有 Project 标题而尚无成员面板的页面可保存独立项目元数据；该来源不得携带成员。空列表、分页、暂时未加载和离开页面不减去已有成员。

路由中的名称 slug 不是身份。各适配器独立校验，后台再次核对精确 URL/ID、字段白名单和成员唯一性。仅读取允许的链接、标题叶与元数据属性；不读消息、预览、草稿、附件、HTML 或完整会话 JSON。不调用竞品的 gizmos/conversations 接口。

## 主体隔离和文档绑定

正常采集使用既有同源 `/api/auth/session` 的有界 JSON 读取，只取 `user.id` 的摘要与有效 `expires`。不要求 token，不提取/发送 token，不请求 accounts roster，不从默认/唯一 workspace 推断当前空间。该来源只用于本地隔离，不认证 Workspace。

有主体时项目键为 Profile + 主体摘要 + Project ID，跨重载、浏览器重启和同主体新标签稳定。无主体时为 Profile + browser session + documentId + 身份代际 + Project ID，只在同一已绑定文档内稳定，不能跨未知文档自动合并。未知重载可能保留独立项目卡，这是身份边界，不按名称合并消除。

`HELLO → LOCAL_IDENTITY → OBSERVE → observeLocalProject()` 为独立生产路径。元数据去重后、提交前重新读取主体；后台签发短时身份 token，并校验 sender、真实 documentId、href、routeEpoch、scopeEpoch、采集开关、权限、token 和过期时间。SPA 重新绑定路由但保留同文档身份代际；已确认主体变化会旋转代际并拒绝旧事件。

主体变化时不得把旧面板解释成新主体的关系：所有贡献成员或名称的旧 surface 都被阻断，新替换的来源可重新观察；侧栏更新而主面板仍旧时不接受混合批次。首次尚无成功观察的切换保守拒绝当前面板。瞬时来源读取失败不使用旧主体提交，也不伪称退出账号；有界重试成功后可继续同一面板。明确未登录结果使旧主体失效。

## 独立本地模型与无损写入

`LocalObservedProject` 保存稳定键、ID、名称、Profile/本地边界、来源种类、最后文档摘要/路由、观察时刻、`trust:'native-relation-observed'` 与 `membershipCoverage:'observed-only'`。空项目有独立记录。会话的可选 `localProject` 保存明确关系或冲突；正式 membership 继续 UNKNOWN，owner 继续 unassigned。

首次直接观察可复用原未分配目录记录，保持原 key、owner、firstSeenAt、browserLastVisitAt、activity、OpenDays 和 stableRank。只增加局部关系、更新有效原生会话标题，不把这些旧日期认证为账号活动。已属于另一边界的同 ID 创建独立本地记录，不复制旧标题/日期/活动；内部 ownerKey 索引同步分区。原用户墓碑继续有效，已隔离到 A 的墓碑不删除 B 的同 ID。

同一本地边界对同一会话观察到不同 Project 是冲突，不按到达顺序自动搬移。关系变为 conflicting 并回到待归属；项目元数据和原会话目录仍保留，重放任一旧观察不能消除冲突。正式 PROJECT/NONE 或撤销/冲突证据不受本地观察覆盖。

数据库保持 version=1 和12个store。独立本地项目行存于现有 settings store 的 `localProject:` 前缀，主设置仍使用 `main`；旧构建可打开同一数据库并忽略新项目行。没有 schema 升级、数据重建或目录迁移。回退会失去新版投影能力，旧版后续写入不承诺维护它不认识的可选本地关系字段；原目录/活动仍可读。显式清除全部本地数据才清除此前缀，本轮不执行清除。

`confirmObservation()` 不接收本地观察；正式 scopes/projects/witnesses 不写入假证明。旧 localProjectCandidate 数据继续读取兼容，只有新的明确观察才走独立本地模型，不批量升级旧候选。

观察有界且仅覆盖当前已渲染元数据：每个IPC最多200条成员；未显示、超限、未支持语言/结构不声称已完整收录。未知主体新文档、首次身份变化或跨主体复用旧DOM均保留独立边界，不用全量接口补齐。完整分页和成员移除属于独立FULL_PROJECT_SYNC。

## 首页与搜索

本地项目显示“原生项目 · 本地已观察”，详情说明主体隔离或本文档边界及空间未认证。项目卡使用稳定 key；项目改名不变身份，同名不同 ID 不合并。成员按原冻结30日历日投影，父项目随成员最新有效展示时间定位，旧成员保持在父卡内。没有日期与空项目保留可达卡片；被项目消费的成员不重复出现在普通 UNKNOWN 日期列表。全目录搜索支持原生项目名、成员标题和 URL；空项目也可搜索。

继续继承 D1 标题保护、原历史/活动、生活模式、原生书签和浏览器开窗行为；不重做既有实机验收。

## 验证与交付边界

新 `tests/browser/native-project-grouping.mjs` 在隔离 Profile 实际安装生产扩展，校验构建字节，使用合成 HTTPS Project/session 页面并操作真实 Start UI。验证空卡、成员、迟到更新、重复访问、改名、slug、同名不同ID、同主体重启、不同主体/文档/Profile、同文档切换、撤权与旧事件，以及原目录/标题/活动/搜索保全。回执 `native-project-grouping-validation.json` 与开发包同 SHA。

真实已登录 ChatGPT 样本仍独立核验。本轮连接的本地浏览器上下文不可用；不请求用户反复运行诊断，不用合成结果填补实机来源。保持原分支与 Draft PR #1，不合并、不发布，不处理 Edge favicon。

## 已实际阅读的公开源码

- [chatgpt-project-sidebar content.js](https://github.com/imranbarbhuiya/chatgpt-project-sidebar/blob/d77de5f0e7a65fefe8da7e7c44dd6250832dcf4d/src/content.js)：原生标题控件、Project 页面链接、侧栏项目标签和增量缓存。
- [core.js](https://github.com/imranbarbhuiya/chatgpt-project-sidebar/blob/d77de5f0e7a65fefe8da7e7c44dd6250832dcf4d/src/core.js) 及 [slug 测试](https://github.com/imranbarbhuiya/chatgpt-project-sidebar/blob/d77de5f0e7a65fefe8da7e7c44dd6250832dcf4d/tests/core.test.cjs)：Project/会话 ID 与名称分离；不采用其按名称回连缓存。
- [chatgpt-exporter content.js](https://github.com/vincze-tamas/chatgpt-exporter/blob/56422972f8c798812a9028bee2009413f94949d9/content.js)：只研究 Project 链接 ID 及项目成员分页的元数据关联。没有移植正文抓取、令牌处理或内部接口调用。
