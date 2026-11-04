// The security findings of one tool, under its schema beside the contract checks: the same
// facts as the Security section, scoped to the tool a person is looking at.

import { el, badge, t } from '../dom.js';
import { reviewSecurity, maxSeverity } from '../../core/security/review.js';
import { renderFinding, severityBadge } from './security.js';

export function toolSecurityFindings(tool, discovery) {
  const review = reviewSecurity({ discovery: { ...discovery, tools: [tool] } });
  return review.findings.filter((f) => f.toolName === tool.name);
}

// The card badge: the highest severity among the tool's findings, nothing when there is none.
export function securityBadge(findings) {
  const top = maxSeverity(findings);
  return top ? severityBadge(top, t('security_cardBadgeHelp')) : null;
}

export function renderToolSecurity(root, { tool, discovery }) {
  const findings = toolSecurityFindings(tool, discovery);
  const box = el('details', { class: 'ck-bar sec-detail' });
  const top = maxSeverity(findings);
  if (top === 'critical' || top === 'high' || top === 'medium') box.open = true;
  box.append(
    el('summary', { title: t('help_nav_security'), text: findings.length ? t('security_detailTitleCount', [String(findings.length)]) : t('security_detailTitle') }),
    el('p', { class: 'field-desc', text: t('security_detailIntro') }),
  );
  if (!findings.length) box.append(el('p', { class: 'field-desc', text: t('security_detailNone') }));
  for (const f of findings) box.append(renderFinding(f));
  root.append(box);
  return findings;
}

export { badge };
