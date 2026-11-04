// In-panel help preserves the current form and never executes a page tool. Native dialog
// supplies modality and Escape; its content is text-only, including page-supplied names.
import { el, t } from '../dom.js';
import { openDemo } from '../../shared/demo.js';

function topic(id) {
  return el('section', { class: 'help-topic' }, [
    el('h3', { text: t(`help_${id}Title`) }),
    el('p', { text: t(`help_${id}Body`) }),
  ]);
}

function visible(node) {
  if (!node.getClientRects().length || node.closest('[hidden]')) return false;
  // Contents of a collapsed details can still have layout rectangles in Chrome.
  for (let parent = node.parentElement; parent; parent = parent.parentElement) {
    if (parent.matches('details:not([open])') && node !== parent.querySelector(':scope > summary')) return false;
  }
  return getComputedStyle(node).visibility !== 'hidden';
}

function currentControls() {
  const entries = new Map();
  for (const node of document.querySelectorAll('#statusbar button, #rail button, #view button, #view summary, #view [title]')) {
    if (!visible(node) || !node.title) continue;
    const card = node.closest('.card-button');
    const label = card ? t('help_toolCardsTitle')
      : node.getAttribute('aria-label') || node.labels?.[0]?.textContent?.trim()
        || node.textContent.trim() || node.getAttribute('placeholder');
    if (!label) continue;
    const explanation = card ? t('help_toolCardsBody') : node.title;
    entries.set(`${label}\n${explanation}`, { label, explanation, disabled: node.matches(':disabled') });
  }
  const list = el('dl', { class: 'help-controls' });
  for (const { label, explanation, disabled } of entries.values()) {
    list.append(el('dt', { text: label }), el('dd', { text:
      explanation + (disabled ? ` ${t('help_disabled')}` : '') }));
  }
  return list;
}

export function openHelp({ page = 'start' } = {}) {
  if (document.querySelector('.help-dialog')) return;
  const opener = document.activeElement;
  const controls = currentControls();
  const title = el('h2', { id: 'help-title', tabindex: '-1', text: t('help_title') });
  const close = el('button', { text: t('help_close'), title: t('help_closeHelp') });
  const content = el('div', { class: 'help-content', tabindex: '0', role: 'region', 'aria-label': t('help_explanations') });
  const tabs = el('div', { class: 'help-pages', role: 'group', 'aria-label': t('help_topics') });
  const dialog = el('dialog', { class: 'help-dialog', 'aria-labelledby': 'help-title' }, [
    el('div', { class: 'help-heading' }, [title, close]), tabs, content,
  ]);
  const pages = ['start', 'screen', 'developer'];
  for (const id of pages) {
    const button = el('button', { text: t(`help_${id}`), title: t(`help_${id}Help`),
      'data-help-page': id, 'aria-pressed': String(page === id) });
    button.addEventListener('click', () => { page = id; paint(); });
    tabs.append(button);
  }
  function paint() {
    for (const button of tabs.children) button.setAttribute('aria-pressed', String(button.dataset.helpPage === page));
    if (page === 'screen') {
      content.replaceChildren(el('p', { class: 'muted', text: t('help_screenIntro') }), controls);
    } else if (page === 'developer') {
      content.replaceChildren(...['inspect', 'regressions', 'security', 'debug', 'automate', 'sharing'].map(topic));
    } else {
      const demo = el('button', { class: 'primary', text: t('openDemo'), title: t('openDemoHelp') });
      demo.addEventListener('click', () => { dialog.close(); openDemo(); });
      const glossary = el('details', { class: 'help-glossary' }, [
        el('summary', { text: t('help_glossary'), title: t('help_glossaryHelp') }),
        ...['tool', 'schema', 'frame', 'annotations', 'hints', 'poisoning', 'provenance', 'native'].map(topic),
      ]);
      content.replaceChildren(topic('intro'), el('ol', { class: 'help-steps' },
        ['choose', 'fill', 'read'].map(id => el('li', {}, [topic(id)]))),
      demo, el('p', { class: 'field-desc', text: t('help_demoBody') }),
      topic('audit'), glossary);
    }
    content.scrollTop = 0;
  }
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { dialog.remove(); if (opener?.isConnected) opener.focus({ preventScroll: true }); });
  paint();
  document.body.append(dialog);
  dialog.showModal();
  title.focus({ preventScroll: true });
}

export function helpIntro() {
  const button = el('button', { class: 'link-button', text: t('help_startAction'), title: t('help_startHelp') });
  button.addEventListener('click', () => openHelp());
  return el('details', { class: 'help-intro' }, [
    el('summary', { text: t('help_new'), title: t('help_newHelp') }),
    el('p', { class: 'field-desc', text: t('help_inlineBody') }), button,
  ]);
}
