// Where a tool was registered — and, when that is not known, exactly why not.
//
// Source Finder never invents a location. There are only three things it can say: here is the
// file and line, captured at registration time; Instrumentation Mode was off so nothing was
// captured; or it was on and the stack pointed outside this page's own code. A guess dressed
// as an answer would send the developer to read the wrong file, which is worse than silence.
//
// The toggle lives here rather than in a settings screen, because this is the moment the user
// discovers they need it.

import { el, badge, t } from '../dom.js';
import { shortLocation, UNKNOWN_REASON } from '../../core/source.js';

export function renderToolSource(root, { tool, url, onChanged = () => {} }) {
  const source = tool.source ?? { known: false, unknownReason: 'not-instrumented' };
  const box = el('details', { class: 'src-bar' });
  const summary = el('summary', { text: t('toolSource_source'), title: t('help_source') });
  box.append(summary);

  if (source.known) {
    summary.textContent = t('toolSource_sourceDotLocation', [shortLocation(source)]);
    box.append(
      el('p', { class: 'card-name src-file', text: `${source.file}:${source.line}:${source.column}` }),
      source.function
        ? el('p', { class: 'field-desc', text: t('toolSource_in1', [String(source.function)]) })
        : null,
      el('div', { class: 'card-meta' }, [
        badge(t('toolSource_capturedAtRegistration'), 'ok',
          t('toolSource_recordedByInstrumentationModeWhen')),
        source.registrations > 1
          ? badge(t('toolSource_registeredTimes', [String(source.registrations)]), 'warn',
            t('toolSource_registeredTimesHelp'))
          : null,
      ]),
    );

    if (source.callers?.length) {
      const callers = el('details', { class: 'tree-raw' });
      callers.append(el('summary', { text: t('toolSource_calledFrom1More', [String(source.callers.length)]), title: t('help_callers') }));
      for (const caller of source.callers) {
        callers.append(el('p', {
          class: 'field-desc',
          text: `${caller.function ? `${caller.function} — ` : ''}${caller.file}:${caller.line}`,
        }));
      }
      box.append(callers);
    }
    root.append(box);
    return;
  }

  box.append(
    el('p', {
      class: 'field-desc',
      text: UNKNOWN_REASON[source.unknownReason] ?? t('toolSource_theSourceIsNotKnown'),
    }),
  );

  // Only the "it was never captured" case has an action attached to it. If the stack pointed
  // outside the page, turning instrumentation on again would change nothing, and offering the
  // button anyway would be a false promise.
  if (source.unknownReason === 'not-instrumented') {
    box.append(toggle(url, onChanged));
  }

  root.append(box);
}

function toggle(url, onChanged) {
  const status = el('p', { class: 'field-note', hidden: '' });
  const button = el('button', {
    text: t('toolSource_turnOnInstrumentationMode'),
    title: t('toolSource_explorerWillWrapRegistertoolOn'),
  });

  const wrap = el('div', {}, [
    el('p', {
      class: 'field-desc',
      text: t('toolSource_explorerCanRecordWhereEach'),
    }),
    el('div', { class: 'row-inline' }, [button]),
    status,
  ]);

  button.addEventListener('click', async () => {
    button.disabled = true;
    const state = await chrome.runtime.sendMessage({ type: 'instrument-state', url });
    const out = await chrome.runtime.sendMessage({
      type: 'instrument-set', url, on: !state?.on,
    });
    button.disabled = false;

    if (out?.error) {
      status.textContent = out.error;
      status.hidden = false;
      return;
    }
    // A registration that already happened cannot be captured after the fact, so saying "done"
    // without saying "reload" would leave the user staring at an unchanged screen.
    status.textContent = out.on
      ? t('toolSource_onForThisSiteReload')
      : t('toolSource_offForThisSiteReload');
    status.hidden = false;
    button.textContent = out.on
      ? t('toolSource_turnOffInstrumentationMode')
      : t('toolSource_turnOnInstrumentationMode');
    button.title = out.on ? t('help_instrumentOff') : t('toolSource_explorerWillWrapRegistertoolOn');
    onChanged(out.on);
  });

  // The button has to say the truth about the current state before it is pressed.
  chrome.runtime.sendMessage({ type: 'instrument-state', url }).then((state) => {
    if (!state?.on) return;
    button.textContent = t('toolSource_turnOffInstrumentationMode');
    button.title = t('help_instrumentOff');
    status.textContent = t('toolSource_onForThisSiteBut');
    status.hidden = false;
  }).catch(() => {});

  return wrap;
}
