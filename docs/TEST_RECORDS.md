# Free V1 测试证据说明

## 分层结论

源码与合成数据测试不能证明真实 ChatGPT 来源。当前交付维持 `SOURCE_GATE_BLOCKED`，没有 `FREE_V1_ACCEPTED` 或真实 Mac/Edge 通过声明。

| 层 | 测试入口 | 能证明的范围 |
|---|---|---|
| 类型/纯函数/事务 | `npm run typecheck` / `npm test` | URL、时间、来源解码、三态、IDB/CAS、日活动、逐条解析与墓碑、历史分批/恢复/饱和、IPC与打开幂等 |
| 打包隐私审计 | `npm run build` / `npm run audit` | MV3最小权限、无正文接口/正文文本回退、无生产fixture、无运行时第三方依赖、文件hash |
| 真实安装的隔离浏览器 | `npm run test:browser` | 生产包安装、IPC边界、历史API、可信中键导航、worker及浏览器重启、目录留存与删除恢复 |
| 导入中断恢复 | `node tests/browser/import-recovery.mjs` | 257条实际history，首批200+57待处理，关闭页面/终止worker后续跑；history权限变体明确标注 |
| 来源和IPC边界 | `node tests/browser/privacy-boundaries.mjs` | 精确host权限测试变体；悬置已知session GET时缓存先显示，实际Chrome子frame与伪字段拒绝，HTML仅作文本 |
| 原生浏览器存储故障 | `node tests/browser/storage-faults.mjs` | 实际IndexedDB执行未修改生产存储模块；v1升级中断、并发重开、注入quota回滚/重试，非物理磁盘耗尽 |
| 正式UI | `node tests/ui/production-ui.mjs` | 实际MV3中渲染合成IDB数据的布局、5/+12、旧项、搜索、网站、键盘、scope隔离与窄屏 |
| 真实ChatGPT与正式Chrome/Edge | 冻结06验收表与M0文档 | 当前 BLOCKED / NOT_RUN；必须后续现场证明 |

## 合成与真实 API 的边界

所有本轮自动化浏览器 profile 都是隔离临时目录，没有访问用户浏览器、私人会话或真实账号。

`tests/browser/extension.mjs` 首先加载原样生产 manifest，验证只安装 storage、没有自动申请可选权限。为实际测试 `chrome.history.search/getVisits`，脚本随后复制一个临时测试包，仅将 history 从 optional 改为 required，其他 JavaScript 字节保持不变，并由测试生成少量合成浏览记录。这证明真实浏览器 API 到生产导入代码的闭环；不冒称无头环境已经接受过生产的浏览器原生权限弹窗。此测试变体不会进入开发 ZIP。

UI fixture 只由测试进程直接写入隔离 IndexedDB。生产构建没有 URL 参数、隐藏开关、消息命令或导入路径可以将这些假数据作为验证来源。截图中的项目与会话为合成示例，不是自动读取的真实 Project/NONE。

## 构建关联

每个开发包内 `build.json` 记录完整 Git SHA、dirty 标志、source gate、适配器版本和六个运行文件 SHA-256。交付打包拒绝 dirty 工作树。

测试脚本将机器回执写入 `artifacts/privacy-audit.json`、`browser-validation.json`、`ui-validation.json`。只把与包 SHA 完全一致且 dirty=false 的回执放入 ZIP 的 `verification` 目录。GitHub Actions 使用同一个 push SHA 重新检出、安装锁定依赖、验证并上传构建和证据。

开发中发现并已修正的具体问题：同版本归属冲突被重放消解；NONE/PROJECT证据误配；非ready scope写入；同步历史别名遮蔽本地记录；并发OPEN重复开页；IMPORT_STEP响应形状差异；旧文档删除新绑定；连接权限同步意外重开收录；后台OPEN未发布revision导致下一操作冲突。对应的有效测试或实际浏览器回归保留在源码中。

## 明确未完成的门

- S01–S06/S09 真实 current-context、正确P、正向NONE与账号切换来源。
- O01/O03等要求成功抵达的真实主动活动链。当前URL到达仍不会创建活动。
- O09 地址栏适配器保持禁用；刷新、恢复、script导航不猜活动。
- macOS 正式 Chrome/Edge 的原生权限交互、垂直标签、200%浏览器缩放及四条完整旅程。
- 2000条/20项目性能由独立脚本实际测量，20次首屏与20次搜索；同SHA机器、冷热条件、逐次样本和p95在 performance-validation.json。开发期测得宽搜索失败后已分页修复，不能用小样本截图或更换计时口径代替该门。

现代正式 Chrome/Edge 的命令行侧载行为与 Chromium 测试通道不同，因此自动化 Chromium 通过不能填写为 Edge 通过。依据：[Playwright 官方扩展测试说明](https://playwright.dev/docs/chrome-extensions)；正式使用仍按扩展管理页手动“加载已解压”流程验证。

## 复合验收映射

`acceptance-matrix.json` 对每行列出具体 `predicates` 与 `missingConditions`。一份UI/单元回执整体PASS，不能代替该行全部条件。纯单元回执记录实际测试名称；需要视觉审查的行还要求显式的同SHA `review-validation.json`。CI不会伪造人工/模型视觉审阅。未知或未完成行保留NOT_RUN，真实来源与设备门保留BLOCKED。

存储故障harness由当前生产模块直接打包，报告记录每个实际依赖源文件和测试bundle hash；它不代表生产IPC或权限弹窗已验收。当前v1只有初始建库与同版本重开，没有虚构历史版本迁移。

## 已保留的性能失败与实质修复

[第三阶段CI](https://github.com/haohongfei2001-png/vaiwl-start/actions/runs/41360320317) 的搜索呈现p95=123.7ms，确为FAIL；所有功能套件通过不能替代该门。原始机器与逐次样本保存在 `docs/evidence/performance-8878287.json`。A/B/trace与未采用方案保存在 `performance-rendering-diagnosis.json`。最终仅改变搜索背景模糊的绘制方式，保留3px效果、原遮罩、100条分页、2000条数据、20次样本和双rAF的100ms门。

包与验收生成器会核对当前HEAD/dirty状态，拒绝用旧dist搭配新文档；所有同SHA失败（含性能和视觉回执）均使交付打包失败。
