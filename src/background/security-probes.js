// Runs active security probes (S2) through the ordinary executor, one call at a time, on a site
// the person declared they control. The consent is read from storage at the moment of the run,
// never from the message; a run without it is refused. Every call is recorded in history as a
// probe; progress is broadcast; a stop cancels the call in flight and ends the run.

import { runTool, cancelTool, newCallId } from './execute.js';
import { planProbes, judgeProbe } from '../core/security/probes.js';
import { isControlled } from '../storage/security.js';
import { hold, release } from './keepalive.js';

const running = new Map(); // tabId -> { stop: boolean, callId: string|null }

export async function runProbes({ tabId, topOrigin, tools = [] }) {
  if (!Number.isInteger(tabId) || !topOrigin) return { error: 'A tab and its origin are required.' };
  if (!(await isControlled(topOrigin))) return { error: 'consent-required', code: 'consent-required' };
  if (running.has(tabId)) return { error: 'A probe run is already in progress for this tab.', code: 'busy' };

  const state = { stop: false, callId: null };
  running.set(tabId, state);
  const plans = tools.map((tool) => ({ tool, steps: planProbes(tool) }));
  const total = plans.reduce((n, p) => n + p.steps.length, 0);
  const calls = [];
  const findings = [];
  let done = 0;
  hold();
  try {
    for (const { tool, steps } of plans) {
      for (const step of steps) {
        if (state.stop) break;
        state.callId = newCallId();
        broadcast({ tabId, done, total, toolName: tool.name, probe: step.id });
        const outcome = await runTool(tabId, {
          frameId: tool.frameId, documentId: tool.documentId, toolName: tool.name, origin: tool.origin,
          args: step.args, tool, topOrigin, callId: state.callId, probe: step.id,
        });
        state.callId = null;
        done += 1;
        calls.push({ toolName: tool.name, probe: step.id, callId: outcome.callId, ok: outcome.ok === true, code: outcome.code ?? null, historyId: outcome.historyId ?? null, durationMs: outcome.durationMs ?? null });
        findings.push(...judgeProbe(tool, step, outcome));
      }
      if (state.stop) break;
    }
  } finally {
    release();
    running.delete(tabId);
  }
  broadcast({ tabId, done, total, finished: true, cancelled: state.stop });
  return { findings, calls, total, done, cancelled: state.stop, tools: plans.map((p) => ({ name: p.tool.name, probes: p.steps.map((s) => s.id) })) };
}

export async function stopProbes(tabId) {
  const state = running.get(tabId);
  if (!state) return { stopped: false, reason: 'not-running' };
  state.stop = true;
  if (state.callId) await cancelTool(tabId, state.callId);
  return { stopped: true };
}

export function probesRunning(tabId) {
  return running.has(tabId);
}

function broadcast(payload) {
  chrome.runtime.sendMessage({ type: 'security-probe-progress', ...payload }).catch(() => {});
}
