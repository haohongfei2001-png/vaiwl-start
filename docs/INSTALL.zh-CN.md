# VAIWL Start Free V1 · 本地工作空间开发包

本包执行 `VAIWL-START-FREE/1.0 / 2026-11-03-native-experience`。本次新增统一工作空间、浏览器原生书签与标签页身份设置，保留Start导航活动和局部Project候选；不宣称完整原生归属认证或商店发布。

## 已安装用户：保留原有目录更新

已有564条历史的用户不需要再次导入，也不要卸载扩展、清除本地数据或换路径加载副本。

1. 保留原扩展ID与已加载的原路径，把本包 `vaiwl-start` 文件夹中的运行文件更新到该路径。只更新扩展代码，不能覆盖Chrome Profile、IndexedDB或扩展数据目录。
2. 在 `chrome://extensions`（Edge为 `edge://extensions`）对原扩展重新加载一次，再新开Start。原数据使用同一个数据库名、version=1和12个store，无重建/迁移。
3. 在设置底部核对构建SHA与包内 `vaiwl-start/build.json`。已授权的ChatGPT连接与继续收录状态应保留；新开或刷新一次用于观察的ChatGPT项目页，以使用新内容脚本。

本轮用户给出的扩展ID为 `ikfnmnlajafpkoojjbcofpceghpmgdbc`。该值来自用户现有安装信息；更新时应以浏览器实际注册记录核对，不能凭猜测新建安装目录。

## 更新后可以看到什么

首页不再出现“主动打开／归属待确认”和“历史浏览／归属待确认”两个来源列表。已确认项目内直接展开会话，UNKNOWN统一为“待归属”，已确认NONE按日期呈现。取同一记录的最新有效浏览/主动打开时间排序，不写新的OpenDay；旧项目成员、无日期链接、5/+12、搜索与30天翻页继续保留。

在设置中选择书签栏习惯一次：所有网页常驻则Start不重复显示；仅新标签页需要则在Start显示；主动隐藏则不显示。只有点击授权才请求bookmarks，不额外请求history。已授权后的原生新增、改名、移动、删除自动反映。旧快捷网站位于设置的“查看旧快捷网站”，仍可打开和管理；“将旧快捷网站加入原生书签”须确认，跳过已有网址，绝不删除旧数据。

标签页名称默认使用Chrome/Edge和常用界面语言；图标采用可靠的本地近似样式，不声称与内部原生图标完全相同。可分别改名称、选产品图标或上传PNG/JPEG/WebP（≤1MiB、2048px）。设置即时应用并跨标签、重启、扩展Reload保留。恢复默认不改变扩展安装身份或页内Logo。

原生Project、NONE与账号资料库仍各自需要可信来源。未知目录不会自动归入当前账号；局部候选仍有明确标识，不跨观察合并。关闭标签/浏览器保留目录、旧网站、墓碑和已提交活动。

## 最少实机核验

在同一个Chrome Profile里只做这组产品操作：

1. 更新后看原目录数量未减少、日期标题出现；上下切换一个30日窗口，并搜索一条旧会话。
2. 从Start打开一条会话，回到Start看当日主动打开位置；同日再开一次并刷新目标页，活动日不增加。应用内错误提示不代表内容可用，活动仅是打开行为。
3. 正常浏览一个已有原生Project，查看是否产生明确候选；关闭目标标签，再开Start确认目录和活动仍在。浏览器完整重启的留存可在正常结束使用时顺手核验，无需为此关闭当前工作。

不要求执行旧source-check核验器，不发送消息、不新建Project、不清空目录。真实来源无法验证时保留候选/UNKNOWN，不影响日期组织。

## 首次安装与常用操作

首次使用者解压整个 `vaiwl-start` 文件夹，在Chrome/Edge扩展页开启开发者模式并加载包含 `manifest.json` 的文件夹。打开新标签；若其他扩展占用新标签，可点击扩展图标进入Start。

历史导入与ChatGPT观察分别按用户动作请求可选权限。只保留匹配ChatGPT会话的必要元数据，不读取正文、草稿、附件或完整会话JSON。Free没有AI API或云服务。连接/继续收录关闭时不记录新的Start活动，已有本地历史仍可看。纯同步历史默认排除，导入范围饱和时保留PARTIAL而不声称完整账号历史。

网站可新增、编辑、固定、排序和折叠；固定不改变用户顺序。`/`开启本地搜索，Ctrl/Cmd+K/L及浏览器原生导航保留。移除仅写本地墓碑，不删除ChatGPT原会话。

## 从源码构建和验证

需要Node.js 24和Python 3。唯一分支 `codex/free-v1-implementation`，Draft PR #1，main未合并。

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

加载 `dist`。交付ZIP要求工作树干净，`build.json`及verification回执绑定同一SHA；合成浏览器测试不能替代真实ChatGPT/Mac/Edge验收。


## 生活 / 工作空间与书签栏更新

本候选仍从原路径更新、保留原扩展ID，不卸载、不清库。新增 `favicon` 与 `search` 权限分别用于浏览器网站图标和默认搜索引擎；原生书签依然按需授权。工作空间右上角点击“生活”即保存以后新标签的默认模式，重启仍保留；生活右上角点击“工作空间”反向切回。其他已开标签保持原样。生活首页由扩展提供，不能当作浏览器原装新标签页。

书签默认一行，末端展开更多，文件夹逐层打开。若浏览器原生书签栏已经常驻，在显示设置中选“所有网页常驻”，避免重复。图标缺失或拒绝书签权限不会阻止首页和模式切换。
