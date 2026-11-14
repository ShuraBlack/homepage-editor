import { html, render, useState, useEffect, api, meta, go, FileEditor, I, applyAccent, t } from './lib.js';
import { Services } from './views/services.js';
import { Widgets } from './views/widgets.js';
import { Settings } from './views/settings.js';
import { Proxmox } from './views/proxmox.js';
import { FileBrowser } from './views/files.js';
import { EditorSettings } from './views/editor.js';

const NAV = [
  [t('Visuell'), [['services', t('Services'), 'layout-grid'], ['widgets', t('Info-Widgets'), 'layout-dashboard'], ['settings', t('Einstellungen'), 'sliders-horizontal'], ['proxmox', 'Proxmox', 'server']]],
  [t('Code'), [['css', 'custom.css', 'palette'], ['js', 'custom.js', 'braces']]],
  [t('Dateien'), [['icons', t('Icons'), 'shapes'], ['backgrounds', t('Hintergründe'), 'image'], ['files', t('Alle Dateien'), 'folder-tree']]],
  [t('Editor'), [['editor', t('Einstellungen'), 'settings']]],
];

function route() {
  const [name, ...rest] = decodeURIComponent(location.hash.replace(/^#\/?/, '')).split('/');
  switch (name || 'services') {
    case 'services': return html`<${Services} />`;
    case 'widgets': return html`<${Widgets} />`;
    case 'settings': return html`<${Settings} />`;
    case 'proxmox': return html`<${Proxmox} />`;
    case 'css': return html`<${FileEditor} root="config" path="custom.css" />`;
    case 'js': return html`<${FileEditor} root="config" path="custom.js" />`;
    case 'icons': case 'backgrounds': return html`<${FileBrowser} root=${name} path=${rest.join('/')} grid=${true} />`;
    case 'files': return html`<${FileBrowser} root=${rest[0] || 'config'} path=${rest.slice(1).join('/')} tabs=${true} />`;
    case 'editor': return html`<${EditorSettings} />`;
    case 'edit': return html`<${FileEditor} key=${rest.join('/')} root=${rest[0]} path=${rest.slice(1).join('/')} />`;
    default: return html`<p class="pad">${t('Seite nicht gefunden.')}</p>`;
  }
}

function App() {
  const [, setHash] = useState(location.hash);
  const [menu, setMenu] = useState(false);
  useEffect(() => {
    const h = () => { setHash(location.hash); setMenu(false); };
    addEventListener('hashchange', h);
    return () => removeEventListener('hashchange', h);
  }, []);
  const current = location.hash.replace(/^#\/?/, '').split('/')[0] || 'services';
  return html`<div class=${'shell' + (menu ? ' menu-open' : '')}>
    <aside class="sidebar">
      <div class="brand"><span class="logo"><${I} n="house" s=${18} /></span><div><strong>homepage</strong><div class="muted small">Editor</div></div>
        <button class="btn icon-btn menu-btn" aria-label=${t('Menü')} aria-expanded=${menu} onClick=${() => setMenu(!menu)}><${I} n="layout-grid" /></button></div>
      <nav>
        ${NAV.map(([title, items]) => html`<div class="nav-title">${title}</div>
          ${items.map(([id, label, ico]) => html`<button class=${'nav-item' + (current === id || (id === 'files' && current === 'edit') ? ' active' : '')}
            aria-current=${current === id ? 'page' : undefined} onClick=${() => go('#/' + id)}><span class="nav-ico"><${I} n=${ico} /></span>${label}</button>`)}`)}
      </nav>
      <div class="sidebar-foot">
        ${meta.homepageUrl && html`<a class="nav-item" href=${meta.homepageUrl} target="_blank" rel="noopener"><span class="nav-ico"><${I} n="external-link" /></span>${t('Homepage öffnen')}</a>`}
        <form method="post" action="/logout"><button class="nav-item"><span class="nav-ico"><${I} n="log-out" /></span>${t('Abmelden')}</button></form>
        <div class="muted small keys"><kbd>${t('Strg')}</kbd> <kbd>S</kbd> ${t('speichern')}</div>
      </div>
    </aside>
    <main class="main">${route()}</main>
  </div>`;
}

Object.assign(meta, await api.meta());
applyAccent(meta.accent);
render(html`<${App} />`, document.getElementById('app'));
