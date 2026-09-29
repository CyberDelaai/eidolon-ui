(function (EIDOLON) {
  'use strict';
  const $ = EIDOLON.$;
  // ---- UI translations (the top-right language picker). Brand names, the menu
  // and the version stay as-is; everything else switches. Translatable DOM nodes
  // carry data-i18n / data-i18n-title attributes; applyLang rewrites them. ----
  const I18N = {
    en: { h_controls: '// CONTROLS', h_output: '// OUTPUT',
      hint_controls: 'Token controls will live here.',
      hint_output: 'Export settings will live here.',
      ph_title: 'NO TOKEN LOADED',
      ph_body: 'EIDOLON is compiling — the token workspace goes here.',
      b_export: 'EXPORT PNG',
      tag: 'TOKEN MAKER', tag_alt: 'SUMMON YOUR ECHO' },
    ru: { h_controls: '// УПРАВЛЕНИЕ', h_output: '// ВЫВОД',
      hint_controls: 'Здесь будут настройки токена.',
      hint_output: 'Здесь будут настройки экспорта.',
      ph_title: 'ТОКЕН НЕ ЗАГРУЖЕН',
      ph_body: 'EIDOLON в разработке — здесь будет рабочая область.',
      b_export: 'ЭКСПОРТ PNG',
      tag: 'СОЗДАНИЕ ТОКЕНОВ', tag_alt: 'ПРИЗОВИ СВОЁ ЭХО' },
    fr: { h_controls: '// COMMANDES', h_output: '// SORTIE',
      hint_controls: 'Les réglages du jeton seront ici.',
      hint_output: "Les réglages d'export seront ici.",
      ph_title: 'AUCUN JETON CHARGÉ',
      ph_body: "EIDOLON est en compilation — l'espace de travail arrive ici.",
      b_export: 'EXPORTER PNG',
      tag: 'CRÉATEUR DE JETONS', tag_alt: 'INVOQUE TON ÉCHO' },
    de: { h_controls: '// STEUERUNG', h_output: '// AUSGABE',
      hint_controls: 'Hier kommen die Token-Einstellungen hin.',
      hint_output: 'Hier kommen die Export-Einstellungen hin.',
      ph_title: 'KEIN TOKEN GELADEN',
      ph_body: 'EIDOLON wird kompiliert — hier entsteht der Token-Arbeitsbereich.',
      b_export: 'PNG EXPORTIEREN',
      tag: 'TOKEN-ERSTELLER', tag_alt: 'RUF DEIN ECHO' },
    es: { h_controls: '// CONTROLES', h_output: '// SALIDA',
      hint_controls: 'Aquí irán los ajustes del token.',
      hint_output: 'Aquí irán los ajustes de exportación.',
      ph_title: 'NINGÚN TOKEN CARGADO',
      ph_body: 'EIDOLON está compilando — aquí irá el área de trabajo.',
      b_export: 'EXPORTAR PNG',
      tag: 'CREADOR DE TOKENS', tag_alt: 'INVOCA TU ECO' },
    it: { h_controls: '// CONTROLLI', h_output: '// OUTPUT',
      hint_controls: 'Qui andranno le impostazioni del token.',
      hint_output: "Qui andranno le impostazioni d'esportazione.",
      ph_title: 'NESSUN TOKEN CARICATO',
      ph_body: "EIDOLON è in compilazione — qui ci sarà l'area di lavoro.",
      b_export: 'ESPORTA PNG',
      tag: 'CREATORE DI TOKEN', tag_alt: 'EVOCA IL TUO ECO' },
    ja: { h_controls: '// コントロール', h_output: '// 出力',
      hint_controls: 'ここにトークン設定が入ります。',
      hint_output: 'ここにエクスポート設定が入ります。',
      ph_title: 'トークン未読み込み',
      ph_body: 'EIDOLON はコンパイル中 — ここに作業エリアが入ります。',
      b_export: 'PNG書き出し',
      tag: 'トークンメーカー', tag_alt: '残響を呼べ' },
    zh: { h_controls: '// 控制', h_output: '// 输出',
      hint_controls: '令牌设置将在此处。',
      hint_output: '导出设置将在此处。',
      ph_title: '未加载令牌',
      ph_body: 'EIDOLON 编译中 — 此处将是令牌工作区。',
      b_export: '导出 PNG',
      tag: '令牌制作器', tag_alt: '召唤你的回响' },
  };
  let lang = 'en';

  // Translate a key in the current language, falling back to English.
  EIDOLON.t = (key) => (I18N[lang] && I18N[lang][key]) || I18N.en[key] || key;

  // Rewrite every data-i18n / data-i18n-title node for the chosen language.
  EIDOLON.applyLang = function applyLang(code) {
    lang = I18N[code] ? code : 'en';
    EIDOLON.state.lang = lang;
    EIDOLON.save('eidolon:lang', lang);
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const v = EIDOLON.t(el.getAttribute('data-i18n'));
      if (v) el.textContent = v;
    });
    document.querySelectorAll('[data-i18n-title]').forEach((el) => {
      const v = EIDOLON.t(el.getAttribute('data-i18n-title'));
      if (v) el.setAttribute('title', v);
    });
    document.documentElement.lang = lang;
  };

  // Wire the picker + restore the saved language on load.
  document.addEventListener('DOMContentLoaded', () => {
    const sel = $('uiLangSel');
    const saved = (() => { try { return localStorage.getItem('eidolon:lang'); } catch (e) { return null; } })();
    const start = saved && I18N[saved] ? saved : 'en';
    if (sel) {
      sel.value = start;
      sel.addEventListener('change', () => EIDOLON.applyLang(sel.value));
    }
    EIDOLON.applyLang(start);
  });
})(window.EIDOLON);
