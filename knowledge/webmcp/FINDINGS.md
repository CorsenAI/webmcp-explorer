# WebMCP Fieldbook — findings index

Corsen's record of how WebMCP behaves **in practice**: in real Chrome builds, behind real
permissions, on real pages — as opposed to how the specification or the vendor documentation
says it should. Every entry is a fact that was **observed**, with the fixture, the automated
test or the measurement that produced it. Nothing here is inferred from reading a spec.

This directory is meant to outlive WebMCP Explorer. Corsen Context, Corsen WebMCP Security and
future products start from it rather than from zero.

## How to use it

- One finding = one file in `findings/WMP-NNNN.yaml`, with a fixed schema (below).
- The topic files (`SPEC_COMPATIBILITY.md`, `BROWSER_MATRIX.md`, `SECURITY.md`, …) are
  **narratives over the findings**: they cite finding ids, they never carry facts of their own.
- A finding's `status` is one of `confirmed` (reproduced by an automated test or a repeated
  measurement), `observed` (seen once, in one environment, with the evidence named),
  `reported` (stated by a third party, not yet reproduced by us), `superseded` (no longer true;
  the entry says since when and why).
- When a finding stops being true, do not delete it: set `status: superseded`, add
  `superseded_by` or a dated note. A future browser will make several of these wrong, and the
  history of what was true when is exactly the value of this book.

## Finding schema

```yaml
id: WMP-0002
title: getTools() aggregates same-origin frame tools into the top document
date_observed: 2026-09-04
environment:
  browser: Chrome for Testing
  version: 152.0.7977.82
  mode: native            # native | origin-trial | testing-flag | polyfill
expected: each frame reports only its own tools
observed: a same-origin child's tools also appear in the parent's getTools()
reliable_discriminator: tool.window === window
impact: [duplicate tools in inspectors, wrong frame attribution, broken execution routing]
workaround: keep a tool only when tool.window is the frame's own window
evidence:
  fixture: fixtures/iframes.html
  automated_test: test/registry.test.js
  chrome_e2e: true
  decision: D-021
  commit: 117bf78
spec_status:
  documented: unclear
  implementation_specific: true
products_affected: [WebMCP Explorer, Corsen WebMCP Security, Corsen Context]
status: confirmed
```

Paths are relative to the WebMCP Explorer repository at the commit named. Decisions (`D-nnn`)
are entries of `docs/DECISIONS.md` in that repository; the fixtures and tests are the ones that
still run in its suite.

## Index

| Id | Title | Status | Area |
|---|---|---|---|
| WMP-0001 | The API lives on `document.modelContext`; `navigator.modelContext` is legacy | confirmed | spec |
| WMP-0002 | `getTools()` aggregates same-origin frame tools; `tool.window` tells them apart | confirmed | frames |
| WMP-0003 | `inputSchema` is returned as a JSON **string**, not an object | superseded | spec |
| WMP-0004 | Annotations are normalised by the browser; `consequentialHint` does not exist in Chrome 152 | confirmed | spec |
| WMP-0005 | Cross-origin tools never surface to the top document on HTTP loopback; `fromOrigins: ['*']` throws | observed | frames |
| WMP-0006 | A cross-origin iframe **without** `allow="tools"` still gets the API and registers | observed | frames |
| WMP-0007 | WebMCP is unusable on `chrome-extension://` pages; `getTools()` rejects asynchronously | confirmed | platform |
| WMP-0008 | An extension cannot see its own pages' tab URL without `tabs`, nor inject into them | confirmed | platform |
| WMP-0009 | An MV3 service worker dies between t+35 s and t+40 s under a pending fetch; a 20 s API pulse keeps it alive | confirmed | mv3 |
| WMP-0010 | `Target.closeTarget` kills the worker on demand; `chrome.storage.session` survives it | confirmed | mv3 |
| WMP-0011 | When the page navigates under a running injected tool, the `executeScript` promise never settles | confirmed | execution |
| WMP-0012 | A tool whose `execute` resolves `null` comes back as the **string** `"null"` | confirmed | execution |
| WMP-0013 | Removing the iframe under a running tool settles the injection with no result | confirmed | execution |
| WMP-0014 | Reloading the tab under a running tool settles the injection with no result | confirmed | execution |
| WMP-0015 | A page's Content-Security-Policy does not apply to extension MAIN-world injections | confirmed | platform |
| WMP-0016 | `toolactivated` fires on `window` for imperative `executeTool` calls too | observed | events |
| WMP-0017 | Background tabs align timers to 1 s: in-page durations inflate for waiting tools | observed | execution |
| WMP-0018 | Stable Chrome 152 exposes nothing without `enable-webmcp-testing`; Chrome for Testing 152 exposes it unflagged | confirmed | environment |
| WMP-0019 | `devtools-webmcp-support` enables the DevTools panel, not the page API | confirmed | environment |
| WMP-0020 | Stable Chrome 152 ignores `--load-extension`; Chrome for Testing is required for automation | confirmed | tooling |
| WMP-0021 | A test profile must be created by Chrome itself, or IndexedDB cannot open | confirmed | tooling |
| WMP-0022 | Reloading an extension loaded from the command line does not reliably pick up changed files | confirmed | tooling |
| WMP-0023 | `http://localhost` and `http://127.0.0.1` are secure contexts; `featurePolicy` exposes `tools`; `originAgentCluster` is `undefined` | confirmed | environment |
| WMP-0024 | 1 000 tools are discovered in ~60 ms and rendered in ~9 ms; growth is linear | confirmed | performance |
| WMP-0025 | Declarative `<form toolname>` in a shadow root is invisible to a light-DOM scan | confirmed | declarative |
| WMP-0026 | Store listing images: 1280×800 or 640×400, up to five, full bleed, showing the actual experience | confirmed | store |
| WMP-0027 | Since August 2026 the Store requires disclosure of every data collection, functional ones included | confirmed | store |
| WMP-0028 | Chrome reports a `history.pushState` through `tabs.onUpdated` like a navigation | confirmed | platform |
| WMP-0029 | Chrome 152 exposes declarative `<form toolname>` tools through `getTools()`; a form without `toolautosubmit` waits for a person | confirmed | declarative |
| WMP-0030 | Ollama rejects tool-bearing requests for models without the `tools` capability (HTTP 400); Gemma 3 is one of them | confirmed | providers |
| WMP-0031 | An IndexedDB index orders equal keys by primary key; a limit applied while iterating returns an arbitrary subset | confirmed | platform |
| WMP-0032 | Without a window session, headful Chrome on macOS registers the extension worker and then aborts; `--headless=new` runs the same suite | confirmed | tooling |
| WMP-0033 | `getTools()` returns the tool's `title`; an empty string when the page gave none | confirmed | spec |
| WMP-0034 | `executeTool()` takes only a JSON string in Chrome 152 and 153, and does not check the arguments against `inputSchema` | superseded | execution |
| WMP-0035 | An aborted signal settles `executeTool()` with an `AbortError` at once; Chrome 153 hands the signal to the tool, Chrome 152 does not | confirmed | execution |
| WMP-0036 | A tool that resolves with an object is handed to the caller as its JSON serialisation | confirmed | execution |
| WMP-0037 | Chrome 153 still returns `inputSchema` as a string and still drops `consequentialHint`, three weeks after the specification changed both | superseded | spec |
| WMP-0038 | Releasing one `AbortController` that registered several tools fires `toolchange` once per tool | confirmed | events |
| WMP-0039 | A tool registered with an empty or missing description is accepted by `registerTool()` and never returned by `getTools()` — corrected 2026-09-11: the promise rejects, see WMP-0043 | superseded | spec |
| WMP-0040 | A toolbar click that opens the side panel through `openPanelOnActionClick` grants no `activeTab`; a click handled by `action.onClicked` does | confirmed | platform |
| WMP-0041 | Revoking the broad http/https patterns also drops every single-site grant they contain | observed | platform |
| WMP-0042 | `chrome://extensions` site access for optional grants: the master switch revokes every site, per-site switches re-grant, a broad request switches the page to the selector | observed | platform |
| WMP-0043 | `registerTool()` refuses a descriptor by rejecting its promise, never by throwing: empty description, missing member, non-callable `execute`, duplicate name and an aborted signal all reject asynchronously on Chrome 153 | observed | spec |
| WMP-0044 | A failing tool reaches the caller as `UnknownError` with one fixed message on Chrome 153; the tool's own error name and message are dropped | observed | platform |
| WMP-0045 | Chrome for Testing 153 exposes `document.modelContext` in every secure context without the testing flag and without an origin-trial token; insecure pages get nothing | observed | platform |
| WMP-0046 | Chrome 155 returns `inputSchema` as an **object** and `executeTool()` takes only an object; a JSON string is refused with a `TypeError`; arguments still unvalidated | confirmed | spec |
| WMP-0047 | Chrome 155 keeps `consequentialHint` in returned annotations; 152 and 153 dropped it | confirmed | spec |
| WMP-0048 | The `debugging` annotation is kept by Chrome 157 and dropped by 155 | observed | spec |
| WMP-0049 | `executeTool(tool)` with no input is accepted on 155 and 157 (empty object); 153 throws | confirmed | execution |
| WMP-0050 | Chrome 157 dispatches `ToolActivatedEvent`/`ToolCancelEvent` on `document.modelContext`; 152–155 dispatch a `WebMCPEvent` on `window` | observed | events |
| WMP-0051 | `Origin-Agent-Cluster: ?0` document: reading `document.modelContext` throws `SecurityError` on 153 and 155; works on 157 | observed | environment |
| WMP-0052 | A failing tool is still `UnknownError` with one fixed sentence on 155 and 157; spec #339 not implemented | confirmed | platform |
| WMP-0053 | `window.originAgentCluster` is the readable signal; `document.originAgentCluster` is undefined on every build | confirmed | environment |
| WMP-0054 | A declarative form is still listed by `getTools()` on 155 and 157 (object schema) after the spec removed the declarative API | confirmed | declarative |
| WMP-0055 | A declarative form without `toolautosubmit` keeps its call pending until a person submits it; an abort settles it at once, fires `toolcancel` and releases the form (155, 157) | confirmed | declarative |
| WMP-0056 | Chrome 155 refuses a declarative call that names a parameter the form does not have; imperative arguments stay unchecked | observed | declarative |

Add new findings at the end; never renumber.
