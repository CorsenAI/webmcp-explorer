# WebMCP Explorer

A Chrome extension by Corsen AI for discovering, inspecting and exercising WebMCP tools.

- Discover JavaScript tools and declarative form inventories, including frame provenance.
- Run tools manually, save recipes and inspect results and unknown effects.
- Review security indicators, proposed fixes and a provisional heuristic grade.
- Connect a local MCP client through the optional zero-dependency Node companion and Corsen Guard.
- Use your own model provider in Agent Lab, with session keys or an optional encrypted vault.
- Export reviewed Playwright tests and Markdown/SARIF security reports.
- Eight interface languages, including Hebrew and Arabic RTL.

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
Report security concerns privately to security@corsen.ai.

## License

Copyright 2026 Corsen AI. Licensed under [Apache 2.0](LICENSE). See [NOTICE](NOTICE) for attribution
and the trademark boundary. Chrome and WebMCP are referenced descriptively; this project is not
an official Google product.

The 2.3.0-rc1 source passed 735 distinct unit cases on Linux, macOS and Windows. The complete
Linux Chrome 155 headful campaign passed 70/70. Native UI and MCP flows passed on macOS
Chrome 155 and Windows Chrome 157 ARM64. See [QUALIFICATION.md](QUALIFICATION.md) for the exact
scope and [SOURCE-SHA256.json](SOURCE-SHA256.json) for the qualified product-file hashes.

This repository publishes the release candidate's source. The 2.3.0-rc1 candidate has not been
published to the Chrome Web Store or npm.
