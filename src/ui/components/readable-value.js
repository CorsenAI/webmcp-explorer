// A faithful view of JSON data, without requiring the reader to parse JSON punctuation.
// Keys and scalar values remain literal text. No inferred units, links, HTML or summaries.
import { el, t } from '../dom.js';
import { DisplayNumber } from '../../core/json-display.js';
import { pointerToken } from '../../core/json-pointer.js';

const PAGE_SIZE = 20;

export function readableValue(value, depth = 0, { onSelect = null, path = '' } = {}) {
  if (value === null || typeof value !== 'object' || value instanceof DisplayNumber) {
    const kind = value instanceof DisplayNumber ? 'number' : value === null ? 'null' : typeof value;
    const text = value instanceof DisplayNumber ? value.text : value === null ? t('readable_noValue')
      : value === '' ? t('readable_emptyText') : String(value);
    return el('span', { class: 'rv-scalar' }, [
      el('span', { class: 'rv-value', text }),
      el('span', { class: 'rv-kind', text: t(`readable_${kind}`) }),
    ]);
  }

  const array = Array.isArray(value);
  const entries = Object.entries(value);
  if (!entries.length) return el('p', { class: 'field-desc', text: array ? t('readable_emptyList') : t('readable_emptyObject') });
  const content = el('dl', { class: 'rv-fields' });
  let drawn = 0;
  const more = el('button', { title: t('readable_moreHelp') });
  const box = el('div', { class: 'rv-group' }, [content, more]);
  function appendPage() {
    const page = entries.slice(drawn, drawn + PAGE_SIZE);
    for (const [key, child] of page) {
      const childPath = `${path}/${pointerToken(key)}`;
      const label = array ? t('readable_item', [String(Number(key) + 1)]) : key;
      const name = onSelect ? el('button', { class: 'link-button fc-pick', text: label || t('fieldChecks_emptyKey'),
        title: t('fieldChecks_pickHelp', [childPath]), 'aria-label': t('fieldChecks_pickHelp', [childPath]), 'data-path': childPath }) : null;
      name?.addEventListener('click', () => onSelect(childPath, child));
      content.append(el('div', { class: 'rv-field' }, [
        name ? el('dt', {}, [name]) : el('dt', { text: label }),
        el('dd', {}, [readableValue(child, depth + 1, { onSelect, path: childPath })]),
      ]));
    }
    drawn += page.length;
    more.hidden = drawn >= entries.length;
    more.textContent = t('readable_more', [String(Math.min(PAGE_SIZE, entries.length - drawn)), String(entries.length - drawn)]);
  }
  more.addEventListener('click', appendPage);

  // Deep values are built only when requested. Wide values are paged, including the root.
  // Expanding a node never changes the data or executes a page tool.
  if (depth > 2) {
    const details = el('details', { class: 'rv-nested' }, [
      el('summary', { text: t(array ? 'readable_items' : 'readable_fields', [String(entries.length)]), title: t('readable_expandHelp') }),
      box,
    ]);
    details.addEventListener('toggle', () => { if (details.open && drawn === 0) appendPage(); });
    return details;
  }
  appendPage();
  return box;
}
