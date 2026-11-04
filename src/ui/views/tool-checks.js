// Contract checks for one tool: the gaps in its declared contract that commonly make an agent
// pick the wrong tool or call it wrongly. Facts with a level — a warning is likely to confuse a
// model or break a call, a note is worth a look — never a score (D-004 rule 10).

import { el, badge, t } from '../dom.js';
import { checkTool, CHECK, LEVEL } from '../../core/checks.js';

const TEXT = {
  [CHECK.noDescription]: () => t('checks_noDescription'),
  [CHECK.shortDescription]: (detail) => t('checks_shortDescription', [String(detail)]),
  [CHECK.duplicateDescription]: (detail) => t('checks_duplicateDescription', [String(detail)]),
  [CHECK.noSchema]: () => t('checks_noSchema'),
  [CHECK.schemaError]: (detail) => t('checks_schemaError', [String(detail)]),
  [CHECK.schemaNotObject]: (detail) => t('checks_schemaNotObject', [String(detail)]),
  [CHECK.propertyWithoutDescription]: (detail) => t('checks_propertyWithoutDescription', [String(detail)]),
  [CHECK.requiredNotDeclared]: (detail) => t('checks_requiredNotDeclared', [String(detail)]),
  [CHECK.nameNeedsAlias]: () => t('checks_nameNeedsAlias'),
  [CHECK.duplicateName]: () => t('checks_duplicateName'),
  [CHECK.noAnnotations]: () => t('checks_noAnnotations'),
};

export function checkText(item) {
  const render = TEXT[item.code];
  return render ? render(item.detail) : item.code;
}

// The card badge: only warnings earn a place on the list, where space is scarce.
export function checksBadge(tool, allTools, result = checkTool(tool, allTools)) {
  if (!result.warnings) return null;
  const warnings = result.items.filter((item) => item.level === LEVEL.warn);
  return badge(
    result.warnings === 1 ? t('checks_oneOnCard') : t('checks_nOnCard', [String(result.warnings)]),
    'warn',
    warnings.map(checkText).join('\n'),
  );
}

export function renderToolChecks(root, { tool, allTools = [] }) {
  const result = checkTool(tool, allTools);
  const box = el('details', { class: 'ck-bar' });
  if (result.warnings) box.open = true;

  const count = result.items.length;
  box.append(
    el('summary', { title: t('help_contractChecks'), text: count ? t('checks_titleCount', [String(count)]) : t('checks_title') }),
    el('p', { class: 'field-desc', text: t('checks_intro') }),
  );

  if (!count) {
    box.append(el('p', { class: 'field-desc', text: t('checks_none') }));
  }
  for (const item of result.items) {
    box.append(el('div', { class: 'ck-item' }, [
      badge(item.level === LEVEL.warn ? t('checks_levelWarn') : t('checks_levelNote'),
        item.level === LEVEL.warn ? 'warn' : 'accent'),
      el('span', { class: 'ck-text', text: checkText(item) }),
    ]));
  }
  root.append(box);
  return result;
}
