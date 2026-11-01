# 可执行验收标准

这些是**待开发产品**的验收要求，默认全部 NOT_RUN。不能把设计样稿的34项检查改填成以下产品通过数。每个PASS必须关联实际build SHA、浏览器版本、输入/动作和可核对的结果；真实用户数据不进入公开证据。

标记：U=纯领域/事务自动测试；B=实际扩展浏览器测试；L=真实ChatGPT元数据与动作；V=视觉/键盘审查。U不能替代B/L，Chromium headless不能替代完整Edge。

## A. 来源与范围（发布阻断项）

| ID | 输入/动作 | 精确通过条件 | 层 |
|---|---|---|---|
| S01 | 用户选择的真实Project P与普通会话N | 同一受支持profile分别产生正向PROJECT(P)、正向NONE；无正文读取 | L |
| S02 | 普通/c/、无badge、missing/null、未完整列表 | 全部UNKNOWN，不能凭缺失判NONE | U+L |
| S03 | P页旁边的Q历史链接 | Q不归P，限定P成员可正确归P | U+L |
| S04 | 项目内第一条会话标题与Project名称不同 | Project取P标题叶，会话取其标题叶，不互相误用 | U+L |
| S05 | 账号A→B，同名P/C；旧A文档迟到 | B不写入A；错误scopeEpoch拒绝；标题相同不合并 | B+L |
| S06 | accounts roster/default/null/仅昵称 | 无独立当前context证明不得变为已验证scope | U+L |
| S07 | 500条无账号历史，只打开其中1条确认A | 只链接这一条到A，其余499条仍未分配 | U+B |
| S08 | 生产构建依赖图与网络审计 | 不含完整conversation(s)/ID读取/消息解析/正文selector/Pro/模型请求 | U+B+L |
| S09 | 不支持DOM/401/挑战/来源冲突 | 有界停止并给准确失败码，目录可达；没有自动降为NONE | B+L |
| S10 | 原Free STATUS和Start验收记录 | 两者分开，原挂载未过不写已过；新metadata未验不写已通 | 审查 |

## B. 主动打开与时间

| ID | 输入/动作 | 精确通过条件 | 层 |
|---|---|---|---|
| O01 | Start左键或Enter打开已有会话，成功抵达 | 只有一条有效intent和当日OpenDay；不需发送消息 | B+L |
| O02 | Start中键/Ctrl/Cmd显式后台打开 | 抵达后当日一个单位；后台active=false不误拒绝明确意图 | B |
| O03 | 原生ChatGPT会话链接真实点击+SPA路由 | sender/document/route/目标关联后计一日 | L |
| O04 | element.click/dispatchEvent/pushState，无手势 | 活动增量为0 | U+B |
| O05 | 点击被取消、转到别的会话、登录页或404 | 无活动；intent rejected/expired，不凭onVisited补计 | B+L |
| O06 | 多tab同C同日同时打开、重复消息/双击 | OpenDay唯一键仅1，lastOpenedAt为最后合法打开，事务无裂缝 | U+B |
| O07 | 刷新、恢复关闭tab、浏览器重启恢复20tab、自动激活邻tab | 活动增量全部为0 | B |
| O08 | history.back/go脚本且含forward_back/from_address_bar | 活动增量0；不把qualifier名称当充分手势证明 | B |
| O09 | 若启用地址栏adapter，完整新typed导航及对应负例 | Chrome/Edge各通过，排除reload/start_page/redirect/后台/遍历 | B |
| O10 | 外站链接/书签/切回tab，无独立可证意图 | 可收录，活动不猜；限制与产品说明一致 | B |
| O11 | intent写后worker终止，再收到匹配抵达 | session未变且TTL内最多提交一次 | B |
| O12 | 浏览器重启或扩展Reload，旧tabId被复用 | browserSessionId不同，旧intent不消费 | B |
| O13 | staging点击，抵达时首次核验A | 本次新OpenDay只落A的resolvedRecordKey；旧staging活动不迁移、不双写 | U+B |
| O14 | 请求预期A，最终抵达B | 拒绝，不借未分配兜底写A或B活动 | U+B |
| O15 |23:59:59手势，次日00:00:02抵达 | 使用签发时issuedTimeZone/issuedLocalDate；只有前一天活动 | U+B |
| O16 | 意图存续期用户改时区、系统时钟异常 | 已签发日键不变；异常时间不造新鲜活动 | U |
| O17 | HTTP cache/BFCache抵达且有明确有效意图 | 可正常记；无意图自动恢复仍0，缓存本身不判主动性 | B |
| O18 | 空白新聊/脚本获得新conversation ID | 可新收录，无确认打开则活动0；没有发送追踪或正文采集 | B+L |
| T01 | contracts/time-vectors.json全部边界 | 与继承纯函数一致，30个日历日无缺日/重叠 | U |
| T02 | 一个P成员今天活动，其余60天前 | P只在当前段一张卡；旧成员在P内可展开 | U+B |
| T03 | NONE旧日期会话今天再次主动打开 | 只出现在今天，旧日期无重复实体 | U+B |
| T04 | 未知日期、仅history.lastVisitTime | 不塞今天/最老段；独立无日期入口可搜索打开 | U+B |
| T05 | 当前段→空段→更早已知段→返回 | 每次k±1，不跳空；k=0没有向上按钮 | B |
| T06 | 10个活动同毫秒/缺日期的对象，多次投影 | 稳定rank/ID顺序完全相同，不随机跳动 | U |
| T07 | 指针按下/IME期间更新排序；之后安全点 | 操作目标不漂移，完成后≤1秒更新并恢复同recordKey焦点/锚 | B+V |
| T08 |另一个tab更新目录/午夜到来，当前浏览历史段 | 不强制跳回当前段，更新有界且可预期 | B |

## C. 目录、权限与持久性

| ID | 输入/动作 | 精确通过条件 | 层 |
|---|---|---|---|
| D01 | history导入默认/自选全部可读取范围 | 明确时间边界、500批、饱和细分；无默认24h/100静默漏项 | U+B |
| D02 | 同毫秒超过一批、关闭导入页、worker退出、继续 | 有checkpoint/去重；仍饱和标PARTIAL；不虚称全量 | U+B |
| D03 | 同标题不同ID、不同路径同ID、同ID跨scope | 前者不合并，同scope合法别名去重，跨scope分离 | U |
| D04 | 假域名/子域/share/temporary/危险query/编码/credentials | URL规则拒绝，不转成私有会话 | U+B |
| D05 | isLocal=false/缺失/title缺失 | 来源准确未知或同步；无主动活动，缺标题安全占位 | U+B |
| D06 | 关闭全部ChatGPT tab并重启浏览器 | 已保存目录、网站顺序和折叠仍存在，可重新进入 | B |
| D07 | 删除A scoped记录后history重导入/候选再解析 | A不复活；B同ID经独立核验仍可用；明确恢复可解除A墓碑 | U+B |
| D08 | revoke history、revoke ChatGPT host、禁用采集 | 分别停止对应来源，现有目录仍可读，不后台再申请 | B |
| D09 | 清浏览器历史/退出ChatGPT | 不悄悄清已保存目录；留存说明与清本地操作准确 | B |
| D10 | quota错误、迁移中断、重复升级 | 旧库不被删；错误有界；重试不重复实体 | U+B |
| D11 | 新tab首次打开，无联网/身份请求很慢 | 已存本地数据先显示；慢来源不阻塞首屏 | B |
| D12 |恶意标题HTML、未知IPC字段、伪scope/verified、跨frame消息 | 纯文本渲染/严格拒绝，不执行HTML，不接受伪权威 | U+B |

## D. 首页与兼容

| ID | 输入/动作 | 精确通过条件 | 层 |
|---|---|---|---|
| U01 | 桌面默认页，6项目+NONE+UNKNOWN | 原型层级/尺寸成立，非统计后台；项目卡无整卡折叠 | V |
| U02 | 当前成员>5，旧成员另有数条 | 初始5/+12；旧箭头只展开真实旧成员；全部可达 | B+V |
| U03 | 项目、NONE、待确认、没有项目的账号 | 过滤只变视图，UNKNOWN不混NONE；无项目仍有完整可用首页 | B |
| U04 | 搜索旧会话、无结果、Esc返回 | 跨日期可达、限选中scope、焦点/滚动恢复；不全文搜索 | B+V |
| U05 | '/', Ctrl/Cmd+K/L, PageUp/Down, 普通滚轮 | /仅页面非编辑无修饰时开搜索；其余原生键位和滚动不被抢占 | B |
| U06 | 320/400/720/1000/1440/1920及200%缩放 | 无水平溢出；菜单/右缘箭头不遮内容；列数按视口变化 | B+V |
| U07 | 添加网站、固定、拖动、键盘上下移动、折叠/重启 | 统一用户顺序持久；固定不乱序且折叠仍可见 | B+V |
| U08 | 网站javascript/data/带凭证URL | 拒绝；合法http/https正常打开，不增加ChatGPT活动 | U+B |
| U09 | 初次安装、拒绝权限、导入只有UNKNOWN | 首屏可立即用，按需授权，无无限加载或假Project | B+V |
| U10 | Chrome与Edge各侧载，原生垂直标签开启/收起 | 新标签覆盖与首页布局均正常，不操作真实标签顺序 | B+V |
| U11 | 另一新标签扩展/企业策略占用 | 不争抢，提供扩展图标打开入口与可理解说明 | B |
| U12 | 离线、非受支持页面、其他扩展共存 | 可读缓存；无宿主mask/iframe/正文注入；既有功能不破坏 | B+L |

## 必需的真实连续旅程

1. 新装 → 拒绝history仍可用网站 → 再授权导入 → UNKNOWN可打开 → P/NONE来源逐条确认 → 关闭全部tab → 重启 → 从首页重新打开。
2. 项目中打开旧会话 → 项目进入当前段 → 旧成员仍在父卡 → 在原生ChatGPT切到另一会话 → 回Start排序正确 → 同日重开不重复。
3. A账号资料库 → 切B → 同名P/C → 旧A消息迟到 → 回选A本地目录；无跨scope数据覆盖和活动错记。
4. 一次明确后台打开、一次刷新、一次恢复多个tab、一次脚本history.go；只有明确打开生成活动。

## 证据规则与完成门

每条记录为 `{id,status,buildSha,browserVersion,environment,steps,observed,artifactRefs,limitations}`。状态只有PASS/FAIL/BLOCKED/NOT_RUN；禁止“基本通过”替代失败。公开仓只存合成/脱敏结果与固定失败码，不上传用户原始页面、账号标识或会话标题。

完整Free V1必须S01–S09、O01–O08/O10–O18、T/D/U及四条连续旅程通过；O09只有启用地址栏能力才强制，否则记录SUPPORTED入口限制。Edge真实验收不能被API兼容性文档或Chromium样稿替代。来源门失败时可交付目录受限候选，但状态不得是FREE_V1_ACCEPTED。
