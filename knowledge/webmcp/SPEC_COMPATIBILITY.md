# Spec versus implementation

Where the WebMCP specification (W3C Web Machine Learning CG draft; its repository moved on
2026-08-14, 2026-08-17, 2026-08-19 and 2026-09-03 on the points below) and the Chrome developer
documentation say one thing and Chrome 152 or 153 does another. Each line points at the finding
that holds the evidence; this file adds no facts of its own.

| Topic | Documentation or specification says | Chrome 152 / 153 does | Finding |
|---|---|---|---|
| API host | `document.modelContext` (migrated from `navigator.modelContext`) | as documented; legacy host absent | WMP-0001 |
| `inputSchema` read back | spec since 2026-08-14: an object (`RegisteredTool#inputSchema` was `DOMString`; still `object` on 2026-09-11) | a JSON **string**, in 152 and still in 153 | WMP-0003, WMP-0037 |
| Annotations | `readOnlyHint`, `untrustedContentHint`, and since 2026-09-03 `consequentialHint` | normalised to the first two; `consequentialHint` dropped, in 152 and still in 153 | WMP-0004, WMP-0037 |
| `title` | vendor docs (2026-09-01): optional descriptor field | returned by `getTools()`, `''` when absent | WMP-0033 |
| `executeTool()` arguments | spec since 2026-08-17: an object — the IDL says `optional any inputObject` since 2026-09-10, and step 9 still rejects a non-Object with a `TypeError`; vendor docs: a JSON string | JSON string only; an object rejects with `UnknownError` | WMP-0034 |
| `registerTool()` refusals | rejected promise: empty name/description, duplicate name, invalid name, unserialisable schema, aborted signal | rejected promise in every measured case (`InvalidStateError`, `TypeError`, `AbortError`); no synchronous throw; an empty description is refused, a one-space one accepted | WMP-0043, WMP-0039 |
| Argument validation | not stated | none: a value violating the schema reaches the tool | WMP-0034 |
| `executeTool(…, { signal })` | spec since 2026-08-19: aborting cancels the execution | caller settled with `AbortError` at once in both; the tool receives the signal in 153 only, and its own listener had not fired when the caller settled | WMP-0035 |
| Non-string result | a string is expected | an object is serialised as JSON | WMP-0036 |
| A tool that throws or rejects | the tool's own rejection reason | `DOMException` `UnknownError`, one fixed message, whatever was thrown | WMP-0044 |
| Empty or missing `description` | required field | `registerTool()` accepts it silently; `getTools()` never lists the tool (153) | WMP-0039 |
| Cross-origin exposure | `allow="tools"` + `exposedTo` + `fromOrigins` surfaces child tools | nothing surfaced on HTTP loopback; `'*'` rejected as insecure | WMP-0005 |
| Permissions policy default | `tools` defaults to `self`: a cross-origin frame without `allow` has no API | the frame has the API and registers | WMP-0006 |
| `execute` returning `null` | possible, signals a navigation | the caller receives the string `"null"` | WMP-0012 |
| `toolactivated` / `toolcancel` | events of the declarative surface | also fired for imperative `executeTool` | WMP-0016 |
| `toolchange` granularity | "the set changed" | one event per tool removed by a shared abort | WMP-0038 |
| `toolprogress` | discussed upstream, not stabilised | not present | (research, api-facts) |
| Extension pages | not addressed | API present but every call rejects (`document.domain`) | WMP-0007 |

## Reading the table

- "Chrome 152 / 153 does" means Chrome for Testing 152.0.7977.82, 153.0.8010.36, or stable
  152.0.7977.66 with the testing flag, on the dates recorded in the findings. A later Chrome may
  move any line; `tools/probe-platform.mjs` re-measures the moving ones in a minute.
- The specification text now leads the browser on three points (schema type, argument form,
  `consequentialHint`). Code has to follow the browser it runs in and accept both forms.
- The cross-origin rows are the ones most likely to change: the observation was made on
  loopback HTTP and the HTTPS re-check named in WMP-0005 is still open.

## What this means for a product

- Never hard-code the annotation list; render what is present (WMP-0004, WMP-0037).
- Parse the schema at one place; accept string or object (WMP-0003, WMP-0037).
- Choose the argument form before the call from the shape the same runtime gives `inputSchema`
  back in: a string means the measured runtime (send a JSON string), an object means a runtime
  that follows the specification (send the object). Keep one fallback on a `TypeError` raised by
  the binding itself (message starting with "Failed to execute 'executeTool'"), never on a
  `TypeError` thrown by the tool, and never a third attempt; validate arguments yourself
  (WMP-0034, `page/execute.js`, D-075).
- Expect every `registerTool()` refusal as a rejected promise, never a synchronous throw: trace
  the promise, and treat a rejection the page handled itself as unobservable (WMP-0043).
- Pass a signal on every call so it can be cancelled, and say that the page's tool may still
  finish (WMP-0035).
- Do not build completeness on the native cross-origin path; inject into the frame or say
  the discovery is partial (WMP-0005).
- Do not infer a navigation from a `null` result; watch the tab (WMP-0011, WMP-0012).

## 2026-10-18 — Chrome 155 (Stable) and 157 (Beta)

Measured with `tools/probe-platform.mjs` on 153.0.8010.36, 155.0.8059.84 and 157.0.8103.6
(linux64, headless). Rows above describe 152/153; these rows say what moved since.

| Topic | Specification (Draft CG Report, 2026-10-16) | Chrome 155 | Chrome 157 | Finding |
|---|---|---|---|---|
| `inputSchema` read back | object | **object** | object | WMP-0046 |
| `executeTool()` arguments | `optional any inputObject`; non-Object rejected with TypeError; omitted = `{}` (#324) | **object only**; string → TypeError "invalid input object: value is not an object"; omitted accepted | object only; string → TypeError "parameter 2 is not of type 'object'."; omitted accepted | WMP-0046, WMP-0049 |
| Argument validation | not stated | none | none | WMP-0046 |
| Annotations | `readOnlyHint`, `untrustedContentHint`, `consequentialHint`, `debugging` (#253) | first three kept, `debugging` dropped | all four kept | WMP-0047, WMP-0048 |
| Activation events | `ToolActivatedEvent`/`ToolCancelEvent` on `ModelContext` (#245) | `WebMCPEvent` on `window` | **typed events on `document.modelContext`**, `ontoolactivated`/`ontoolcancel` | WMP-0050 |
| Origin-keyed agent cluster | requirement removed (#330, 2026-09-30) | still required: calls refused with `SecurityError` naming `document.domain` | **not required**: API works, `window.originAgentCluster === false` | WMP-0051 |
| Tool failure | specific DOMException types (#339, 2026-10-08) | `UnknownError`, fixed sentence | same | WMP-0052 |
| Declarative forms | removed from the spec (#338), separate explainer | listed by `getTools()`, object schema | same | WMP-0054 |
| `title` omitted | — | `''` | `''` | WMP-0033 holds |
| Continuations (`requestToken`/`resumeTool`), `requestUserInteraction` | explainer / discussion only | absent | absent | platform note |

Product consequence: choose the argument form from the shape of `inputSchema` (D-075, holds);
listen for activation events on both targets (D-128); treat a refused call as its own
availability state and quote the browser (D-128).
