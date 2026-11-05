# vaiwl-start

A new tab workspace for ChatGPT conversations, projects and opt-in scheduled-task results.

The task-results implementation inherits the unmodified PR #7 model and the shared homepage themes from PR #6. See [ChatGPT 定时任务：安装、同步与验证范围](docs/CHATGPT_TASKS.zh-CN.md).

## Free V1 development candidate

The original workspace implementation originated in [PR #1](https://github.com/haohongfei2001-png/vaiwl-start/pull/1); it is now part of `main`. This task-results candidate is on the independent `feat/chatgpt-task-home-20261104` branch. The candidate has a persistent local directory, bounded browser-history import, scoped data/transaction core, the frozen new-tab UI, website management, and loadable MV3 packaging.

**LOCAL_WORKSPACE_READY:** imported UNKNOWN history remains organized into 30-day windows. Native Project pages, explicit Project conversation URLs and independently checked sidebar metadata now populate stable **locally observed native Projects**, including empty Projects, incremental members, renames and full-directory search. Local identity uses Profile + observed session principal, or an isolated document boundary when no principal is available. Formal membership remains UNKNOWN; current Workspace certification and full membership synchronization are separate capabilities. Start opening days, existing history, life mode and native bookmarks are preserved. See the [user-approved native Project amendment](docs/free-v1/13-NATIVE-PROJECT-LOCAL-AMENDMENT.md). Installed-extension fixtures do not certify the current signed-in ChatGPT source or imply FREE_V1_ACCEPTED.

- [安装与实际使用](docs/INSTALL.zh-CN.md)
- [唯一实施状态](docs/IMPLEMENTATION_STATUS.md)
- [测试范围与限制](docs/TEST_RECORDS.md)
- [M0 来源门](docs/M0_SOURCE_GATE.md)

Build: `npm ci && npm run verify`. Load `dist` as an unpacked extension. `npm run package` creates a development ZIP from a committed, clean tree. Main remains unchanged; no store release.

## Free V1 design handoff

**All homepage themes and future UI work must follow the [cross-theme mandatory design rules (R1–R6)](docs/free-v1/16-HOME-THEME-DESIGN-GUARDRAILS.md).** AI designers and coding agents must read [AGENTS.md](AGENTS.md) before proposing or changing home UI. This is a design contract, not a claim that the rules are implemented yet.


**VAIWL-START-FREE/1.0 — design specification, not a released extension.**

- [Start here · 冻结设计入口](docs/free-v1/00-READ-ME-FIRST.md)
- [Codex development instructions · 正式开发指令](docs/free-v1/07-CODEX-START.md)
- [Product spec](docs/free-v1/01-PRODUCT-SPEC.md) · [Interaction design](docs/free-v1/02-INTERACTION-DESIGN.md)
- [Data contract](docs/free-v1/03-DATA-CONTRACT.md) · [Source reliability](docs/free-v1/04-SOURCE-RELIABILITY.md)
- [Architecture and reuse](docs/free-v1/05-ARCHITECTURE-AND-REUSE.md) · [Acceptance criteria](docs/free-v1/06-ACCEPTANCE.md)
- [Offline interactive design prototype](design/free-v1/prototype.html) — download and open locally; all content is synthetic.

![VAIWL Start Free V1 desktop design](design/free-v1/desktop.png)

The extension will keep a local, persistent directory of visited ChatGPT conversations, native projects, and user-managed website shortcuts. The ordinary conversation collector remains metadata-only. The separately enabled task adapter stores only explicitly task-tagged final AI output locally. Neither uses a paid AI API.

The standalone homepage avoids the original VAIWL host-mount dependency. Reliable live account/context and explicit NONE membership sources remain required engineering gates, not capabilities proven by this design prototype. See the source matrix and acceptance criteria before making product readiness claims.
