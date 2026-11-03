# Chrome Local-first Free V1 · 候选与验收边界

本轮基线为 `6bc0b29b848edcf7e6b5293c24fd5d957f0b3515`，唯一分支 `codex/free-v1-implementation`，原 Draft PR #1。候选精确 SHA、dirty=false、运行文件哈希见包内 `vaiwl-start/build.json`；各门结果见同包 `verification/`，不引用另一构建的绿色结果。

## 首次自动生效：确认的缺陷与修复

基线的收录恢复只由设置/连接操作触发。实际安装的基线扩展执行 Reload 后，已打开 Project 的旧内容脚本失效，新 worker 没有重新注入，迟到成员无法自动写入。这是确定性源码缺陷；不能据此断言它是用户此前首次缺卡的唯一原因。

修复仅改变后台收录生命周期：安装/更新（含 unpacked Reload）、浏览器启动、相关连接权限变化与用户设置共用串行恢复入口；每次执行及一次 250ms 有界重试均重新读取持久收录偏好和当前权限。已暂停或撤权不会被恢复为开启。普通 worker 消息唤醒不会反复重注入或旋转身份。

`HELLO → LOCAL_IDENTITY → OBSERVE → observeLocalProject → Start` 的来源、文档/路由/主体隔离、提交前检查和 UNKNOWN 合同保持不变。不修改 Project 解析器、标题规则、OpenDay、数据库结构或首页布局。

### 决定性证据

- 修复前：干净 6bc0b29 生产包通过首次启用及正常打开；在原生扩展管理页 Reload 后，同一仍打开的 Project 文档迟到成员未入库，测试失败。
- 修复后：`project-startup-validation.json` 覆盖 14 项实装检查：生产字节、首次启用既有页面、正常打开、Reload 既有/新页面、worker 终止后唤醒、晚到身份/面板、SPA、暂停/恢复、首次身份读取瞬时失败、完整浏览器重启、原位升级、写入后 UI 和来源请求边界。
- 专项启动/Reload/重启路径不调用测试辅助 `PERMISSIONS_SYNC`。旧测试的每次启动同步会掩盖这次缺陷，旧测试保留，新增专项独立覆盖。
- 七组单元反例覆盖禁用状态、注册幂等、暂停与恢复竞态、过时事件、权限缺失、失败后的下一事件、同次有界重试及重试期间暂停。

所有新浏览器场景使用真实安装的生产 JavaScript、隔离 Profile 和合成 HTTPS 元数据。只有临时测试 manifest 预授予可选连接权限，首次启用仍操作生产设置 UI；headless 不声称实际接受了原生权限弹窗。worker 用隔离目标终止验证恢复，不声称精确覆盖浏览器自然休眠的 30 秒时间点。没有接入用户真实 Profile、读取聊天正文或改动真实 Project。

## 当前能力矩阵

| 能力 | 证据与结论 |
|---|---|
| 真实原生 Project ID、名称、两条明确成员 | 继承 6bc0b29 的 `REAL_NATIVE_PROJECT_PASS`，Chrome 156.0.8078.80 / macOS 27.0；本轮不重复真实来源采样 |
| 卡片、成员不重复、关闭标签/刷新/重开后保留 | 继承上述实机 PASS；本轮用同 SHA `native-project-grouping-validation.json` 检查回归 |
| 首次自动恢复 | 新 `project-startup-validation.json`；通过才可作为本轮候选的工程门 |
| 旧历史、D1 标题、搜索、活动、书签 | 继承已获实机 PASS；本轮只执行隔离生产扩展集成，不重计或重导真实目录 |
| UNKNOWN / 本地已观察 / 正式 PROJECT 隔离 | 同 SHA 单元、Project、来源和隐私回执；本地观察不提升正式认证 |
| 工作/生活双模式 | `life-bookmarks-validation.json`：工作默认、即时切换、生活不投影工作内容、返回恢复、跨标签不覆盖、Reload/重启持久化、迟到响应拒绝 |
| Chrome 原生书签与标签设置 | `native-experience-validation.json`、`life-bookmarks-validation.json`：顺序/文件夹/单行/缩放/偏好/图标失败回退；不把页面内 favicon 检查冒称原生标签栏像素验收 |
| 旧数据与新版关系 | `native-upgrade-validation.json` 的 v1/12 stores 保全；新增专项的 6bc0b29 同路径/同 ID 升级保留本地关系 |
| 完整账号/Workspace 认证、正向 NONE | 仍未认证，独立限制 |
| 全量 Project 同步/分页/成员移除 | 未实现；仅当前明确观察的元数据，不以缺席推断删除 |
| Edge 原生新标签 favicon | 继续独立 FAIL，不属于 Chrome Local-first RC；继承 Edge CI 不解除此项 |

Chrome 原生新标签的自动化 `setZoom` 被浏览器拒绝，`B-native-NTP-zoom` 如实保留 BLOCKED；直接扩展页面的实际缩放及窗口尺寸变化已有覆盖。这项环境限制不写成生产缺陷或 PASS。

`acceptance-matrix.json` 保留完整原合同的 BLOCKED/NOT_RUN 行，并加入首次自动恢复、双模式工程门。`LOCAL_WORKSPACE_READY` 不等于完整 `FREE_V1_ACCEPTED`；最终 Chrome RC 裁决还需要当前候选的全部工程门、包校验和审查结果。

## 审查范围与剩余风险

本轮由同一执行者在实现后另做一次反向差异审查，不冒称第二位审查者已批准。检查事件重入/暂停竞态、权限撤销、失效文档、身份隔离、重复卡、写入与 UI 的区别、失败重试上限、存储兼容和新标签行为；未放宽原有效断言。进入 main 前仍需维护者独立审查 PR。

永久权限缺失、浏览器拒绝注入、持续存储错误或不支持的原生结构仍不能保证收录；一次有界重试不会无限扫描。来源正常且已开启收录时不需要切换开关。未知主体仍按文档边界隔离，不按名称合并。此前首次缺卡的历史根因没有唯一确认。

## 安装、备份及回退

本轮交付新的候选，不自动覆盖用户当前可用的 6bc0b29 实机。安装按 [INSTALL.zh-CN.md](INSTALL.zh-CN.md)：先验证 ZIP/构建/运行文件，再备份原代码和对应本地数据，保留原扩展 ID、原路径，用户在受支持界面 Reload 一次。不卸载、不清库、不重新导入。

本轮没有 schema 迁移；6bc0b29 已理解 `LocalObservedProject` 与会话 `localProject`，隔离升级测试保留这些字段。回退代码到该基线仍会恢复已知的 Reload 自动恢复缺陷，需要正常重新访问目标页面。更旧的 7372/6df 等构建虽然可打开 v1 数据库，却不承诺后续写入保留这些关系；禁止将“能打开数据库”当作无损回退。

不得运行旧构建后再用旧快照覆盖当前用户数据库。确需数据回退时，先另存当前代码和数据，在浏览器不再写入时使用配对且完整的备份恢复；这会回到备份时间点，须另行明确批准。保留当前目录不是对旧代码写入兼容的保证。本轮不执行真实用户数据恢复。

进入 main 合并评审的剩余条件：候选同 SHA CI 全成功、完整验证包及哈希核对、维护者独立审查、明确接受上述 Chrome Local-first 范围。PR 保持 Draft，不自动合并、不发布商店。
