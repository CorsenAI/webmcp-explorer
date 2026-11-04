// The demo page's tools. Deliberately varied, because a demo where everything is a happy path
// teaches nothing about the product: Explorer's whole argument is that it tells you the truth
// when things are awkward.
//
// So there is a tool with a rich schema, one that is slow, one that fails, one that returns
// nothing, and one registered a few seconds late so the live timeline has something real to
// show.

import { ensureModelContext } from './webmcp-polyfill.js';

// Chrome hides this tab's URL from the panel without the `tabs` permission — not even the
// extension's own pages are exempt — and that permission would put "read your browsing
// history" on the install prompt. And it refuses to let the extension inject a script into
// its own pages at all. So the demo answers for itself, over a port it opens: the service
// worker only ever learns about a tab that volunteered (D-049).

// Awaited: the native object exists here but rejects every call, so which implementation
// the page will use cannot be known synchronously.
const mc = await ensureModelContext();
const state = document.getElementById('state');
const cart = [];

// The names this page has registered. Read from here rather than from the implementation, so
// the page behaves identically whether the browser supplies WebMCP or the bundled polyfill
// does — the first version read the polyfill's own map and threw on a browser with native
// WebMCP, which stopped the bridge from ever opening.
const registered = [];

// Opened first, and never gated on anything below: the panel has no other way to reach this
// page, so a failure further down must not take the bridge with it.
import('./bridge.js');

function announce() {
  document.getElementById('impl').textContent = mc.__explorerPolyfill
    ? 'This page uses the small WebMCP implementation bundled with Explorer. Native WebMCP '
      + 'cannot run on an extension page at all — Chrome refuses it because such a page is not '
      + 'origin-isolated the way the API requires. Explorer will report a polyfill on every '
      + 'screen, never native.'
    : 'This page is using the browser’s own WebMCP implementation.';
}

function register(descriptor) {
  mc.registerTool(descriptor);
  registered.push(descriptor.name);
}

const CATALOGUE = [
  { id: 'p1', name: 'MacBook Air 15"', category: 'laptops', price: 1199, stock: 4 },
  { id: 'p2', name: 'ThinkPad X1 Carbon', category: 'laptops', price: 1449, stock: 0 },
  { id: 'p3', name: 'Pixel 9 Pro', category: 'phones', price: 899, stock: 12 },
  { id: 'p4', name: 'Studio Monitors, pair', category: 'audio', price: 349, stock: 2 },
];

register({
  name: 'search_products',
  description: 'Search the product catalogue by keyword, category and maximum price.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Free text search over the product name' },
      category: { type: 'string', enum: ['laptops', 'phones', 'audio'] },
      maxPrice: { type: 'number', minimum: 0, maximum: 5000 },
      inStockOnly: { type: 'boolean', default: false },
    },
    required: ['query'],
  },
  annotations: { readOnlyHint: true },
  execute: async ({ query = '', category, maxPrice, inStockOnly }) => {
    const found = CATALOGUE.filter((item) => {
      if (query && !item.name.toLowerCase().includes(String(query).toLowerCase())) return false;
      if (category && item.category !== category) return false;
      if (typeof maxPrice === 'number' && item.price > maxPrice) return false;
      if (inStockOnly && item.stock === 0) return false;
      return true;
    });
    return JSON.stringify({ products: found });
  },
});

register({
  name: 'add_to_cart',
  description: 'Add a product to the shopping cart. Fails when the product is out of stock.',
  inputSchema: {
    type: 'object',
    properties: {
      sku: { type: 'string', description: 'The product id, for example p1' },
      quantity: { type: 'integer', minimum: 1, maximum: 10, default: 1 },
    },
    required: ['sku'],
  },
  annotations: { readOnlyHint: false },
  execute: async ({ sku, quantity = 1 }) => {
    const item = CATALOGUE.find((p) => p.id === sku);
    // A tool that throws is part of the demo: Explorer has to show a failure honestly, and a
    // page where nothing ever fails would not demonstrate that.
    if (!item) throw new Error(`No product with id ${sku}`);
    if (item.stock === 0) throw new Error(`${item.name} is out of stock`);
    cart.push({ sku, quantity });
    render();
    return JSON.stringify({ added: true, cart });
  },
});

register({
  name: 'estimate_delivery',
  description: 'Estimate a delivery date. Takes about a second, like a real backend call.',
  inputSchema: {
    type: 'object',
    properties: { postcode: { type: 'string', description: 'Destination postcode' } },
    required: ['postcode'],
  },
  annotations: { readOnlyHint: true },
  execute: async ({ postcode }) => {
    await new Promise((resolve) => setTimeout(resolve, 900));
    const days = 2 + (String(postcode).length % 3);
    return JSON.stringify({ postcode, businessDays: days });
  },
});

register({
  name: 'clear_cart',
  description: 'Empty the cart. Returns nothing at all.',
  inputSchema: null,
  annotations: { readOnlyHint: false },
  execute: async () => {
    cart.length = 0;
    render();
    // An empty answer is the case agents forget to handle, so the demo contains one.
    return '';
  },
});

// Registered late on purpose: the live timeline needs something that actually happens after
// the panel is already watching.
setTimeout(() => {
  register({
    name: 'apply_promo_code',
    description: 'Apply a promotional code. This tool appears a few seconds after page load.',
    inputSchema: {
      type: 'object',
      properties: { code: { type: 'string' } },
      required: ['code'],
    },
    annotations: { readOnlyHint: false },
    execute: async ({ code }) => JSON.stringify({
      code, accepted: String(code).toUpperCase() === 'WEBMCP',
    }),
  });
  render();
}, 4000);

function render() {
  state.textContent = `${registered.length} tools registered · ${cart.length} in the cart`;
  document.getElementById('tools').textContent = registered.join(', ');
  document.getElementById('cart').textContent = cart.length
    ? cart.map((c) => `${c.quantity} × ${c.sku}`).join(', ')
    : 'empty';
}

announce();
render();
