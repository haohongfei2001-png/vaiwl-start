# Free V1 · 原生新标签页与统一工作空间修订

> **当前最高优先修订：[第14号首页与时间投影合同](14-HOME-TIME-PROJECTION-AMENDMENT.md)。** 废止可见待确认/来源等级、严格更早日期证明与独立无日期会话区；完整项目、范围时间证据、最近与全局更早按该合同执行。身份隔离、P1权限及12stores不变。

合同 `VAIWL-START-FREE/1.0`；修订 `2026-11-03-native-experience`。本次用户授权优先于第10号修订中的来源可见分组和独立首页快捷网站要求。其余账号隔离、严格原生证明、30日历日与本地优先边界不变。

## 统一投影
首页是项目→窗口；UNKNOWN 统一为“待归属”，不再按主动打开/浏览历史拆开。`lastDisplayAt` 是同一记录有效 `browserLastVisitAt` 与 `activity.lastConfirmedOpenAt` 的较新值；校验真实 ISO 日历、当前时刻（包括同日未来时间）及冻结日历区间。此字段只在投影派生，不写回数据库、不转移历史所有权、不生成 OpenDay。已确认 NONE 使用相同展示时间，UNKNOWN 不推定 NONE。候选项目继续按既有观察边界隔离，撤销或冲突回退待归属。同一项目按成员最新展示时间定位，旧成员不拆散；无日期入口保持可达。保留5/+12、旧窗口展开、30天翻页、全历史搜索和焦点/滚动锚点。

## 原生书签
`bookmarks` 仅为可选权限，原始安装权限仍只有 storage。显示偏好需用户选一次：常驻（Start隐藏）、仅新标签页（Start显示）、隐藏（Start隐藏）。公开 API 不提供可靠原生书签栏可见模式，不读取 Profile 配置猜测。若浏览器仍渲染原生栏，用户选择不重复显示。允许拒绝/撤销，目录不受影响。
读取原生书签栏树，优先 folderType，兼容旧 Chromium 永久节点1；支持多书签栏、文件夹、顺序、空栏和变更事件。不猜测本地化名称。只读界面不删除/移动真实书签。HTTP(S)且无嵌入凭据的书签可点击；特殊协议显示为不可点击，仍可在原生浏览器打开。
旧 shortcuts 的所有记录保留在设置的兼容区，非首页主来源。迁移需明确点击并确认，原生 create 逐项执行；全树URL去重、同源跨标签锁、重试跳过已添加项、权限失败保留全部旧数据。不自动删除、移动原始书签。原生书签并发外部编辑不具有事务性保证，失败回执明确已添加数。

## 标签页身份
名称与图标相互独立。默认使用 browser UA + chrome.i18n.getUILanguage 的新标签页名称（常用语言映射，其他语言英语回退）；Chrome/Edge 采用不同的本地近似 favicon，非内部 chrome:// 或 edge:// 图标。可选现有产品四格图标、本地 PNG/JPEG/WebP 上传。文件≤1MiB、宽高≤2048；先验证类型/签名/尺寸，再解码并在canvas重编码128px PNG，移除元数据，不接受SVG/GIF/脚本，输出≤100000字符。错误保留上次有效设置。仅改HTML标题/链接favicon，不改manifest安装身份或页面Logo。
偏好保存在 chrome.storage.local 的独立 native.* 键，跨页同步、重启/Reload持久化；不增加 IndexedDB store，不复制书签树到目录。原数据库名/version=1/12stores及所有旧主键、墓碑、活动不变。卸载风险仍存在，升级必须原ID原路径、不清库。

## 验证与限制
必须覆盖真实扩展页面渲染、实际 bookmarks API 的CRUD事件、显示/权限路径、显式幂等迁移、身份恢复/持久化/恶意上传、统一来源投影和12store升级比较。测试中的合成目录与预授权书签环境不得冒充真实账号证据或系统授权弹窗。保持PR Draft、不合并、不发布。

## API依据（查阅2026-11-03）
- https://developer.chrome.com/docs/extensions/develop/ui/override-chrome-pages
- https://developer.chrome.com/docs/extensions/reference/api/bookmarks
- https://developer.chrome.com/docs/extensions/reference/api/permissions
- https://learn.microsoft.com/en-us/microsoft-edge/extensions/developer-guide/api-support
