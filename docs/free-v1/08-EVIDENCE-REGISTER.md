# 证据登记与交付状态

## 当前结论

**DESIGN_READY — VAIWL-START-FREE/1.0**。

本轮交付完整产品设计、可操作首页样稿、类型与数据合同、来源可靠性矩阵、复用架构、可执行验收及Codex正式指令。生产扩展没有在本轮实现；真实principal/context、正向NONE和Chrome/Edge产品验收尚待开发。阶段边界不能合并成一个PASS。

## 来源锁定与远端状态

| 对象 | 本轮实际核对 |
|---|---|
| 原VAIWL PR #16 | open、Draft、未合并；开始与交付前HEAD均1903b00f774b4fd7f3d15b3669878c32e2c7a9c8 |
| 原Free状态 | 原Project入口/成员局部证据与增强宿主挂载未完成分别记录；NONE、稳定账号仍不能视为已通过 |
| 新仓原main | ebd6cd5705a1a56a3cafae3eda27537379098c81；只有原README |
| 本轮写入范围 | 仅vaiwl-start独立design/free-v1-20261102设计分支；main和原仓不修改 |
| 标准能力 | Chrome/Edge官方文档及Chromium导航反例；引用详见04 |

原仓35份文件的实际字节均核对Git blob SHA，另记录SHA-256：[来源清单](evidence/source-manifest.json)。本轮不重新运行原VAIWL测试，不把源码存在视为生产已启用。

## 本轮实际完成的验证

| 验证 | 实际结果 | 证明范围 |
|---|---|---|
| 交互样稿 | 34/34 PASS | 本地合成页面的布局与指定交互 |
| 样稿浏览器 | 无头Chromium 156.0.8078.4，隔离profile、本地file页面 | 不是已安装MV3扩展，也不是真实Edge |
| 视口 | 1440/1000/720/400/320均无横向溢出 | 1000px模拟垂直标签占用后的内容宽度，不冒称操作了真实垂直标签 |
| 设计预览 | 桌面、搜索、初装、历史导入、1000px、400px共6张 | Chromium实际渲染截图，全部合成数据 |
| 时间合同 | 9/9通过固定上游源码的createFreeViewSession/freeSegmentFor/freeWindowFor | 月末、闰年、DST、段边界、未来日等设计期预期值 |
| 类型合同 | Node 24 TypeScript语法剥离加载成功 | 语法检查；未冒称tsc完整类型检查 |
| 文档与文件 | 相对链接存在、JSON可解析、截图/HTML哈希匹配 | 交付一致性 |
| 独立审查 | 源码继承与浏览器数据合同两个独立审查方向；已发现差额全部关闭 | 设计审查，不替代实现测试 |

[样稿回执](../../design/free-v1/prototype-validation.json) · [时间向量回执](evidence/time-vector-verification.json) · [来源继承审查](evidence/source-inheritance.md) · [合同来源复核](evidence/contract-review-source.md) · [浏览器合同复核](evidence/contract-review-browser.md)

截图中文字体为验证环境注入的Noto Sans CJK SC；交付HTML仍是系统字体栈，无字体下载依赖。公开示例没有使用私人会话或账号数据。

## 已关闭的审查差额

1. staging首次确认账号后的活动落点：新增resolvedRecordKey/committedRecordKey，同事务仅写新解析记录，旧活动不迁移。
2. 缓存语义：HTTP cache/BFCache不决定主动性，以用户意图和active抵达关联为准。
3. 日键冻结：issuedTimeZone/issuedLocalDate在签发时固定，抵达期间时区变化不改旧日键。
4. Project URL与conversation URL分开校验。
5. 空白新聊获ID先收录，V1不扩为新发送/创建意图追踪。
6. CandidateResolution与scoped墓碑联动，避免A删除后重导入复活，同时不抑制B。
7. 修正Project标题与Project内会话标题的函数映射。
8. 站内搜索不劫持Cmd/Ctrl+K/L；网站固定不打乱用户order。

## 仍待真实开发取得的证据

- 无正文的稳定principal与当前context来源。
- 受支持布局中正向PROJECT及正向NONE，尤其NONE不靠缺失推导。
- 新扩展在Chrome/Edge的安装、采集、抵达关联、账号切换、MV3重启及真实连续旅程。
- 若启用地址栏分支，其正例与恢复/脚本导航反例。

这些不是本轮隐瞒的已知实现错误；它们是首个开发竖切和发布验收的明确未取得事实。不得把离线样稿或者绿色CI补填为这些实机证据。
