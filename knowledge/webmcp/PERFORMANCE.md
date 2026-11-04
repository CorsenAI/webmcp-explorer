# Performance

Measured, never estimated. Machine and browser are named in the findings.

| Measurement | Result | Finding |
|---|---|---|
| Discovery of 1 000 tools (MAIN-world probe + registry) | ~60 ms | WMP-0024 |
| Rendering 1 000 tool cards with plain DOM | ~6–9 ms | WMP-0024 |
| Growth from 1 to 1 000 tools | linear; no quadratic step | WMP-0024 |
| MV3 worker idle death under a pending fetch | between t+35 s and t+40 s | WMP-0009 |
| Keep-alive pulse that kept a 45 s call alive | one API call every 20 s | WMP-0009 |
| Timer alignment in a background tab | 1 s boundaries; a 3 000 ms wait measured 3 982 ms | WMP-0017 |
| Tool execution round trip through the extension, instant tool | 1–2 ms over the in-page time | store/screenshots/2-run.png |

## Budgets Explorer holds itself to

From `docs/ARCHITECTURE.md` section 7 and D-011: discovery + render under 300 ms up to 100
tools and under 2 000 ms at 500 and 1 000 tools. `tools/e2e/perf.mjs` fails when a budget is
exceeded. List virtualisation was considered and not built, because the measurement did not
justify it (D-026).

## How the numbers were taken

- In-page duration is measured inside the page around `executeTool` alone; the extension's
  round trip is reported separately so the tool is not blamed for the extension's overhead.
- Discovery timing comes from the probe's own `performance.now()` deltas, per frame.
- Worker lifetime was measured with **no** messages sent to the worker during the wait; the
  first attempt at measuring it reset the idle timer by polling and gave a wrong answer.
