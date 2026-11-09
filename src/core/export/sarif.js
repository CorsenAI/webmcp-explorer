import { RULES, AGENTIC_SOURCE } from '../security/rules.js';
import { CATALOG } from '../security/catalog.js';
import { visible } from './safe.js';
const byCode=new Map(Object.entries(RULES).flatMap(([id,r])=>r.codes.map(code=>[code,id])));
const level=s=>s==='critical'||s==='high'?'error':s==='medium'?'warning':'note';
// GitHub code scanning: > 9.0 critical, 7.0–8.9 high, 4.0–6.9 medium, 0.1–3.9 low; none for info.
const SECURITY_SEVERITY={critical:'9.5',high:'8.0',medium:'5.5',low:'3.0'};
// Rule metadata GitHub requires before it displays a result (fullDescription, help), engine v3.
function ruleDescriptor(id){
  const r=RULES[id],code=r?null:id.replace(/^EXPLORER-/,''),def=r?null:CATALOG[code];
  const severity=r?.severity??def?.severity??null;
  const properties={tags:['security','webmcp'],scope:'runtime metadata review; not exploit verification',precision:r?.precision??(def?.nature==='observed'?'high':'medium')};
  if(SECURITY_SEVERITY[severity])properties['security-severity']=SECURITY_SEVERITY[severity];
  return {id,name:id,shortDescription:{text:r?.title??id},
    fullDescription:{text:r?.description??`Explorer finding ${code} (${def?.axis??'unclassified'}, ${def?.nature??'indicator'}).`},
    help:{text:r?.help??'Review the evidence and the cited sources; an indicator is not proof of exploitation.'},
    helpUri:AGENTIC_SOURCE,properties};
}
function observedLocation(tool) {
  if(!tool?.source?.known||!tool.source.file)return null;
  try {
    const url=new URL(tool.source.file);
    if(!['http:','https:','file:'].includes(url.protocol)||url.username||url.password)return null;
    const location={artifactLocation:{uri:url.href}};
    if(Number.isSafeInteger(tool.source.line)&&tool.source.line>0)location.region={startLine:tool.source.line};
    return location;
  } catch { return null; }
}
// Runtime locations remain runtime locations. No repository filename or line is invented.
export function securitySarif(review,discovery) {
  const findings=(review?.findings??[]).filter(f=>Object.hasOwn(CATALOG,f.code));
  const idOf=f=>byCode.get(f.code)??`EXPLORER-${f.code}`;
  const ids=[...new Set([...Object.keys(RULES),...findings.map(idOf)])].sort();
  const rules=ids.map(ruleDescriptor);
  const results=findings.map(f=>{
    const tool=discovery?.tools?.find(t=>t.instanceId===f.instanceId&&t.name===f.toolName);
    const physical=observedLocation(tool);
    const location={logicalLocations:[{name:visible(f.toolName??'page'),fullyQualifiedName:JSON.stringify([f.origin,f.frameId,f.toolName]),kind:f.toolName?'function':'module'}]};
    if(physical)location.physicalLocation=physical;
    const id=idOf(f);
    return {ruleId:id,ruleIndex:ids.indexOf(id),level:level(f.severity),kind:f.severity==='info'?'informational':'review',
      message:{text:`${id}: ${f.code}. Review the tool metadata and its evidence; an indicator is not proof of exploitation.`},
      locations:[location],partialFingerprints:{'webmcpIdentity/v1':JSON.stringify([id,f.code,f.logicalId??f.toolName,f.origin,tool?.frameIndexPath??f.frameId,f.evidence?.path??null])},
      properties:{toolName:f.toolName??null,origin:f.origin??discovery?.topOrigin??null,frameId:f.frameId??null,
        metadataPath:f.evidence?.path??null,evidence:f.evidence??null,nature:f.nature,severity:f.severity,
        remediationCodeSnippet:f.remediationCodeSnippet??null,locationKind:physical?'observed-registration':'logical-only'}};
  });
  return {$schema:'https://json.schemastore.org/sarif-2.1.0.json',version:'2.1.0',runs:[{tool:{driver:{name:'WebMCP Explorer',informationUri:'https://developer.chrome.com/docs/ai/webmcp',rules}},
    results,properties:{coverage:review?.coverage??{},score:review?.score??null,locationNote:'Physical locations identify observed registrations. GitHub repository annotations require an explicit source/repository mapping; logical-only locations do not imply a source file.'}}]};
}
