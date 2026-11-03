# Chrome 新标签页页脚：平台核查

核查日期：2026-11-03。对象是扩展接管新标签页后，由 Chrome 在内容区外绘制、显示扩展名称和“自定义 Chrome”的底栏。

## 结论与产品实现边界

- Chromium 扩展团队的公告明确说明：Chrome 138 开始为扩展提供的新标签页增加此页脚。它不是 VAIWL Start 的 HTML 页脚，扩展 CSS 无权隐藏浏览器界面。
- Google 当前帮助文档给出正式隐藏操作：**右键底栏 → 隐藏新标签页页脚**。替代路径是 **自定义 Chrome → 页脚 → 关闭“在新标签页上显示页脚”**。这是一项用户浏览器设置，不应由扩展修改 Profile、实验 flag 或内部 API。
- 没有发现公开、受支持的扩展 API 可以读写这一显示开关。Chrome Extensions DevRel 在同一官方讨论中明确说明没有返回页脚状态的 API；本实现不根据窗口高度等不可靠启发式“检测”页脚。
- 说明仅放在 VAIWL Start 设置中；不在首页放常驻提醒。浏览器主题与外观仍可通过 **Chrome 菜单 → 设置 → 外观** 访问，不必保留底栏。
- 受管理浏览器可能由管理员锁定页脚显示，Google 帮助文档明确说明用户开关可能受限。产品不绕过此限制。

## 官方来源

1. [Google Chrome 帮助：Customize your New Tab page in Chrome](https://support.google.com/chrome/answer/11032183?hl=EN)，其中“Turn New Tab page footer on or off”给出右键菜单、Footer 开关和受管理浏览器限制。
2. [Chromium Extensions：PSA: Updates to the new tab page in Chrome 138](https://groups.google.com/a/chromium.org/g/chromium-extensions/c/DNj1B3vywr0)，Chrome Extensions DevRel 2025-06-17 公告确认原生页脚来源；2025-08-22 跟帖确认没有返回其状态的 API。

## 验证范围

本轮浏览器回归检查扩展设置中有准确的一次性操作说明、首页没有产品自绘的页脚或常驻说明，并核对没有新增权限。Playwright 的内容页截图不包含浏览器原生底栏，不能据此宣称原生底栏已被扩展移除，也不能冒充用户 Mac 上已经操作过这个开关。

Edge 的新标签页 UI 与标签栏 favicon 单独记录；Chrome 的这条隐藏说明不作为 Edge 行为证据。
