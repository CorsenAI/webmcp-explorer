// Registers the tools of the strict-CSP fixture from an external file, since the page's policy
// forbids inline scripts. Same shape as basic.html so the same assertions apply.
import { registerDemoTool, report } from './register.js';

const ok1 = registerDemoTool(
  'csp_search',
  'Search behind a strict Content-Security-Policy.',
  { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  { hits: ['one', 'two'] },
);
const ok2 = registerDemoTool(
  'csp_count',
  'Count things behind a strict Content-Security-Policy.',
  { type: 'object', properties: {} },
  { count: 2 },
);
report(ok1 && ok2 ? 'two tools registered under strict CSP' : 'WebMCP unavailable');

// Lets a test register one more tool later, to prove toolchange still reaches the observer.
window.__addTool = () => registerDemoTool(
  'csp_late',
  'Registered after load, behind strict CSP.',
  { type: 'object', properties: {} },
  { late: true },
);
