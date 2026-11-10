# WebMCP Explorer — Privacy Policy

Last reviewed: 2026-11-10. Applies to WebMCP Explorer 2.6.1.
Earlier Store versions may offer fewer features; optional features described below act only
when you enable or request them.

This policy explains how WebMCP Explorer handles your data, which features share data,
and the controls available to you.

Publisher: Corsen AI. Contact: [security@corsen.ai](mailto:security@corsen.ai).

## The short version

WebMCP Explorer has **no backend** for collecting your activity. There is no
analytics collection or remote telemetry, and no advertising/tracking identifier.
The optional Local MCP Bridge shares only explicitly shared tools and requested results with
the local client you pair. That client may retain or forward data under its own settings.

Explorer contacts an AI endpoint only when you explicitly use the provider you configure:
to list its models, run Agent Lab or run an eval suite. Before a run, the screen states
what will be sent and to which host. **No AI provider is selected by default.** You may connect a cloud provider using your own API key,
or a local server such as Ollama or LM Studio. Provider pricing and quotas apply; local model
performance depends on your hardware and server setup. Explorer does not include Gemini Nano
or a Gemini CLI companion. Manual discovery, checks and recipes require no AI
provider, account or key. A page tool you invoke can itself contact the site's services or
change site data; that remains true when several calls are run as a manual recipe.

## What Explorer reads, and where it stays

On a site you have allowed, Explorer reads, and processes on your device only:

- **The address of the current tab** — so it can name the site it is asking permission for
  and route requests to the right page. It is shown in the panel. A saved recipe and its
  run evidence retain the selected page's address as described below. A run you started
  stays bound to its selected tab, including if you switch tabs while it runs; Explorer
  does not collect an inventory of unrelated tab addresses or your browsing history.
- **The WebMCP tools the page and its frames register**: name, description, input schema,
  annotations, origin, frame. This is website content in the Store's sense, and it is the
  object of the product.
- **What a tool returns when you, a manual recipe or the agent run it.** A tool result is produced by the
  page's own code and **can contain data from the page** — a product list, an order, a search
  result. Explorer keeps it in your local history so you can look back at it.
- Whether WebMCP is available on the page and, if not, why: secure context, origin isolation,
  the `tools` permissions policy.
- The `<form toolname>` elements the page declares, static field names/types/constraints,
  tool descriptions and choice options, including open shadow roots. This produces an
  explicitly indicative schema when no native tool is available. Typed field values,
  hidden/password/file contents and closed shadow roots are not read. Submit-handler
  consent checks cannot be inferred from this inventory.
- The `src` and `allow` attributes of iframes, to explain which frames could be inspected.
- For the declarative tool forms above, the names, types and `autocomplete` tokens of every
  control, hidden ones included, so the review can say that a hidden business value is submitted
  without the agent seeing it. Names only: no value is read.
- When a page exposes no tool, the attributes of its ordinary forms on the top document (field
  names, types, constraints, labels, option values, the form's method and the path of its action),
  to propose a starter contract. The starter is text to copy; no value you typed is read and
  nothing is registered or submitted.
- In Instrumentation Mode, the `exposedTo` origins a registration call passes, and the source
  text of the tool's own `execute` callback, read in the page with the browser's intrinsic
  function-to-string, at most 16,384 characters, in memory only. Only fixed labels such as
  "request-method-write" leave the page; the source text, its constants and any secret it
  might contain are never copied, stored or displayed.
- Only when you ask for it, on a site you declared you control: the text of the top document's
  inline scripts and of its same-origin script files (at most twenty files, one million characters
  each), read once in memory, without cookies, to look for provider secret key formats. A finding
  keeps the provider, the key type, the count and the length; the text and any key value are
  discarded at once and never stored, displayed or exported. Scripts from other origins are not
  fetched.

Explorer does **not** scrape the full page HTML or unrelated visible text. Declared tool
metadata, static form choices and, on request, the page's own scripts are the limited surface
described above. It does not read
cookies or form values you type.

## Does Explorer modify the page?

Normal discovery and execution do not instrument the page: Explorer observes the WebMCP API
the browser exposes and calls the tools the page registered, nothing more.

Two separate features can change the inspected page, each off by default and enabled
explicitly for a granted site during the browser session:

- **Instrumentation Mode** wraps existing registration/removal methods before page scripts,
  records metadata and registration locations, and retains callbacks in the page's MAIN
  world. A captured callback can be used only when the corresponding runtime has no native
  executor; a native refusal never causes a direct fallback.
- **JS emulation** installs an explicitly identified, bundled imperative implementation only
  when native WebMCP is absent. It does not submit HTML forms, reproduce native browser
  security guarantees, or grant cross-origin access. Forms remain inventory only.

Both require reloading the page. Disabling them or revoking access removes future script
registration; reload an already-open page to remove its installed instrumentation/emulation.
Metadata events cross a bounded telemetry channel. They are untrusted page claims and cannot
invoke tools, change extension settings, or access credentials. This local channel is not
analytics and transmits nothing to an external service.

Every tool request selects one engine and encoding before dispatch. Explorer never retries
an action because of an exception or switches to a second engine after failure. A cancelled,
interrupted or unconfirmed action may already have happened. Agent Lab and Evals stop when
its effects are unknown; completed actions are not rolled back.

## The security and governance review

The Security section reviews the tool metadata already described above — names, titles,
descriptions, input schemas, annotations, origins and, when Instrumentation Mode is on for
the site, the script location that registered each tool — and the live timeline of the tab.
It runs entirely on your device: it never executes a tool, never contacts a server and never
sends the page's text anywhere. Findings are facts or labelled indicators with the exact excerpt
they rest on. Phase B adds a provisional 0–100/A–F heuristic score with its formula and
unknown coverage, not a security certification. Proposed fixes are generated locally as copy-only
templates and never applied to the page or executed. Exporting is a copy or download you trigger;
the report contains page-authored evidence, proposed fixes, unknown checks and that score.

The live timeline follows the tools of a tab once you open Tools, Timeline or Security on it. To
tell when a tool's contract is replaced under the same name, Explorer computes in the page, for each
tool, SHA-256 fingerprints of its description, input schema and annotations, and passes on the tool
names and those fingerprints only. Fingerprints are one-way hashes, not the texts. They are kept in
memory with the tab's timeline, never stored, and dropped when the tab closes or the browser stops
the extension's worker. A timeline you export names the part that changed, not the fingerprints.

### Active probes, only on a site you declare you control

The Security section can also run **probes**: a fixed set of at most five calls per selected
tool — arguments generated from the tool's own schema, then a wrong type, a missing required
argument, an unknown property and a 10,000-character string — to see what the tool's code does
and what it returns. Probes run only after you tick, for that site, "I control this site";
only tools declared read-only are preselected; the box says what will run before the button
that runs it; each call goes through the same path as a manual Run, in your browser session, and
is recorded in History marked as a probe. Nothing is sent anywhere else. The sites you declared
you control are stored on your device and listed, with the reviewed marks, under Settings →
Stored data; clearing that data withdraws the consent.

### Baselines and the re-check of open tabs

You can save the current review of a site as its **baseline**; later reviews show what is new
since. If you turn on **Re-check open tabs** in Settings (off by default), Explorer uses the
`alarms` permission to run, at the interval you choose, the same passive review on tabs that
are already open and whose site has a baseline and is allowed, and paints the toolbar badge with
the number of new findings and of tools whose contract changed. It never opens a page, never runs a
probe and sends nothing. A baseline keeps, for each tool, SHA-256 fingerprints of its whole contract
and of its description, input schema and annotations, so a later review can say which part changed;
fingerprints are one-way hashes, not the texts. The baselines, the re-check setting and the last
re-check's counts are stored on your device with the other security review data and cleared with it.

You can export a baseline to a file and import one for the same site, for another machine, a
reinstall or a colleague. The file holds what the baseline holds (tool names, fingerprints, finding
keys, the site and the date) and is written and read on your device: Explorer sends it nowhere. An
imported file is checked field by field, bounded like a saved baseline, and refused when it was
made for another site.

### Origin-trial tokens

When it inspects a page, Explorer reads the page's `<meta http-equiv="origin-trial">` tokens, at most
twenty, decodes them in memory and checks them with Chrome's public key, to say whether Chrome would
honour a WebMCP token on that page. The token text is not stored or sent anywhere; the panel keeps
the decoded facts (trial name, origin, expiry date, status) only while it shows them. A page cannot
show an extension its response headers: tokens sent in an `Origin-Trial` header are read only when
you press Scan Origin (below), from the same request as the other headers, and handled the same way.

### Discovery conventions, only when you press the button

The Security section can fetch, for the site you are inspecting and only when you press
**Scan Origin**, three paths some agents and auditors look for
(`/.well-known/webmcp`, `/.well-known/webmcp.json`, `/llms.txt`) and the current page once more
to read its `Permissions-Policy`, CSP, CORS and `Origin-Trial` headers. These GET requests go to the site's own origin, from
Explorer, without your cookies, with a timeout and a size cap; nothing is sent anywhere else and
nothing is stored. Discovery files are labelled optional conventions, not WebMCP requirements. Header evidence
does not establish the effective policy, authenticated response or exploitable CORS access.

## Local MCP Bridge, only when enabled and paired

The optional companion connects a trusted local MCP client to explicitly shared browser tabs.
Explorer's service worker dials only 127.0.0.1 on the configured port. The separate zero-dependency
Node.js companion listens on that address and communicates with its parent client over stdio.
It does not contact a cloud service, fetch code or receive Explorer's provider API keys.

The client receives the shared tools' names, descriptions, schemas, annotations and origins, and
the results of requested calls. That client may retain or forward them according to its own
settings, including to a cloud model; Explorer cannot control the client's subsequent handling.
Site access alone does not share a tab. Navigation, permission removal and reconnection clear
bindings. The default requires an explicit per-call approval showing name, origin and exact JSON;
timeout means denial. Optional automatic reads still undergo the security gate. Unknown effects
pause further calls and are never replayed automatically.

A generated pairing secret, connection preferences and in-flight markers live only in trusted
extension session storage. The explicit Copy MCP client configuration button puts the secret in
the clipboard for the intended client. It is excluded from normal state/settings exports and
logs. The receiving client may store that configuration; keep it private. Browser restart or
extension reload invalidates the session, and Forget pairing or Clear saved data and keys removes
the secret and disconnects. Call arguments/results follow normal History behaviour; durable
hashed request reservations remain independent of history deletion to prevent replay. The
companion retains request IDs/fingerprints in memory for its process lifetime, not request bodies.

Mutual HMAC authentication and message counters protect the local channel from peers without
the secret. A process able to read private client configuration or browser memory can obtain it;
these controls do not secure a compromised OS/account. Neither loopback nor a nonce alone is
treated as authentication.

## What is stored on your device

All of it lives in the extension's own storage, in your Chrome profile. None of it is
directly readable by the web pages you inspect, and none of it is synced. The optional Agent
access feature described below shares only the requesting page's tool contracts and results.

| What | Where | Lifetime | Cleared by |
|---|---|---|---|
| Local bridge pairing and preferences | Trusted chrome.storage.session | Browser session; not persisted by Explorer | Forget pairing, Clear saved data and keys, browser restart/extension reload |
| Which sites you allowed Explorer to inspect | Chrome's own permission store | Until you revoke it | Explorer Settings or `chrome://extensions` → Site access |
| Observed optional site grants: origin patterns only, never page content; retained to remove dormant Chrome permissions correctly | `chrome.storage.local` | Until a covered revoke completes in Chrome | Removed automatically with that revoke; removing the extension deletes remaining records |
| Panel settings and Agent Lab configuration: provider, endpoint address, model name, budgets | `chrome.storage.local` | Until removal | Removing the extension |
| Agent Lab conversations: your messages, the model's answers and the tool calls in between, kept per site | `chrome.storage.local` | The 10 most recently saved conversations per site; older ones are removed | Delete a conversation, or Clear agent sessions in Settings |
| Conversation groups: a name, and which conversations carry it | `chrome.storage.local` | Until you delete them | Delete the group (never removes conversations), or Clear agent sessions in Settings |
| Prompt profiles: a name and the system-prompt text you wrote | `chrome.storage.local` | Until you delete them | Delete the profile, or Clear prompt profiles in Settings |
| Custom connectors you created: name, dialect, endpoint address — never the API key | `chrome.storage.local` | Until you delete them | Delete the connector, or Clear connectors in Settings |
| Which allowed sites may route their own tools to a third-party agent: origin only | `chrome.storage.local` | Until you switch it off | The same switch, or Clear agent access in Settings |
| Tool execution history: arguments you sent, results returned, timings and execution status | IndexedDB | At most 2,000 entries / 30 days, or until cleared | Clear, in History or Settings |
| Invocation reservations: hashed request identity, hashed call fingerprint, document identifier, timestamps and status; no arguments, results or provider keys | IndexedDB | Retained separately from history to prevent replay across worker restarts and clearing saved data | Removing the extension; the count and purpose are shown in Settings |
| Session-only instrumentation/emulation choices | Chrome dynamic content-script registrations | Browser session | Disable in Settings, revoke site access, or end the browser session; reload existing pages to remove installed page code |
| Local overrides and mocked responses | `chrome.storage.local` | Until you remove them | Remove, per tool, or Clear in Settings |
| Saved calls: the argument sets you named, per tool | `chrome.storage.local` | Until you delete them | Delete, per saved call, or Clear in Settings |
| Selected-field checks: field paths, comparisons and expected values attached to saved calls | `chrome.storage.local` | With the saved call | Delete the saved call or clear saved calls in Settings |
| Manual recipe definitions: selected site/address, tool/frame contracts, arguments, named inputs, explicit result bindings and optional checks | `chrome.storage.local` | Until deletion; up to 30 definitions within 2 MB, 20 steps each | Delete saved recipe or clear Recipes and run evidence in Settings |
| Manual recipe runs: definition, input values, reviewed overrides, resolved arguments, outcomes and interruption status | `chrome.storage.local` | Up to 8 runs within 3 MB; old completed evidence is evicted; up to 20,000 characters of each result retained | Clear Recipes and run evidence in Settings after stopping active recipes |
| Eval suites and the last two results of each | `chrome.storage.local` | Until you delete them | Delete, per suite, or Clear in Settings |
| Contract snapshots, per site | `chrome.storage.local` | Until you delete them | Delete, per snapshot, or Clear in Settings |
| Security review data: the findings you marked as reviewed (code, tool name, contract fingerprint; per site, at most 50 sites and 400 marks each), the sites you declared you control for active probes, the saved baselines (tool names, contract fingerprints with one fingerprint per part, and finding keys; at most 300 findings and 1,000 tools per site, 50 sites) with the counts of the last re-check, and the re-check setting | `chrome.storage.local` | Until you clear them | Clear, in Settings → Stored data (one entry for all of it) |
| Where the panel was, and what you had typed in it | `chrome.storage.session` (memory) | Browser session | Closing Chrome, or the Stop button |
| An agent run or eval suite in progress | `chrome.storage.session` (memory) | Browser session | Closing Chrome, or the Stop button |
| **API keys, decrypted cache** | `chrome.storage.session`, trusted extension contexts only | Browser session; also cleared on extension reload, update or disable | Forget per provider, Lock vault, delete vault, clear saved data and keys, or Forget Agent Lab |
| **Optional encrypted key vault**: authenticated ciphertext, random salt/IV and version/KDF parameters | `chrome.storage.local`, trusted extension contexts only; never sync | Until explicitly removed | Delete vault, switch to session-only storage with the passphrase, clear saved data and keys, Forget Agent Lab, or remove the extension |

## API keys

An API key is authentication information, and Explorer treats it as such.

**Session storage is the default.** Keys remain in browser-managed session memory, survive
worker suspension and panel reopening, and are cleared on browser restart and extension
reload/update/disable.

**Encrypted persistence is optional.** The vault uses AES-GCM 256-bit authenticated encryption,
a fresh random 16-byte salt and 12-byte IV, and PBKDF2-HMAC-SHA256 with 600,000 iterations.
The passphrase must have at least 12 characters. Persistent storage contains only
`{version, iterations, salt, iv, ciphertext}`. The passphrase and derived encryption key are
not saved. They are used transiently to unlock or modify the vault. There is no passphrase
recovery. Encryption at rest does not protect an unlocked browser from compromised extension
code or a compromised operating system.

Unlocking populates the decrypted session cache. Locking clears that cache; modifying saved
keys requires the passphrase again. A wrong passphrase or altered envelope fails closed.
Legacy plaintext device keys are still removed. Settings exports include neither plaintext
keys, passphrases nor vault envelopes. Provider requests requiring a key are not sent while
that key is unavailable or the vault is locked.

A key is read in one place only — the extension's background worker, at the moment of
building the request — and applied as the provider's authentication header. It is never
exposed to the inspected page, never placed in the page's JavaScript context, never written
to the timeline, the history, an export, a snapshot, or any log.

## Exports and the clipboard

Every export — the tools of a page, a timeline, an eval result, a run of saved checks, the
reproduction of one call as Markdown, JSON, a DevTools console snippet or a Playwright script,
a versioned manual recipe, its Markdown run report, the diagnostic evidence shown in a
preview, or the settings backup file (your own configuration: providers, connectors, prompt
profiles, agent-access switches — never an API key) —
is built from what Explorer observed on the page you allowed: tool contracts, the arguments you
typed, and what the page's tools returned, which can contain data from that page. An export
exists only when you press Copy (it goes to your clipboard) or Save (it goes to your downloads
folder, through the browser's own download of a file Explorer generated in memory). Explorer
never transmits an export anywhere and does not store a separate copy of the generated file.
Provider authentication keys are not automatically added. Arbitrary page results or arguments
can still contain sensitive data that Explorer cannot identify. Recipe and diagnostic export previews let
you inspect and remove selected data before copying or downloading; they do not alter the
saved definition or guarantee that every secret has been removed. A recipe definition does
not export site authentication, Chrome permissions or a browser session.

Single runs and manual recipes can also export a Playwright `.spec.ts` test; Security can export
Markdown and SARIF 2.1.0 with observed evidence and source locations. New recipe journals retain
the minimal tool contracts needed for assertions. These exports do not execute tools while being
created. A run with arguments/results omitted cannot generate an executable test from hidden data.
When a developer later runs a generated test, it opens the recorded site in a fresh browser and
can invoke real tools. It writes an empty local receipt named by a hash of the plan/run ID to the
OS temporary directory and may attach tool outputs to the developer's Playwright report.
Explorer does not add its provider keys or vault passphrase to the receipt or generated file.

## What leaves your device, and when

For an AI run, only after the screen has stated what will be sent and to which host, and only
when you press Send or Run. The explicit List models action also contacts the configured provider
and can send its authentication header; it does not send page tools or results. Explorer
never silently selects or switches providers. A local endpoint processes requests on the
machine hosting that server; cloud requests go to the provider you chose. The page's own network activity
when one of its tools executes is separate from these provider requests.

Sent, in that case, to the endpoint you configured and to no one else:

- your conversation messages, including prior turns when you continue a saved conversation,
  and the selected system prompt or prompt profile;
- the **names, descriptions and input schemas** of the WebMCP tools the current page exposes,
  including any local override you applied to them;
- the **arguments** the model asks to call a tool with;
- the **results the page's tools return** — and, as said above, a tool result can contain
  data from the page, which therefore reaches the model;
- your API key, as the endpoint's authentication header.

Explorer does not send the page's HTML, its text, cookies, your browsing history, the list of
your open tabs, or any identifier of you or your machine.

Explorer **refuses** to send any of this over plain `http` to a host that is not your own
machine, because the key and the prompts would travel unencrypted. `localhost`, `127.0.0.1`
and `::1` are allowed, so local Ollama or LM Studio servers work; anything else must be
`https`.

Explorer must ask Chrome for permission to reach each endpoint, and asks for **that endpoint
only** — never for all sites.

## Optional Agent access

Agent access is off by default. In Settings, you can separately allow an agent running on
`https://corsen.ai` or `https://www.corsen.ai` to communicate with Explorer. This also
requires ordinary site access. When enabled, that page can list its own WebMCP tool names,
descriptions and input schemas, ask Explorer to call those tools with supplied arguments,
and receive their results. These results may contain page data; the website may process
them under its own privacy policy. The bridge does not expose other tabs, your saved
conversations, configuration or provider API keys.

Turn Agent access off in Settings to refuse further requests. Removing ordinary site
access also removes the bridge.

## Your controls

- See every site Explorer may inspect, and revoke any of them, from the Settings screen in the
  panel or at `chrome://extensions` → Site access. Further collection and invocation require current access; Explorer
  removes registered instrumentation/emulation scripts for it. Reload an open page to remove page code already installed.
- Inspect storage counts in Settings. Clear individual saved-data classes or use **Clear saved
  data and keys** to also reset the provider configuration, session keys and encrypted vault.
  Invocation reservations remain so clearing history cannot silently reauthorize an action.
  Destructive clear controls ask for a second click before deleting.
- Forget an API key per provider; encrypted changes require the passphrase. Lock or delete the vault in Model setup or Settings. Browser restart clears the decrypted session cache, not an encrypted vault.
- Stop any run or suite in progress, and clear what the panel remembers, with the Stop
  button in the panel's status bar.
- Clear the execution history, overrides, saved calls, eval suites and snapshots from their own screens.
- Save or delete manual recipes and inspect their run reports in Tools. Stop a recipe before
  clearing its stored data in Settings. A stored interrupted run never resumes automatically;
  a pending page action may already have happened, so inspect the page before a reviewed rerun.
- Cancel a tool call that is taking too long, from the Cancel button beside Run. The page's own tool may still finish its work; its answer is discarded.
- Removing the extension removes everything it stored.

## Limited use

Explorer's use of any data it reads or transfers is limited to providing and improving the
user-facing features described here — inspecting, testing and debugging the WebMCP tools of
web pages. Explorer does not sell data. Transfers are limited to the AI provider you configure,
the requesting site you explicitly enable for Agent access, and the trusted local MCP client
you pair for explicitly shared tabs, for the purpose you initiate. A paired client's subsequent
handling is governed by its own settings, as explained above. Explorer does not use data for
advertising or for determining creditworthiness or lending, and does not allow humans to read
it except with your explicit consent for a specific piece of data, for security purposes, or to
comply with applicable law.

## Not in this product

No security certification: Security reports a provisional heuristic grade alongside facts,
labelled indicators and unknown checks. Audit remains the separate contract-quality score. Explorer is not a page firewall. It observes and reports tool metadata, supports explicit local simulation, and refuses ambiguous or duplicate Explorer requests. It does not certify page code or undo a tool’s own actions. No background page opening, no scheduled probes, no telemetry.

The passive checks do not inspect cookies, authentication tokens, session credentials or custom
submit handler internals. Origin scan reads CSP/CORS/Permissions-Policy response headers, not
effective browser policy. It rejects redirects, sends no credentials and makes at most one
request per distinct URL per explicit scan. A failed response is not retried. Discovery files
are optional conventions; a missing file alone is not a security vulnerability.

## Changes

This policy changes only when the code does, and the review date at the
top is updated. Previous versions are available on request to security@corsen.ai.

Provider responses can include signed or encrypted continuation data needed for subsequent
tool calls. Explorer keeps this with the saved conversation and returns it only when continuing
with the same model and API format. It is separate from API keys. For the built-in OpenAI
connector, Explorer requests `store:false`; the provider's own data-handling terms still apply.
