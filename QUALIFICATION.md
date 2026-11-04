# 2.3.0-rc1 qualification

Qualified on 2026-11-03/04. Source: 206 files under `src/`, unchanged from the qualified candidate.
The [source manifest](SOURCE-SHA256.json) contains each relative path and SHA-256 digest.
Its own SHA-256 is `7ed84ba94162c18ee504571ea2c2c83a41b4e138d5bc6ef7ef32f8dfae53f49c`.

| Platform | Browser | Results |
| --- | --- | --- |
| Linux | CfT 155.0.8059.84 | 735 units; 70/70 full headful scenarios |
| macOS ARM64 | CfT 155.0.8059.84 | 735 units; 10/10 bridge; 7/7 native UI |
| Windows 11 ARM64 | Chrome 157.0.8103.39 ARM64 | 735 units; 10/10 bridge; 7/7 native UI |

These are the same 735 distinct unit cases repeated on each OS, not 2,205 different tests.
Live encrypted-vault restart/provider flow: 17/17. Real official external MCP SDK: 9/9.
Native clipboard, paths with spaces, LF/CRLF framing and 80 narrow/RTL strip layouts were checked.
CfT 155 win64 under Windows ARM64 translation did not produce a usable graphical run and is not
claimed as qualified. Grades remain heuristics; metadata cannot attest callbacks or backend
authorization. No distributed exactly-once guarantee or GitHub SARIF ingestion is claimed.
