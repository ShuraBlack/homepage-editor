// UI translations. German is the source language: t('Speichern') returns the German text itself unless the
// dictionary of the chosen language has an entry, so a missing translation never shows an empty label.
import { DICTS } from './i18n-dict.js';

export const LANGS = { de: 'Deutsch', en: 'English', fr: 'Français', it: 'Italiano' };
const KEY = 'hpe-lang'; // also read by login.html

/** Saved choice, else the browser language, else English. */
export const lang = (() => {
  const saved = localStorage.getItem(KEY);
  if (LANGS[saved]) return saved;
  const nav = (navigator.language || '').slice(0, 2).toLowerCase();
  return LANGS[nav] ? nav : 'en';
})();
document.documentElement.lang = lang;

/** Store the choice in the browser; a reload re-renders every label (many are built once at import). */
export function setLang(l) {
  localStorage.setItem(KEY, l);
  location.reload();
}

const dict = DICTS[lang] || {};

/** t('Verschoben nach {name}', { name }) */
export function t(s, vars) {
  const out = dict[s] ?? s;
  return vars ? out.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : out;
}

/** Server errors are German too; translate whole messages or the part before "details: …". */
export function tServer(msg) {
  if (dict[msg]) return dict[msg];
  const i = msg.indexOf(': ');
  return i > 0 && dict[msg.slice(0, i)] ? dict[msg.slice(0, i)] + msg.slice(i) : msg;
}
