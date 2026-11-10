# WebMCP Explorer

A Chrome extension by Corsen AI to discover, inspect, test and review the security of the WebMCP
tools a website exposes to AI agents.

**[Install from the Chrome Web Store](https://chromewebstore.google.com/detail/webmcp-explorer/pccddgfopjiggjhhlgndlghimbdndjef)** · **[Online scanner](https://webmcp.corsen.ai/)** · **[Video: WebMCP explained (7 min)](https://youtu.be/AZ7_LgeVLjs)**

Free, no account, no telemetry. Apache-2.0.

![WebMCP Explorer's side panel next to a demo shop, listing the six WebMCP tools the page registers with their descriptions, annotations and frames](docs/images/tools.png)

## What it does

- **Inspect** every tool a page registers: JavaScript tools and declarative forms, in iframes and
  open shadow roots, with schema, annotations and the frame that registered it. A live timeline
  tracks registrations, removals and contracts replaced under the same name; tools a page registers
  only after the first pointer movement or scroll appear as soon as you move the pointer over it.
  The environment check decodes the page's WebMCP origin-trial token and says whether Chrome honours
  it, ignores it (outside the page's head, written with spaces, expired, another origin, not signed
  by Chrome) or stops within 14 days; Scan Origin also reads a token sent in the response header.
- **Run** a tool from a generated form or JSON arguments, read the result, save checks and combine
  calls into multi-step recipes. Unknown effects stop automatic continuation.
- **Review security with evidence**: thirteen rule families (WMCP-SEC-001 to 013) cover
  prompt-injection indicators, hidden or look-alike characters, consequential actions without hints,
  read-only claims contradicted by the callback's own source, declarative forms that submit hidden
  business fields, untrusted content, `exposedTo` lists and frames, text far beyond Chrome's
  budgets and changes in registered contracts. A provisional grade shows its calculation and what
  could not be observed.
- **Catch a changed contract**: while the panel follows a page, a tool whose description, input
  schema or annotations are replaced under the same name is reported in the timeline and as a
  finding that names the part; a tool that re-mounts with the same contract is not flagged. Between
  visits, save a security baseline: a later review names each tool whose contract changed and the
  part that changed, with its own warning for a rewritten description. A baseline can be exported
  to a file and imported for the same site. The optional re-check of open tabs counts changed
  contracts on the toolbar badge.
- **Fix with a diff**: each fix shows the observed contract and the proposed one. *Test this fix
  locally* applies the proposed description, schema and hints on Explorer's side only. A page with
  forms and no tool gets starter contracts, without auto-submit and without sensitive fields.
- **Check a site you control**: bounded probes (at most eight calls per tool) and, on request, a
  search of the page's own scripts for provider secret keys, reported by type and length, never by
  value.
- **Export** reviewed Playwright tests and Markdown or SARIF security reports. For GitHub code
  scanning of a public page, [webmcp.corsen.ai/ci/](https://webmcp.corsen.ai/ci/) generates the workflow.
- **Agent Lab**: let your own model provider call the page's tools and inspect every call. Keys stay
  in session memory, or in an optional encrypted vault.
- **Local MCP bridge** (optional): connect a trusted MCP client through the zero-dependency Node
  companion; Corsen Guard asks for approval before calls by default.
- Eight interface languages, including Hebrew and Arabic RTL.

| Run a tool, read the result, reproduce the call | Review security findings with their evidence |
| --- | --- |
| ![Result of a tool call shown as readable fields, with buttons to save it as a check, reproduce the call or use it in a recipe](docs/images/run.png) | ![Critical finding: a tool description that reads like an instruction to the agent, with the exact excerpt as evidence and why it matters](docs/images/security.png) |

## Try it in a minute

1. Install Explorer from the [Chrome Web Store](https://chromewebstore.google.com/detail/webmcp-explorer/pccddgfopjiggjhhlgndlghimbdndjef).
   It has no site access at install.
2. Open it from the toolbar, then **Help → Open the demo page**. The demo page ships its own
   JavaScript implementation of WebMCP, so it works without any browser flag; Explorer marks it as
   Compatibility, never Native. Open `search_products`, enter `MacBook` and press **Run**.
3. For real sites, the browser must support WebMCP: enable `chrome://flags/#enable-webmcp-testing`
   and relaunch Chrome, or visit a site enrolled in Chrome's WebMCP origin trial. Then allow that
   site in Explorer. For example, [webmcp.corsen.ai](https://webmcp.corsen.ai/) registers three tools.

## Watch

[![WebMCP Explained, a 7-minute video: what WebMCP is, the risks its specification lists, and a demo of WebMCP Explorer](docs/images/video.jpg)](https://youtu.be/AZ7_LgeVLjs)

[WebMCP Explained](https://youtu.be/AZ7_LgeVLjs) (7 min) covers what WebMCP is, the risks its own
specification lists and a demo of Explorer. A [62-minute deep dive](https://youtu.be/cQ2WHsnlD04)
goes through the tool lifecycle, scenarios and best practices.

## Development

The extension is plain JavaScript with no runtime dependency. Node.js 22+ is needed for the local
companion; qualification uses the exact versions recorded in the release report.

```sh
node --test
node tools/check-store-build.mjs
```

For local installation, open Chrome's extensions page, enable Developer mode and choose Load
unpacked with the `src` directory. Grant access only to the sites you intend to inspect.
WebMCP availability depends on the browser build and the page's environment. Explorer reports
observed capabilities; an absent API does not prove a disabled flag. Explicit JS emulation does
not provide native form submission or access to closed shadow roots.

See [the companion guide](packages/webmcp-bridge/README.md) for local MCP configuration. Pairing
configuration contains a secret and belongs only in a trusted client's private settings.

## Security boundaries

Tool metadata and read-only hints are untrusted. A grade is not a security certification.
Corsen Guard requires approval for risky or insufficiently described external calls and denies
unanswered requests on timeout. Unknown effects are not replayed automatically. At-most-once
reservation covers Explorer's dispatches, not a site's internal actions. Exported test receipts
are local files and do not coordinate separate machines or survive deliberate deletion.

Exports can contain arguments and page results. Review them before sharing. SARIF locations
are observed runtime locations; repository annotations require an explicit source mapping.
Read the [extension privacy policy](PRIVACY.md). The website's online scanner is a separate,
optional service with its own privacy policy. Report security concerns privately to security@corsen.ai.

## License

Copyright 2026 Corsen AI. Licensed under [Apache 2.0](LICENSE). See [NOTICE](NOTICE) for attribution
and the trademark boundary. Chrome and WebMCP are referenced descriptively; this project is not
an official Google product. It is also unrelated to the experimental `webmcp-explorer` sample in
Microsoft Edge's `webmcp-labs` repository.

See [QUALIFICATION.md](QUALIFICATION.md) for the qualification of this source (2.6.0) and
[SOURCE-SHA256.json](SOURCE-SHA256.json) for the hashes of its product files.
