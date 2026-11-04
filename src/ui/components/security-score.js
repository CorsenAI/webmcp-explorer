import { el, t } from '../dom.js';

export function renderSecurityScore(root, review) {
  const score = review.score;
  const title = score.value === null ? t('security_scoreUnavailable') : t('security_scoreValue', [String(score.value), score.grade]);
  const breakdown = el('details', { class: 'sec-score-method' }, [
    el('summary', { text: t('security_scoreMethod'), title: t('security_scoreFormula') }),
    el('p', { class: 'field-desc', text: t('security_scoreFormula') }),
    el('ul', { class: 'field-desc sec-score-deductions' }, score.deductions.map(d => el('li', {
      text: `${d.ruleId ?? d.code} · ${d.toolName ?? t('security_pageFinding')} · −${d.points}`,
    }))),
  ]);
  root.replaceChildren(el('p', { class: 'sec-score-value', text: title }),
    el('p', { class: 'field-desc', text: t('security_scoreCaution') }), breakdown);
  root.className = 'card sec-score';
  root.setAttribute('data-grade', score.grade ?? 'unknown');
  root.setAttribute('data-score', String(score.value ?? 'unknown'));
}
