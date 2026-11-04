# UX and DX patterns

How developers understand, test, mock and debug WebMCP — what worked in Explorer, with the
evidence that it worked. Patterns, not facts about the browser; the browser facts are in the
findings.

## Patterns that proved themselves

- **A form generated from the JSON Schema, with a raw-JSON toggle that stays in sync both
  ways.** Developers run a tool without writing JSON; the two views are one set of arguments
  (`tools/e2e/form-run.mjs`, D8).
- **Override and mock on the inspector's side, never in the page.** Rewriting a description,
  disabling a tool or mocking its answer lets a developer test an agent against failures the
  backend cannot produce on demand, without touching the site (D-030,
  `tools/e2e/overrides.mjs`). Every affected tool is flagged as overridden; a result obtained
  with an override in force says which ones (D-030).
- **Before/after evaluation of the same goals across a description rewrite**, reported as
  fixed / broken / unchanged per case, with regressions stated even when the net figure
  improved (`tools/e2e/evals.mjs`, D-039).
- **A live timeline that reports what it lost**: a bounded buffer, dropped events counted,
  "sampled" stated in the UI, and a view that refreshes itself on a worker broadcast
  (D-029, D-054, L-10).
- **Honest execution outcomes**: in-page duration separated from round trip; a tool that
  fails, returns nothing, or whose page navigates away is reported with a reason and never
  shown as an execution (`tools/e2e/inflight.mjs`, D-055).
- **Discovery completeness as a first-class state**: "Discovery partial — N origins not
  granted" with a grant action right there, never the look of a complete discovery
  (`tools/e2e/partial-grant.mjs`, D-023).
- **The blocked screen carries its own way out**: an illustration of the toolbar, the
  extensions button circled, a pin hint, and a one-click broad grant — and it unblocks itself
  when access arrives, without redrawing what the user was doing (D-031, D-032, D-033).
- **The first screen is the environment screen** for most installers (WMP-0018): diagnosis on
  several axes, the flag as copyable text, a bundled demo page so the product can be used
  before any real site exposes tools (D-017, D-049).
- **Closing the panel costs nothing**: section, open tool, typed goal and selected suite come
  back; a stop button exists for when the user wants to be done (D-042, D-044).
- **Network disclosure inline, before the button that acts on it**, built from the live
  configuration and naming the real host (D-052).

## Rules that came from mistakes

- Controls update in place; rebuilding them on every edit steals focus (D-027).
- A control reports only its own change; two edits in one tick used to lose one (D-040).
- Never point at UI the user cannot see, such as an unpinned toolbar icon (D-032).
- An empty state draws immediately, before the first round trip (D-047).
- Every icon-only button carries a title or aria-label and every input a label or hint; the
  rule is checked on every screen by `tools/e2e/tooltips.mjs`.
- A live instance is not a logical identity. Two frames loading the same URL each own a tool of
  the same name: keep both instances (list, execution, agent aliases), and let history,
  overrides and snapshots follow the logical tool (D-056, `tools/e2e/twins.mjs`).
- Resolve the tool to execute by ownership, never by the first name match: `getTools()` in a
  frame lists its same-origin siblings' tools too (WMP-0002), and refusing an ambiguous target
  with a reason beats guessing (D-056).

## Anti-patterns observed in the field

From the competitive review (`docs/research/2026-09-04-competitive-landscape.md`): schemas
dumped as raw JSON in a table cell, a "trace" that is `JSON.stringify` to the clipboard,
Gemini-only agents, `<all_urls>` host permissions that trigger the install warning. Explorer
avoided each on purpose (D-014, D-045).
