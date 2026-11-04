// Keep the actual editor while another detail tab is open. A draft may contain unfinished
// JSON or invalid fields: serializing only valid values would silently lose that work.
import { el, t } from '../dom.js';
import { buildFormModel } from '../../core/schema/model.js';
import { sampleArguments } from '../../core/schema/sample.js';
import { renderForm, readForm } from '../components/schema-form.js';

export function createToolArguments(schema) {
  const model = buildFormModel(schema);
  let mode = model.renderable ? 'form' : 'json';
  // An invented optional maximum (e.g. maxPrice: 0) silently filters out useful results.
  // Seed required inputs and declared defaults; leave other optional fields for the user.
  let values = sampleArguments(schema, { requiredOnly: true, includeOptionalDefaults: true });
  let host = null;

  function element() {
    if (host) return host;
    host = el('div', { class: 'form-host' });
    if (mode === 'form') {
      renderForm(host, model, values);
    } else {
      if (!model.renderable) host.append(el('p', {
        class: 'field-note', text: t('toolDetails_thisSchemaUsesConstructsExplorer'),
      }));
      const area = el('textarea', {
        class: 'mono', rows: '10', id: 'raw-json',
        title: t('toolDetails_rawJsonHelp'), 'aria-label': t('toolDetails_rawJsonLabel'),
      });
      area.value = JSON.stringify(values, null, 2);
      host.append(area);
    }
    return host;
  }

  function read() {
    if (!host) return { values, errors: [] };
    if (mode === 'form') return readForm(host, model);
    try { return { values: JSON.parse(host.querySelector('#raw-json').value), errors: [] }; }
    catch { return { values: null, errors: [{ message: t('toolDetails_theJsonIsNotValid') }] }; }
  }

  return {
    model,
    get mode() { return mode; },
    element,
    read,
    initialValues: values,
    // Deliberate loads and replays replace the draft; merely looking at Schema does not.
    reset(next) { values = next; host = null; },
    toggle() {
      const draft = read();
      if (draft.errors.length) return draft.errors[0].message;
      values = draft.values;
      mode = mode === 'form' ? 'json' : 'form';
      host = null;
      return null;
    },
  };
}
