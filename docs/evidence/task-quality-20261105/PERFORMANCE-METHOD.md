# Task quality measurement method

This is the reproducible method, not a performance result or a live-account acceptance claim. The measured JSON and screenshots are emitted by the same-commit `ChatGPT task results` CI jobs under `artifacts/task-quality/{chrome,edge}/{baseline,candidate}/` and `artifacts/task-sync-quality/{chrome,edge}/`.

## Comparison

- Control: unchanged PR #9 commit `549f1e2794784586326ce114d98abbd3d36e2458`, built from a separate clean Git worktree.
- Candidate: the current PR head, built by `npm run verify`.
- Both use the same benchmark, browser binary, CI runner, fonts, window dimensions and synthetic data. Every runtime file is checked against its own `build.json` hash before installation.
- The browser runs the unpacked extension's production JavaScript. The isolated manifest pregrants optional `bookmarks`, `scripting`, `alarms` and ChatGPT-origin access; the tests do not claim the native permission dialog was accepted.
- There are no real account records, task prompts or private AI outputs in the fixtures or public screenshots.

## Measurements

| Question | Measurement |
| --- | --- |
| How soon does a cached home appear? | From navigation time origin to two animation frames after the real project grid exists and is visible. Three warmups, then 24 independent reloads of the ten-task cache. Report min, p50, p95 and max. |
| How soon does the cached task appear? | Same navigation time origin and visibility rule for the actual `.task-featured` element, measured independently of the project grid. |
| Does opening or closing respond quickly? | Trusted browser click / Escape event timestamp to the second subsequent animation frame, verifying the real popover is open / closed. Twenty-four repetitions per action. |
| What happens with low, larger or unavailable data? | Twelve reloads each with one task, thirty tasks (ten selected), browser offline, and retained data after a sync error. Cold empty installation and cached loading after a full browser restart are separate single observations; neither is reported as a p95. |
| What is the CPU cost? | CDP `Performance.getMetrics` renderer `TaskDuration` and `ScriptDuration` using `threadTicks`. Navigation resets the document's metric epoch, so a load uses the new document totals. Same-document background-sync measurements use before/after deltas. Raw readings are retained. |
| What is the memory/resource cost? | Renderer JS heap and CDP DOM/listener counters. The component is opened, disposed by Life mode and reconstructed 40 times; before/after heap and counters are collected after explicit browser GC. |
| Is network required for cached use? | HTTP(S) request count from the real browser context, with unavailable network during cache tests. Eight new tabs are opened concurrently with automatic sync enabled and a fresh cache. |
| Does background work affect typing or reading? | A separate local HTTPS native-page fixture holds one actual result response while eight explicit refreshes arrive. Trusted typing latency, active tab/focus, project position, retained preview and an already-open full-text reader are observed. |
| Does synchronization stay bounded? | First read, eight concurrent refreshes, five later rounds, network failure, immediate retries, worker restart and ordinary-source recovery. Record native GET request count, bytes and wall duration; verify temporary tabs are released. |

The first budgets are cached project-grid p95 ≤300 ms and panel interaction p95 ≤100 ms. The report records whether each budget was met; a miss remains visible with the actual timings. It does not replace the observation with a threshold or pretend a controlled fixture is a user-device measurement.

## Visual and behavioral coverage

The same installed runtime renders classic, A (`spatial`), B (`workbench`) and C (`folio`) with project cards, recent conversations, bookmarks and task data. Screenshots show default and expanded states at 1470 CSS pixels, plus representative 1280/390 widths. Bounds are checked at 1920, 1280, 1024, 760, 640, 390 and 320 pixels. Actual browser zoom is exercised at 125%, 150% and 200% on the extension document.

Opening a results panel must not move project or recent content. Full text and its original source remain reachable. Reader focus returns to its originating control. Worker and browser restarts retain cached text. The existing homepage-guardrails suite independently covers R1–R6; this benchmark does not substitute screenshots for those functional checks.

## Limits

These are real headless Linux Chrome-for-Testing/Chromium and Microsoft Edge executions in disposable Profiles, with synthetic source data. They establish browser/runtime behavior under controlled conditions. They do not establish Mac rendering latency, a physical display's latency, live ChatGPT authentication, real Cloudflare recovery, or native Edge vertical-tab UI behavior. Reduced viewport widths exercise the content layout that a sidebar constrains, without claiming that the native sidebar was operated.

The CPU figures are foreground-renderer CPU, and memory figures are renderer JS heap; neither is whole-browser process usage or Service Worker CPU. The [official Performance protocol](https://chromedevtools.github.io/devtools-protocol/tot/Performance/) distinguishes elapsed `timeTicks` from the selected `threadTicks`. Source fixture timings include synthetic network behavior, including a deliberately delayed response. Forty lifecycle cycles and several sync rounds detect bounded leaks and repeatability failures, but are not a multi-day endurance certification.

To repeat locally with installed browser binaries:

```sh
npm run verify
VAIWL_QUALITY_RUNTIME=/absolute/path/to/clean-pr9/dist VAIWL_QUALITY_LABEL=baseline node tests/browser/task-quality.mjs
VAIWL_QUALITY_LABEL=candidate node tests/browser/task-quality.mjs
node tests/browser/task-sync-quality.mjs
```

Choose Edge with `VAIWL_BROWSER_CHANNEL=msedge VAIWL_TEST_BROWSER_FAMILY=edge`. `VAIWL_CHROMIUM_EXECUTABLE` can point at an explicitly chosen compatible browser binary. Production Profiles and source task schedules are never needed by these commands.
