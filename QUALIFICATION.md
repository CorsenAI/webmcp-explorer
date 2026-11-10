# 2.6.1 qualification

Qualified on 2026-11-10. Source: 218 files under `src/`. The [source manifest](SOURCE-SHA256.json)
contains each relative path and SHA-256 digest; its own SHA-256 is
`359413123e4041e0d47b37453e6726e2a9065229d00d0a80a1e3bab0a8359d8a`.

Store package: `webmcp-explorer-2.6.1.zip`, 878102 bytes, SHA-256
`a90fe40ba690d7939173bd4389c72712ba18a4609b0a87affd732a17a5df39e1`, reproducible: built from this
commit with Node 26.8.1, `node tools/pack-store.mjs` gives exactly these bytes (the archive takes its
timestamps from the commit), and `node tools/verify-store-zip.mjs` matches every entry with `src/`.

| Platform | Browser | Results |
| --- | --- | --- |
| Linux | Chrome for Testing 155.0.8059.84 | 805 units; 76/76 functional scenarios on the shipping build (production manifest, permissions granted through Chrome's own dialog); 12/12 permission journeys |
| macOS 27.2 ARM64 | Chrome for Testing 155.0.8059.84 | 805 units; 76/76 functional scenarios |
| Windows 11 ARM64 | — | 805 units; package read back entry by entry |

These are the same 805 distinct unit cases repeated on each OS. On the Windows ARM64 machine, Chrome
for Testing runs as x64 under emulation and does not give usable functional runs; no Windows
functional result is claimed for 2.6.1. Store gate (`node tools/check-store-build.mjs`): 218 files,
1682 messages, no finding. No new permission.

What 2.6.1 changes: one rule of the security review, and nothing else since 2.6.0.

A description that addresses the agent is rated in two tiers. `text-agent-directive`, critical, is
what published tool-poisoning cases write in a description: an order to ignore earlier instructions,
to hide an action from the user, to send data elsewhere, to call another tool and carry its result,
to read a secret file, to change how another tool behaves, to take effect without being called, to go
to another site, or a rule about what the agent must answer. `text-usage-instruction`, low and new,
is guidance on when or in what order to call tools ("always call this first", "you must call this
tool", an "IMPORTANT:" label).

The rule was measured before it was changed, on source text only (no page was loaded):

| Set | 2.6.0 | 2.6.1 |
| --- | --- | --- |
| 488 descriptions from the source of 12 public WebMCP projects | 13 rated critical | none critical, 11 low |
| 16 phrasings published with the attacks (WebMCP draft §6.3.1.1, Invariant Labs, Trail of Bits) | 5 rated critical | 14 critical, 1 low, 1 not matched |

The 13 were workflow guidance such as "use X to find the id before calling this", in demos published
by browser vendors among others. Both findings are indicators over English text that quote their
excerpt: a rephrased instruction or one in another language is not found, and the real set shows
what the earlier list got wrong without bounding the errors of the new one.

What 2.6.0 added (2026-11-10): origin-trial tokens read the way Chrome reads them (a meta element
outside `<head>` or a token written with blanks is never read); a tool contract replaced under its
own name reported live with the part that changed; security baselines exported to a file and
imported for the same site; the `Origin-Trial` header read by Scan Origin; instrumentation requests
applied one at a time.

Limits: the timeline samples the tool list when the page signals a change and starts when the panel
follows a tab; the observer runs in the page's own world, where a page that looks for it can find
it; fingerprints are kept in memory only. Grades remain heuristics; metadata cannot attest callbacks
or backend authorization. SARIF carries observed runtime locations.
