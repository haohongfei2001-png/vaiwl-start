# VAIWL Start Free V1 · 本地工作空间开发包

本包执行 `VAIWL-START-FREE/1.0 / 2026-11-02-local-first`。当前能力为本地历史时间组织、Start 导航活动和局部 Project 候选；不宣称完整原生归属认证或商店发布。

## 已安装用户：保留原有目录更新

已有564条历史的用户不需要再次导入，也不要卸载扩展、清除本地数据或换路径加载副本。

1. 保留原扩展ID与已加载的原路径，把本包 `vaiwl-start` 文件夹中的运行文件更新到该路径。只更新扩展代码，不能覆盖Chrome Profile、IndexedDB或扩展数据目录。
2. 在 `chrome://extensions`（Edge为 `edge://extensions`）对原扩展重新加载一次，再新开Start。原数据使用同一个数据库名、version=1和12个store，无重建/迁移。
3. 在设置底部核对构建SHA与包内 `vaiwl-start/build.json`。已授权的ChatGPT连接与继续收录状态应保留；新开或刷新一次用于观察的ChatGPT项目页，以使用新内容脚本。

本轮用户给出的扩展ID为 `ikfnmnlajafpkoojjbcofpceghpmgdbc`。该值来自用户现有安装信息；更新时应以浏览器实际注册记录核对，不能凭猜测新建安装目录。

## 更新后可以看到什么

- “本地历史”中的UNKNOWN按浏览器最近访问日期进入“历史浏览／归属待确认”窗口，沿用30个当地日历日上下切换、每窗5条与+12展开、全目录搜索。没有有效日期的入口仍可达。
- 从Start普通点击、Enter、中键或修饰键明确打开一条未分配会话，精确浏览器导航完成后记本地OpenDay。再次同日打开只更新最后时刻，不增加活动日；刷新、自动恢复和后台采集不造活动。
- 主动日期显示为“主动打开／归属待确认”，不把浏览器访问时间写成活动。它确认用户主动打开，不声称正文加载成功或阅读完毕。
- 正常打开原生Project页面，若当前原生面板结构匹配，明确的ID、名称和已观察成员会形成“本地候选项目／原生归属待确认”。未出现候选表示没有取得支持的局部结构，不能用名称猜测。
- 原生Project、NONE与账号资料库仍各自需要可信来源。未知目录不会自动归入当前账号。候选不等于已认证Project，不跨观察合并。
- 关闭标签、退出浏览器后，本地目录、网站、墓碑和已提交活动保留。浏览器重启/扩展Reload不补记旧pending意图。

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
