// WMCP-SEC-013: provider secret keys in script text the page sends to every visitor. Explorer only:
// the public scanner never runs this (owner decision 2026-11-08), so it is reached through
// reviewSecurity's extraFindings, never imported by review.js. The token never leaves findSecrets:
// a match yields its type, provider, length and whether it is a live key, nothing of its value.
//
// Formats: GitHub, Stripe and Slack publish their prefixes (docs read 2026-11-08); OpenAI and
// Anthropic do not, and their patterns are concordant secret-detector heuristics, labelled as such.
// Stripe publishable keys (pk_) are meant for client code and are never reported. Pure JavaScript.

import { finding } from './catalog.js';

export const MAX_SECRET_SCAN_CHARS = 1_000_000;

const PATTERNS = Object.freeze([
  { type: 'stripe-secret-key', provider: 'Stripe', live: true, re: /\b(?:sk|rk)_live_[0-9A-Za-z]{16,}/g },
  { type: 'stripe-test-key', provider: 'Stripe', live: false, re: /\b(?:sk|rk)_test_[0-9A-Za-z]{16,}/g },
  { type: 'stripe-organization-key', provider: 'Stripe', live: true, re: /\bsk_org_[0-9A-Za-z_]{16,}/g },
  { type: 'github-token', provider: 'GitHub', live: true, re: /\b(?:ghp|gho|ghu|ghr)_[0-9A-Za-z]{36,}|\bghs_[0-9A-Za-z_.-]{36,}|\bgithub_pat_[0-9A-Za-z_]{50,}/g },
  { type: 'slack-token', provider: 'Slack', live: true, re: /\b(?:xoxb|xoxp|xapp|xwfp)-[0-9A-Za-z-]{20,}|\bxoxe\.xapp-[0-9A-Za-z-]{20,}/g },
  { type: 'openai-key', provider: 'OpenAI (detector heuristic)', live: true, re: /\bsk-(?:proj|svcacct|admin)-[0-9A-Za-z_-]{40,}/g },
  { type: 'anthropic-key', provider: 'Anthropic (detector heuristic)', live: true, re: /\bsk-ant-(?:api|admin)\d{2}-[0-9A-Za-z_-]{80,}/g },
]);
export const SECRET_TYPES = Object.freeze(PATTERNS.map((p) => p.type));

// Matches of one text: [{ type, provider, live, length }], at most `limit`, never the value.
export function findSecrets(text, { limit = 20 } = {}) {
  const value = String(text ?? '').slice(0, MAX_SECRET_SCAN_CHARS);
  const out = [];
  for (const p of PATTERNS) {
    for (const m of value.matchAll(p.re)) {
      if (out.length >= limit) return out;
      out.push({ type: p.type, provider: p.provider, live: p.live, length: m[0].length });
    }
  }
  return out;
}

// sources: [{ kind: 'callback' | 'inline-script' | 'script', label, text, tool? }]. One finding per
// location and key type; the excerpt names the type and length and says the value is not shown.
export function reviewSecrets(sources = []) {
  const out = [];
  for (const source of sources.slice(0, 200)) {
    const groups = new Map();
    for (const hit of findSecrets(source?.text)) {
      const g = groups.get(hit.type) ?? { ...hit, count: 0 };
      g.count += 1;
      groups.set(hit.type, g);
    }
    for (const g of groups.values()) {
      out.push(finding('client-secret-exposed', { tool: source.tool ?? null, severity: g.live ? 'critical' : 'medium',
        evidence: { field: source.kind ?? 'script', path: String(source.label ?? '').slice(0, 300),
          excerpt: `${g.provider} ${g.type}: ${g.count} match${g.count === 1 ? '' : 'es'}, ${g.length} characters (value not shown)` },
        detail: { type: g.type, provider: g.provider, live: g.live, count: g.count, location: source.kind ?? 'script', valueShown: false } }));
    }
  }
  return out;
}
