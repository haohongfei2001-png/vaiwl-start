# 书签与持久双模式 · 工程记录

正式工程：原分支 `codex/free-v1-implementation`、原 Draft PR #1；不合并、不发布。

## 实际实现

- 官方 `_favicon` 与16px稳定回退；真实原生有序书签树、空标题纯图标、可选授权与变更同步。
- 实测宽度的一行前缀，隐藏项不可聚焦；展开受限滚动、文件夹逐层导航；不覆盖工作区。
- 顶部生活/工作空间胶囊；异步读取模式前无工作内容首帧。独立本地键、即时本页切换、后续页面继承、旧页不切换。
- 生活本地日期/时间与默认搜索，无AI或外部信息流。退订工作区、不读SNAPSHOT、不投影；旧响应无法回写当前模式。
- 原始数据库/采集设置/书签保留；显式导入在已开始事务落地后等待返回工作区继续，不修改持久任务状态。

## 独立审查与已处理缺陷

独立代理审查实际源码（不是第二次自评）发现：模式保存重试递增渲染epoch会丢弃尚未返回的工作区；空标题书签被网址替代；原生书签重建缺少稳定焦点键；连接异步完成可能在生活模式发出工作提示。已分别拆分保存序号、严格保留可见原名、增加焦点键和同步测量/可见焦点回退、增加mode/epoch检查。专项浏览器测试保留保存重试与迟到SNAPSHOT反例；书签单元覆盖空名和焦点键。

## 验证入口

- `npm run verify`：类型、单元、生产构建、依赖/权限/隐私审计。
- 既有全部浏览器回归及原位升级比较保留。
- `node tests/browser/life-bookmarks.mjs`：默认NTP实际入口，模式/重启/真实runtime Reload/旧页隔离/零SNAPSHOT/读写故障/迟到回执/12store全量保全。
- 同一脚本真实bookmarks API创建182项+嵌套目录，官方缓存favicon像素比对、缩放、窗口宽度、内部滚动、CRUD/离线/撤权。
- Chrome系 `life-bookmarks-validation.json` 与 Edge `edge-life-bookmarks-validation.json` 分开记录，不互相替代；截图在 `artifacts/life-bookmarks/<family>/`。

本提交中的文档是工程与验收范围记录。同SHA最终结果、浏览器版本、截图、安装ZIP及hash以GitHub Actions artifacts和原PR #1回执为准；不在运行前预填PASS。

## 继承与范围

开始HEAD dd8d8051；远端随后新增 a8e54d01 的Project增量观察，已完整继承。正式Project来源仍由对应专项裁决，Edge原生新标签页标签栏favicon仍由旧独立专项裁决。本轮网站favicon不依赖标签栏问题解决。没有操作用户真实浏览器Profile或数据。


## 首次同SHA运行与验收驱动修正

候选 `a193296e18b1dd1c0a8d17ed7418c6dca4e05e8a`，Actions `41599557496`：类型/单元/构建作业成功，Edge新专项43 PASS、1原生NTP缩放自动化BLOCKED；Chrome原有回归及native-experience 41项通过，新life专项停在“Reload必须立即出现新worker”的观测。生活页设计本就不发SNAPSHOT，后台可以保持休眠，不能把工作空间触发的后台活动当作生活页前置条件。

后续只修验收驱动：Chrome使用该同提交已通过的原生扩展管理页Reload，并等待对应LOADED/ENABLED事件；临时生活观察页先断言零SNAPSHOT，再发送被生产协议明确拒绝的无业务消息以唤醒后台，仅用于验证新worker timeOrigin。仍保留实际新实例、原生新标签life、零工作数据读取和持久化断言；Edge已通过的runtime.reload路径保留。未删除测试、放宽成功条件或修改生产代码。最后候选需重新取得同SHA三作业结果。

原生NTP缩放因浏览器内部可见URL限制，setZoom/自动化快捷键不能提供完整证据时明确记录BLOCKED；同版直接扩展页真实150%缩放单独通过，不合并宣称原生入口缩放通过。
