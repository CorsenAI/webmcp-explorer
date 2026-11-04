# Chrome Web Store: what shipping an inspector taught

Requirements met and traps met on the way to a Store submission. Store rules change; the
`reported` findings are dated and must be re-read against the Store documentation before
being relied on again.

## Permissions

- Installing with **no** "read and change all your data on websites" warning requires:
  no `host_permissions`, no static `content_scripts` with broad `matches`, no `tabs`, no
  `webNavigation`, no `debugger`. Explorer ships `sidePanel`, `storage`, `scripting`,
  `activeTab` and `optional_host_permissions` only (D-014, D-015, D-024; verified by the
  user on a fresh profile, J1).
- `webNavigation` alone shows "Read your browsing history"; frame ↔ origin correlation is
  possible without it, from `executeScript({ allFrames: true })` results (D-015).
- `activeTab` is a bootstrap, not an architecture: its grant disappears on navigation
  (D-024). Without it and without a grant, Chrome hides the tab's URL and title (J1c).
- Per-origin optional grants need a user gesture in Chrome's own bubble; they cannot be
  automated, so those paths stay manual recipes (Explorer TEST_MATRIX section J).

## Data disclosure and privacy

- Every data collection must be prominently disclosed, functional ones included, and any later
  change of data handling disclosed proactively; data must be strictly necessary to the single
  purpose; and extensions built to circumvent the guardrails of AI services are banned —
  enforced since 2026-08-01 (WMP-0027, read at the source on 2026-09-10). Explorer declares
  authentication data (API keys), web history (current tab address), user activity (tool calls)
  and website content (tools and their results) — conservatively; its overrides and mocks act
  on the user's own page under test, not on an AI service.
- The privacy policy is written against the code and changes in the same commit as the
  behaviour (`docs/PRIVACY.md`, D-052). It carries a Limited Use statement and must be
  published at a stable URL before submission.
- No plaintext credentials at rest: `chrome.storage.session` only (D-051).
- No remote code: strict CSP on extension pages, no `eval`, no CDN, provider responses parsed
  as JSON and never executed (I1). A build gate checks the exact package
  (`tools/check-store-build.mjs`).

## Listing assets

- Up to five real screenshots at 1280×800 or 640×400 (WMP-0026). Explorer composes
  each from two genuine captures and refuses to capture until the panel shows what the
  caption promises (D-054).
- Promotional tiles 440×280 and 1400×560 rendered by the browser from the real icon
  (D-043).
- Every visible string goes through `_locales`; a script extracts and checks them (D-053).

## Quality signals a reviewer can see

- An MV3 worker that survives long model calls and reports interrupted work honestly
  (D-050).
- A single declared purpose — WebMCP development, inspection, testing and debugging — with
  the Agent Lab and Evals framed inside it (D-008).
- A truth gate before submission: a test matrix reconciled against evidence, with no
  ambiguous TODO left (D-053, D-055).
