# Independent settings review

Scope: settings implementation originally based on `1c2aee3cd344889a8b5313a23c19c0489ca0ef5d`, and final bounded source re-review at merge commit `56472c862f0538a8a4dbadf7ab18aa17da831286`. The candidate includes homepage commit `fbaef3fb00b47f284452fc628bffb816898bbf54` and settings fixes `58d2f30`. Reviewed files include `public/newtab.html`, `public/settings.css`, `src/ui/settings-view.ts`, `src/ui/native-experience.ts`, the settings integration in `src/ui/newtab.ts`, and the build resource list.

Reviewer role: separate from the implementation agents. This file records source inspection and targeted structural checks. Installed-browser acceptance and same-SHA CI results belong to the final validation receipt; they are not implied by this review.

## Actual information architecture

The implementation follows the recommended four-category center:

| Category / detail | Actual entry and content |
| --- | --- |
| 新标签页 | `settings-nav-newtab` → tab preview, independent title save, icon selection/upload/reset, bookmark display and permission |
| AI 工作空间 | `settings-nav-workspace` → ChatGPT permission, effective capture state, history import/status/revoke, explicit timezone save |
| 数据与隐私 | `settings-nav-data` → removed-record recovery and separately styled irreversible local clear |
| 帮助与关于 | `settings-nav-about` → version, expandable browser appearance/provider/icon help |
| 旧快捷网站 | `settings-legacy-link` → `settings-panel-legacy` → existing editor and writable native folder migration |
| 技术诊断 | `settings-diagnostics-link` → `settings-panel-diagnostics` → truthful source state, build SHA, adapter, controlled source check |
| Import / removed / legacy editor / clear | Existing native dialogs open above the settings center; the parent remains open, preserving its category and scroll |

No duplicated mode switch, editable-looking 30-day rule or ordinary-page source gate was added. Settings selectors are scoped to the settings center or its detail dialogs; they inherit global text/line/hover tokens. The homepage grid, projection, bookmark shelf and life layout are not rewritten by this settings diff.

## Functional preservation check

The complete functional map is in `BASELINE-AUDIT.md`. Its proposed locations correspond to the implemented locations above. A separate parser comparison of baseline/current settings, import, legacy editor, recovery and clear dialogs found:

- Baseline identified buttons, inputs, selects, links and forms: **31**.
- Retained identified controls: **31**.
- Removed identified controls: **0**.
- Added controls are category navigation, back, detail links and loading retry.

This structural check does not prove clickability. Dynamic import actions, shortcut editor actions and restoration rows were separately traced through their existing handlers. They still route to `IMPORT_*`, `SHORTCUT_*` and `RECORD_RESTORE`; explicit clear still uses `CLEAR_LOCAL`.

Relative to the integrated homepage parent `fbaef3fb00b47f284452fc628bffb816898bbf54`, the candidate has no changes in `src/background`, `src/storage`, `contracts`, `src/ui/bookmark-shelf.ts`, `public/bookmarks.css`, `public/life.css`, or `public/newtab.css`. Database version and primary keys remain unchanged.

## Issues identified during independent review

| Issue | Reproduction / implication | Disposition at this review checkpoint |
| --- | --- | --- |
| R1 — life-mode import does not restart | Start import from explicit life workspace settings; close settings; reopen workspace settings. The saved job can remain running while no batch is scheduled. Hidden→visible previously updated only the clock. | Implementation now restores a running job on the explicit workspace settings visit and uses `workspaceAccessAllowed()` for lifecycle refresh/resume. Targeted browser test requested. |
| R2 — native errors lack error styling | Native title/icon/bookmark code writes `data-state="error"`; CSS originally only matched `data-error="true"`. | CSS now supports both status paths. Native error messages remain local to their affected control group. |
| R3 — enabled save can silently lose an action | Trigger a delayed catalog mutation, then submit timezone or clear while the shared mutation guard is busy. Original guard returned without visible feedback. | Save controls are now disabled/marked busy during catalog mutation; competing programmatic submission gets a busy message; focus restoration added. Browser interleaving coverage requested. |
| R4 — committed clear mislabeled as failed/preserved | Let `CLEAR_LOCAL` succeed, then reject the following `SNAPSHOT`. Combining write and read in one catch could claim “已有数据仍然保留” after actual deletion. | Write success is now recorded separately from refresh failure. The committed-operation callback still runs, with “操作已完成，页面暂未刷新” if needed. Exact post-clear fault-injection browser check added. |
| R5 — permission-revoked import checkpoint discoverability | A checkpoint with pending work in `permission-revoked` previously offered only starting a new import. | “授权并继续” now requests history in the trusted gesture and calls `IMPORT_RESUME` for the same job. Denial retains the checkpoint; imported records remain. This fixes an inherited baseline gap. |
| R6 — history permission removal returns false | Make `chrome.permissions.remove({permissions:['history']})` resolve false. The original action chain refreshed state without explaining that permission remained. | `revokeHistory()` now disables the control while pending, checks actual `permissions.contains`, and reports retained permission as an error. The click remains trusted and imported records are retained. Source fix confirmed in `58d2f30` and the integrated candidate. |
| R7 — native modal Tab endpoint escape | First installed-browser run reported that Tab could leave the dialog for browser chrome after 59 successful settings checks. | A local keydown handler now cycles the visible enabled focus endpoints within each settings dialog. It excludes hidden/inert controls and leaves Ctrl/Meta/Alt+Tab and IME handling alone. Corrected candidate execution required. |

## Source-level safety and interaction conclusions

- Common settings in life mode do not obtain a workspace snapshot. Explicit navigation into workspace/data/legacy/diagnostics grants a temporary settings access path. Leaving that path unsubscribes revisions, invalidates late refreshes and clears private surfaces. It does not switch or persist the home mode.
- `refresh()` applies snapshot results only while its sequence, mode epoch, selected scope and access remain current. The life path renders settings without building the workspace homepage.
- The effective capture switch requires actual ChatGPT permission and the stored capture preference. Disconnect/revoke renders it off and disabled; permission checks and event updates are retained. Background P1 ingestion authority is unchanged.
- Connection from settings no longer silently forces a paused capture setting on. The homepage's existing first-connect action remains an explicit onboarding behavior. Explicit history import remains possible while capture is paused.
- Title and timezone draft flags protect unfinished edits from refresh/navigation. Native icon errors and picker cancellation preserve the previous persisted selection. Native preference writes remain independent and serialized.
- Bookmark migration traverses writable folders in native order, excludes managed subtrees, snapshots the chosen folder and source list, revalidates the destination, serializes migration, deduplicates existing URLs and retains all old shortcuts. No homepage bookmark ordering change was introduced.
- The settings navigation uses real buttons with current-page semantics and supplemental arrow navigation. Headings can receive focus after category changes. Native modal dialogs preserve the parent layer and Escape behavior; local Tab endpoint cycling supplements the browser's modal boundary. The corrected Tab behavior requires execution on the final candidate.
- The clear confirmation explicitly excludes ChatGPT conversations, browser history and native bookmarks. Restoration wording now matches immediate restoration of the stored local record.
- The diagnostics page still says account-space certification and full sync are incomplete. The ordinary settings page does not misrepresent local collection as cloud synchronization.

## Required execution evidence

This environment has no usable Chrome/Edge executable. This reviewer therefore does **not** claim installed-browser or screenshot PASS. The independent settings browser suite and CI must verify actual modal geometry, parent/focus return, life access release, permission refusal/revocation, title/icon persistence and failures, timezone/capture persistence, old database retention, folder migration/deduplication, import pause/resume/cancel, R1 lifecycle recovery and R4 post-commit read failure.

Native permission prompts, injected permission-result branches and actual browser grants must remain distinctly labeled. Content-page screenshots do not prove browser-native tab-strip icon behavior.

### First CI failure independently inspected

[Settings CI run 41661764056](https://github.com/haohongfei2001-png/vaiwl-start/actions/runs/41661764056) tested clean commit `1a6024b65be82f620dbf83765447181dac0d1458`. This reviewer read the downloaded Edge `settings-consumer/edge/validation.json`: it records **59 PASS**, followed by failed assertion `SC-keyboard-focus-contained` and its duplicate failure-summary record. These are one substantive focus failure, not two independent defects. The receipt identifies Edge 156 on an isolated Linux profile. It does not claim completion of the later checks. The local Tab fix must pass on the new candidate before final acceptance.

## Homepage integration and regression adaptation re-review

The non-destructive merge at `56472c862f0538a8a4dbadf7ab18aa17da831286` was independently compared with both parents. The only incoming shared `src/ui/newtab.ts` change removes the chat/arrow decorations from `conversationRow`, matching the homepage designer's implementation. It does not touch the settings navigation, permissions, drafts, modal stack or collection behavior. Homepage CSS and bookmark/life presentation files remain byte-equivalent to the homepage parent.

The pending regression-test adaptations in `tests/browser/automatic-history.mjs` and `tests/browser/project-startup.mjs` were also inspected. They conditionally click the new workspace category only when that category exists, allowing the same test to run against the deliberately installed old-version counterexample. The old UI's closed parent dialog is handled conditionally after import. No historical capture, database, collection, restart or old-version counterexample assertion was relaxed.

The settings workflow now also runs the homepage's responsive/native-frame suite for both browsers on the combined candidate. Added Linux GUI utilities support those existing native-frame checks; they do not change production permissions or runtime behavior.

## Review disposition

No confirmed new P0/P1 was identified in this bounded source review. R1–R7 have source fixes, and the concurrently developed homepage is now included without a destructive overwrite. Source review is ready for final same-SHA validation. This is not a merge approval or a claim that the corrected browser suite has already passed; the final CI receipt must record the actual combined candidate's results and retain the first-run failure history.
