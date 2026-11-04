# VAIWL Start — repository instructions for AI designers and coding agents

These instructions apply to the entire repository and to **every** homepage theme, including existing B/C variants and future themes.

## Required reading before any UI/design change

1. **Read `docs/free-v1/16-HOME-THEME-DESIGN-GUARDRAILS.md` in full.** It is the latest user-approved, mandatory cross-theme homepage design contract (2026-11-04).
2. Read `docs/free-v1/00-READ-ME-FIRST.md` and applicable product/data amendments before changing runtime behavior. Verify against current `main`/active branches; historical branch and PR instructions in old docs may be stale.
3. For any proposal, visual prototype, code, or review that touches the homepage, include an **R1–R6 compliance check**, with explicit PASS/FAIL/NOT_TESTED and evidence appropriate to the work. A design mock is not a runtime or real-user acceptance test.

## Hard cross-theme requirements (summary only; canonical detail in #16)

- Never display project/conversation/window **counts** anywhere in user-facing UI.
- Do not display time-span/date-range bars on the homepage; make period length configurable in Settings; keep adjacent-period back/forward arrows. Real single-day group headings remain allowed.
- Use **one compact button** for instant Work ↔ Life mode toggle, not two adjacent buttons.
- The **only project-card top-right control is `+`**, bound to creating a ChatGPT conversation *inside that project*; no overflow/menu/other buttons there.
- In Recent, display only nonempty **Pinned → Today → Yesterday**, or if all absent, the newest real date in the selected period; a separate small disclosure arrow expands remaining genuine date groups.
- Settings must offer **equal-height cards** (a one-conversation project still occupies full card height) and **content-adaptive cards** (later rows move upward to fill unused vertical space while preserving stable visual/keyboard order).

## Conflict and change rules

- For UI, layout, and interactions, the November 4 #16 contract overrides older static menu and no-masonry directives. Its scope does **not** override identity, real activity evidence, permissions, storage safety, or navigation validity in earlier contracts.
- Theme switching must not silently change the behavioral contract, layout setting, or stored data.
- When a request conflicts with a rule, surface the conflict and seek a new explicit user ruling rather than silently drifting.
- Do not claim the above behavior is already implemented merely because this normative document was added. A docs-only change does not pass UI acceptance.
