# WebMCP Explorer local companion

A zero-dependency Node.js stdio MCP server and authenticated IPv4 loopback WebSocket relay.
Requires Node.js 22+ (qualification: Node 26.8.1, Linux, Chrome for Testing 155.0.8059.84).
No installer, daemon, native module, remote code, account or relay configuration file.
This is a local private package; no public npm publication is claimed.

## Start from Explorer

1. Open Explorer → Settings → Local MCP Bridge. Enable this browser session.
2. For a local checkout/extracted package, set **Local companion script** to the absolute path
   of `packages/webmcp-bridge/cli.mjs` (or the extracted `package/cli.mjs`). If you deliberately
   installed the package's `webmcp-bridge` bin on your PATH, leave this field empty.
3. Copy **MCP client configuration** into a trusted client's stdio server configuration. It
   contains the complete command, configured port (default 18971), extension ID and a generated
   session pairing secret. Keep it private; do not paste it into a website, issue or chat.
4. Start/restart that MCP server in the client. Explorer shows an authenticated connection.
5. Grant the intended site Chrome access if needed, then explicitly share its tab in Explorer.
   Permission alone does not expose a tab. Keep the Explorer panel open for approval requests.

Calls require approval by default. Optional automatic read-only mode still requires captured
registration annotations (enable Instrumentation Mode for that site and reload) and no critical/
high security indicator, mutation, consequential hint or unchecked argument condition. Generic
MCP destructiveHint is preserved from capture because native WebMCP may omit it. A read-only
hint is not proof of the callback's actual behaviour. The default remains manual approval.

Approvals show the exact name, origin and JSON (invisible controls escaped), expire after the
configured 5–60 seconds, and are consumed once. No approval means no dispatch. Metadata and
Chrome document identity are checked again; metadata is also compared to the chosen RegisteredTool
inside the page immediately before execution. Unknown effects pause the bridge; inspect the
page and explicitly resume/share again. No request is retried or resumed on reconnect.

## Protocol and boundaries

MCP JSON-RPC 2.0 over UTF-8 newline-delimited stdio, versions 2025-11-25 / 2025-06-18:
`initialize`, `notifications/initialized`, `ping`, `tools/list`, `tools/call`,
`notifications/tools/list_changed` and cancellation. Protocol-only stdout; diagnostics stderr.
The incompatible stateless 2026-07-28 lifecycle is not implemented. One stdio client / relay
process / browser connection per configured port; a used port is refused, never adopted.

The internal WebSocket is not a public MCP HTTP endpoint. It binds only 127.0.0.1, requires exact
Host/path/extension Origin, and performs mutual HMAC-SHA256 challenge/response plus directional
message authentication and strict sequence counters. Tokens are never URL parameters or logs.
Payloads are authenticated, not encrypted. A process with access to the private client config,
browser memory or a privileged debugger can steal the secret; this is not an OS sandbox.

Session-only pairing ends on browser restart, extension reload/update/disable or Forget pairing.
Update the copied client configuration after a new pairing. Navigation/revocation/reconnection
clear tab bindings; an interrupted dispatch survives as a blocked marker. The extension's
persistent hashed invocation reservations prevent replay independently of history deletion.
The relay remembers request IDs for its process lifetime and rejects duplicates. It never
executes page JavaScript itself and never receives extension provider API keys.

Limits: 1 MiB transport messages, 32 KiB arguments / depth 32 / 4096 nodes, 16 concurrent calls,
8 shared tabs, 200 tools and 64 KiB exported metadata per tab. Oversized/inaccessible/inventory-only
or locally overridden tools are omitted. Output beyond 512 KiB is replaced by a completion notice;
the action is not repeated. No compression/binary WS messages or arbitrary HTTP endpoints.

## Development

From the project root:

```sh
node --test test/bridge-core.test.js test/bridge-relay.test.js test/execute-page.test.js
node tools/check-store-build.mjs
```

`protocol.js` is shared verbatim with `src/core/bridge/protocol.js`; a test enforces byte identity.
Do not introduce external dependencies or replace the host/token checks with a bare nonce.
The extension source remains independently packaged; this companion is not loaded as remote
extension code. Publication and modifying an actual external MCP client's settings are separate
owner actions, not part of the qualification harness.
