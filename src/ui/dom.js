// Every string rendered by Explorer may come from the inspected page, which is untrusted.
// Nothing here uses innerHTML (D-019).

export const UI_LANGUAGES = [
  { code: 'auto', labelKey: 'settings_languageAuto', dir: 'ltr' },
  { code: 'en', label: 'English', dir: 'ltr' },
  { code: 'fr', label: 'Français', dir: 'ltr' },
  { code: 'es', label: 'Español', dir: 'ltr' },
  { code: 'de', label: 'Deutsch', dir: 'ltr' },
  { code: 'ja', label: '日本語', dir: 'ltr' },
  { code: 'zh_CN', label: '简体中文', dir: 'ltr' },
  { code: 'he', label: 'עברית', dir: 'rtl' },
  { code: 'ar', label: 'العربية', dir: 'rtl' },
];

const UI_LANG_CODES = new Set(UI_LANGUAGES.map((l) => l.code));
const RTL_CODES = new Set(['he', 'iw', 'ar']);

let currentUiLanguage = 'auto';
let activeDict = null;
const dictCache = new Map();

function formatMessage(raw, subs) {
  if (typeof raw !== 'string') return '';
  const list = Array.isArray(subs) ? subs : (subs !== undefined && subs !== null ? [subs] : []);
  return raw.replace(/\$([1-9]|\$)/g, (_m, tok) => {
    if (tok === '$') return '$';
    const idx = Number(tok) - 1;
    return idx < list.length && list[idx] !== undefined && list[idx] !== null ? String(list[idx]) : '';
  });
}

export const t = (key, subs) => {
  if (activeDict && Object.prototype.hasOwnProperty.call(activeDict, key)) {
    const raw = activeDict[key]?.message;
    if (typeof raw === 'string' && raw.length > 0) return formatMessage(raw, subs);
  }
  return globalThis.chrome?.i18n?.getMessage?.(key, subs) || key;
};

globalThis.__WEBMCP_TRANSLATE__ = t;

export function getUiLanguage() {
  return currentUiLanguage;
}

export function isRtlLanguage(code) {
  const base = String(code || '').toLowerCase().split(/[-_]/)[0];
  return RTL_CODES.has(base);
}

function applyDocumentDirection(code) {
  const docEl = globalThis.document?.documentElement;
  if (!docEl || typeof docEl.setAttribute !== 'function') return;
  const effective = code === 'auto'
    ? (globalThis.chrome?.i18n?.getUILanguage?.() || globalThis.navigator?.language || 'en')
    : code;
  const htmlLang = String(effective).replace('_', '-');
  const dir = isRtlLanguage(effective) ? 'rtl' : 'ltr';
  docEl.lang = htmlLang;
  docEl.dir = dir;
  docEl.setAttribute('lang', htmlLang);
  docEl.setAttribute('dir', dir);
}

async function loadLocaleDict(code) {
  if (dictCache.has(code)) return dictCache.get(code);
  if (typeof globalThis.__WEBMCP_LOCALE_LOADER__ === 'function') {
    const data = await globalThis.__WEBMCP_LOCALE_LOADER__(code);
    if (data && typeof data === 'object') dictCache.set(code, data);
    return data ?? null;
  }
  const getURL = globalThis.chrome?.runtime?.getURL;
  if (typeof getURL !== 'function' || typeof globalThis.fetch !== 'function') return null;
  try {
    const res = await fetch(getURL(`_locales/${code}/messages.json`));
    if (!res.ok) return null;
    const data = await res.json();
    if (data && typeof data === 'object') dictCache.set(code, data);
    return data ?? null;
  } catch {
    return null;
  }
}

export async function setUiLanguage(code, { persist = true } = {}) {
  const next = UI_LANG_CODES.has(code) ? code : 'auto';
  currentUiLanguage = next;
  if (next === 'auto') {
    activeDict = null;
  } else {
    activeDict = await loadLocaleDict(next);
  }
  applyDocumentDirection(next);
  if (persist) {
    try {
      await globalThis.chrome?.storage?.local?.set?.({ uiLanguage: next });
    } catch {
      // Ignore storage errors in bare test contexts.
    }
  }
  return currentUiLanguage;
}

export async function initUiLanguage() {
  let code = 'auto';
  try {
    const stored = await globalThis.chrome?.storage?.local?.get?.('uiLanguage');
    if (stored && typeof stored.uiLanguage === 'string' && UI_LANG_CODES.has(stored.uiLanguage)) {
      code = stored.uiLanguage;
    }
  } catch {
    // Ignore in bare test contexts.
  }
  return setUiLanguage(code, { persist: false });
}

export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else node.setAttribute(key, value);
  }
  for (const child of [].concat(children)) {
    if (child) node.append(child);
  }
  return node;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

// SVG needs its own namespace, and `class` must go through setAttribute: on an SVG element
// `className` is a read-only SVGAnimatedString, so the plain el() above would silently drop
// it. Same no-innerHTML rule applies.
export function svg(tag, props = {}, children = []) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null) continue;
    if (key === 'text') node.textContent = value;
    else node.setAttribute(key, value);
  }
  for (const child of [].concat(children)) {
    if (child) node.append(child);
  }
  return node;
}

export function badge(text, kind, title) {
  return el('span', { class: `badge badge-${kind}`, text, title });
}

export function row(table, label, value, title) {
  table.append(el('tr', {}, [
    el('th', { text: label, title }),
    el('td', { text: value }),
  ]));
}
