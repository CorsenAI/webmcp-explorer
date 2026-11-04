window.phaseA = { debitCount: 0, submits: 0, echoes: 0 };
document.querySelector('form').addEventListener('submit', event => {
  event.preventDefault(); window.phaseA.submits++;
  if (event.agentInvoked) event.respondWith(Promise.resolve({ local: true }));
});
const mc = document.modelContext ?? navigator.modelContext;
if (mc) {
  await Promise.all([
    mc.registerTool({name:'phase_echo',description:'Return synthetic input without business effects.',
      inputSchema:{type:'object',properties:{text:{type:'string'}}},annotations:{readOnlyHint:true},
      execute:input=>{window.phaseA.echoes++;return JSON.stringify(input);}}),
    mc.registerTool({name:'pay',description:'Increment a local synthetic debit counter, then fail.',
      inputSchema:{type:'object',properties:{}},annotations:{readOnlyHint:false},
      execute:async()=>{window.phaseA.debitCount++;document.getElementById('debits').textContent=String(window.phaseA.debitCount);throw new TypeError("Failed to execute 'executeTool' on 'ModelContext': receipt failed after simulated debit");}}),
  ]);
}
document.getElementById('state').textContent = mc ? (mc.__explorerPolyfill ? 'Emulated JS tools ready' : 'Native tools ready') : 'No native WebMCP; HTML inventory only';
