# Browser matrix

What was actually observed, in which build. A cell is filled only when a finding backs it.

| Behaviour | Chrome stable 152.0.7977.66 | Chrome for Testing 152.0.7977.82 (win64, mac-arm64, linux64) | Chrome for Testing 153.0.8010.36 (linux64, mac-arm64, win64) | Other browsers |
|---|---|---|---|---|
| `document.modelContext` present for pages | only with `enable-webmcp-testing`, after relaunch (WMP-0018) | present without any flag (WMP-0018) | present **without the flag** in every secure context and absent on an insecure page (WMP-0045, linux64, 2026-09-11); the vendor page of 2026-08-07 still describes an origin trial from 149 plus the flag | not measured |
| `devtools-webmcp-support` effect | DevTools panel only (WMP-0019) | — | — | — |
| Loopback HTTP is a secure context | yes (WMP-0023) | yes | yes | — |
| `--load-extension` honoured | **no** (WMP-0020) | yes | yes | — |
| Same-origin frame tools aggregated in parent | — | yes; `tool.window` discriminates (WMP-0002) | yes (suite, `twins`) | — |
| Cross-origin tools surface to parent | no, on loopback HTTP (WMP-0005) | no (WMP-0005) | not re-measured | — |
| `consequentialHint` | dropped (WMP-0004) | dropped | **still dropped** (WMP-0037) | — |
| `inputSchema` type from `getTools()` | — | string (WMP-0003) | **still a string** (WMP-0037) | — |
| `title` returned by `getTools()` | — | yes, `''` when none (WMP-0033) | yes (WMP-0033) | — |
| `executeTool()` argument form | — | JSON string only; object rejected (WMP-0034) | JSON string only; object rejected (WMP-0034) | — |
| Runtime validates arguments against `inputSchema` | — | no (WMP-0034) | no (WMP-0034) | — |
| Abort via `{ signal }` settles the caller | — | at once, `AbortError` (WMP-0035) | at once, `AbortError` (WMP-0035) | — |
| Tool's `execute` receives `{ signal }` | — | **no** (WMP-0035) | **yes** (WMP-0035) | — |
| Object result from `execute` | — | serialised as JSON (WMP-0036) | serialised as JSON (WMP-0036) | — |
| Extension page can use the API | — | no; async SecurityError (WMP-0007) | no (suite, `demo`) | — |
| MV3 worker survives a pending 50 s fetch | — | dies at t+35–40 s (WMP-0009) | same, keep-alive covers it (suite, `worker-lifetime`) | — |
| `executeScript` settles when the page navigates under a tool | — | **never settles** (WMP-0011) | same (suite, `inflight`) | — |
| `executeScript` settles when the frame is removed / tab reloaded | — | settles, no result (WMP-0013, WMP-0014) | same (suite, `inflight`) | — |
| Page CSP applies to MAIN-world injections | — | no (WMP-0015) | no (suite, `csp`) | — |
| `tabs.onUpdated` fires for `pushState` | — | yes, as a load (WMP-0028) | yes (suite, `navigation`) | — |
| Declarative forms exposed via `getTools()` | — | see WMP-0029 | same (suite, `declarative`) | — |
| `toolchange` per tool on a shared abort | — | one event per tool (WMP-0038) | one event per tool (WMP-0038) | — |
| Tool registered with an empty description | — | not measured | accepted, then absent from `getTools()` (WMP-0039) | — |
| 1 000 tools discovered / rendered | — | ~60 ms / ~9 ms (WMP-0024) | within budget (suite, `perf`) | — |

## Versions and dates

- Stable Chrome 152.0.7977.66: developer workstation, 2026-09-04.
- Chrome for Testing 152.0.7977.82 (win64): automation browser, 2026-09-04 and 2026-09-05.
- Chromium 152.0.7977.64 (snap, unbranded) on Ubuntu 24.04.3 under WSL2 with a WSLg display,
  2026-09-05: the full 27-scenario suite passed identically, and `partial-grant` on 2026-09-06.
  Every behaviour above that the suite exercises therefore holds on Linux Chromium too; the one
  failure of the first pass was a product bug that random IndexedDB key order had hidden on
  Windows (WMP-0031, D-058).
- Chrome for Testing 152.0.7977.82 (mac-arm64) on macOS 26.5.1, Apple Silicon, 2026-09-06: the
  same 27-scenario suite and the `partial-grant` scenario passed identically, so the column above
  holds on both win64 and mac-arm64. The Mac was reached over SSH, whose launchd session has no
  window server; headful Chrome aborts there two seconds after start, so the run was
  `--headless=new` (WMP-0032). Headless proves behaviour, not the rendering on a Mac screen.
- Chrome for Testing 152.0.7977.82 and **153.0.8010.36** (linux64) on Ubuntu 26.04, 2026-09-10:
  `tools/probe-platform.mjs` measured both builds side by side (WMP-0033 to WMP-0038), and the
  27-scenario suite passed 27/27 on 153 before any code was changed for it. 153.0.8010.36 was the
  Stable channel build of the Chrome for Testing feed that day; the Beta channel was 154.0.8037.0.
- Chrome for Testing **153.0.8010.36 (mac-arm64)** on macOS 26.6.2, Apple Silicon, Node 24,
  2026-09-10: the 31-scenario suite of build 1.0.0 and `partial-grant` passed identically,
  headless over SSH (WMP-0032). The 153 column above therefore holds on mac-arm64 as well as
  linux64.
- Chrome for Testing **153.0.8010.36 (linux64 and mac-arm64)**, 2026-09-11: the 36-scenario
  suite of the 1.1.0 candidate (commit `761b1fa`) and `partial-grant` passed on Ubuntu 26.04
  (headless) and on macOS 26.6.2, Apple Silicon, Node 24 (headless over SSH); the shipped
  manifest's permission journeys passed with real input on Linux (Xvfb, dark and light) and on
  Windows 11 (desktop agent). The same day, `tools/probe-registration.mjs` and
  `tools/probe-execute-errors.mjs` on linux64 added WMP-0043 (every `registerTool()` refusal is
  a rejected promise; WMP-0039 corrected) and WMP-0044 (every tool failure reaches the caller as
  `UnknownError` with one fixed sentence) to the 153 column.
- Origin trial window per the vendor docs: Chrome 149 to 156 (research, api-facts). Not
  measured by us on an origin-trial site: the fixtures run behind the testing flag.

## Not yet measured

Headful Chrome on a macOS screen (fonts, overlay scrollbars, the side panel's native chrome —
the macOS run was headless; Explorer matrix row S3 keeps that as a manual pass); Edge, Brave
and other Chromium builds; Chrome on Android; Chrome 154 and later (the Beta channel is
154.0.8037.0 — `tools/probe-platform.mjs` is the way to fill that column); an origin trial token on
a real origin; HTTPS for the cross-origin path (WMP-0005). Each of these is a column or a row to
fill, with a finding, before anything is claimed about it.

## 2026-10-18 — columns for Chrome for Testing 155.0.8059.84 (Stable) and 157.0.8103.6 (Beta), linux64

| Behaviour | 155 | 157 | Finding |
|---|---|---|---|
| `inputSchema` type from `getTools()` | **object** | object | WMP-0046 |
| `executeTool()` argument form | **object only** | object only | WMP-0046 |
| Omitted `executeTool()` input | accepted (`{}`) | accepted | WMP-0049 |
| Runtime validates arguments | no | no | WMP-0046 |
| `consequentialHint` returned | **yes** | yes | WMP-0047 |
| `debugging` returned | no | **yes** | WMP-0048 |
| `toolactivated`/`toolcancel` target | `window`, `WebMCPEvent` | **`document.modelContext`, typed events** | WMP-0050 |
| `Origin-Agent-Cluster: ?0` document | accessor readable, every call refused (`SecurityError`) | **API works** | WMP-0051 |
| `window.originAgentCluster` on secure loopback | true | true | WMP-0053 |
| Tool failure surfaces as | `UnknownError`, fixed sentence | same | WMP-0052 |
| Declarative form via `getTools()` | listed, object schema | listed | WMP-0054 |
| Abort via `{ signal }` | `AbortError` at once | same | WMP-0035 holds |
| `toolchange` per removed tool on a shared abort | one each (7/7) | one each | WMP-0038 holds |
| `navigator.modelContext` | absent | absent | WMP-0001 holds |
| Explorer E2E suite | **50/50** (series 2.0 source; 44/49 on the 1.5.0 source, five stale scenarios) | `environment-oac`, `live`, `inflight` pass; full suite not run | D-128 |

Not yet measured on these builds: branded Chrome, Edge 150, macOS and Windows (Phase 5 of the
2.0 plan), an origin-trial token on a real origin, HTTPS cross-origin path (WMP-0005).
