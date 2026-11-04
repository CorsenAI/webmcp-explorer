// The rail icons, drawn rather than borrowed.
//
// They replace the placeholder glyphs (⛭ ≡ ◈), which were unreadable at rail size and, worse,
// looked alike: a rail whose icons cannot be told apart at a glance is a rail the user stops
// looking at. What matters at 18 px is silhouette, so the three are deliberately different
// shapes — rows, a line, a vessel — before they are different pictures.
//
// Stroke-based and drawn in currentColor, so the active state is a colour change and nothing
// else has to be maintained twice.

import { svg } from './dom.js';

const BOX = { viewBox: '0 0 24 24', width: '18', height: '18', 'aria-hidden': 'true' };
const STROKE = {
  fill: 'none',
  stroke: 'currentColor',
  'stroke-width': '1.6',
  'stroke-linecap': 'round',
  'stroke-linejoin': 'round',
};

// Tools: a list of named things. Each row is a marker and a label, which is exactly what a
// tool card is.
function toolsIcon() {
  const rows = [];
  for (const y of [7, 12, 17]) {
    rows.push(svg('circle', { cx: '5.2', cy: String(y), r: '1.4', fill: 'currentColor' }));
    rows.push(svg('path', { d: `M9.5 ${y} H19` }));
  }
  return svg('svg', BOX, [svg('g', STROKE, rows)]);
}

// Security: a shield with a check inside. The one closed, pointed outline on the rail, so it
// is told apart from the rows, the trace and the flask by silhouette alone.
function securityIcon() {
  return svg('svg', BOX, [
    svg('g', STROKE, [
      svg('path', { d: 'M12 3 L19 6 V11.5 C19 15.5 16 18.8 12 20.5 C8 18.8 5 15.5 5 11.5 V6 Z' }),
      svg('path', { d: 'M9 12 L11.2 14.2 L15.2 9.8' }),
    ]),
  ]);
}

// Timeline: a trace with one event in it. Reads as activity over time rather than as a list,
// which is the whole distinction between this section and the previous one.
function timelineIcon() {
  return svg('svg', BOX, [
    svg('g', STROKE, [svg('path', { d: 'M3 13 H7.6 L10 6.5 L13.6 17.5 L16 13 H21' })]),
  ]);
}

// Agent Lab: a flask. It is a lab, not a chat — the icon should not suggest a messaging app.
function agentIcon() {
  return svg('svg', BOX, [
    svg('g', STROKE, [
      svg('path', {
        d: 'M9.6 3.2 V9.4 L4.9 17.5 A1.7 1.7 0 0 0 6.4 20.2 H17.6'
          + ' A1.7 1.7 0 0 0 19.1 17.5 L14.4 9.4 V3.2',
      }),
      svg('path', { d: 'M8.2 3.2 H15.8' }),
      // The fill line: without it the flask reads as an empty triangle.
      svg('path', { d: 'M7.3 14.6 H16.7' }),
    ]),
  ]);
}

// Evals: a check inside a frame — a verdict on something, which is what a suite produces.
// Distinct from the flask at a glance because it is square where the flask is tapered.
function evalsIcon() {
  return svg('svg', BOX, [
    svg('g', STROKE, [
      svg('rect', { x: '3.8', y: '3.8', width: '16.4', height: '16.4', rx: '3' }),
      svg('path', { d: 'M8 12.2 L11 15.2 L16.2 8.8' }),
    ]),
  ]);
}

// Audit: a gauge — an open arc with a needle. It reads as "how good is this" without sharing
// a silhouette with anything else on the rail: no rows, no line, no closed box, no cog. The
// tick above the arc keeps it from being mistaken for a clock.
function auditIcon() {
  return svg('svg', BOX, [
    svg('g', STROKE, [
      svg('path', { d: 'M4.4 17.6 A8.6 8.6 0 1 1 19.6 17.6' }),
      svg('path', { d: 'M12 13.4 L16.1 8.9' }),
      svg('path', { d: 'M12 3.4 V5.6' }),
    ]),
    svg('circle', { cx: '12', cy: '13.9', r: '1.5', fill: 'currentColor' }),
  ]);
}

// Reset: the universal stop square, ringed. It must not look like the refresh arrow beside
// it, so it is built from a circle and a solid block rather than from a curve.
function resetIcon() {
  return svg('svg', BOX, [
    svg('g', STROKE, [svg('circle', { cx: '12', cy: '12', r: '8.4' })]),
    svg('rect', { x: '9', y: '9', width: '6', height: '6', rx: '1.2', fill: 'currentColor' }),
  ]);
}

// Settings: a cog — a ring with eight teeth. Round where every other rail icon is made of
// lines or a box, so it reads at a glance as the one that is not a section of the product.
function settingsIcon() {
  const teeth = [];
  for (let i = 0; i < 8; i += 1) {
    const angle = (Math.PI / 4) * i;
    const x1 = (12 + Math.cos(angle) * 6.6).toFixed(2);
    const y1 = (12 + Math.sin(angle) * 6.6).toFixed(2);
    const x2 = (12 + Math.cos(angle) * 9.4).toFixed(2);
    const y2 = (12 + Math.sin(angle) * 9.4).toFixed(2);
    teeth.push(svg('path', { d: `M${x1} ${y1} L${x2} ${y2}` }));
  }
  return svg('svg', BOX, [
    svg('g', STROKE, [
      svg('circle', { cx: '12', cy: '12', r: '6.6' }),
      svg('circle', { cx: '12', cy: '12', r: '2.4' }),
      ...teeth,
    ]),
  ]);
}

const ICONS = {
  tools: toolsIcon,
  timeline: timelineIcon,
  security: securityIcon,
  agent: agentIcon,
  evals: evalsIcon,
  audit: auditIcon,
  settings: settingsIcon,
  reset: resetIcon,
};

export function icon(name) {
  const draw = ICONS[name];
  // A missing icon must be visible as missing, not silently absent: an empty rail button is
  // a dead control the user learns to ignore.
  if (!draw) return svg('svg', BOX, [svg('g', STROKE, [svg('circle', { cx: '12', cy: '12', r: '7' })])]);
  return draw();
}

export const ICON_NAMES = Object.keys(ICONS);
