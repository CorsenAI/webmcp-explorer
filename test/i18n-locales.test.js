import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { UI_LANGUAGES, t, setUiLanguage, getUiLanguage, initUiLanguage, isRtlLanguage } from '../src/ui/dom.js';
import { auditToolset } from '../src/core/audit.js';

const LOCALE_CODES = ['en', 'fr', 'es', 'de', 'ja', 'zh_CN', 'he', 'ar'];

function readLocale(code) {
  return JSON.parse(readFileSync(new URL(`../src/_locales/${code}/messages.json`, import.meta.url), 'utf8'));
}

test('all 8 locales exist, have 100% key parity with en, and preserve positional placeholders', () => {
  const en = readLocale('en');
  const enKeys = Object.keys(en).sort();
  assert.ok(enKeys.length >= 1450);

  const phOf = (s) => (String(s ?? '').match(/\$[1-9]/g) ?? []).sort().join(',');

  for (const code of LOCALE_CODES) {
    const dict = readLocale(code);
    assert.deepEqual(Object.keys(dict).sort(), enKeys, `key mismatch in locale ${code}`);
    for (const key of enKeys) {
      const msg = dict[key]?.message;
      assert.equal(typeof msg, 'string', `${code}.${key} must be a string`);
      assert.ok(msg.trim().length > 0, `${code}.${key} must not be empty`);
      assert.equal(/(?<!\$)\$(?!\$|\d)/.test(msg), false, `${code}.${key} has unescaped $`);
      assert.equal(phOf(msg), phOf(en[key].message), `${code}.${key} placeholder mismatch`);
    }
    if (code !== 'en') {
      // Every prose sentence (> 25 chars) must be translated, never left as English fallback.
      const untranslatedProse = enKeys.filter(
        (k) => en[k].message.length > 25 && dict[k].message === en[k].message && k !== 'settings_version'
      );
      assert.deepEqual(
        untranslatedProse,
        [],
        `Locale ${code} has untranslated English prose keys: ${untranslatedProse.join(', ')}`
      );

      // Guard against partially-substituted hybrid strings containing 2+ English stopwords.
      const hybridKeys = enKeys.filter((k) => {
        const stripped = dict[k].message
          .replace(/https?:\/\/\S+/g, '')
          .replace(/chrome:\/\/\S+/g, '')
          .replace(/\$\d+/g, '');
        const stop = stripped.match(
          /\b(the|and|for|with|from|that|this|your|you|have|has|not|are|were|will|can|cannot|when|where|which|while|before|after|into|only|also|never|always|every|each|between|without|through|because|should|would|could)\b/gi
        ) ?? [];
        return stop.length >= 2;
      });
      assert.deepEqual(
        hybridKeys,
        [],
        `Locale ${code} has partially-translated hybrid English keys: ${hybridKeys.join(', ')}`
      );
    }
  }
});

test('setUiLanguage switches t() and auditToolset() output across LTR (fr) and RTL (he, ar) languages', async () => {
  const docEl = {
    lang: 'en',
    dir: 'ltr',
    attrs: {},
    setAttribute(k, v) { this.attrs[k] = v; },
  };
  const prevDoc = globalThis.document;
  const prevLoader = globalThis.__WEBMCP_LOCALE_LOADER__;
  const stored = {};
  const prevChrome = globalThis.chrome;

  globalThis.document = { documentElement: docEl };
  globalThis.__WEBMCP_LOCALE_LOADER__ = async (code) => readLocale(code);
  globalThis.chrome = {
    i18n: {
      getUILanguage: () => 'en-US',
      getMessage: (k) => readLocale('en')[k]?.message || k,
    },
    storage: {
      local: {
        get: async (k) => ({ [k]: stored[k] }),
        set: async (obj) => Object.assign(stored, obj),
      },
    },
  };

  try {
    assert.equal(UI_LANGUAGES.length, 9);
    assert.equal(isRtlLanguage('he'), true);
    assert.equal(isRtlLanguage('ar'), true);
    assert.equal(isRtlLanguage('zh_CN'), false);
    assert.equal(isRtlLanguage('fr'), false);

    const sampleTools = [{
      name: 'bare_tool',
      description: '',
      inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
    }];

    await setUiLanguage('fr');
    assert.equal(getUiLanguage(), 'fr');
    assert.equal(docEl.dir, 'ltr');
    assert.equal(docEl.lang, 'fr');
    assert.equal(t('toolsHeading'), 'Outils');
    assert.equal(t('tools_countAll', ['5']), '5 outils');
    const frAudit = auditToolset(sampleTools);
    const frMissing = frAudit.perTool[0].findings.find((f) => f.rule === 'desc-missing');
    const frParam = frAudit.perTool[0].findings.find((f) => f.rule === 'param-missing-desc');
    assert.equal(frMissing.message, t('audit_rule_descMissing'));
    assert.match(frMissing.message, /Aucune description/);
    assert.equal(frParam.message, t('audit_rule_paramMissingDesc', ['1', '1']));

    await setUiLanguage('zh_CN');
    assert.equal(docEl.dir, 'ltr');
    assert.equal(docEl.lang, 'zh-CN');
    assert.equal(t('toolsHeading'), '工具');
    assert.equal(t('sidepanel_agentLab'), '代理实验室');

    await setUiLanguage('he');
    assert.equal(docEl.dir, 'rtl');
    assert.equal(docEl.lang, 'he');
    assert.equal(t('toolsHeading'), 'כלים');
    const heAudit = auditToolset(sampleTools);
    const heMissing = heAudit.perTool[0].findings.find((f) => f.rule === 'desc-missing');
    const heParam = heAudit.perTool[0].findings.find((f) => f.rule === 'param-missing-desc');
    assert.equal(heMissing.message, t('audit_rule_descMissing'));
    assert.match(heMissing.message, /חסר תיאור/);
    assert.equal(heParam.message, t('audit_rule_paramMissingDesc', ['1', '1']));

    await setUiLanguage('ar');
    assert.equal(docEl.dir, 'rtl');
    assert.equal(docEl.lang, 'ar');
    assert.equal(t('toolsHeading'), 'الأدوات');
    assert.equal(stored.uiLanguage, 'ar');

    // initUiLanguage restores from storage
    await setUiLanguage('en', { persist: false });
    assert.equal(docEl.dir, 'ltr');
    await initUiLanguage();
    assert.equal(getUiLanguage(), 'ar');
    assert.equal(docEl.dir, 'rtl');

    await setUiLanguage('auto');
    assert.equal(getUiLanguage(), 'auto');
    assert.equal(docEl.dir, 'ltr');
    assert.equal(t('toolsHeading'), 'Tools');
  } finally {
    globalThis.document = prevDoc;
    globalThis.__WEBMCP_LOCALE_LOADER__ = prevLoader;
    globalThis.chrome = prevChrome;
  }
});
