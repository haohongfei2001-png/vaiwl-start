# 首页领域逻辑独立反向审查

审查者：`/root/ui_home`。该代理未实现本轮时间领域逻辑、原生时间适配器和 Repository 接线；UI 则由该代理实现，UI 的独立审查另由 `/root` 与 `/root/review_platform` 完成。本记录不是 GitHub 人类维护者批准。

## 范围与方法

只读交叉检查 `time-evidence.ts`、`projection.ts`、`native-time.ts`、项目 IPC 校验与 Repository 新增接线。重点检查30天边界、跨主体/资料库约束、时间来源语义、冲突与失效、旧数据保留、项目唯一消费以及搜索可达性；未改动这些领域/存储源码。

## 发现并已修正的两个具体反例

1. **弱证据抹掉已有历史日期。** A 有35天前的浏览器访问时间，B 无日期；加入合法但没有原生活动锚点的 A→B 列表，旧实现将 A 扩成 `[35天前, 当前观察时刻]`，导致原本位于历史区间1的会话变成无法分段，项目可能退到全局更早。作者修正为不足以证明新区间时保留已可用直接时间；新增 `insufficient native order never removes an existing historical visit from its interval` 回归通过。
2. **原生活动顺序压过更新的用户打开。** 原生顺序 A→B 表示消息/会话更新时间排序，B 后来从 Start 打开或具有更新浏览时间时，旧排序仍强制 A 在 B 前。作者收紧显示排序边，只在证据实际可推出显示先后时使用；新增 `later Start or browser activity outranks native chronological order for display` 对 Start 与 browser 两类直接时间回归通过。

以上反例由源码分析构造并交给作者修复；本代理没有保留旧源码的执行失败回执，不将静态反例写成已实测旧版 FAIL。

## 当前源码结论

- 原生活动锚点与浏览/Start打开事件区分，前者用于原生列表时间约束；后两者可用于自己的显示时间，但不冒充消息发送。
- 区间推断保留上下界；无法决定区间时不生成具体日期；有效的相对顺序仍可排序项目更早成员。
- profile、scope、local boundary 必须一致；缺失成员、过期/撤销、pin/manual/partial、方向不符与时间冲突拒绝相应推断。
- 所有可靠项目成员进入父项目的正常或更早列表；全无时间及空项目在全局更早可达。无归属且无日期只保留全历史搜索入口。
- 本轮新增存储位于既有 conversation 可选字段及 settings 前缀，不改变12-store schema；历史合并明确保留新时间元数据，其他主体创建的记录不复制旧活动/日期。
- 仅支持已明确暴露时间标签及顺序/覆盖语义的原生 DOM 变体；合成适配器测试通过不证明当前用户真实 ChatGPT 已暴露全部这些能力。

在本次限定源码范围内，两个已发现问题修复后，未发现尚未修复的确定性 P0/P1。真实浏览器及同 SHA CI 由主代理统一验收，本记录不代替它们。

## UI 交互审查后追加修复

`/root/review_platform` 指出异步 mutation 返回后 `refresh(true)` 可能撞上下一次 pointer/IME/drag。UI 作者新增 `SafeRendering.render`，仅无交互时允许立即执行，否则使用同一安全队列；对应异步 Promise 回包三类反例通过。

当前聚焦记录真正离开当前时间区间/筛选时，焦点回当前已选工作区筛选；搜索结果移出时回已选搜索筛选，均使用 `preventScroll`。隐藏的新锚点不再用于滚动补偿，避免跳到隐藏内容的位置。

## 实际执行

- `npm run typecheck`：PASS。
- `node --import tsx --test tests/unit/rendering.test.ts tests/unit/time-evidence.test.ts tests/unit/native-time-storage.test.ts`：**35/35 PASS**，无 skip/fail。
- 本代理未在本机执行真实浏览器：容器无可用浏览器，主代理已安排 CI 实装。

## 审查时源码指纹

这些哈希用于固定本记录的源码对象；后续变更需由主代理核对。

| 文件 | SHA-256 |
|---|---|
| `src/domain/time-evidence.ts` | `55b88262bab1e3c2fc1f9f8f54898720882b5012614f0e1bfa4f37a9f4c61482` |
| `src/domain/projection.ts` | `028d1f5e0437d4beb847720dc1b3baa91c0a1a81dd98379484a705f9584c2a4e` |
| `src/collectors/chatgpt/native-time.ts` | `f42a2d91c5b857c33c188fd789abb5dfc991276032fbe89e419cee9de4c18b69` |
| `src/collectors/chatgpt/project-candidate.ts` | `9ce969d5128f3c3737279032828edd327599dbd7ff819291fe0d45c56dc2eff7` |
| `src/storage/repository.ts` | `5697645886e62b85543268f4f9ed01fa253eb5181f8784325e94ced500a3c2cf` |
| `src/ui/view-state.ts` | `0814ee6c049cdbafbc90342abe3b3ad5f20a3cdfecfb028e30b70ae153466538` |
| `src/ui/newtab.ts` | `a9f8632c8b8172f42fc84f0d03838746a4d2358dee8129b3d9b2b70f595fd836` |
