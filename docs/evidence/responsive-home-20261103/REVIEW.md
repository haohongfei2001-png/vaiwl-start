# Responsive home — independent layout review

## Scope and identity

Independent reviewer: `layout_review`; production implementation and test authoring were performed by other agents. This review covers the production layout changes in `public/newtab.css`, `public/bookmarks.css`, `public/life.css`, and the decorative-icon change in `src/ui/newtab.ts`.

- Baseline: `1c2aee3cd344889a8b5313a23c19c0489ca0ef5d`.
- Visually inspected candidate: `636e5ca15c0a80b79ea2daba05077ec2201e305f`.
- Evidence: first Edge `layout-responsive/edge/validation.json` and its screenshots; Linux Edge 156, isolated installed extension, synthetic fixtures.
- Shared fixture hash: `af51b409c29176948fb77b3a5f170d83e28f71d209de3b9595fcf7c231736632`.
- Runtime receipt verifies 14 files for each build. Candidate reports `candidateDirty: false`; the baseline receipt reports its build metadata as dirty, so this review does not describe the baseline build metadata as clean.

## Verdict

**VISUAL_REVIEW_PASS_WITH_REMAINING_PLATFORM_VALIDATION.** Within the inspected desktop content viewports, the candidate substantially improves the requested proportions, alignment, density, and rhythm. No confirmed P0/P1 regression was found in the reviewed production diff. This is an independent agent review, not a GitHub maintainer approval or a claim that every platform test passed.

The combination of width-controlled adaptive columns and differentiated project/recent treatment is appropriate. Four 280px tracks, 24px gaps, lighter project headings, and removal of repeated decorative row icons yield a coherent home page. Keeping row alignment and natural card heights is preferable to masonry or forced equal-height cards for this product.

## Actual visual inspection

Opened and compared `before-sidebar-budget-1720.png` with `after-sidebar-budget-1720.png`; also inspected `after-fullscreen-2048.png`, `after-sparse.png`, `after-dense.png`, `after-narrow-540.png`, and `after-narrow-390.png`.

| Measured case | Observation |
| --- | --- |
| Same 1720×1056 CSS viewport and fixture | Project/date tracks change from three ≈382.7px columns to four 280px columns. The project grid height changes from 541px to 305px; the date grid starts at y=596.5 instead of y=859.5. |
| Topbar and workspace | Brand, bookmarks, workspace, and settings now follow one 1192px container. Search remains subordinate. |
| 2048×1152 content viewport | Four compact columns remain centered; no stretched three-column row or excessive internal card padding. The wider outer whitespace is a consequence of readable column widths, not a fake browser-footer spacer. |
| Sparse content | Three project cards retain a fourth empty track and their own heights: 169 / 101 / 169px. No artificial equal-height blanks. |
| Dense content | Project rows keep stable shared top edges. Shorter cards leave expected space below them; the page remains a regular grid rather than a moving masonry layout. |
| 540px and 390px | Single-column layouts preserve 13px titles, full-width readable rows, visible actions, and a separate right-side history control. The wider single card at 540px is acceptable for this narrow-window state. |

Long titles are still truncated visually, but removing the repeated chat/arrow decorations preserves 207px of title space in the 280px desktop card. Full titles remain in the existing title/accessible-name/detail paths. No further production layout revision is required by the inspected screenshots.

## Static and behavioral review

- `auto-fill` retains vacant tracks; project count does not determine card width. Grid columns follow available CSS container width.
- The query container is on `#workspace-content`; history navigation is its sibling. This avoids depending on browser-version differences in containment behavior for fixed descendants.
- Project clipping was removed, and conversation/bookmark keyboard focus uses an inward outline. Project actions retain space and appear on focus.
- The DOM edit removes only two decorative SVGs per conversation; canonical links, identity keys, focus keys, complete text, and actions are unchanged.
- Data projection, account/project identity, chronology, pagination increments, capture permissions, and storage code are outside this production diff.
- The inspected receipt verifies shared grids, no horizontal overflow, unobscured controls, fixed rail position after scrolling, title access, five initial rows / twelve more, history/search, bookmark flow/order, mode compatibility, and unchanged contents of twelve stores.

## Evidence limits and remaining checks

The first Edge receipt is **123 PASS / 1 FAIL / 1 BLOCKED**, not a fully green run. The failure is `LAYOUT-touch-coarse-active`: the test context did not activate coarse-pointer CSS. Correcting the harness and rerunning it is required before reporting coarse-pointer coverage. Native new-tab `setZoom` is BLOCKED by the browser; direct installed-extension page zoom at 125% and 150% passed and is recorded separately.

The 1720px case is an available-content-width scenario, not a screenshot of Edge's actual vertical tab strip. All dimensions above are CSS content viewports with DPR/zoom recorded in the receipt, not monitor or outer-window dimensions. Native vertical tabs, native keyboard zoom, final-SHA CI, and the user's Mac installation need their own evidence; this review does not grant them PASS.

Uncached synthetic bookmark hosts use the real Chromium `_favicon` mechanism and display its normal fallback. These screenshots do not establish that every real site's branded favicon was loaded. Platform fonts also affect raster text appearance. The before/after comparison uses the same environment and fixture and does not reproduce the user's private catalog or original screenshot pixels.

Later integration should preserve this first-run record and append final verification separately. Changes to tests or documentation alone do not change the reviewed production layout; any subsequent production change requires a focused follow-up review.
