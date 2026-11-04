// The Audit screen: the quality of the toolset a page declares, tool by tool (F7/D-108).
//
// Where the page checks are pass/fail facts about one tool, the audit is the page-wide view:
// one score, the worst tools first, each finding pointing at the fact that caused it. It
// reports contract quality — what a calling model can act on — never safety (D-004 rule 10,
// D-108 boundary): the words "score" here always mean the declared-quality score.
//
// Pure derivation: the engine runs over the discovery result already on screen, so the screen
// works with no provider, no key and no network, exactly like manual discovery itself.

import { el, badge, t } from '../dom.js';
import { auditToolset } from '../../core/audit.js';
import { exportBar } from '../components/export-bar.js';
import { helpIntro } from '../components/help.js';

function scoreBadge(score) {
  const kind = score >= 80 ? 'ok' : score >= 50 ? 'warn' : 'danger';
  return badge(t('audit_scoreN', [String(score)]), kind, t('audit_scoreHelp'));
}

function auditMarkdown(result, topOrigin) {
  const lines = [
    `# WebMCP toolset audit — ${topOrigin ?? 'page'}`,
    '',
    `Declared-quality score: **${result.overall}/100** `
      + `(${result.counts.pass} pass, ${result.counts.warn} with findings, ${result.counts.fail} failing).`,
    '',
    'This is a report on the contract each tool declares (descriptions, schemas, annotations)',
    '— not a security verdict. Facts below; the judgement of what to fix stays with the reader.',
    '',
  ];
  for (const tool of [...result.perTool].sort((a, b) => a.score - b.score)) {
    lines.push(`## ${tool.tool} — ${tool.score}/100`);
    if (tool.annotated) lines.push(`- declares annotations`);
    if (!tool.findings.length) {
      lines.push(`- no contract findings`);
    }
    for (const f of tool.findings) lines.push(`- **${f.rule}** (−${f.points}): ${f.message}`);
    lines.push('');
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

export function renderAudit(root, { tools, topOrigin, onOpenTool = null }) {
  const result = auditToolset(tools, { translate: t });

  const head = el('div', { class: 'au-head' }, [
    scoreBadge(result.overall),
    el('div', { class: 'au-counts' }, [
      badge(t('audit_passN', [String(result.counts.pass)]), 'ok'),
      badge(t('audit_warnN', [String(result.counts.warn)]), 'warn'),
      badge(t('audit_failN', [String(result.counts.fail)]), 'danger'),
    ]),
  ]);

  const summary = el('p', { class: 'field-desc', text: t('audit_intro') });

  // The view REPLACES its root, like every other screen here (tools.js, evals.js). Appending
  // would stack the audit under whatever the previous section left behind — measured in a real
  // capture, where a half-cut Tools element stayed above the score.
  const nodes = [head, summary];

  if (!result.perTool.length) {
    nodes.push(el('p', { class: 'muted', text: t('audit_noTools') }), helpIntro());
    root.replaceChildren(...nodes);
    return result;
  }

  const list = el('div', { class: 'au-list' });
  // Worst first: the screen exists to say what to look at.
  for (const tool of [...result.perTool].sort((a, b) => a.score - b.score)) {
    const box = el('details', { class: 'au-tool' });
    box.append(el('summary', { class: 'au-tool-head', title: t('audit_scoreHelp') }, [
      scoreBadge(tool.score),
      el('span', { class: 'au-name mono', text: tool.tool }),
    ]));
    if (!tool.findings.length) {
      box.append(el('p', { class: 'au-clean', text: t('audit_clean') }));
    }
    for (const f of tool.findings) {
      box.append(el('div', { class: 'au-item' }, [
        badge(`−${f.points}`, f.points >= 8 ? 'danger' : 'warn', t('audit_pointsHelp')),
        el('span', { class: 'au-text', text: f.message }),
      ]));
    }
    if (typeof onOpenTool === 'function') {
      const openBtn = el('button', {
        class: 'link-button au-open-tool',
        type: 'button',
        text: t('security_openTool'),
        title: t('security_openToolHelp'),
      });
      openBtn.addEventListener('click', () => onOpenTool(tool));
      box.append(el('div', { class: 'row-inline' }, [openBtn]));
    }
    list.append(box);
  }
  nodes.push(list);

  nodes.push(exportBar({
    label: t('audit_export'),
    note: t('audit_exportNote'),
    kinds: ['markdown', 'json'],
    descriptions: {
      markdown: t('audit_exportMarkdownHelp'),
      json: t('audit_exportJsonHelp'),
    },
    filenames: { markdown: 'webmcp-audit', json: 'webmcp-audit' },
    build: () => ({
      filename: `webmcp-audit_${topOrigin ?? 'page'}`,
      markdown: auditMarkdown(result, topOrigin),
      json: { topOrigin, ...result },
    }),
  }));

  root.replaceChildren(...nodes);
  return result;
}
