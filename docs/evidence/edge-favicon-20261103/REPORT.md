# Edge 原生新标签页 favicon：确定故障层与保留阻断

日期：2026-11-03（Asia/Shanghai）。本轮仅处理 Edge 原生新标签页 favicon；不重新验收书签、D1、历史目录。
基线源码：`7372bd17af283a10b602648e4db36a8ff7b2b53d`，clean build。
实际浏览器：Microsoft Edge `156.0.4314.58`，macOS。完整环境、运行文件哈希、图标与截图哈希见 [observations.json](observations.json)。

## 结论

**功能状态仍为 FAIL；已确定故障位于本次 Edge 版本的原生 NTP 标签栏显示路径。没有实施生产绕行，没有降低合同。**

通过 `chrome_url_overrides.newtab` 打开的原生入口，页面正确提供图标，诊断夹具的 `tabs.favIconUrl` 也正确更新，但真实标签栏仍显示 Edge 默认 NTP 图标。相同页面/图标通过普通扩展 URL 打开则显示正常。静态 PNG、动态 data/blob PNG、link 重建与 manifest 图标对照排除了 VAIWL 上传转换、storage 时序、SVG 格式、link 更新及缺少 manifest 图标等合理解释。

这是**被测 macOS / Edge 156.0.4314.58 / 原生新标签页路径**的限制证据。没有取得 Edge 私有实现中的精确函数或微软对永久限制的官方声明；不能外推到所有 Edge 版本、渠道或操作系统。

## 生产构建对照

全部使用新建临时 Profile、现有 Edge 可执行文件和未修改的生产 manifest。没有读取/改动用户真实 Chrome/Edge Profile、清缓存、重新安装或导入真实会话。

| 场景 | 页面图标 | 真实标签栏 | 证据 |
|---|---|---|---|
| 直接打开扩展 Start，上传紫色 PNG | 正确 | 紫色图标；1024 物理像素＝256 逻辑像素 | [整窗](screenshots/production-01-direct-custom.png) |
| 默认 `chrome.tabs.create({active:true})` 创建原生新标签页 | 同一 PNG | 默认 NTP；紫色像素 0 | [整窗](screenshots/production-02-native-custom.png) |
| 在原生新标签页改选产品图标 | 正确 | 仍为默认 NTP | [整窗](screenshots/production-03-native-product.png) |

截图由 macOS `screencapture -l` 捕获本轮独立 Edge PID 所有的窗口，包含浏览器标签栏；不是网页 viewport screenshot。窗口为 1100×760 逻辑点，PNG 为 2200×1520 像素；计数 ROI 为浏览器最上方 [100,0,260,44] 逻辑点，排除页面内容。单独的 DOM 或 tabs 元数据成功不替代标签栏判定。

## 最小夹具：两组共18场景

为去除产品逻辑干扰，创建两个小扩展：一组不提供 manifest 图标，另一组 manifest 使用蓝色 PNG；初始 HTML 的静态图标为红色 PNG，动态更新为绿色 PNG。两组均通过限定到本轮 PID 的原生辅助功能操作点击“保留更改”，回执 `pressed=true`。夹具标题为独立的 `ISOLATED FAVICON FIXTURE`，不是默认“New tab”。

夹具只在临时目录使用 `tabs` 诊断权限；**生产 manifest 未增加权限**。原始夹具在 [fixtures/no-manifest](fixtures/no-manifest) 与 [fixtures/manifest-blue](fixtures/manifest-blue)，可独立加载核对。

| 每组场景 | tabs.url / 地址栏 | 两组真实标签栏 |
|---|---|---|
| 初始 head 静态红色 PNG | edge://newtab/；地址栏空白 | 默认 NTP |
| 动态 data PNG 改为绿色 | edge://newtab/；地址栏空白 | 默认 NTP |
| 删除原 link，重新插入 shortcut icon + sizes | edge://newtab/；地址栏空白 | 默认 NTP |
| 改为 blob PNG | edge://newtab/；地址栏空白 | 默认 NTP |
| history.replaceState 改 hash | edge://newtab/；地址栏空白 | 默认 NTP |
| history.replaceState 改 query | edge://newtab/；地址栏空白 | 默认 NTP |
| history.replaceState 改 path | edge://newtab/；地址栏空白 | 默认 NTP |
| location.replace 到普通 other.html | 普通扩展 URL；地址栏显示 extension://…/other.html | 正确红色图标 |
| 直接打开原 newtab.html 扩展 URL | 普通扩展 URL；地址栏显示 extension://…/newtab.html | 正确红色图标 |

每个场景的 DOM、tabs.favIconUrl、地址栏辅助功能值、完整窗口截图及 SHA-256 均在 observations.json。18 张原始整窗 PNG 全部保留；无失败样本被删除或改标为产品 PASS。

关键图像：[静态PNG仍失败](screenshots/no-manifest-01-native-static-red.png) · [data PNG仍失败](screenshots/no-manifest-02-native-dynamic-green.png) · [manifest蓝色图标仍失败](screenshots/manifest-blue-01-native-static-red.png) · [仅改path仍失败](screenshots/no-manifest-07-replace-path.png) · [普通页跳转成功及地址栏损失](screenshots/no-manifest-08-location-other.png) · [同原始页面直接入口成功](screenshots/no-manifest-09-direct-static-red.png)。

## 已验证替代路径与损失

1. **导航为普通扩展页**：图标能正常显示，但真实地址栏出现扩展 URL，失去当前原生新标签页的空白地址栏表现。未作为正式修复采纳。焦点、历史栈、闪烁等其他影响未在本轮量化，不能声称已经测得。
2. **Edge 原生入口保留默认图标，仅普通 Start 页自定义**：保留原生入口，但不满足正式的任意自定义 favicon 要求。未采纳为验收降级。
3. **等待 Edge 恢复该行为后重新运行专用门**：不改合同，但当前功能继续阻断。不能预先承诺哪个浏览器版本会修复。

未隐藏自定义设置、未加自动重定向、未改变 manifest 身份或权限。

## 旧测试缺口与新专用门

旧 `tests/browser/native-experience.mjs` 使用 headless 浏览器并直接 goto 扩展 URL；图标断言检查 href，page.screenshot 不含标签栏。原有 PASS 仍只证明各自页面层检查，不能证明 Edge 原生标签栏已通过。临时增加 tabs 权限读取 favIconUrl 同样不足。

新增执行命令：

```bash
npm run build
npm run test:edge-tabstrip
```

专用门要求 macOS GUI 与现有 Edge；自动新建自己的临时 Profile。依次检查直接入口紫色正例、原生首次、原生 UI 换青色、再次新建、完全重启独立 Profile 后原生入口，以及重启后的直接入口正例。每项分别保存 DOM/持久化/PNG 解码结果和两次真实标签栏截图像素。直接正例不成立则拒绝下原生结论。

- 标签栏符合自定义图标才是 PASS。
- 原生图标仍默认时为 FAIL，退出码1；“成功复现”不等于产品通过。
- 截图/窗口/平台/构建等基础设施缺失为 ERROR 或 BLOCKED，退出码2。
- 构建 SHA、dirty、manifest 与运行文件哈希、Edge 版本、截图 SHA 均写入回执。
- 同 SHA 的专用门结果单独附于 PR #1；不能把常规 CI 的绿灯汇总成 Edge 门成功。
- 现有 CI workflow 未增加或移除断言；本地不重新跑书签、D1、历史目录专项。

## 外部核对资料

- [Microsoft manifest 文档](https://learn.microsoft.com/en-us/microsoft-edge/extensions/getting-started/manifest-format) 支持 chrome_url_overrides，但不承诺这一具体标签栏行为。
- [Chrome override 文档](https://developer.chrome.com/docs/extensions/develop/ui/override-chrome-pages) 说明新标签页入口与地址栏优先焦点。
- [Bonjourr #700](https://github.com/victrme/Bonjourr/issues/700)：产品作者记录相同 Edge 回归。2026-06-14 曾报告恢复，2026-07-14 又报告失效；[再次处理的真实代码提交](https://github.com/victrme/Bonjourr/commit/437d34c08a9bb232121a87bc17f745504c8093c3)。这是独立同类报告，不是微软官方永久限制声明。

## 工程处置

本轮仅增加专用测试、证据和状态说明；生产源码、资源、权限、合同与已有数据结构保持原样。保持原 PR Draft，不合并、不发布。当前剩余阻断是：**在保留 Edge 原生新标签页入口体验的同时，使用户自定义 favicon 真正显示于标签栏**。当前没有已验证的无损扩展侧修复。
