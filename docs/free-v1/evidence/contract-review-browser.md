# 浏览器数据合同独立复核

范围仅：`01-PRODUCT-SPEC.md`、`03-DATA-CONTRACT.md`、`contracts/free-v1.ts`、`contracts/manifest.example.json`。未修改被审文件。备份/恢复已知将移出 V1，不对此重复阻断。

## 阻断：P0 — 候选打开后的当次活动没有确定写入目标

**位置**：数据合同 §1、§5.4–5；TS `OpenIntent.targetRecordKey/expectedScopeKey`、`CandidateResolution`。

从 staging 条目点击时 `targetRecordKey` 必定是候选 key，`expectedScopeKey=null`。抵达时若 metadata 首次证明账号 A，规格只说“身份未证只可提交到未分配”“expectedScope 不匹配拒绝”，没有规定当次新事件写入 A 还是仍写候选。CandidateResolution 又明确禁止迁移活动。

**可复现后果**：Codex 把本次活动写到候选，A 中已确认 Project 的 scoped record 仍无活动；或者写两边导致一个动作两份活动；或把 null 当 mismatch 拒绝所有首次解析。

**最小修订**：保持 `requestedRecordKey` 不变，增加 `resolvedRecordKey/committedRecordKey`。null 表示请求未绑定账号而非真实账号；抵达已证 A 时，本次新事件只写 A 的 scoped record，建立 candidate link，不搬任何旧活动。抵达仍无身份时只写候选。请求本来绑定 A 而抵达 B 时必须拒绝。活动/解析链接/意图消费同事务。

## P1 — 意图未冻结时区，设置变更可把活动记错日

**位置**：产品 §4.1/§4.2；数据 §5.6；TS `OpenIntent`。

按 issuedAt 与资料库时区记日，但 OpenIntent 没有保存签发时 Z/localDate 或时区版本。用户在60秒待抵达期内从 UTC+8 改为 UTC-5，消费方读取新设置，便会将同一已签发动作落在另一个日去重键。

**最小修订**：intent 保存 `issuedTimeZone`、`issuedLocalDate`（worker计算）或不可变设置revision；消费使用冻结值。设置变更只影响之后的新意图和投影，不能重解释 pending intent。明确 activity summary 中的日期/时区表示最近那次已确认事件的签发日，而当前首页段可用时间戳在当前 Z 重新投影。

## P1 — Project URL 被声明为 conversation-only URL

**位置**：TS `ConversationURL` 与 `ProjectRecord.canonicalUrl`。

ProjectRecord 的 URL 类型用 `ConversationURL`。如果 Codex 复用会话路径验证器，就会拒绝合法 Project 首页 URL；如果放宽，会把 Project 首页误纳入会话目录。

**最小修订**：单独 `NativeProjectURL` 类型/验证器，ProjectRecord 用该类型；不改变会话导入 parser。

## P1 — “新聊天获得 ID 后记活动”没有可表达的意图

**位置**：产品 §4.1 末句；TS `OpenIntent.targetRecordKey/targetConversationId/targetUrl`，`OpenIntentEvidence`。

当前合同只表达已有具体 conversationId 的 Start/原生链接目标。点击“新聊天”时没有目标会话ID；后续生成ID时不能凭路由变化反造一个指向已知ID的旧意图。若实现者试图实现该句，会新增对提交或输入行为的监听，或把自动路由误计。

**最小修订**：V1 删除“同一有效主动创建链可记”的承诺，明确首次得到 ID 可以收录目录，只有随后对已有 ID 的确认主动打开才计；若一定支持，应另写受限 creation intent 合同，这会增大范围。优先前者。

## P1 — 删除墓碑没有覆盖候选别名的重新出现

**位置**：产品 §5“防重导入墓碑”；数据 §3/§8；TS `Tombstone.key`。

墓碑只存精确 scoped record key。A scoped 记录被删除后，history 导入使用 `unassigned + conversationId` 另一个 key，仍可再次显示为候选；反向情况也一样。现有 CandidateResolution 明确给出两者联系，却没有要求删除/重导入归约查询它。

**最小修订**：明确墓碑只对当前资料库生效；候选映射已证明属于被移除 scoped record 时，当前资料库投影与再次解析遵守该墓碑，不能自动复活。独立账号 B 的记录不受 A 墓碑影响。若删除 staging 候选，后续导入同 staging key 保持隐藏；新鲜真实主动打开是否明确视为恢复需固定一种规则。不要改成所有账号共用一个 cid 墓碑。

## P2 — 同一索引的字段名需要统一

数据表写 `[pinned,order,id]`，说明又要求实际 `pinnedIndex`；建议直接把表改为 `[pinnedIndex,order,id]`。活动索引 `lastActiveAt` 应明确映射 `activity.lastConfirmedOpenAt`，否则工程会生成两个不一致字段。已有“平铺派生字段同事务”规则正确。

## 已核对无阻断

- Manifest 的 storage 必需、history/scripting/webNavigation/ChatGPT host 可选符合能力边界；无需 tabs 权限，无全站权限。
- 只对 fresh address-bar commit 做有限支持，拒绝 forward_back/redirect/reload/start_page，且默认禁用待双浏览器验证，避免了已知脚本历史导航误判。
- browserSessionId 放 storage.session，业务/intent 放 IDB，重启旧 intent 失效，方向正确。
- 历史不回填活动；分时二分、重叠去重、最小时间片饱和标 PARTIAL，避免默认100/24小时与伪完整问题。
- UNKNOWN 独立、NONE要求显式语义证据、不把缺字段当NONE，以及不同账号同ID分开均清晰。
- 当前合同不把本地标签伪装账号，且明确长期全UNKNOWN不能通过完整V1验收，边界诚实。

结论：先修复 P0 的“首次账号解析活动去向”，再消除时区、新聊天和 URL 类型三处直接实现歧义；其余不需要重做架构或扩大首版。

## 有限收口复核（2026-11-02）

状态：**BROWSER_CONTRACT_GAPS_CLOSED**。本次只复核上述已报 P0/P1 的修改与对应验收条目，没有运行测试、扩大审查或作真实浏览器通过声明。

| 原差额 | 修订证据 | 收口 |
|---|---|---|
| staging 首次绑定活动去向 | schema 区分 target/resolved/committedRecordKey；数据 §5.5 规定本次只写 resolved、旧活动不迁移、预期A抵达B拒绝；O13/O14覆盖 | 关闭 |
| 待抵达期间时区变化 | intent 冻结 issuedTimeZone/issuedLocalDate；数据 §5.6；O15午夜、O16时区变更分别验证 | 关闭 |
| Project URL 与会话 URL 混用 | 独立 NativeProjectURL，ProjectRecord 使用该类型 | 关闭 |
| 新聊天创建链超出意图Schema | 产品 §4.1明确首次生成ID仅收录，后续明确打开才记；O18覆盖 | 关闭 |
| staging 别名绕过A墓碑 | 数据 §8通过CandidateResolution在投影与再解析检查A墓碑，B独立核验可用，恢复必须明确；D07覆盖 | 关闭 |
| HTTP/BFCache 与用户主动性混淆 | 数据 §5.4以有效意图和active文档关联判断，HTTP缓存不决定主动性；O17覆盖 | 关闭 |

这些结论表示开发合同已消除本轮发现的实现歧义。O13–O18、D07等仍是后续实现验收要求，尚未被执行为产品测试；Chrome/Edge和ChatGPT真实来源准入门保持原状态。
