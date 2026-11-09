# 2.4.0 qualification

Qualified on 2026-11-09. Source: 215 files under `src/`. The [source manifest](SOURCE-SHA256.json)
contains each relative path and SHA-256 digest; its own SHA-256 is
`cdaf52393e356e7e12c6c1e16f597706f76ecf3501b0c6f9d619ca390bdc538a`.

Store package: `webmcp-explorer-2.4.0.zip`, 840042 bytes, SHA-256
`cd39847f66667e6fc213c3d4bfeb0a312f877c4884967d788a3b42945193b9c7`, reproducible (`node
tools/pack-store.mjs` twice gives identical bytes; `node tools/verify-store-zip.mjs` matches every
entry with `src/`).

| Platform | Browser | Results |
| --- | --- | --- |
| Linux | Chrome for Testing 155.0.8059.84 | 758 units; 71/71 functional scenarios on the shipping build (production manifest, permissions granted through Chrome's own dialog); 12/12 permission journeys with real input |
| macOS 27.2 ARM64 | Chrome for Testing 155.0.8059.84 | 758 units; 71/71 functional scenarios |
| Windows 11 ARM64 | — | 758 units; package read back entry by entry |

These are the same 758 distinct unit cases repeated on each OS. On the Windows ARM64 machine, Chrome
for Testing runs as x64 under emulation and does not give usable functional runs; no Windows
functional result is claimed for 2.4.0. Store gate (`node tools/check-store-build.mjs`): 215 files,
1646 messages, no finding. No new permission.

What 2.4.0 adds: rule families WMCP-SEC-008 to 013 in the security review, before/after views of each
fix, local test of a fix on Explorer's side, starter contracts from a page's forms, bounded probes
(eight calls per tool at most) and, on request for a site you declare you control, a search of the
page's own scripts for provider key formats that keeps the provider, type and length only.

Grades remain heuristics; metadata cannot attest callbacks or backend authorization. SARIF carries
observed runtime locations.
