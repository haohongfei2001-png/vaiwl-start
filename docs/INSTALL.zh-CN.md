# VAIWL Start Free V1 开发候选安装

## 当前能用的部分

这是可加载的新标签页扩展，包含独立本地目录和网站快捷入口，没有演示会话。你可以导入浏览器当前仍可读取的 ChatGPT 会话链接，在本地按标题搜索，关闭真实标签后再打开，新增/编辑/固定/排序网站，删除和明确恢复本地入口。

当前候选为 **SOURCE_GATE_BLOCKED / 受限目录**。稳定账号与当前空间、正向 Project/NONE、无正文的成功抵达尚未取得 Start 自身的真实证据。导入和观察的会话先保留在“账号待确认”；本候选不会制造 Project、NONE 或主动打开日期。项目卡、日期窗口与活动事务已实现并通过合成数据测试，但不能将其当作真实数据来源已接通。

## Chrome / Edge 侧载

1. 解压开发 ZIP，保留整个 `vaiwl-start` 文件夹。不要从 ZIP 内直接加载，也不要移动已加载的文件夹。
2. Chrome 打开 `chrome://extensions`；Edge 打开 `edge://extensions`，开启“开发者模式”。
3. 选择“加载已解压的扩展程序”，选中包含 `manifest.json` 的 `vaiwl-start` 文件夹。
4. 打开新标签页。若浏览器询问是否保留新的新标签页，按自己的选择确认。若其他扩展或企业设置占用了新标签页，可点击 VAIWL Start 扩展图标打开本页；本扩展不会修改其他扩展或标签顺序。
5. 在设置底部核对构建 SHA 与本包的 `vaiwl-start/build.json` 一致；源码分支为 `codex/free-v1-implementation`，PR 保持 Draft。

更新同一路径的候选后，在扩展管理页点击一次“重新加载”，重新打开 Start。已有 IndexedDB 目录保留；扩展 Reload 会使旧打开意图失效，不补记活动。

## 第一次使用

- **网站**：点击“＋”，填写名称与不含账号密码的 HTTP(S) 地址。整理菜单可编辑、固定、拖动或键盘上下排序。固定不会改变顺序；折叠后只显示固定项。
- **导入**：点击“导入浏览历史”，选择最近 90 天或浏览器当前可读取的全部范围，主动授予历史权限。该权限由浏览器提供，覆盖全部历史；扩展先筛选再保存，仅保留匹配 ChatGPT 会话的必要字段。纯同步记录默认排除，可在导入框明确包含。
- **查看**：导入项位于“账号待确认”，可打开、搜索、查看详情和移除。导入时间不是主动打开时间，也不代表完整账号历史。部分范围饱和或发生异常时会保留 PARTIAL 状态，可在同一导入任务继续。
- **打开**：普通点击/Enter 在当前 Start 标签中导航到真实 ChatGPT；Ctrl/Cmd+点击、中键打开后台标签，Shift+点击开新窗口。不会搬移、重排、批量打开或自动复用现有标签。
- **连接**：设置中“连接 ChatGPT”单独申请该站点与观察能力；这允许发现会话路由和限定项目列表中的标题候选。内部 source gate 未通过的能力仍保持关闭。连接成功不等于已经证明当前账号/空间。
- **快捷键**：点击搜索或在页面非编辑状态按 `/` 打开本地搜索。Ctrl/Cmd+K/L 和浏览器原生滚动/导航快捷键保留。

## 留存与移除

目录保存在当前浏览器 profile。关闭 ChatGPT 标签、退出登录或清理浏览器历史不会自动删除扩展目录。撤销 history 权限停止后续历史读取，断开 ChatGPT 停止对应观察；已有本地目录仍可看。

“从首页移除”仅移除本地入口并写防重导入墓碑，不会删除 ChatGPT 会话。设置的“恢复收录”解除该本地移除；“清除本地数据”会清除此扩展自己的目录、活动、网站和设置。当前版本没有跨设备同步或备份 UI，卸载扩展可能丢失本地目录。

## 本轮唯一 Mac 操作组

本轮来源取证只按随包 [M0_CONTROLLED_CHECK.zh-CN.md](M0_CONTROLLED_CHECK.zh-CN.md) 操作。入口在 Start → 设置 → 来源状态与构建 → 受控来源核验。它直接导出脱敏JSON，不需要开发者工具或复制session/网络响应。

更新时覆盖**原来已加载的同一个路径**并重新加载，保留扩展ID与目录；不要卸载旧扩展或另加一个不同路径的副本。四项来源未取得独立真实证明前，不重复执行完整Chrome/Edge旅程。只有全部来源接通后，才执行冻结的双浏览器完整验收。

## 从源码构建

需要 Node.js 24 与 Python 3。检出唯一实现分支后运行：

```bash
npm ci
npm run verify
npx playwright install --with-deps chromium
npm run test:browser
node tests/browser/import-recovery.mjs
node tests/browser/privacy-boundaries.mjs
node tests/browser/source-recovery.mjs
node tests/browser/storage-faults.mjs
node tests/ui/production-ui.mjs
node tests/browser/performance.mjs
node scripts/acceptance.mjs
npm run package
```

加载 `dist` 目录。ZIP 生成在 `artifacts` 中；交付打包要求工作树干净。若已经安装兼容的 Chrome for Testing，可用 `VAIWL_CHROMIUM_EXECUTABLE` 为测试指定它；这是测试进程设置，不是生产扩展的来源开关。
