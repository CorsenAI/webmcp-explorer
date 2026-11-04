// Copy or save what Explorer observed, in a shape you can paste into a code review or read
// back from a script.
//
// It is collapsed by default. Export is something you reach for on purpose, and four buttons
// permanently above a result would compete with the result itself.
//
// The warning is not boilerplate: a trace holds whatever the page's tools returned, and the
// user is the only one who knows whether that is shareable. Explorer will not decide for them
// by quietly redacting, which would also make the report untrue.

import { el, t } from '../dom.js';

const TYPES = {
  markdown: { extension: 'md', mime: 'text/markdown' },
  json: { extension: 'json', mime: 'application/json' },
  sarif: { extension: 'sarif.json', mime: 'application/sarif+json' },
  // Scripts: a DevTools console snippet and a Playwright script (a reproduction, export/repro.js).
  console: { extension: 'js', mime: 'text/javascript' },
  playwright: { extension: 'spec.ts', mime: 'text/javascript' },
};

function kindLabel(kind) {
  if (kind === 'sarif') return 'SARIF 2.1.0';
  if (kind === 'json') return t('exportBar_json');
  if (kind === 'console') return t('exportBar_console');
  if (kind === 'playwright') return t('exportBar_playwright');
  return t('exportBar_markdown');
}

// A blob download works from an extension page without the downloads permission, and the
// object URL is released as soon as the click has been dispatched.
export function saveText(filename, text, kind) {
  const { extension, mime } = TYPES[kind];
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
  const link = el('a', { href: url, download: `${filename}.${extension}` });
  document.body.append(link);
  link.click();
  link.remove();
  // Not immediate: revoking before the browser has read the blob cancels the download.
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return { filename: link.download, url };
}

function textOf(report, kind) {
  if (kind === 'json') return `${JSON.stringify(report.json, null, 2)}\n`;
  if (kind === 'markdown') return report.markdown;
  return report[kind] ?? '';
}

// `build` is called at click time, never at render time: the run or the result may still be
// changing, and an export must be of what is on screen now.
export function exportBar({ build, label = t('exportBar_export'), note = null, kinds = ['markdown', 'json'], descriptions = {}, filenames = {} }) {
  const status = el('span', { class: 'field-note ex-status' });

  const row = (kind, description) => {
    const copy = el('button', {
      text: t('exportBar_copy'),
      title: t('exportBar_copyThe1ReportTo', [String(kind)]),
    });
    copy.addEventListener('click', async () => {
      const report = build();
      if (!report) return;
      await navigator.clipboard.writeText(textOf(report, kind));
      say(t('exportBar_copied', [kindLabel(kind)]));
    });

    const save = el('button', {
      text: t('exportBar_save'),
      title: t('exportBar_downloadThe1ReportAs', [String(kind)]),
    });
    save.addEventListener('click', () => {
      const report = build();
      if (!report) return;
      const saved = saveText(filenames[kind] ?? report.filename, textOf(report, kind), kind);
      say(t('exportBar_savedFile', [String(saved.filename)]));
    });

    return el('div', { class: 'row-inline ex-row' }, [
      el('span', { class: 'field-label ex-kind', text: kindLabel(kind) }),
      copy,
      save,
      el('span', { class: 'field-desc ex-desc', text: description }),
    ]);
  };

  let timer = null;
  function say(text) {
    status.textContent = text;
    clearTimeout(timer);
    timer = setTimeout(() => { status.textContent = ''; }, 2500);
  }

  const box = el('details', { class: 'ex-bar' });
  const DEFAULT_DESCRIPTIONS = {
    markdown: () => t('exportBar_forReview'),
    json: () => t('exportBar_forScript'),
    sarif: () => t('export_sarifHelp'),
    console: () => t('exportBar_forConsole'),
    playwright: () => t('exportBar_forPlaywright'),
  };
  box.append(
    el('summary', { text: label, title: t('help_export') }),
    ...kinds.map((kind) => row(kind, descriptions[kind] ?? DEFAULT_DESCRIPTIONS[kind]?.() ?? '')),
    el('p', {
      class: 'field-desc',
      text: note ?? t('exportBar_aReportContainsWhatThe'),
    }),
    status,
  );
  return box;
}
