# Security-relevant observations

Facts about the trust boundaries around WebMCP that were established while building an
inspector. This is **not** a threat model or a risk scoring method — that belongs to Corsen
WebMCP Security. It is the ground such a product can stand on.

## What a page can and cannot see of an inspector

- Anything posted with `window.postMessage` in the MAIN world is visible to the page. Only
  tool metadata may travel that way; never a credential (Explorer D-029).
- A wrapper placed around `registerTool` for provenance can be disguised so that
  `String(fn)` shows native code, but `Function.prototype.toString.call(fn)` still reveals it
  (Explorer L-11, `tools/e2e/source.mjs`). Instrumentation is detectable by a determined page.
- A marker left on `window` can be made non-enumerable, but it still exists (Explorer Q12).
- A page's CSP does not keep extension MAIN-world code out (WMP-0015). Sites cannot use CSP
  as a defence against extensions, and extensions cannot be blocked by it.

## What an inspector must not trust

- The presence of `document.modelContext` inside a frame says nothing about the embedder's
  `allow="tools"` policy (WMP-0006). Read the embed attribute from the parent and report it
  as a diagnosis.
- A `null` result cannot be told from the text `"null"` (WMP-0012).
- A tool that navigates the page may leave the caller waiting forever (WMP-0011); the tab's
  lifecycle is the only reliable signal.
- Same-origin frames leak their tools into the parent's list (WMP-0002); attribution needs
  `tool.window`.

## Data that leaves the device (when a model is involved)

Observed in Explorer's own Agent Lab and Evals, and disclosed in its privacy policy: the user's
goal, tool names, descriptions and schemas, tool-call arguments and **tool results — which may
contain page content** — go to the configured model endpoint. Nothing goes anywhere until the
user configures a provider and presses Run (Explorer D-052, `docs/PRIVACY.md`).

## Credentials

- API keys live in the service worker only, in `chrome.storage.session` (memory; gone when the
  browser closes; survives a worker restart, WMP-0010). No plaintext key at rest (D-051).
- A remote `http://` model endpoint is refused, not merely flagged; loopback stays allowed for
  Ollama and LM Studio (D-051).

## Extension platform facts with security consequences

- An MV3 worker dies under a long request unless extension API activity keeps it alive
  (WMP-0009): state that must survive belongs in `storage.session`, never in memory.
- An extension cannot inject into its own pages (WMP-0008): a bundled demo needs a port, and
  that port is a boundary to keep as narrow as any other.

## Open questions for a security product

- Prompt injection through tool descriptions and results, tool poisoning, output contamination,
  contract drift between what a page declared and what it executes, and provenance of a
  registration are the topics Explorer deliberately does not judge. The observations above
  give them a measured starting point; none of them is answered here.
