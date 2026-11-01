# Carefully scoped inheritance

All upstream reads are from `haohongfei2001-png/Virtual-AI-Workspace-Layer` at fixed commit `1903b00f774b4fd7f3d15b3669878c32e2c7a9c8`. No upstream files were changed. The later PR #16 diagnostic commit does not supply a Start identity, NONE, or arrival source.

| Local implementation | Upstream source / SHA-256 | Scope |
|---|---|---|
| `src/domain/time.ts` | `src/navigation/projection.mjs`; `36334b5da4bd8e89718bf45b69723f4a657d46797c03c653298aaa3392399f24` | `instant`, strict ISO parsing and `localDay`; typed, with a correction for JavaScript Date.UTC years 00–99. No message/event projection copied. |
| `src/domain/time.ts` | `src/data/free-time-policy.mjs`; `8a75b5bdde8abf8ee07873ecf2aa45a19faccd030b9f03c738b56db6ba9ea17a` | `createFreeViewSession`, `freeSegmentFor`, `freeWindowFor`, `relocateFreeSegment`; horizon fixed at 30, no auto policy. |
| `src/domain/ids.ts` | `src/host/url-policy.mjs`; `fddfafcca2276161e6fd3c908ac896d0dab656fce6cf06aee64f1f442f7ac7e9` | Adapted native URL rejection rules; UUID conversation IDs, raw authority/encoding/dot-segment checks, default-deny query/fragment, exact Project route. Old domain is an explicit history-only alias. |
| `src/collectors/chatgpt/identity.ts` | `src/host/isolated-session-reader.mjs`; `49b5726c6b1317f1879a5c5b263a88bdb8e0b886a31a012d156c9b42a84118e1` | Fixed session-only requests, deadline and RAM-only credentials. No conversation reader. |
| `src/collectors/chatgpt/identity.ts` | `src/host/session-identity.mjs`; `ff71fb796ab2c81ef07a5fae274a3de2c4317e05af48a590c952bb0c51b31281` | Bounded JSON and roster decoding; never selects current context. |
| `src/collectors/chatgpt/metadata.ts` | `src/host/native-surface-boundary.mjs`; `c6aebcfb13aca3965b48304d27e9347f01f9c9c092cf4cc3225087dd366f74b8` | Title-only Project candidate grammar, reciprocal tab/panel references. No host mount or source authority. |

Pure functions and rejection rules are inherited; source authority is not. `containerHint` never establishes membership. The real profile still requires its own verified principal, independently selected context, positive NONE and exact arrival evidence.

The frozen provenance manifest in `docs/free-v1/evidence/source-manifest.json` includes canonical fixed URLs, Git blob hashes and lengths. Each reused source was checked against that manifest. New Start storage, transactions, candidate resolution, open-day model and projections are separate implementations of `VAIWL-START-FREE/1.0`.
