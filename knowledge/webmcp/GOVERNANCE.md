# Governance

Who exposes what to agents, read versus write, human-only actions, agent permissions and
consent. **No verified findings yet.** This file states the scope so that the first findings
land in the right place, and nothing more.

## Scope

- Which tools a site exposes, with which annotations (`readOnlyHint`,
  `untrustedContentHint`; `consequentialHint` is not implemented in Chrome 152, WMP-0004).
- Whether a tool's declared read-only nature matches what it does.
- How a site restricts exposure to specific origins (`exposedTo`) and how the embedder
  delegates the `tools` policy (`allow="tools"`; see WMP-0005 and WMP-0006 for how little
  the API's presence proves).
- What consent a user gave, and how an agent's action is distinguished from a human's
  (`event.agentInvoked` on declarative forms).

## What would count as evidence

A fixture that exposes a governed surface, an automated test against a real Chrome, and a
finding file naming both. Statements about "what sites should do" without a measurement do
not belong here.

## Related, elsewhere

Explorer deliberately does not judge risk (D-008, L-08); that is Corsen WebMCP Security's
remit. The security-relevant observations that exist are in `SECURITY.md`.
