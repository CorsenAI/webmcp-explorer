// Which eval cases were judged against a contract that has since changed. Pure JavaScript.
//
// A result is a fact about the tools as the model saw them — descriptions and schemas after
// any local override. When that offered contract moves, the result is still true about the
// past and says nothing about the present; L-16 used to leave the reader to notice that. The
// run records the offered fingerprint of every tool it declared; this compares it with the
// tools on the page now and names the cases whose expected tool changed under them.
//
// Three answers, never a guess: `changed` (the offered contract differs), `gone` (the tool is
// no longer on the page), or nothing — and a result recorded before fingerprints were kept is
// left alone rather than declared fresh.

export const STALE = { changed: 'changed', gone: 'gone' };

export function staleness(result, currentTools = []) {
  const recorded = result?.tools;
  if (!recorded || typeof recorded !== 'object') {
    return { known: false, byCase: {}, count: 0 };
  }
  const now = new Map(currentTools.map((tool) => [tool.name, tool.offeredFp ?? tool.contractFp ?? null]));
  const byCase = {};
  for (const entry of result.cases ?? []) {
    const name = entry.expectTool;
    if (!name || !recorded[name]) continue;
    if (!now.has(name)) {
      byCase[entry.caseId] = { tool: name, reason: STALE.gone };
      continue;
    }
    const then = recorded[name].offeredFp ?? recorded[name].declaredFp ?? null;
    const current = now.get(name);
    if (then && current && then !== current) {
      byCase[entry.caseId] = { tool: name, reason: STALE.changed };
    }
  }
  return { known: true, byCase, count: Object.keys(byCase).length };
}
