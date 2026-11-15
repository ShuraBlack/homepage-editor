// Settings of the editor itself (stored in the state file on the server, not in Homepage's config).
// The UI language is the exception: it lives in the browser (localStorage), see i18n.js.
import { html, useState, useEffect, api, meta, toast, confirmDlg, Field, useSaveKey, I, applyAccent, prefs, setPref, t } from '../lib.js';
import { LANGS, lang, setLang } from '../i18n.js';
import { checkUpdate, cachedUpdate, isNewer, REPO } from '../update.js';

const UPDATE_CMDS = [
  [t('Aus dem Quellcode gebaut'), 'git -C editor pull && docker compose up -d --build homepage-editor'],
  [t('Fertiges Image (ghcr.io)'), 'docker compose pull homepage-editor && docker compose up -d homepage-editor'],
];

const FIELDS = [
  { k: 'homepageUrl', label: t('Homepage-URL'), placeholder: 'http://192.168.1.10:3000',
    hint: t('Für „Homepage öffnen“ und die Vorschau von Bildern mit /-Pfad. Leer = kein Link.') },
  { k: 'iconsUrl', label: t('Icons-URL'), placeholder: '/images/icons', hint: t('Pfad, unter dem Homepage den Icons-Ordner ausliefert.') },
  { k: 'backgroundsUrl', label: t('Hintergründe-URL'), placeholder: '/images',
    hint: t('Pfad, unter dem Homepage den Hintergrund-Ordner ausliefert. Liegt die Icons-URL darunter, ist der Icons-Ordner bei den Hintergründen gesperrt.') },
];
const DEFAULT_ACCENT = '#f5a524';
// per-browser preferences (lib.js `prefs`): they apply at once, like the language
const PREF_FIELDS = [
  { k: 'theme', label: t('Farbschema'), options: [['dark', t('Dunkel')], ['light', t('Hell')], ['system', t('Wie das System')]] },
  { k: 'density', label: t('Dichte'), options: [['normal', t('Normal')], ['compact', t('Kompakt')]] },
  { k: 'start', label: t('Startseite'), options: [['services', t('Services')], ['widgets', t('Info-Widgets')], ['bookmarks', t('Bookmarks')],
    ['settings', t('Einstellungen')], ['proxmox', 'Proxmox'], ['docker', 'Docker'], ['files', t('Alle Dateien')]] },
  { k: 'afterSave', label: t('Nach dem Speichern'), options: [['', t('nichts weiter')], ['open', t('Homepage öffnen bzw. neu laden')]],
    hint: () => (meta.homepageUrl ? t('Nutzt einen eigenen Tab, der bei jedem Speichern neu geladen wird.') : t('Braucht die Homepage-URL unten.')) },
];
const PRESETS = ['#f5a524', '#ef6c4a', '#e5484d', '#e93d82', '#8e4ec6', '#6e56cf', '#3e63dd', '#0090ff', '#12a594', '#30a46c', '#7bc043'];
const pick = (m) => ({ ...Object.fromEntries(FIELDS.map((f) => [f.k, m[f.k] || ''])), accent: m.accent || '' });

export function EditorSettings() {
  const [v, setV] = useState(() => pick(meta));
  const [, setTick] = useState(0);
  const pref = (k, val) => { setPref(k, val); setTick((n) => n + 1); };
  const [upd, setUpd] = useState(cachedUpdate);
  const [checking, setChecking] = useState(false);
  const checkNow = async () => { setChecking(true); setUpd(await checkUpdate(true)); setChecking(false); };
  const refresh = async () => { Object.assign(meta, await api.meta()); setV(pick(meta)); applyAccent(meta.accent); setTick((n) => n + 1); };
  const run = (fn, ok) => async () => { try { await fn(); await refresh(); if (ok) toast(ok); } catch (e) { toast(e.message, 'err'); } };

  // the colour is previewed live; leaving without saving restores the saved one
  useEffect(() => () => applyAccent(meta.accent), []);
  const setAccent = (c) => { setV((x) => ({ ...x, accent: c })); applyAccent(c); };

  const save = run(() => api.saveSettings(v), t('Einstellungen gespeichert'));
  const reset = run(async () => {
    if (await confirmDlg(t('Auf Standard zurücksetzen?'), t('Es gelten wieder die Werte aus den Umgebungsvariablen der docker-compose.yml und die Standard-Akzentfarbe.'), t('Zurücksetzen'), true)) await api.resetSettings();
  }, null);
  const revoke = run(async () => {
    if (await confirmDlg(t('Alle anderen Sitzungen abmelden?'), t('Andere Browser und Geräte müssen sich neu anmelden. Diese Sitzung bleibt aktiv.'), t('Abmelden'), true)) await api.revokeSessions();
  }, null);
  useSaveKey(save);
  const accent = v.accent || DEFAULT_ACCENT;

  return html`<div class="view">
    <header class="view-head">
      <div><h1>${t('Editor-Einstellungen')}</h1><div class="muted small">${meta.custom ? t('Eigene Werte aktiv') : t('Standardwerte aus der docker-compose.yml')}</div></div>
      <div class="actions">
        ${meta.custom && html`<button class="btn" onClick=${reset}><${I} n="rotate-ccw" /> ${t('Auf Standard zurücksetzen')}</button>`}
        <button class="btn primary" onClick=${save}><${I} n="save" /> ${t('Speichern')}</button>
      </div>
    </header>
    <div class="stack">
      <section class="card"><header class="card-head"><h2>${t('Darstellung')}</h2></header>
        <div class="card-body">
          <div class="field"><label for="es-lang">${t('Sprache')}</label>
            <select id="es-lang" class="inp lang-pick" value=${lang} onChange=${(e) => setLang(e.target.value)}>
              ${Object.entries(LANGS).map(([k, name]) => html`<option value=${k}>${name}</option>`)}
            </select>
            <small class="muted">${t('Wird nur in diesem Browser gespeichert und gilt sofort.')}</small>
          </div>
          <div class="field"><label for="es-accent">${t('Akzentfarbe')}</label>
            <div class="accent-row">
              <input id="es-accent" type="color" class="accent-pick" value=${accent} onInput=${(e) => setAccent(e.target.value)} />
              <code>${accent}</code>
              <span class="accent-presets" role="group" aria-label=${t('Vorschläge')}>
                ${PRESETS.map((c) => html`<button type="button" class=${'swatch' + (c === accent ? ' on' : '')} style=${`background:${c}`}
                  title=${c} aria-label=${t('Akzentfarbe {c}', { c })} aria-pressed=${c === accent} onClick=${() => setAccent(c === DEFAULT_ACCENT ? '' : c)}></button>`)}
              </span>
            </div>
            <small class="muted">${t('Vorschau sofort, gespeichert erst mit „Speichern“. Gilt auch für die Anmeldeseite.')}</small>
          </div>
          <div class="fields">
            ${PREF_FIELDS.map((f) => html`<div class="field" key=${f.k}><label for=${'es-' + f.k}>${f.label}</label>
              <select id=${'es-' + f.k} class="inp" value=${prefs[f.k] ?? f.options[0][0]} onChange=${(e) => pref(f.k, e.target.value)}>
                ${f.options.map(([v, l]) => html`<option value=${v}>${l}</option>`)}
              </select>
              ${f.hint && html`<small class="muted">${f.hint()}</small>`}</div>`)}
          </div>
          <small class="muted">${t('Sprache, Farbschema, Dichte, Startseite und „Nach dem Speichern“ gelten nur in diesem Browser und sofort.')}</small>
        </div>
      </section>
      <section class="card"><header class="card-head"><h2>${t('Pfade & Links')}</h2></header>
        <div class="card-body"><div class="fields">
          ${FIELDS.map((f) => html`<${Field} key=${f.k} f=${{ ...f, wide: true, placeholder: meta.defaults?.[f.k] || f.placeholder }}
            value=${v[f.k]} onValue=${(x) => setV({ ...v, [f.k]: x })} />`)}
        </div></div>
      </section>
      <section class="card"><header class="card-head"><h2>${t('Sitzungen')}</h2></header>
        <div class="card-body">
          ${meta.stateError && html`<div class="alert">${t('Die Status-Datei kann nicht geschrieben werden – Anmeldungen überleben keinen Neustart: {err}', { err: meta.stateError })}</div>`}
          <p class="muted">${t('{n} aktive Sitzung(en). Eine Anmeldung bleibt {days} Tage gültig, auch über Neustarts – sofern {file} auf einem Volume liegt (z. B. ./editor-data:/data/state). Sonst ist sie nach jedem docker compose up --build weg.',
            { n: meta.sessions, days: meta.sessionDays, file: meta.stateFile })}</p>
          <div><button class="btn" onClick=${revoke}><${I} n="log-out" /> ${t('Alle anderen abmelden')}</button></div>
        </div>
      </section>
      <section class="card"><header class="card-head"><h2>${t('Version & Updates')}</h2>
        <span class="muted small">${t('Installiert: v{v}', { v: meta.version })}</span></header>
        <div class="card-body">
          <div class="field"><label for="es-updates">${t('Nach Updates suchen')}</label>
            <select id="es-updates" class="inp lang-pick" value=${prefs.updates === 'on' ? 'on' : ''} onChange=${(e) => { pref('updates', e.target.value); if (e.target.value) checkNow(); }}>
              <option value="">${t('aus')}</option><option value="on">${t('einmal täglich bei GitHub')}</option>
            </select>
            <small class="muted">${t('Fragt die neueste Version bei GitHub ab ({repo}). GitHub sieht dabei die IP-Adresse dieses Browsers. Gilt nur in diesem Browser.', { repo: REPO })}</small>
          </div>
          <div class="accent-row">
            <button class="btn" disabled=${checking} onClick=${checkNow}><${I} n="rotate-ccw" /> ${t('Jetzt prüfen')}</button>
            <span class="muted small">${checking ? t('Prüfe…')
              : !upd ? t('Noch nicht geprüft.')
              : upd.error ? t('Prüfung fehlgeschlagen: {msg}', { msg: upd.error })
              : !upd.latest ? t('Noch kein Release veröffentlicht.')
              : isNewer(upd.latest, meta.version) ? html`${t('Neue Version {v} verfügbar.', { v: upd.latest })} <a href=${upd.url} target="_blank" rel="noopener">${t('Release-Notes')} ↗</a>`
              : t('Aktuell (neueste Version: {v}).', { v: upd.latest })}</span>
          </div>
          <h4>${t('Aktualisieren')}</h4>
          ${UPDATE_CMDS.map(([label, cmd]) => html`<div class="field"><label>${label}</label><code class="cmd">${cmd}</code></div>`)}
        </div>
      </section>
    </div>
  </div>`;
}
