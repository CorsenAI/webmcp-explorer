// The saved checks of a whole page, run in one click: after a deploy, "what broke?" answered
// tool by tool, with the reason for each failure, and a report to keep beside the deploy.
//
// A check is a saved call with an expectation (core/saved-calls.js). Each one runs in the frame
// its tool lives in now, through the same path as the Run button; a tool that has no live
// instance any more is reported as gone, not skipped in silence; a call whose arguments no
// longer fit the schema is reported as needing review, not run against a contract it was not
// written for.

import { el, badge, t } from '../dom.js';
import { reviewSavedCall, judgeSavedCall, savedChecksForPage, REVIEW, VERDICT } from '../../core/saved-calls.js';
import { exportBar } from '../components/export-bar.js';
import { checksReport } from '../../core/export/checks-report.js';
import { verdictLine, expectationHelp } from './tool-saved-calls.js';
import { diagnosticEvidence } from '../components/diagnostic-evidence.js';

function callId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function renderPageChecks(root, { tools, tabId, topOrigin }) {
  const host = el('div');
  root.append(host);
  load();

  // The recorded embedding origin keeps missing cross-origin tools in the report (D-089).
  async function load() {
    const all = await chrome.runtime.sendMessage({ type: 'saved-calls-all' });
    const checks = savedChecksForPage(Array.isArray(all) ? all : [], tools, topOrigin);
    if (!checks.length) return;
    paint(checks);
  }

  function paint(checks) {
    const status = el('p', { class: 'field-note pc-status', role: 'status', hidden: '' });
    const listHost = el('div');
    const run = el('button', { class: 'primary', text: t('tools_checksRun'), title: t('tools_checksRunHelp') });
    let results = [];

    // Read-only readiness is useful before a person chooses to execute the whole suite.
    // Share exactly the existing target/review policy with Run; this is not a test result.
    function readiness(saved) {
      const live=tools.filter(tool=>tool.logicalId===saved.logicalId);
      const target=live.length===1?live[0]:live.find(tool=>tool.frameId===0)??live[0]??null;
      if(!target)return {target,kind:'gone',reason:t('tools_checksToolGone',[saved.toolName])};
      const review=reviewSavedCall(saved,target);
      if(review.status===REVIEW.needsReview)return {target,kind:'review',reason:review.problems[0]??''};
      return {target,kind:null};
    }
    const problems=checks.map(saved=>({saved,...readiness(saved)})).filter(item=>item.kind);
    const readinessHost=el('div',{class:'pc-readiness'},problems.length?[
      el('p',{class:'field-note',text:t('tools_checksReadiness',[String(problems.length)])}),
      el('ul',{},problems.map(item=>el('li',{text:`${item.saved.toolName} · ${item.saved.name}: ${item.kind==='review'?t('tools_checksReviewReason',[item.reason]):item.reason}`}))),
      el('p',{class:'field-desc',text:t('tools_checksReadinessHelp')}),
      diagnosticEvidence({state:'saved-check-readiness',origin:topOrigin,checksExecuted:false,
        checks:problems.map(({saved,target,kind,reason})=>({name:saved.name,tool:saved.toolName,
          toolOrigin:saved.origin,frameId:target?.frameId??null,contractFingerprint:target?.contractFp??null,kind,reason}))}),
    ]:[]);

    run.addEventListener('click', async () => {
      run.disabled = true;
      readinessHost.hidden = true;
      results = [];
      const counts = { pass: 0, fail: 0, review: 0, gone: 0 };
      for (const [index, saved] of checks.entries()) {
        status.hidden = false;
        status.textContent = t('tools_checksRunning', [String(index + 1), String(checks.length)]);
        const ready=readiness(saved),target=ready.target;
        let judgement;
        let outcome = null;
        if (!target) {
          counts.gone += 1;
          judgement = { verdict: VERDICT.notAcheck, reason: t('tools_checksToolGone', [saved.toolName]) };
        } else {
          if (ready.kind === 'review') {
            counts.review += 1;
            judgement = { verdict: VERDICT.notAcheck, reason: t('savedCalls_skippedNeedsReview', [ready.reason]) };
          } else {
            outcome = await chrome.runtime.sendMessage({
              type: 'run',
              tabId,
              call: { frameId: target.frameId, toolName: target.name, origin: target.origin, args: structuredClone(saved.args), tool: target, topOrigin, callId: callId() },
            });
            judgement = judgeSavedCall(saved, outcome);
            if (judgement.verdict === VERDICT.pass) counts.pass += 1;
            else if (judgement.verdict === VERDICT.fail) counts.fail += 1;
          }
        }
        results.push({ saved, target, outcome, judgement });
        listHost.replaceChildren(...results.map(line));
      }
      run.disabled = false;
      status.textContent = t('tools_checksSummary', [String(counts.pass), String(counts.fail), String(counts.review), String(counts.gone)]);
    });

    const box = el('details', { class: 'pc-bar' });
    box.append(
      el('summary', { text: t('tools_checksTitle', [String(checks.length)]), title: t('help_savedChecks') }),
      el('p', { class: 'field-desc', text: t('tools_checksIntro') }),
      ...(checks.some((saved) => !saved.topOrigin)
        ? [el('p', { class: 'field-note', text: t('tools_checksLegacyScope') })] : []),
      readinessHost,
      el('div', { class: 'row-inline' }, [run]),
      status,
      listHost,
      exportBar({
        label: t('exportBar_export'),
        build: () => (results.length ? checksReport(results, { origin: topOrigin }) : null),
        note: t('tools_checksExportNote'),
      }),
    );
    host.replaceChildren(box);
  }

  function line({ saved, judgement }) {
    return el('div', { class: 'card pc-row' }, [
      el('p', { class: 'card-name' }, [
        document.createTextNode(`${saved.toolName} · ${saved.name}`),
      ]),
      el('div', { class: 'card-meta' }, [badge(t('savedCalls_checkBadge'), 'ok', expectationHelp(saved.expect))]),
      verdictLine(judgement),
    ]);
  }
}
