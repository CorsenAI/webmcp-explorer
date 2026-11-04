// Observations only: absence does not prove a disabled flag, missing forms do not prove JS.
export function diagnosticState(result) {
  const env=result?.env??{},tools=result?.tools??[];
  const runtime=env.checks?.apiAvailability==='refused'?'refused':env.state==='compat-polyfill'?'emulated'
    :env.checks?.apiAvailability==='missing'||env.state==='unavailable'?'unavailable'
      :env.legacyHost?'legacy':env.checks?.apiAvailability==='partial'?'partial':'native';
  // Explorer's emulation registers JS only; HTML remains a separate, non-executable inventory.
  const imperative=tools.filter(t=>t.registrationType==='imperative'||t.executionContract?.engine==='emulated'&&!t.inventoryOnly&&t.registrationType!=='declarative').length;
  const declarative=tools.filter(t=>t.registrationType==='declarative').length;
  return {runtime,imperative,declarative,unknown:tools.length-imperative-declarative,canOfferEmulation:env.reason==='api-absent'};
}
