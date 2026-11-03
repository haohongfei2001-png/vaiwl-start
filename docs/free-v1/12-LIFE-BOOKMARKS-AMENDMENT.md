# Free V1 · 生活 / 工作空间与书签栏修订

合同 `VAIWL-START-FREE/1.0`；修订 `2026-11-03-life-bookmarks`。当前用户明确授权此功能；本修订覆盖第11号修订的书签全区隐藏与固定安装权限清单，其余数据、来源与账号隔离边界保留。

## 持久双模式

初装默认工作空间；顶部搜索与设置之间是带线性图标和文字的胶囊按钮。工作空间显示“生活”，生活显示“工作空间”。无确认弹窗、不重载扩展、不关闭浏览器标签。

点击即时切换当前页面，独立 `chrome.storage.local['native.homeMode']` 仅保存 `workspace|life`。后续新标签、浏览器重启与扩展 Reload 读取该默认。其他已打开页面不订阅此键、不强制切换。Profile 由浏览器原生扩展存储隔离，不使用 storage.sync。

首帧两个资料面板均隐藏，偏好读取完成才显示目标模式。缺失/无效值默认工作空间；读取失败显示无资料的可重试壳层，不能猜测默认并泄露工作内容。写入失败当前页保持所选模式，明确提示默认未保存并提供重试。保存序号与视图生命周期分开，重试不能废弃正在加载的工作区。迟到 SNAPSHOT 与排队渲染必须拒绝旧生命周期。

生活模式包含本地时间/日期、页面网页搜索及同一原生书签区域。无项目、会话、待归属、活动、工作提示、新闻、广告或推荐。清除当前页工作资料 DOM/内存快照、退订目录更新，不请求 SNAPSHOT，不投影目录。时钟仅可见时每分钟更新。不修改原始目录或采集开关。已开始的导入事务自然落地，生活模式不启动下一批；持久 checkpoint/state 不改，返回工作区继续。

生活搜索用 `chrome.search.query` 沿用默认搜索引擎，失败保留输入并提示地址栏；不抢地址栏初始焦点，不拦截原生快捷键。生活是扩展内部的原生体验导向首页，不是浏览器内置新标签页。公开 override API 是 manifest 声明，未发现安全的逐标签运行时恢复原生 API；不跳内部URL、不停用/卸载扩展、不绕过策略。

## 原生书签架

首页只使用一套原生书签数据。仍由用户选常驻/仅新标签/隐藏三种习惯；前者和隐藏不重复渲染首页栏。保留原树顺序、名称（包括清空名称的纯图标书签）、文件夹结构及实时 CRUD 同步，不重排、不持久复制、不自动迁移。

默认完整一行。测量实际容器、条目与末端展开按钮尺寸，动态决定连续可见前缀；隐藏条目同时 hidden/inert。响应 ResizeObserver、窗口/缩放/字体变化。展开在文档流内限制最大高度并内部滚动；文件夹逐层导航，避免深递归展开。展开仅为当前页状态，新页始终回到一行。

每个安全 HTTP(S) 网站由官方扩展 `_favicon/?pageUrl=…&size=32` 读取浏览器图标，不用第三方代理。固定16px图标框、失败本地通用图标、非阻塞加载。加载成功不单独证明真实图标，验收必须用已知图像像素核对。非法协议保留名称但不在扩展内执行。授权拒绝/撤销、空树、异常数据和离线不阻断首页。

## 权限与升级

必需权限为 `storage`、`favicon`、`search`；`bookmarks`、`history`、`scripting`、`webNavigation` 与 ChatGPT host 仍按原有用户动作可选。不添加 tabs/all_urls/debugger 等生产权限。严格 CSP 增补 `img-src 'self' data:`，无远程图片代理。新增两份本地CSS列入build哈希。

数据库名/version=1/12 stores、旧主键、OpenDays、墓碑、设置与书签原树不变。仅明确“清除全部Start本地数据”时一并移除模式键；该操作不修改其他已打开页面的当前模式。

## 正式验证

复用原回归；新增 `tests/browser/life-bookmarks.mjs` 必须实装扩展，使用 `chrome.tabs.create({})` 的真实NTP入口。覆盖双向模式/后续页/重启/Reload/多页隔离/迟到响应/读写错误/数据保全，以及真实favicon像素、原生CRUD、文件夹、动态单行/展开/缩放、超长列表、离线/异常/撤权。系统授权弹窗拒绝的注入测试必须如实标注，不冒充人工系统弹窗验收。Chrome系与Microsoft Edge分别产生同SHA独立回执与截图。

## 官方依据（2026-11-03）

- https://developer.chrome.com/docs/extensions/develop/ui/override-chrome-pages
- https://developer.chrome.com/docs/extensions/how-to/ui/favicons
- https://developer.chrome.com/docs/extensions/reference/api/search
- https://developer.chrome.com/docs/extensions/reference/api/storage
- https://developer.chrome.com/docs/extensions/reference/api/bookmarks
- https://learn.microsoft.com/en-us/microsoft-edge/extensions/developer-guide/api-support
