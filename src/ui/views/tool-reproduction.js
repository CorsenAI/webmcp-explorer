// The two next steps after reading a result stay visible before a potentially long payload.
import { el, t } from '../dom.js';
import { exportBar } from '../components/export-bar.js';
import { reproReport, specFilename } from '../../core/export/repro.js';
import { reproContext } from './repro-context.js';

export function resultActions(root, onRecipe = null) {
  const reveal = (selector, focus) => {
    const box = root.querySelector(selector);
    if (!box) return;
    box.open = true;
    box.scrollIntoView({ block: 'nearest' });
    box.querySelector(focus)?.focus({ preventScroll: true });
  };
  const save = el('button', {
    class: 'save-result-check', text: t('toolResult_saveCheck'), title: t('toolResult_saveCheckHelp'),
  });
  save.addEventListener('click', () => reveal('.sc-bar', '#sc-name'));
  const reproduce = el('button', {
    class: 'reproduce-result', text: t('toolDetails_reproduce'), title: t('toolResult_reproduceHelp'),
  });
  reproduce.addEventListener('click', () => reveal('.ex-bar', 'button'));
  const recipe = onRecipe ? el('button', { class: 'use-in-recipe', text: t('recipes_use'), title: t('recipes_useHelp') }) : null;
  recipe?.addEventListener('click', onRecipe);
  return el('div', { class: 'row-inline result-actions' }, [save, reproduce, recipe]);
}

export function reproductionBar({ tool, outcome, args, url, topOrigin }) {
  // Capture the override before enabling export. An export must not race the background read
  // and silently describe a mocked result as an ordinary invocation.
  let override = null;
  let ready = false;
  const box = exportBar({
    label: t('toolDetails_reproduce'),
    kinds: ['markdown', 'json', 'console', 'playwright'],
    filenames: { playwright: specFilename(tool).replace(/\.spec\.ts$/, '') },
    note: t('toolDetails_reproduceNote'),
    build: () => ready ? reproReport({ tool, args: outcome.args ?? args, outcome,
      override, ...reproContext({ tool, url, topOrigin }) }) : null,
  });
  const buttons = [...box.querySelectorAll('button')];
  buttons.forEach((button) => { button.disabled = true; });
  chrome.runtime.sendMessage({ type: 'overrides-list' }).then((all) => {
    override = Array.isArray(all) ? all.find((o) => o.logicalId === tool.logicalId) ?? null : null;
    ready = true;
    buttons.forEach((button) => { button.disabled = false; });
  }).catch(() => {
    box.append(el('p', { class: 'field-note error', text: t('toolResult_reproUnavailable') }));
  });
  return box;
}
