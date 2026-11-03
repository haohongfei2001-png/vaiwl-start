# Settings redesign — baseline functional audit

Baseline: `1c2aee3cd344889a8b5313a23c19c0489ca0ef5d`. This is a source audit, not a browser execution receipt. The audit covers the settings dialog and the import, removed-record, legacy-site and clear dialogs it opens. It does not authorize homepage changes or database migration.

## Information architecture decision

| Direction | First-use comprehension / discovery | Steps / density | Growth / fit |
| --- | --- | --- | --- |
| A. One grouped page | Familiar initially, but the existing operations produce a long scroll and mix unrelated permissions | Few navigation clicks; highest scanning cost | Repeats the problem when import and technical states expand |
| B. Navigated settings center | Four stable task names make identity, workspace, data and help predictable | One category action; each category remains short | Best foundation at desktop and split-window sizes |
| C. Main page plus detail pages | Very clean landing page, but too many entry cards hide ordinary controls | Additional entry/return actions for frequently used changes | Useful for migration, diagnostics and destructive confirmation |

**Recommendation:** B with a restrained use of C: four categories, “新标签页 / AI 工作空间 / 数据与隐私 / 帮助与关于”. Identity and bookmarks belong together in the first category. Import is a visible workspace action; migration and diagnostics are details. Do not add a separate bookmarks category or a second home-mode switch. Do not expose a 30-day setting when it has no editable value. On narrow screens, change navigation presentation without duplicating controls or creating a second persistence path.

## Complete operation map

The “new location” column is the recommended destination. The implementation's final mapping and execution receipt must confirm it.

| Existing setting / operation | Existing UI entry and handler | Persistence / browser operation | Permission | New location and required interaction |
| --- | --- | --- | --- | --- |
| Custom tab title | `#tab-title-form`, `initNativeExperience` submit; `validTitle` | `chrome.storage.local['native.title']` | None | New tab → title; explicit save/Enter; never clobber an unfinished draft on unrelated refresh |
| Browser default tab title | Same title form with an empty value; `defaultTabTitle` | `native.title=''`; browser family and UI locale determine the displayed fallback | None | New tab → clear the title and save, or restore default identity; icon remains independent when only the title is saved |
| Browser / product / uploaded icon | `#tab-icon` change; `identity()` | `native.icon`; bundled SVG or sanitized local PNG | None | New tab → icon; choice saves immediately; title remains independent |
| Upload or replace local icon | `#tab-upload-again`, `#tab-icon-upload`; `sanitizeIcon` | `native.icon` only after validated conversion; 1 MiB, ≤2048×2048, PNG/JPEG/WebP | User file picker | New tab → icon upload; failure or picker cancellation preserves the previous icon and truthful selection |
| Restore default tab identity | `#tab-identity-reset` | Sets `native.title=''`, `native.icon={kind:'browser'}`; leaves bookmarks unchanged | None | New tab → restore tab identity; does not reset other settings |
| Bookmark display preference | `#bookmark-preference` change; `bookmarkPreference` | `native.bookmarks`: `ask`, `always`, `newtab`, `hidden` | None to set preference | New tab → bookmarks; preserve three user behaviors and unconfigured value; no claim of automatic detection |
| Grant / revoke bookmark access | `#bookmark-connect`, trusted document click | `chrome.permissions.request/remove({permissions:['bookmarks']})`; observed with contains and permission events | Optional `bookmarks` | Same bookmarks row; browser prompt remains in the trusted gesture turn; rejected/revoked/error states accurate |
| Refresh bookmark read failure | `#bookmark-retry`; `refreshBookmarks` | Read-only browser tree refresh | `bookmarks` | Retain retry where failure is visible; no change to homepage shelf organization in this task |
| Legacy shortcut count / access | `#legacy-count`, `#legacy-sites` | Snapshot `shortcuts` store | No browser permission; workspace-only data | New tab → legacy websites detail, behind explicit workspace entry in life mode |
| Legacy shortcut create / edit | `#add-site-form`, `#site-name`, `#site-url`, `data-edit-site`; `SHORTCUT_UPSERT` | IndexedDB `shortcuts` via `Repository.saveShortcut` | None | Legacy websites detail; preserve validation, cancel edit, id and pin state |
| Legacy shortcut pin / reorder / remove | `data-pin-site`, `data-move-site`, drag/drop, `data-remove-site` | `SHORTCUT_UPSERT/MOVE/REMOVE`; `shortcuts` | None | Same detail; retain accessible move buttons as well as dragging |
| Legacy shortcut section expand/collapse | `#site-toggle`, `#show-more-sites` | `settings.main.shortcutSectionCollapsed`; expanded view is UI-only | None | Same detail; keep pinned-when-collapsed behavior |
| Migration target selection | `#bookmark-destination` | UI-only selected native node id; baseline only offers writable bookmark bars | `bookmarks` | Legacy migration detail; this request additionally requires native writable folder selection, with target revalidation |
| Migrate legacy websites | `#bookmark-migrate`; `migrate()` under navigator lock | `chrome.bookmarks.create`, preserving local shortcuts; reread tree and search existing URL before create | `bookmarks`, trusted action | Detail → migrate; concise scope confirmation, counts, dedupe, partial-failure retry; never delete source or existing bookmarks |
| Connect / disconnect ChatGPT | `#connect-chatgpt`; `connectChatGPT` | Permission request/remove + `PERMISSIONS_SYNC`; capture preference in IndexedDB settings | `scripting`, `webNavigation`, `https://chatgpt.com/*` | AI workspace → connection; status represents local observation permission, not cloud account sync |
| Continue / pause capture | `#capture-enabled` change; `SETTINGS_UPDATE` | `settings.main.captureEnabled`; background reconcile and automatic-history fencing | ChatGPT connection required to run | AI workspace → separate toggle; show effective operation only when connected; capture preference and actual permission are distinct |
| Import browser history entry | `#settings-import`, `#first-import` | Opens import dialog; no import until explicit start | None to inspect | AI workspace → visible “导入浏览器历史” action |
| Import range | `#import-range` | `IMPORT_START` checkpoint `startTimeMs/endTimeMs`, recent90/all | `history` at start | Import detail; preserve both ranges |
| Include browser-readable synced history | `#include-synced` | Import checkpoint `includeSynced` | `history` | Import detail; no claim to fetch unavailable devices or complete account history |
| Grant history and start import | `#confirm-import`; `startImport` | Trusted permission request, `PERMISSIONS_SYNC`, `IMPORT_START`, repeated bounded `IMPORT_STEP` | Optional `history` | Import detail; brief permission scope before request; rejection leaves existing data intact |
| Import progress / partial / complete / error | `renderImport`, `latestJob`, `pumpImport` | `importJobs` checkpoint and discovered candidates commit together | `history` to read more | Detail and concise workspace entry status; no false full-history completion |
| Pause / resume / cancel import | `data-import-pause/resume/cancel` | `IMPORT_PAUSE/RESUME/CANCEL`; pending intervals/candidates persist | Resume requires history grant | Detail controls reflect persisted state; closing detail is not cancellation |
| Import across reload / return | `loadWorkspace` resumes latest running job; `activeJobId` | `importJobs`; running work is bounded per page request | `history` | Resume remains reachable after page/browser reopening; returning to life stops scheduling new batches |
| Revoke history permission | `#revoke-history` | `chrome.permissions.remove`, `PERMISSIONS_SYNC`; affected jobs become `permission-revoked` | Existing `history` | Workspace/import permission row; late automatic events cannot write; imported catalog remains |
| Library timezone | `#timezone-form`; `SETTINGS_UPDATE` after IANA validation | `settings.main.libraryTimeZone`; `createFreeViewSession` recomputes projection | None | AI workspace → library timezone; explicit save; existing OpenDay keys and recorded timezone remain unchanged |
| Removed-record listing / restore | `#show-removed`, `#removed-list`, `data-restore-record`; `RECORD_RESTORE` | Selected-scope `tombstones`; stored record restored into `conversations` and tombstone deleted | None | Data/privacy → removed conversations; restore immediately returns stored local record, not merely eligibility for future import |
| Clear all local Start data | `#clear-local`, `#clear-dialog`, trusted `#confirm-clear`; `CLEAR_LOCAL` | All 12 Start stores except revision reset in place; new local profile; removes native preference and home mode keys | None; explicit irreversible confirmation | Data/privacy → distinct danger section and confirmation; clearly exclude real ChatGPT, browser history and native bookmarks |
| Current capability / source status | `#source-description`, `#source-details`; `renderSettings` | Snapshot capabilities and source status; read-only | Workspace snapshot; no extra grant | Help → technical diagnostics; exact incomplete account certification and full-sync status retained |
| Build version / SHA / adapter | `#source-details` | Build fingerprint | None to read bundled manifest/build; snapshot currently used | Help/about summary + technical details; SHA not primary UI |
| Controlled source check | Link to `source-check.html` | Separate controlled diagnostic flow | Uses its existing guarded source permissions | Help → diagnostics, explicit user action; keep independent diagnostic safety behavior |
| Chrome native footer help | `#browser-footer-help` and browser appearance help | No writes; native browser action described | None | Help → native browser appearance detail; factual browser limitation only where needed |
| New tab provider conflict help | “新标签页入口” paragraph | No writes; action icon fallback and extension manager instructions | None | Help → new tab entry troubleshooting |
| Close / Escape / focus | Generic `showDialog` / `closeDialog`, browser dialog semantics | UI-only | None | Header close remains reachable; detail return restores prior section, scroll, safe draft and trigger focus |

## Critical state boundaries to preserve

1. `restoreHomeMode()` reads only the home-mode storage key before deciding whether to call `loadWorkspace`. A life page must not send `SNAPSHOT`, start an import batch, subscribe to catalog revisions, or build hidden conversation DOM merely because settings opened. Native title/icon/bookmark preferences do not require the workspace catalog.
2. `applyHomeMode()` invalidates late refreshes, unsubscribes workspace updates, clears all private surfaces and closes dialogs. Any new settings controller must also clear or gate private diagnostics, removal lists and legacy shortcuts. An explicit action may enter the workspace; a category tab alone should not silently reveal it if the design presents that category as ordinary life settings.
3. Permission status must be observed, not inferred from a stored capture preference. Baseline `PERMISSIONS_SYNC` can preserve `captureEnabled=true` after a disconnect. That is not evidence of active capture. Baseline UI currently shows the raw preference, creating a stale “on” appearance.
4. Baseline source permission operations are synchronous with the trusted browser gesture before any `await`. New navigation or permission explanation layers must not defer the final request across a lost user activation.
5. P1 automatic-history fencing lives in `service-worker.ts` plus `Repository.begin/commitAutomaticHistory`, using runtime epoch, persistent generation, worker identity and transaction checks. Every pause, relevant permission change, clear and late getVisits response is gated. Visual changes must not call alternative ingestion paths or make new write authority.
6. Explicit history import is deliberately independent of continuous capture. Paused/disconnected capture may coexist with an explicitly authorized history import. Do not disable import merely because capture is paused.
7. Import pause/cancel and concurrent batches use revision-aware checkpoint writes. Keep imported partial results, pending candidates and coverage truth. Permission loss makes running/paused/partial jobs `permission-revoked`; actual browser grant is needed before resume.
8. Tab identity uses independent `chrome.storage.local` keys, not a catalog snapshot. Native saves serialize and re-read those keys. Do not migrate them into IndexedDB or overwrite title and icon together except the explicit restore-identity action.
9. `CLEAR_LOCAL` is the only explicit whole-library reset, and is broader than the currently selected account scope. It retains the selected library timezone as a default while resetting other Start data. Normal settings initialization must never call it or create a new profile.
10. Database schema is version 1 with 12 stores. No schema or primary key change is needed for this redesign.

## Baseline defects / inconsistencies the redesign should fix

- The capture checkbox is rendered from the stored preference without requiring current ChatGPT permission. It can appear on while disconnected.
- General `render()` does not call `renderSettings()` when an open settings dialog receives revision updates. External permission changes can leave connection/history controls stale until reopening.
- `renderSettings()` overwrites the timezone input on every direct render, losing unfinished edits. `identity()` only protects the currently focused title input; navigating to another settings section can also lose an unfinished title draft on later refresh.
- Generic `showDialog()` closes the parent settings dialog when opening import/removed/legacy/clear. There is no explicit settings-detail return stack, scroll restoration or guaranteed restoration to the original settings trigger.
- Baseline restore text says the user must import/observe the record again, but the repository restores the retained record immediately. Use truthful local restoration copy.
- Native migration currently selects only writable bookmark-bar roots. The new user contract asks for native folder selection; implement it without changing the homepage bookmark shelf.
- Native upload selection can remain “upload” after cancel/failure while the persisted icon is a different mode. The new UI should return to the persisted mode and retain its preview.
- The clear confirmation names ChatGPT/history exclusions but omits native bookmarks; add the explicit bookmark exclusion while retaining irreversible scope.
- The first settings page permanently contains implementation explanations, a non-editable 30-day rule, duplicated home-mode description and detailed capability status. Relocate or remove them without removing operations.

## Verification ownership

This document records code inspection only. The final acceptance file must attach actual results for installed Chrome/Edge navigation, identity persistence and failed uploads, all bookmark preferences and permission transitions, folder migration retry/dedupe, connected/paused/disconnected states, import transitions, timezone save and failed save, local restore/clear scope, life privacy, keyboard/focus, narrow/zoom layout, and old database compatibility. Native browser prompt outcomes, injected API-result branches and browser-tab-strip limitations must be labeled distinctly.
