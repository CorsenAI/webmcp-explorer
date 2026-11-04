// An eval suite: a list of goals and what each one should make the model do.
//
// This is the feature the overrides exist for. Rewriting a tool description is only useful if
// you can answer "did that make the model pick it?", and a single run answers nothing — models
// are not deterministic and one lucky call proves as little as one unlucky one.
//
// Pure JavaScript: no chrome.*, no fetch.

let counter = 0;

// Ids only have to be unique within a profile, and a suite must survive structuredClone, so a
// timestamp plus a counter is enough. No crypto, no dependency.
function newId(prefix) {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}_${counter.toString(36)}`;
}

export function createSuite({ name = 'Untitled suite', origin = null, cases = [] } = {}) {
  return {
    id: newId('suite'),
    name,
    // The page the suite was written against. A suite run elsewhere is not wrong, but the
    // result means something different, and the UI has to be able to say so.
    origin,
    createdAt: Date.now(),
    cases: cases.map((entry) => createCase(entry)),
  };
}

export function createCase({
  goal = '', expectTool = null, expectFirst = false, forbidTools = [], repeat = 1,
} = {}) {
  return {
    id: newId('case'),
    goal,
    // The WebMCP tool name the user typed, not the alias sent to the model: the alias is an
    // implementation detail the user never sees.
    expectTool,
    expectFirst: Boolean(expectFirst),
    forbidTools: [...forbidTools],
    // A model is not deterministic. One run proves nothing, so a case can ask for several.
    repeat: Math.max(1, Math.min(20, Number(repeat) || 1)),
  };
}

// Problems that would make a run meaningless, reported as codes so the UI can phrase them.
export function suiteProblems(suite) {
  const problems = [];
  if (!suite?.cases?.length) problems.push('no-cases');

  (suite?.cases ?? []).forEach((entry, index) => {
    if (!entry.goal?.trim()) problems.push(`case-${index}-no-goal`);
    // A case with nothing to check passes trivially, which is worse than failing.
    if (!entry.expectTool && !entry.forbidTools.length) problems.push(`case-${index}-no-expectation`);
    if (entry.expectFirst && !entry.expectTool) problems.push(`case-${index}-first-without-tool`);
    if (entry.expectTool && entry.forbidTools.includes(entry.expectTool)) {
      problems.push(`case-${index}-contradictory`);
    }
  });

  return problems;
}

// Names a case mentions that the page does not expose. Reported before a run, because a suite
// that expects a tool which no longer exists will fail for a reason that has nothing to do
// with the model.
export function unknownTools(suite, tools = []) {
  const known = new Set(tools.map((tool) => tool.name));
  const missing = new Set();
  for (const entry of suite?.cases ?? []) {
    if (entry.expectTool && !known.has(entry.expectTool)) missing.add(entry.expectTool);
    for (const name of entry.forbidTools) {
      if (!known.has(name)) missing.add(name);
    }
  }
  return [...missing];
}

export function totalRuns(suite) {
  return (suite?.cases ?? []).reduce((sum, entry) => sum + entry.repeat, 0);
}

// A suite built from the page itself: one case per tool, each asking for that tool by its own
// description. It is a starting point to edit, not a benchmark — a goal that quotes the
// description is the easiest possible test, and the UI says so.
export function suiteFromTools(tools = [], origin = null) {
  return createSuite({
    name: 'Every tool, once',
    origin,
    cases: tools.map((tool) => createCase({
      goal: tool.description
        ? `${tool.description} Do it for this page.`
        : `Use the ${tool.name} tool on this page.`,
      expectTool: tool.name,
      expectFirst: true,
    })),
  });
}
