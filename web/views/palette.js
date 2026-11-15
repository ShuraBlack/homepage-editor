// Quick search (Ctrl+K): pages, services from services.yaml and the files in config/.
import { html, useState, useEffect, api, YAML, go, I, Dlg, t } from '../lib.js';
import { searchServices } from './services.js';
import { VISUAL } from './files.js';

/** Services of a parsed services.yaml (plain JS) as palette entries; groups are walked, their path is the hint. */
function serviceEntries(list, path = [], out = []) {
  for (const it of Array.isArray(list) ? list : []) {
    const [name, v] = (it && typeof it === 'object' && Object.entries(it)[0]) || [];
    if (name == null) continue;
    if (Array.isArray(v) || (v == null && !path.length)) serviceEntries(v, [...path, name], out);
    else out.push({ label: name, hint: path.join(' › '), icon: 'layout-grid', run: async () => {
      await go('#/services');
      if (location.hash === '#/services') searchServices(name); // not when leaving was cancelled
    } });
  }
  return out;
}

/** `pages`: [[hash, label, icon]] from the sidebar. */
export function Palette({ pages, close }) {
  const [q, setQ] = useState('');
  const [act, setAct] = useState(0);
  const [more, setMore] = useState([]);
  useEffect(() => {
    Promise.all([
      api.readOr('config', 'services.yaml', '[]').then((txt) => serviceEntries(YAML.parse(txt))).catch(() => []),
      api.list('config').then((l) => l.filter((e) => !e.dir).map((e) => ({
        label: e.name, hint: t('Datei'), icon: 'file', run: () => go(VISUAL[e.name] || `#/edit/config/${e.name}`),
      }))).catch(() => []),
    ]).then(([a, b]) => setMore([...a, ...b]));
  }, []);
  const all = [...pages.map(([hash, label, icon]) => ({ label, hint: t('Seite'), icon, run: () => go(hash) })), ...more];
  const s = q.trim().toLowerCase();
  const list = all.filter((x) => !s || x.label.toLowerCase().includes(s) || x.hint.toLowerCase().includes(s)).slice(0, 50);
  const pick = (x) => { close(); x?.run(); };
  useEffect(() => { document.getElementById('pal-' + act)?.scrollIntoView({ block: 'nearest' }); }, [act]);
  const key = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setAct((a) => Math.max(0, Math.min(list.length - 1, a + (e.key === 'ArrowDown' ? 1 : -1))));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pick(list[act]);
    }
  };
  return html`<${Dlg} title=${t('Schnellsuche')} onClose=${() => close()}>
    <input class="inp" autofocus role="combobox" aria-expanded="true" aria-controls="pal-list" aria-activedescendant=${list[act] ? 'pal-' + act : undefined}
      aria-label=${t('Schnellsuche')} placeholder=${t('Seite, Service oder Datei…')} value=${q} onKeyDown=${key}
      onInput=${(e) => { setQ(e.target.value); setAct(0); }} />
    <ul class="palette-list" role="listbox" id="pal-list">
      ${list.map((x, i) => html`<li id=${'pal-' + i} role="option" aria-selected=${i === act} class=${i === act ? 'act' : ''}
        onMouseDown=${(e) => { e.preventDefault(); pick(x); }} onMouseEnter=${() => setAct(i)}>
        <${I} n=${x.icon} /><span>${x.label}</span><span class="muted small">${x.hint}</span></li>`)}
      ${!list.length && html`<li class="muted">${t('Nichts gefunden.')}</li>`}
    </ul>
  <//>`;
}
