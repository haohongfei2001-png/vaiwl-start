# vaiwl-start

A new tab workspace for ChatGPT conversations and projects.

## Free V1 design handoff

**VAIWL-START-FREE/1.0 — design specification, not a released extension.**

- [Start here · 冻结设计入口](docs/free-v1/00-READ-ME-FIRST.md)
- [Codex development instructions · 正式开发指令](docs/free-v1/07-CODEX-START.md)
- [Product spec](docs/free-v1/01-PRODUCT-SPEC.md) · [Interaction design](docs/free-v1/02-INTERACTION-DESIGN.md)
- [Data contract](docs/free-v1/03-DATA-CONTRACT.md) · [Source reliability](docs/free-v1/04-SOURCE-RELIABILITY.md)
- [Architecture and reuse](docs/free-v1/05-ARCHITECTURE-AND-REUSE.md) · [Acceptance criteria](docs/free-v1/06-ACCEPTANCE.md)
- [Offline interactive design prototype](design/free-v1/prototype.html) — download and open locally; all content is synthetic.

![VAIWL Start Free V1 desktop design](design/free-v1/desktop.png)

The extension will keep a local, persistent directory of visited ChatGPT conversations, native projects, and user-managed website shortcuts. Free V1 does not read message bodies or depend on an AI API.

The standalone homepage avoids the original VAIWL host-mount dependency. Reliable live account/context and explicit NONE membership sources remain required engineering gates, not capabilities proven by this design prototype. See the source matrix and acceptance criteria before making product readiness claims.
