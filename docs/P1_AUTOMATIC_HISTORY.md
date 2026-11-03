# P1 自动历史采集授权修复

基线：`5ad87bab060d321754cc65d073ac8736ea35b47e`。继续原分支 `codex/free-v1-implementation` 和 Draft PR #1。本次只修复自动历史监听的停止与撤权语义；交付 SHA、完整 CI 和包哈希以 PR 及同 SHA 制品为准。

## 已确认缺陷

独立审查发现 `history.onVisited` 只检查 history 权限，随后直接调用与手动导入共用的 `discoverCandidates()`。因此持续收录关闭、ChatGPT 连接断开，以及 `getVisits()` 期间撤销 history 权限，均可能继续保存 URL、标题和浏览时间。三个生产 worker 反例在干净基线分别新增一条本应拒绝的记录。

## 最小生产改动

- 自动路径改用独立的 `beginAutomaticHistory()` / `commitAutomaticHistory()`，手动导入继续使用原 `discoverCandidates()`。
- 每个 worker 实例具有独立 ID。现有 settings store 内的私有 `automaticHistory` 行保存 Profile、worker ID 与随机代际；新 worker 轮换它，旧 worker 无法重新取得该授权。
- 暂停、恢复、清除及相关权限变化首先同步推进内存代际，并中止已经打开的自动历史写事务；随后持久化代际失效，完成后才准入新的自动事件。
- `getVisits()` 前后都检查 ChatGPT 连接、history 权限及操作代际。初始暂停／缺权时不调用历史读取。
- 最终 IndexedDB 写事务再次检查 captureEnabled、Profile、worker ID 和持久代际。哈希准备及每个异步写阶段保留同步失效检查；停止事件同步中止仍可回滚的自动事务，拒绝旧授权继续写入。浏览器已进入不可回滚提交阶段的先前写入不能因 complete 通知稍后到达而追溯撤销；不存在在 IDB 事务中等待 Chrome 权限 API 的做法。
- 开关写入与持久代际更新在同一事务内完成，防止暂停后恢复让旧读取借用新授权。
- 私有授权更新不增加业务 revision，避免普通 worker 启动干扰显式历史导入的 revision 校验。

数据库仍为 version=1、12 stores，无迁移或目录重建；关闭采集且从未创建授权行的旧数据库保持原样。候选合并逻辑仅提取为共用实现，没有更改 D1 标题择优、Project 身份、成员、30天投影、OpenDays、墓碑、生活模式或原生书签。

完整 CI 另暴露了原有首次 session 503 的恢复缺陷：初次暂时请求失败被发布为匿名身份，随后成功恢复被当作身份切换，封锁同一新页面的面板。仅修正 `content-entry.ts` 的失败分类条件：非 `session-unauthorized` 的空主体结果不发布 `LOCAL_IDENTITY`，沿用现有有界重试；真正401/空会话、主体切换、旧来源阻断和 Project 模型均不变。新增生产 collector 无额外 ROUTE、无 DOM 替换反例，修前FAIL、修后PASS；真正退出登录再登录仍拒绝旧来源，替换后才恢复。没有改 Project 解析器或放宽身份隔离。

## 验证层级

| 层级 | 场景与证据 |
|---|---|
| 生产 worker + Repository | `tests/unit/automatic-history-worker.test.ts`：原三个缺陷、正常自动收录、暂停/恢复、撤权/重新授权、连续状态变化、最终提交前竞态、worker 替换、拒绝结果不覆盖旧标题日期、关闭采集时显式导入、显式导入暂停/取消/撤权。Chrome 端口与 IndexedDB 为隔离注入。 |
| 存储事务 | `tests/unit/automatic-history-storage.test.ts`：事务内授权、Profile/worker/代际变化、哈希期间失效、conversations 写成功后和最终 revision 写成功后的事务回滚，以及旧 v1 数据兼容。 |
| CI 恢复回归 | `tests/unit/collector-lifecycle.test.ts`：首次503随后200自动恢复同一面板；首次401/空会话随后登录仍拒绝旧面板，只有来源替换后恢复。执行生产 collector bundle，未修改身份模型或旧 observer 防护。 |
| 隔离安装的 Chromium | `tests/browser/automatic-history.mjs`：实际生产 JS、真实 chrome.history.onVisited、真实可选 host/history 撤权、暂停不新增或改写记录、手动 UI 导入、完整浏览器重启与重新启用。独立 feeder 扩展只生成合成历史，不改目标 worker 的事件或 API。 |
| 干净旧版对照 | 同一个浏览器专项先构建干净 5ad87bab，必须在正常开启正向检查通过后，恰好于暂停断言失败；任意安装错误、超时或其他失败不算反证。`automatic-history-baseline-validation.json` 记录此预期失败是否被准确确认。 |
| 原有完整回归 | 原 CI 的所有生命周期、Project、标题、活动、UI、升级、书签、性能及 Edge 门保留；仅修正两处历史测试曾依赖越权自动入库的准备条件，增加真实 history seed 检查和暂停目录为空断言，保留手动导入数量及恢复断言。 |
| 用户 Mac | 本轮未访问私人 Profile，未原位安装或覆盖日常 6bc0b29。隔离 Chromium 与生产代码反例不能写成用户 Mac PASS。 |

专项通过后，当前构建的 `automatic-history-validation.json` 必须为 PASS，并作为 acceptance 工程门及开发包回执。已有原生 NTP 缩放 BLOCKED、Edge favicon FAIL、Workspace/NONE/full sync 未完成状态保持原样。

## 安装与回退

本次不自动安装到用户 Mac，不卸载、不清库、不重新导入。正式更新时仍保留原扩展路径和 ID，先备份匹配的代码与数据，再核对包 SHA、运行 SHA 和文件哈希。回退到 6bc0b29 不需要 schema 降级，但会恢复本次已确认的自动历史采集 P1；更旧版本的 localProject 关系字段写入兼容性继续沿用既有警告。

## 审查与合并边界

生产改动由未参与相应文件实现的独立代理反向复核；生产 worker 专项也由测试负责人及另一代理分别执行。本地 TypeScript、199项单元和隐私审计已通过；最终以提交后的同 SHA CI 和安装包校验收口，不以 dirty 本地构建交付。PR 保持 Draft，修复通过只允许进入合并复审，不自动合并 main 或发布商店。
