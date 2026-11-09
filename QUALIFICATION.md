# 2.5.0 qualification

Qualified on 2026-11-09. Source: 218 files under `src/`. The [source manifest](SOURCE-SHA256.json)
contains each relative path and SHA-256 digest; its own SHA-256 is
`24cfc8823201810961331f30d776b994126d052461f4bda935ef7c4a7867591b`.

Store package: `webmcp-explorer-2.5.0.zip`, 855059 bytes, SHA-256
`6eba13233cfda3bce1904fecbc24de4acdb3cbb181d0cae120078e90a7480367`, reproducible (`node
tools/pack-store.mjs` twice gives identical bytes; `node tools/verify-store-zip.mjs` matches every
entry with `src/`).

| Platform | Browser | Results |
| --- | --- | --- |
| Linux | Chrome for Testing 155.0.8059.84 | 774 units; 74/74 functional scenarios on the shipping build (production manifest, permissions granted through Chrome's own dialog); 12/12 permission journeys |
| macOS 27.2 ARM64 | Chrome for Testing 155.0.8059.84 | 774 units; 74/74 functional scenarios |
| Windows 11 ARM64 | — | 774 units; package read back entry by entry |

These are the same 774 distinct unit cases repeated on each OS. On the Windows ARM64 machine, Chrome
for Testing runs as x64 under emulation and does not give usable functional runs; no Windows
functional result is claimed for 2.5.0. The first full Linux run on this build gave 72/74 because of
two timing faults in the test scripts (a cleanup that sent two requests at once, and a click on Send
while it was briefly disabled); both were corrected and the next full run gave 74/74. Store gate
(`node tools/check-store-build.mjs`): 218 files, 1660 messages, no finding. No new permission.

What 2.5.0 adds: the page's WebMCP origin-trial token (meta tags) decoded and checked with Chrome's
public key, with a status-bar warning when Chrome ignores it, when it has expired and during its last
14 days (with several tokens, the valid one that lasts longest counts, as in Chrome); per-part contract fingerprints in security baselines, so a later review names the tool and
the part that changed (description, input schema, annotations) and warns separately about a rewritten
description; the optional re-check counts changed contracts on the toolbar badge; the empty tool list
explains that some sites register tools only after the first pointer movement or scroll.

Grades remain heuristics; metadata cannot attest callbacks or backend authorization. SARIF carries
observed runtime locations.
