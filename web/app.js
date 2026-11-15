import { html, render, useState, useEffect, api, meta, go, FileEditor, I, applyAccent, isDirty, openModal, prefs, t } from './lib.js';
import { Services } from './views/services.js';
import { Widgets } from './views/widgets.js';
import { Bookmarks } from './views/bookmarks.js';
import { Settings } from './views/settings.js';
import { Proxmox, Docker } from './views/servers.js';
import { FileBrowser } from './views/files.js';
import { EditorSettings } from './views/editor.js';
import { Palette } from './views/palette.js';
import { checkUpdate, cachedUpdate, isNewer } from './update.js';

const NAV = [
  [t('Visuell'), [['services', t('Services'), 'layout-grid'], ['widgets', t('Info-Widgets'), 'layout-dashboard'], ['bookmarks', t('Bookmarks'), 'bookmark'],
    ['settings', t('Einstellungen'), 'sliders-horizontal'], ['proxmox', 'Proxmox', 'server'], ['docker', 'Docker', 'container']]],
  [t('Code'), [['css', 'custom.css', 'palette'], ['js', 'custom.js', 'braces']]],
  [t('Dateien'), [['icons', t('Icons'), 'shapes'], ['backgrounds', t('Hintergründe'), 'image'], ['files', t('Alle Dateien'), 'folder-tree']]],
  [t('Editor'), [['editor', t('Einstellungen'), 'settings']]],
];
const PAGES = NAV.flatMap(([, items]) => items.map(([id, label, ico]) => [`#/${id}`, label, ico]));
const MAC = /Mac|iPhone|iPad/.test(navigator.userAgent);
const MOD = MAC ? '⌘' : t('Strg');

const startPage = () => (NAV.some(([, items]) => items.some(([id]) => id === prefs.start)) ? prefs.start : 'services');

function route() {
  const [name, ...rest] = decodeURIComponent(location.hash.replace(/^#\/?/, '')).split('/');
  switch (name || startPage()) {
    case 'services': return html`<${Services} />`;
    case 'widgets': return html`<${Widgets} />`;
    case 'bookmarks': return html`<${Bookmarks} />`;
    case 'settings': return html`<${Settings} />`;
    case 'proxmox': return html`<${Proxmox} />`;
    case 'docker': return html`<${Docker} />`;
    case 'css': return html`<${FileEditor} root="config" path="custom.css" />`;
    case 'js': return html`<${FileEditor} root="config" path="custom.js" />`;
    case 'icons': case 'backgrounds': return html`<${FileBrowser} root=${name} path=${rest.join('/')} grid=${true} />`;
    case 'files': return html`<${FileBrowser} root=${rest[0] || 'config'} path=${rest.slice(1).join('/')} tabs=${true} />`;
    case 'editor': return html`<${EditorSettings} />`;
    case 'edit': return html`<${FileEditor} key=${rest.join('/')} root=${rest[0]} path=${rest.slice(1).join('/')} />`;
    default: return html`<p class="pad">${t('Seite nicht gefunden.')}</p>`;
  }
}

const openPalette = () => { if (!document.querySelector('dialog[open]')) openModal(Palette, { pages: PAGES }); };

function App() {
  const [, setHash] = useState(location.hash);
  const [menu, setMenu] = useState(false);
  const [, setTick] = useState(0);
  const [upd, setUpd] = useState(cachedUpdate);
  useEffect(() => {
    if (prefs.updates === 'on') checkUpdate(); // opt-in (editor settings); at most once a day
    const u = () => setUpd(cachedUpdate());
    addEventListener('hpe-update', u);
    return () => removeEventListener('hpe-update', u);
  }, []);
  useEffect(() => {
    const h = () => { setHash(location.hash); setMenu(false); };
    const d = () => setTick((n) => n + 1); // unsaved marker in the sidebar
    const k = (e) => { if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); } };
    addEventListener('hashchange', h);
    addEventListener('hpe-dirty', d);
    addEventListener('keydown', k);
    return () => { removeEventListener('hashchange', h); removeEventListener('hpe-dirty', d); removeEventListener('keydown', k); };
  }, []);
  const update = prefs.updates === 'on' && isNewer(upd?.latest, meta.version) ? upd : null;
  const current = location.hash.replace(/^#\/?/, '').split('/')[0] || startPage();
  return html`<div class=${'shell' + (menu ? ' menu-open' : '')}>
    <aside class="sidebar">
      <div class="brand"><span class="logo"><${I} n="house" s=${18} /></span><div><strong>homepage</strong><div class="muted small">Editor</div></div>
        <button class="btn icon-btn menu-btn" aria-label=${t('Menü')} aria-expanded=${menu} onClick=${() => setMenu(!menu)}><${I} n=${menu ? 'x' : 'menu'} /></button></div>
      <nav>
        <button class="nav-item" onClick=${openPalette}><span class="nav-ico"><${I} n="search" /></span>${t('Suchen…')}
          <span class="spacer"></span><kbd>${MOD} K</kbd></button>
        ${NAV.map(([title, items]) => html`<div class="nav-title">${title}</div>
          ${items.map(([id, label, ico]) => {
            const active = current === id || (id === 'files' && current === 'edit');
            return html`<button class=${'nav-item' + (active ? ' active' : '')}
              aria-current=${current === id ? 'page' : undefined} onClick=${() => go('#/' + id)}><span class="nav-ico"><${I} n=${ico} /></span>${label}
              ${active && isDirty() && html`<span class="dirty-dot" title=${t('ungespeichert')}></span>`}</button>`;
          })}`)}
      </nav>
      <div class="sidebar-foot">
        ${meta.homepageUrl && html`<a class="nav-item" href=${meta.homepageUrl} target="hpe-homepage"><span class="nav-ico"><${I} n="external-link" /></span>${t('Homepage öffnen')}</a>`}
        ${update && html`<a class="nav-item update" href=${update.url} target="_blank" rel="noopener" title=${t('Update verfügbar') + ' – ' + t('Release-Notes öffnen')}>
          <span class="nav-ico"><${I} n="download" /></span>Update<span class="spacer"></span><span class="badge">${update.latest}</span></a>`}
        <form method="post" action="/logout"><button class="nav-item"><span class="nav-ico"><${I} n="log-out" /></span>${t('Abmelden')}</button></form>
        <div class="muted small keys"><kbd>${MOD}</kbd> <kbd>S</kbd> ${t('speichern')} · <kbd>${MOD}</kbd> <kbd>Z</kbd> ${t('rückgängig')}
          <span class="version" title=${t('Installierte Version')}>v${meta.version}</span></div>
      </div>
    </aside>
    <main class="main">${route()}</main>
  </div>`;
}

Object.assign(meta, await api.meta());
applyAccent(meta.accent);
render(html`<${App} />`, document.getElementById('app'));
