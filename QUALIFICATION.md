# 2.6.0 qualification

Qualified on 2026-11-10. Source: 218 files under `src/`. The [source manifest](SOURCE-SHA256.json)
contains each relative path and SHA-256 digest; its own SHA-256 is
`44c5f04d4a5535f1b9e8ca83b41dcc62e94e734b0f76bd6626f8f837e1bb0e14`.

Store package: `webmcp-explorer-2.6.0.zip`, 872043 bytes, SHA-256
`61b349016de0852a0fbe841fe814d6dd093c6b0c713700aef22213d84c858c3e`, reproducible: built from this
commit with Node 26.8.1, `node tools/pack-store.mjs` gives exactly these bytes (the archive takes its
timestamps from the commit), and `node tools/verify-store-zip.mjs` matches every entry with `src/`.

| Platform | Browser | Results |
| --- | --- | --- |
| Linux | Chrome for Testing 155.0.8059.84 | 798 units; 75/75 functional scenarios on the shipping build (production manifest, permissions granted through Chrome's own dialog); 12/12 permission journeys |
| macOS 27.2 ARM64 | Chrome for Testing 155.0.8059.84 | 798 units; 75/75 functional scenarios |
| Windows 11 ARM64 | — | 798 units; package read back entry by entry |

These are the same 798 distinct unit cases repeated on each OS. On the Windows ARM64 machine, Chrome
for Testing runs as x64 under emulation and does not give usable functional runs; no Windows
functional result is claimed for 2.6.0. The first full run of this version gave 74/75 on Linux and
on macOS: the file input opened by the new Import button had neither a name nor a hint, which the
scenario that checks every control reports. It was corrected and the whole qualification was run
again on the corrected build: 75/75 on both. Store gate (`node tools/check-store-build.mjs`): 218
files, 1679 messages, no finding. No new permission.

What 2.6.0 adds:

- **Token delivery as Chrome reads it.** Chrome reads an origin-trial meta element only inside
  `<head>`, takes its content as written and decodes it with strict Base64. A meta element in the
  body, or a token with spaces, line breaks or missing padding, is now reported as never read;
  2.5.0 reported such a token as honoured. A token that Chrome's key did not sign is named as
  possibly another browser's.
- **Live contract changes.** The timeline compares a SHA-256 fingerprint of each tool's description,
  input schema and annotations as well as the tool names. A tool replaced under its own name is
  reported with the part that changed, and a tool that was removed and came back is said to carry
  the same contract or another one. The security review reports another contract under the same
  name as an observed finding (`contract-changed-in-session`); a re-mount with the same contract is
  not a finding. Measured on Chrome 155 first: with no gap, a microtask or a task between the
  removal and the new registration, the name never leaves the tool list, so names alone cannot show
  a replacement.
- **Baseline files.** A security baseline can be exported to a file and imported for the same site.
- **`Origin-Trial` header.** Scan Origin reads the header from the request it already makes.
- **One request at a time.** Turning Instrumentation Mode and emulation on or off is queued in the
  background.

Limits: the timeline samples the tool list when the page signals a change and starts when the panel
follows a tab; the observer runs in the page's own world, where a page that looks for it can find
it; fingerprints are kept in memory only. Grades remain heuristics; metadata cannot attest callbacks
or backend authorization. SARIF carries observed runtime locations.
