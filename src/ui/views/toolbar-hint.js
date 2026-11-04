// A drawing of the top-right corner of the Chrome toolbar, with the extensions button
// circled and an arrow pointing at it.
//
// Why a drawing and not a sentence: a freshly installed extension is NOT pinned, so the
// words "click the Explorer icon" name an icon that is not on screen. The user then hunts
// through a toolbar of unlabelled glyphs. Found the hard way during manual acceptance —
// the tester could not identify which icon was meant (D-032).
//
// Every shape here is drawn by hand rather than lifted from an icon set: the piece only has
// to be recognisable at 22 px, not pixel-accurate.

import { el, svg, t } from '../dom.js';

// One glyph box is 22 x 22; each is translated so that box is centred on its slot.
const GLYPH = 22;

const SLOTS = { extensions: 148, sidePanel: 184, profile: 220 };
const ICON_Y = 26;

function glyph(cx, cy, child) {
  return svg('g', { transform: `translate(${cx - GLYPH / 2} ${cy - GLYPH / 2})` }, [child]);
}

// Square body, a knob on the top edge and a socket on the right edge — the two features
// that make a shape read as "jigsaw piece" even when it is tiny.
function puzzlePiece() {
  return svg('path', {
    d: 'M6 5 H7.5 C7.5 1.6 12.5 1.6 12.5 5 H16 Q18 5 18 7 V9.5'
      + ' C14.6 9.5 14.6 14.5 18 14.5 V17 Q18 19 16 19 H6 Q4 19 4 17 V7 Q4 5 6 5 Z',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '1.6',
    'stroke-linejoin': 'round',
  });
}

function sidePanelIcon() {
  return svg('g', { fill: 'none', stroke: 'currentColor', 'stroke-width': '1.6' }, [
    svg('rect', { x: '4', y: '5', width: '14', height: '14', rx: '2.5' }),
    svg('path', { d: 'M13 5 V19' }),
  ]);
}

function profileIcon() {
  return svg('circle', {
    cx: '11', cy: '11', r: '7', fill: 'currentColor', opacity: '0.35',
  });
}

// The pointer is deliberately blunt: a straight line and a chevron. An animated or curved
// arrow would draw attention to itself instead of to the button.
function pointer(x) {
  return svg('g', {
    stroke: 'var(--accent)', 'stroke-width': '2',
    'stroke-linecap': 'round', 'stroke-linejoin': 'round', fill: 'none',
  }, [
    svg('path', { d: `M${x} 78 V50` }),
    svg('path', { d: `M${x - 5} 55 L${x} 49 L${x + 5} 55` }),
  ]);
}

export function toolbarHint() {
  const label = t('needActionHintAlt');

  return svg('svg', {
    class: 'toolbar-hint',
    viewBox: '0 0 264 84',
    role: 'img',
    'aria-label': label,
  }, [
    svg('title', { text: label }),

    // The toolbar strip and a stand-in for the address bar, so the drawing is recognisable
    // as "the top of your browser" rather than as three loose icons.
    svg('rect', {
      x: '8', y: '8', width: '248', height: '36', rx: '10',
      fill: 'var(--bg-subtle)', stroke: 'var(--border)',
    }),
    svg('rect', {
      x: '18', y: '17', width: '104', height: '18', rx: '9',
      fill: 'var(--bg)', stroke: 'var(--border)',
    }),
    svg('path', {
      d: 'M30 26 H96', stroke: 'var(--text-muted)', 'stroke-width': '2',
      'stroke-linecap': 'round', opacity: '0.35',
    }),

    // The button we are talking about, ringed.
    svg('circle', {
      cx: String(SLOTS.extensions), cy: String(ICON_Y), r: '15',
      fill: 'var(--accent-bg)', stroke: 'var(--accent)', 'stroke-width': '1.5',
    }),

    svg('g', { fill: 'none', stroke: 'none', color: 'var(--accent)' }, [
      glyph(SLOTS.extensions, ICON_Y, puzzlePiece()),
    ]),
    svg('g', { color: 'var(--text-muted)' }, [
      glyph(SLOTS.sidePanel, ICON_Y, sidePanelIcon()),
      glyph(SLOTS.profile, ICON_Y, profileIcon()),
    ]),

    pointer(SLOTS.extensions),
  ]);
}

export function toolbarHintFigure() {
  return el('figure', { class: 'hint-figure' }, [
    toolbarHint(),
    el('figcaption', { class: 'field-desc', text: t('needActionHintCaption') }),
  ]);
}
