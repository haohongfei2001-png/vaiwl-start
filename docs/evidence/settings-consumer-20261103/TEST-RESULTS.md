# 消费级设置中心：实测结果与完整功能映射

## 验证检查点

本文件记录已完成的 **CI2**，不把后续新增测试预先记为通过。

- 已测源码：`8bcb17928d3191c3200a56c59ca3e7c4c290aac6`，所有对应 receipt 的 `dirty` 为 false。
- CI：[41663529928](https://github.com/haohongfei2001-png/vaiwl-start/actions/runs/41663529928)，三个 job 均 SUCCESS。
- 集成提交：`82405ef44609597e374452dfbc319b9746b28bd6`，已纳入首页 `fbaef3fb00b47f284452fc628bffb816898bbf54`。
- 独立 Draft PR：[PR #2](https://github.com/haohongfei2001-png/vaiwl-start/pull/2)，目标 `codex/free-v1-implementation`。
- CI2 后，正式分支又前进到 `83387b841e58faac1fa00095e57add2aec7527d2`；本专项正在非破坏性集成其原生重绘测试改动，并加入下述两项定向测试。最终精确 SHA、同 SHA 回执与制品以 PR #2 的最终更新为准。

所有安装都使用隔离的 Linux 浏览器 Profile、合成会话／书签／历史数据。没有读取或修改用户真实数据库，没有把测试产生的 Project 归属当作真实账号认证。

## 已执行结果

**浏览器身份：CI2的 `chrome` artifact分类实际使用Playwright Chromium 156.0.8078.4，不是Google Chrome品牌发行版。** 下表及映射据此称Chromium。最终候选将另外使用官方Google Chrome for Testing Stable执行设置和原生窗口专项，既有Chromium回归继续保留；其下载身份、执行结果及精确SHA以PR #2最终回执为准。Edge使用真实Microsoft Edge。

| 验证 | Chromium（CI2） | Microsoft Edge | 证据文件 |
| --- | --- | --- | --- |
| 设置专项 | **90/90 PASS** | **90/90 PASS** | `settings-consumer/{chrome,edge}/validation.json` |
| 原生浏览器窗口、入口与键盘缩放 | **21/21 PASS** | **32/32 PASS** | `settings-native-window/{chrome,edge}/validation.json` |
| 合并后的首页响应式 | 141 PASS，1 API 路径 BLOCKED | 141 PASS，1 API 路径 BLOCKED | `layout-responsive/{chrome,edge}/validation.json` |
| 生活模式与原生书签 | 47 PASS，1 API 路径 BLOCKED | 47 PASS，1 API 路径 BLOCKED | `life-bookmarks-validation.json` / `edge-life-bookmarks-validation.json` |
| 首页项目／时间投影 | 37/37 PASS | 37/37 PASS | `home-workspace-validation.json` / `edge-home-workspace-validation.json` |
| 全部现有生产 UI 回归 | 68/68 PASS | 未重复执行该脚本 | `ui-validation.json` |
| 基础实装／持久化 | 18/18 PASS | 由设置专项覆盖相关操作 | `browser-validation.json` |
| 导入关闭／worker 重启恢复 | 9/9 PASS | 由设置专项覆盖关闭重开导入 | `import-recovery-validation.json` |
| P1 自动历史权限回归 | 14/14 PASS | 未重复执行该专项 | `automatic-history-validation.json` |
| 隐私边界／来源恢复 | 9/9、18/18 PASS | 未重复执行该专项 | `privacy-boundaries-validation.json`、`source-recovery-validation.json` |
| 项目观察／本地归属／启动恢复 | 25/25、37/37、14/14 PASS | 未重复执行该专项 | `project-observation-validation.json`、`native-project-grouping-validation.json`、`project-startup-validation.json` |
| 存储故障／原生体验／原位升级 | 3/3、44/44、6/6 PASS | 设置专项另测同路径升级 | `storage-faults-validation.json`、`native-experience-validation.json`、`native-upgrade-validation.json` |
| Types、单元、build、隐私审计与打包 | CI job SUCCESS | 共用同一源码／产物检查 | `Settings types, unit, privacy and package` job |

Chromium 原生窗口 receipt 标识 **156.0.8078.4**；Edge 标识 **156.0.4314.58**。下表中的 `SC-*` 是设置专项的实际检查 ID，在 CI2 两浏览器均 PASS；`N-*`、`UI-*`、`IMPORT-B-*` 是 Chromium 同 SHA 回归的实际检查 ID。单元测试使用测试文件中的真实名称／编号，指向可执行的算法或故障夹具，不替代真实浏览器权限气泡验收。

## 33 项功能映射与实际证据

完整的旧处理入口、持久化、权限与新位置见 [BASELINE-AUDIT.md](BASELINE-AUDIT.md)。下表将原来合并的一行“自定义名称／浏览器默认名称”分为两个真实操作，共33项；没有通过新增虚构功能扩大数量。

| # | 功能与新版位置 | 现有处理／持久化 | 实测 ID 与结果 |
| --- | --- | --- | --- |
| 1 | 新标签页 → 自定义名称 | `tab-title-form`；`native.title` | `SC-title-independent-from-icon`、`SC-draft-survives-category-roundtrip`、`SC-save-failure-keeps-value-and-draft`、`SC-save-retry-recovers`：两浏览器 PASS。保存失败保留旧值和草稿。 |
| 2 | 新标签页 → 浏览器默认名称 | 空名称＋`defaultTabTitle`；`native.title=''` | `N-default-browser-title`、`N-restore-default`：Chromium PASS；`SC-identity-reset-only`：两浏览器 PASS。浏览器／语言分支另由 `native title: browser and UI locale, not platform brand` 单元测试覆盖。 |
| 3 | 新标签页 → 浏览器风格／产品／自定义图标 | `tab-icon`；`native.icon` | `SC-icon-independent-from-title`、`SC-title-independent-from-icon`：两浏览器 PASS；`N-brand-identity-unchanged`：Chromium PASS。没有更改扩展品牌名或页面 Logo。 |
| 4 | 新标签页 → 上传／更换图片 | `tab-icon-upload`、`sanitizeIcon`；仅成功后写 `native.icon` | `SC-valid-upload-real-browser-decode`、`SC-invalid-upload-preserves-previous-identity`：两浏览器 PASS。取消选择另由 `canceling an upload preserves the previously saved icon and does not report success` 单元测试覆盖；SVG／伪装／超大图像由 `N-upload-reject-*` 覆盖。 |
| 5 | 新标签页 → 恢复名称与图标 | `tab-identity-reset`；只写 title/icon 两键 | `SC-identity-reset-only`：两浏览器 PASS，书签偏好与当前生活模式保留。 |
| 6 | 新标签页 → 书签栏习惯 | `bookmark-preference`；`native.bookmarks` | `SC-three-bookmark-behaviors-persist`：两浏览器 PASS；`N-always-bar-hidden`、`N-user-hidden-bar`、`N-no-permission-settings-only`：Chromium PASS。三个行为保留，没有自动识别原生设置的声明。 |
| 7 | 新标签页 → 书签授权／撤销 | `bookmark-connect`；真实 `permissions` API | `SC-bookmark-permission-refusal`、`SC-real-bookmark-permission-revocation`：两浏览器 PASS。拒绝是命名注入；撤销是实际浏览器 grant 的实际 remove。 |
| 8 | 书签读取失败 → 重新读取 | `bookmark-retry`、`refreshBookmarks`；原生树只读 | `B-bookmark-load-failure-recovers`：两浏览器生活／书签回归 PASS；注入 getTree 失败后，重试恢复实际原生树。 |
| 9 | 新标签页 → 旧快捷网站 → 数量／整理入口 | `settings-legacy-link`、`legacy-sites`；`shortcuts` | `SC-legacy-compatibility-reachable`、`SC-legacy-original-data-visible`：两浏览器 PASS。生活公共设置不读取此列表。 |
| 10 | 旧快捷网站 → 新增／编辑／取消编辑 | `add-site-form`、`SHORTCUT_UPSERT`；`shortcuts` | `UI-edit-website`、`UI-reject-script-shortcut`、`UI-reject-data-shortcut`、`UI-reject-credential-shortcut`：Chromium PASS；新增、编辑与验证通过生产表单执行。 |
| 11 | 旧快捷网站 → 固定／上下移动／拖拽／删除 | `SHORTCUT_UPSERT/MOVE/REMOVE`；`shortcuts` | `UI-pinning-preserves-order`、`UI-keyboard-order-controls`、`UI-native-drag-order`、`UI-remove-website`：Chromium PASS。 |
| 12 | 旧快捷网站 → 展开／收起 | `site-toggle`、`show-more-sites`；`shortcutSectionCollapsed` | `UI-collapsed-pins-only`、`UI-shortcuts-reload`、`UI-native-drag-order-reload`、`B-browser-restart-shortcut-order-collapse`：Chromium PASS。 |
| 13 | 旧快捷网站 → 迁入的原生文件夹 | `bookmark-destination`、`bookmarkMigrationDestinations` | `SC-real-native-folder-migration-deduplicates`：两浏览器 PASS，真实子文件夹可选；`migration destinations include nested folders in native order and exclude managed descendants` 与 `native folder selection survives unrelated renders and permission revocation removes stale targets` 单元测试覆盖可写边界及失效目标。 |
| 14 | 旧快捷网站 → 加入书签／去重／重试 | `bookmark-migrate`；原生 create＋锁；保留原 shortcuts | `SC-real-native-folder-migration-deduplicates`、`SC-repeat-migration-is-idempotent`：CI2 两浏览器 PASS；`N-migration-cancel-no-write`、`N-legacy-all-preserved`：Chromium PASS。**第二次 create 失败后的部分进度／再试反例是新测试，待最终 CI。** |
| 15 | AI 工作空间 → 连接／断开 ChatGPT | `connectChatGPT`、`PERMISSIONS_SYNC`；独立 host/API 权限 | `SC-chatgpt-permission-refusal-independent`、`SC-connected-status-with-paused-capture`、`SC-real-disconnect-stops-active-appearance`：两浏览器 PASS。连接状态未冒充云端同步。 |
| 16 | AI 工作空间 → 继续收录／暂停 | `capture-enabled`、`SETTINGS_UPDATE`；`captureEnabled` | `SC-pause-is-persisted-without-disconnecting`、`SC-disconnected-capture-not-misrepresented`：两浏览器 PASS；自动历史14项同 SHA PASS继续约束暂停、断开、撤权与迟到事件。 |
| 17 | AI 工作空间 → 历史导入入口 | `settings-import` → `import-dialog` | `SC-import-discoverable-with-independent-options`、`SC-nested-escape-returns-to-parent`：两浏览器 PASS。关闭详情保留父设置。 |
| 18 | 历史导入 → 90天／全部可读取范围 | `import-range`；checkpoint 时间边界 | `SC-import-discoverable-with-independent-options`、`SC-import-unsubmitted-options-preserved`、`SC-real-history-import-while-capture-paused`：两浏览器 PASS。D01/D02 分段算法单元测试覆盖范围拆分与持久批次。 |
| 19 | 历史导入 → 包含可读取同步历史 | `include-synced`；checkpoint `includeSynced` | `SC-import-unsubmitted-options-preserved`：两浏览器 PASS；`D04/D05 importer filters unrelated URLs before getVisits, excludes pure sync by default, retains unknown origin and titles safely` 单元测试通过。此项不宣称读取了用户真实跨设备历史。 |
| 20 | 历史导入 → 授权并导入 | `startImport`；history 权限、`IMPORT_START/STEP` | `SC-real-history-import-while-capture-paused`、`SC-history-does-not-imply-capture`：两浏览器 PASS；`IMPORT-B-no-chatgpt-source-authority`：Chromium PASS。主动导入独立于连接与连续收录。 |
| 21 | 历史导入 → 进度／完成／部分／异常 | `renderImport`、`importJobs` | `SC-real-history-import-while-capture-paused`、`SC-import-pause-live-control`：两浏览器 PASS；`D02 minimum saturated time slice is PARTIAL rather than fake completeness`、`D02/D08 paused and cancelled imports do no work; transport failure retains checkpoint` 单元测试通过。部分状态渲染映射另经源码审查，未宣称每个部分状态都已有实机截图。 |
| 22 | 历史导入 → 暂停／继续／取消 | `IMPORT_PAUSE/RESUME/CANCEL`；保留候选与区间 | `SC-import-pause-live-control`、`SC-import-resume-deduplicates`、`SC-import-cancel-retains-completed-results`：两浏览器 PASS，延迟真实 history search 的返回制造受控交错。 |
| 23 | 历史导入 → 关闭／重启／撤权中断恢复 | persisted checkpoint；`loadWorkspace`／显式设置访问恢复 | `SC-life-close-stops-after-inflight-batch`、`SC-life-reopen-resumes-existing-import`、`SC-life-explicit-visit-visibility-resumes-import`、`SC-import-reauthorize-refusal-preserves-checkpoint`、`SC-import-reauthorize-resumes-same-job`：两浏览器 PASS；`IMPORT-B-checkpoint-resumed-completely`：Chromium worker重启实测PASS。 |
| 24 | AI 工作空间 → 撤销历史权限 | `revokeHistory`；remove 后 contains 复核 | `SC-real-history-permission-revocation`：CI2 两浏览器 PASS；保留导入数据语义。**remove=false 的失败反馈定向反例尚待最终 CI。** |
| 25 | AI 工作空间 → 资料库时区 | `timezone-form`、`SETTINGS_UPDATE`；`libraryTimeZone` | `SC-invalid-timezone-preserves-setting`、`SC-timezone-changes-projection-not-original-activity`：两浏览器 PASS，旧 OpenDay 时区／日期逐值保留。 |
| 26 | 数据与隐私 → 恢复已移除会话 | `RECORD_RESTORE`；tombstone → 原 conversation | `SC-removed-record-restore-reachable`、`SC-restore-writes-original-record`：两浏览器 PASS；原 key、标题、URL、owner、membership保留，仅revision前进。 |
| 27 | 数据与隐私 → 清除全部 Start 本地数据 | `CLEAR_LOCAL`；显式确认后清 Start stores/native keys | `SC-danger-scope-explicit`、`SC-danger-cancel-has-no-effects`、`SC-clear-success-survives-followup-read-failure`、`SC-confirmed-clear-removes-only-start-state`、`SC-clear-retains-real-bookmarks-and-history`：两浏览器 PASS。真实原生书签及262条合成浏览历史逐值不变。 |
| 28 | 帮助与关于 → 来源／当前能力 | `source-description`、`source-details`；只读 capabilities | `SC-honest-technical-diagnostics-retained`、`SC-no-engineering-status-in-daily-settings`：两浏览器 PASS；仍说明账号空间认证和全量同步未完成。 |
| 29 | 帮助与关于 → 版本／构建 SHA／适配器 | bundled manifest/build，diagnostic文本 | `SC-honest-technical-diagnostics-retained`：两浏览器 PASS，展示实际构建SHA；运行文件另由 `production-runtime-unchanged` 在原生窗口检查中核对。 |
| 30 | 技术诊断 → 受控来源核验 | 原 `source-check.html` 入口 | `SC-honest-technical-diagnostics-retained`：入口两浏览器PASS；来源恢复独立回归 `source-recovery-validation.json` 18/18 PASS，不等于执行了用户真实账号的受控采样。 |
| 31 | 帮助与关于 → Chrome页脚／原生外观帮助 | 原生 `<details>`、`browser-footer-help`，无自动写操作 | `SC-category-about`、`SC-bounds-about-*`：两浏览器入口及布局PASS；帮助文案源码复核。**用户浏览器右键隐藏页脚未代为执行，也不记为本设置功能自动隐藏。** |
| 32 | 帮助与关于 → 新标签页被占用的帮助 | 原生 `<details>`；扩展图标／管理页说明 | `SC-category-about`、`SC-bounds-about-*`：入口及布局PASS；原生 `native-new-tab-entry` 两浏览器PASS验证当前提供者入口。未装第二个竞争扩展来冒充政策冲突复现。 |
| 33 | 设置中心／二级页 → 返回、关闭、Escape与焦点 | `settings-view`、原生modal、局部Tab端点循环 | `SC-detail-back-restores-parent`、`SC-nested-escape-returns-to-parent`、`SC-keyboard-focus-contained`、`SC-controls-have-accessible-names`、`SC-close-restores-trigger-focus`：两浏览器PASS；原生X11 `native-Escape-and-return-focus`两浏览器PASS。 |

## 生活模式、数据与持久化的额外约束

`SC-life-common-settings-zero-work-reads` 在新标签页／帮助公共设置路径观察到命令列表为空、数据库打开次数为0。只有点击工作专属分类后才临时读取；`SC-life-explicit-work-settings-without-mode-switch` 保持生活模式与隐藏的工作区主体；`SC-life-work-access-cleared-on-leave` 验证离开后不继续读取。可见性变化测试明确注入 `document.hidden`，并保留实际后台批次，未把注入称为物理切标签操作。

`SC-upgrade-same-extension-id`、`SC-upgrade-retains-old-database-and-preferences` 使用同一解压路径和同一Profile从基线升级，版本1、12个store、原记录主键、墓碑、活动及既有偏好逐值保留。`SC-full-browser-restart-persists-settings` 验证关闭浏览器进程后仍恢复名称、图标、生活模式，且生活模式不读取工作区。

可访问名称、键盘Tab／Shift+Tab、Escape、父层返回和触发按钮焦点已自动检查；没有宣称真人使用 VoiceOver／NVDA 完成读屏验收。

## 权限与异常证据的准确边界

1. **实际 grant 与 remove：** 隔离阶段以临时manifest预授予原有可选权限，生产JavaScript保持一致；恢复生产可选manifest后，检查真实权限持久化并调用真实 `permissions.remove`。不是通过伪造布尔值声称实际获得权限。
2. **命名拒绝分支：** 书签、ChatGPT、撤权后重新授权的拒绝由明确的 `permissions.request → false` 注入触发。验证了产品如何响应拒绝；**原生扩展权限气泡没有人工点击接受／拒绝**。
3. **真实数据API＋受控异常：** 迁移使用真实原生书签API，导入使用实际 `chrome.history.search/getVisits` 读取合成历史；暂停／取消时只延迟结果返回。标题保存异常和清除后的首个SNAPSHOT异常有明确注入边界。
4. **不会合并成笼统“权限全部实机通过”：** 原生用户同意界面、真实账号授权、数据API执行和故障分支分别报告。

## 真实原生窗口、缩放与截图

原生窗口专项从 `chrome.tabs.create({active:true})` **不传URL** 创建新标签页，用创建的tab id与实际文档所在tab id一致来证明原生入口；不靠直接打开扩展URL冒充。截图来自实际X11窗口，包含浏览器装饰，未合成标签栏。

- 大窗口为 **2048×1152 的显示器大小窗口**，receipt 明确 `displaySizedWindow=true`、`f11Fullscreen=false`。文件名中的 `fullscreen-window` **不代表F11无边框全屏或用户Mac全屏空间**。
- 实际窄窗口为1024×768；内容区尺寸另有实测。设置内容专项还覆盖1440×1000、960×720、720×800、390×844、320×640，不把内容viewport写成显示器分辨率。
- Chromium与Edge通过 **X11键盘 Ctrl+0、Ctrl+Plus** 实际达到125%和150%，`native-zoom-1.25`、`native-zoom-1.5`均PASS；记录真实zoom、devicePixelRatio、内容viewport、关闭按钮命中和控件边界。
- Edge垂直标签使用真实原生切换、展开和收起。`edge-native-vertical-tabs`、`edge-native-sidebar-collapse`、`edge-native-sidebar-expand`均PASS；展开时占245 CSS px，收起后剩38 CSS px。
- 旧headless API路径 `LAYOUT-native-newtab-zoom`、`B-native-NTP-zoom` **仍为BLOCKED**：`tabs.setZoom` 对原生NTP报不能访问 `chrome://`／`edge://`。实际键盘缩放专项提供替代路径的成功证据，没有删除或改写原阻断记录。
- 不宣称本轮修复Edge原生标签栏favicon限制，也不把内容页图标截图当作浏览器标签栏图标成功。

每个浏览器的设置专项提供32张CI2内容截图。前后同视口对照为 `before-1440x1000.png` ↔ `after-newtab-1440x1000.png`，以及 `before-390x844.png` ↔ `after-newtab-390x844.png`；其余含workspace/data/about/legacy/diagnostics、上传失败、权限拒绝、导入暂停／取消／完成、危险确认与生活模式。原生窗口截图在独立 `settings-native-window` 目录，避免混淆两类证据。

## 失败历史与修复

| 阶段 | 源码／运行 | 实际结果与处理 |
| --- | --- | --- |
| CI1 | `1a6024b65be82f620dbf83765447181dac0d1458`；[41661764056](https://github.com/haohongfei2001-png/vaiwl-start/actions/runs/41661764056) | 设置专项执行至59项PASS后，`SC-keyboard-focus-contained`失败；额外`SC-failure`是同一异常摘要。旧版反例安装还因不存在新导航而使两个旧回归失败。未把这些失败隐藏。 |
| 修复／集成 | `82405ef44609597e374452dfbc319b9746b28bd6` | 加局部Tab端点循环、动态导入／恢复焦点；旧版回归仅条件进入新分类和关闭仍存在的父dialog，原业务断言不放宽；纳入新版首页。 |
| CI2 | `8bcb17928d3191c3200a56c59ca3e7c4c290aac6`；[41663529928](https://github.com/haohongfei2001-png/vaiwl-start/actions/runs/41663529928) | 3/3 jobs SUCCESS；设置两浏览器各90/90；原生窗口21/21、32/32；修复后的Tab测试和旧反例回归均PASS。 |
| 最终候选待运行 | 合入`83387b…`、Google Chrome for Testing身份验证及以下两项定向检查 | 本文件不预先标PASS。最终同SHA测试、PR状态和制品另记PR #2最终回执。 |

## 新增两项待最终CI

| 新测试ID | 将验证什么 | 本文件封存时状态 |
| --- | --- | --- |
| `SC-migration-partial-failure-retains-real-progress` | 只拒绝第二次bookmark create，验证第一次真实写入保留、旧快捷项逐值不变、错误说明正确；随后同目标重试只补余项，既有去重检查也重新运行。 | **PENDING：已写测试，尚未执行最终CI** |
| `SC-history-revoke-false-keeps-honest-status` | 注入history remove=false，真实grant仍保留时UI应说明未撤销并保持重试控件；移除注入后继续真实撤权检查。 | **PENDING：已写测试，尚未执行最终CI** |

最终候选没有授权合并main、发布商店或操作用户真实资料库。独立源码结论与问题闭环见 [REVIEW.md](REVIEW.md)。
