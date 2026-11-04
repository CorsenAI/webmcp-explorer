import { canonicalJson } from '../identity.js';
import { reviewSecurity } from '../security/review.js';
import { mutationVerbs } from '../security/phase-b.js';
export const DEFAULT_PORT = 18971;
export function bridgeUrl(port = DEFAULT_PORT, host = '127.0.0.1') {
  if(!['127.0.0.1','localhost'].includes(host)||!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid loopback bridge endpoint');
  // Even localhost uses the IPv4 literal: no DNS resolution, redirects or configurable path.
  return `ws://127.0.0.1:${port}/webmcp-bridge`;
}
export function guardDecision(tool,{autoReadOnly=false}={}) {
  const review=reviewSecurity({discovery:{tools:[tool],topOrigin:tool.origin,frames:[]}});
  const reasons=[];const a=tool.annotations??{};
  if(!autoReadOnly)reasons.push('manual-mode');
  if(tool.annotationsObserved!==true)reasons.push('uncaptured-annotations');
  if(a.readOnlyHint!==true)reasons.push('not-read-only');
  if(a.destructiveHint===true||a.consequentialHint===true)reasons.push('consequential');
  if(mutationVerbs(tool).length||tool.autoSubmit===true)reasons.push('mutating');
  if(review.findings.some(f=>f.severity==='critical'))reasons.push('critical');
  if(review.findings.some(f=>f.severity==='high'))reasons.push('high');
  if(tool.schemaComplete===false||tool.schemaError)reasons.push('incomplete-schema');
  return {approval:reasons.length>0,reasons,score:review.score,
    findings:review.findings.map(f=>({code:f.code,ruleId:f.ruleId,severity:f.severity,evidence:f.evidence}))};
}

// Page-authored regexes are never compiled in the worker. Unknown checks require approval;
// the native runtime/application still owns complete validation.
export function boundedArguments(value) {
  let nodes=0;
  function visit(v,depth) {
    if(depth>32||++nodes>4096)return false;
    if(v&&typeof v==='object')return Object.values(v).every(x=>visit(x,depth+1));
    return true;
  }
  return visit(value,0);
}

export function bridgeMetadata(tool) {
  return canonicalJson([tool.name,tool.origin,tool.title??'',tool.description??'',tool.inputSchema??null,
    ['readOnlyHint','consequentialHint','untrustedContentHint','debugging'].map(k=>tool.annotations?.[k]===true)]);
}

export function bridgeOutcome(outcome) {
  const unknown=outcome.effectState==='unknown';
  let text=unknown?'Effect unknown; request not replayed. Inspect the page before another request. '+String(outcome.error??'')
    :outcome.ok?String(outcome.result??''):String(outcome.error??outcome.code??'Bridge call refused');
  const truncated=new TextEncoder().encode(text).length>524288;
  if(truncated)text=unknown?'Effect unknown; details omitted due to the bridge limit. Not replayed.'
    :outcome.ok?'Tool returned; output omitted due to the bridge limit. Inspect Explorer History; do not repeat the action.'
      :'Error details omitted due to the bridge limit. No automatic replay.';
  return {isError:!outcome.ok||unknown,content:[{type:'text',text}],_meta:{'corsen/code':outcome.code??null,
    'corsen/effectState':outcome.effectState,'corsen/dispatchState':outcome.dispatchState,
    'corsen/argsEncoding':outcome.argsEncoding??null,'corsen/engine':outcome.engine??null,'corsen/replayed':false,'corsen/outputTruncated':truncated}};
}
