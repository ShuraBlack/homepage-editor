import {
  html, useState, useEffect, useRef, api, joinPath, isImageName, fmtSize, fmtTime, publicUrl, toast, go,
  promptDlg, confirmDlg, openModal, registerFileBrowser, I, IconBtn, Dlg, t,
} from '../lib.js';

export const VISUAL = { 'services.yaml': '#/services', 'widgets.yaml': '#/widgets', 'settings.yaml': '#/settings', 'proxmox.yaml': '#/proxmox' };
const ROOT_LABEL = { config: t('Konfiguration'), icons: t('Icons'), backgrounds: t('Hintergründe') };

async function copyPath(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast(t('Kopiert: {text}', { text }));
  } catch {
    // Clipboard API needs HTTPS; on plain-HTTP LAN show the value instead.
    await promptDlg(t('Pfad kopieren'), text, t('Mit Strg+C kopieren.'), t('Schließen'));
  }
}

function Preview({ root, path, close }) {
  return html`<${Dlg} title=${path} onClose=${() => close()}>
    <img class="preview-img" src=${api.url(root, path)} alt=${path} />
    ${root !== 'config' && html`<p class="small"><code>${publicUrl(root, path)}</code>
      <button type="button" class="chip" onClick=${() => copyPath(publicUrl(root, path))}><${I} n="copy" s=${12} /> ${t('Pfad kopieren')}</button></p>`}
  <//>`;
}

/**
 * File browser. `grid` shows thumbnails (icons/backgrounds), `pick` turns it into an image picker,
 * `tabs` shows the root switcher. Without `embedded` the current folder lives in the URL hash.
 */
export function FileBrowser({ root: initialRoot, path: initialPath = '', grid, pick, tabs, embedded }) {
  const [root, setRoot] = useState(initialRoot);
  const [path, setPath] = useState(initialPath);
  // A listing only counts for the folder it was loaded for. Otherwise, right after switching area/folder, the old
  // names were rendered with the new root and every thumbnail 404'd (e.g. backgrounds/settings.yaml.bak).
  const [loaded, setLoaded] = useState({ key: null, items: null });
  const key = root + '\n' + path;
  const items = loaded.key === key ? loaded.items : null;
  const current = useRef(key);
  current.current = key;
  const [sel, setSel] = useState(null);
  const [filter, setFilter] = useState('');
  const [dropping, setDropping] = useState(false);
  const fileInput = useRef();

  useEffect(() => { setRoot(initialRoot); setPath(initialPath); }, [initialRoot, initialPath]);
  const load = () => {
    const k = key;
    const done = (list) => { if (current.current === k) setLoaded({ key: k, items: list }); }; // drop late answers for old folders
    return api.list(root, path).then(done).catch((e) => { toast(e.message, 'err'); done([]); });
  };
  useEffect(() => { setSel(null); load(); }, [root, path]);

  const nav = (r, p) => {
    if (embedded) { setRoot(r); setPath(p); } else go(`#/${tabs ? 'files/' + r : r}${p ? '/' + p : ''}`);
  };
  const full = (name) => joinPath(path, name);

  const open = (e) => {
    const p = full(e.name);
    if (e.dir) return nav(root, p);
    if (pick) return isImageName(e.name) ? pick(p) : null;
    if (root === 'config' && VISUAL[p]) return go(VISUAL[p]);
    if (isImageName(e.name)) return openModal(Preview, { root, path: p }, 'wide');
    go(`#/edit/${root}/${p}`);
  };
  const rename = async (e) => {
    const n = await promptDlg(t('Umbenennen'), e.name);
    if (!n || n === e.name) return;
    try { await api.rename(root, full(e.name), full(n)); load(); } catch (err) { toast(err.message, 'err'); }
  };
  const remove = async (e) => {
    if (!(await confirmDlg(t('„{name}“ löschen?', { name: e.name }), e.dir ? t('Der Ordner wird mit gesamtem Inhalt gelöscht.') : t('Das kann nicht rückgängig gemacht werden.'), t('Löschen'), true))) return;
    try { await api.del(root, full(e.name)); toast(t('Gelöscht')); load(); } catch (err) { toast(err.message, 'err'); }
  };
  const upload = async (files) => {
    if (!files?.length) return;
    try { const saved = await api.upload(root, path, files); toast(t('{n} Datei(en) hochgeladen', { n: saved.length })); load(); } catch (err) { toast(err.message, 'err'); }
  };
  const mkdir = async () => {
    const n = await promptDlg(t('Neuer Ordner'), '');
    if (n) { try { await api.mkdir(root, full(n)); load(); } catch (err) { toast(err.message, 'err'); } }
  };
  const newFile = async () => {
    const n = await promptDlg(t('Neue Datei'), '', t('z. B. bookmarks.yaml'));
    if (!n) return;
    try { await api.write(root, full(n), ''); go(`#/edit/${root}/${full(n)}`); } catch (err) { toast(err.message, 'err'); }
  };

  useEffect(() => {
    if (embedded) return;
    const h = (ev) => {
      if (!sel || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) || document.querySelector('dialog[open]')) return;
      if (ev.key === 'F2') { ev.preventDefault(); rename(sel); }
      if (ev.key === 'Delete') { ev.preventDefault(); remove(sel); }
    };
    addEventListener('keydown', h);
    return () => removeEventListener('keydown', h);
  }, [sel, root, path]);

  const crumbs = path ? path.split('/') : [];
  const shown = (items || []).filter((e) => !filter || e.name.toLowerCase().includes(filter.toLowerCase()))
    .filter((e) => !pick || e.dir || isImageName(e.name));
  const onlyImages = root !== 'config';

  return html`<div class=${'view files' + (dropping ? ' dropping' : '')}
      onDragOver=${(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDropping(true); } }}
      onDragLeave=${(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDropping(false); }}
      onDrop=${(e) => { if (!e.dataTransfer.files.length) return; e.preventDefault(); setDropping(false); upload(e.dataTransfer.files); }}>
    ${!embedded && html`<header class="view-head"><div><h1>${tabs ? t('Dateien') : ROOT_LABEL[root]}</h1>
      <div class="muted small">${root === 'config' ? t('Alles ohne visuellen Editor öffnet im Code-Editor.') : t('In Homepage erreichbar unter {url}', { url: publicUrl(root, '') })}</div></div></header>`}
    ${tabs && html`<div class="tabs" role="tablist">${Object.keys(ROOT_LABEL).map((r) => html`<button role="tab" aria-selected=${r === root}
      class=${'tab' + (r === root ? ' active' : '')} onClick=${() => nav(r, '')}>${ROOT_LABEL[r]}</button>`)}</div>`}
    <div class="toolbar">
      <nav class="crumbs" aria-label=${t('Pfad')}>
        <button class="link-btn" onClick=${() => nav(root, '')}>${ROOT_LABEL[root]}</button>
        ${crumbs.map((c, i) => html`<span class="muted">/</span><button class="link-btn" onClick=${() => nav(root, crumbs.slice(0, i + 1).join('/'))}>${c}</button>`)}
      </nav>
      <span class="spacer"></span>
      <input class="inp filter" placeholder=${t('Filtern…')} aria-label=${t('Filtern')} value=${filter} onInput=${(e) => setFilter(e.target.value)} />
      <button class="btn primary" onClick=${() => fileInput.current.click()}><${I} n="upload" /> ${t('Hochladen')}</button>
      <input ref=${fileInput} type="file" multiple hidden accept=${onlyImages ? 'image/*,.svg,.ico' : ''}
        onChange=${(e) => { upload(e.target.files); e.target.value = ''; }} />
      <button class="btn" onClick=${mkdir}><${I} n="folder-plus" /> ${t('Ordner')}</button>
      ${root === 'config' && !pick && html`<button class="btn" onClick=${newFile}><${I} n="file-plus" /> ${t('Datei')}</button>`}
    </div>
    ${items === null ? html`<p class="muted pad">${t('Lade…')}</p>` : grid ? html`<div class="gallery">
        ${path && html`<button class="tile dir" onClick=${() => nav(root, crumbs.slice(0, -1).join('/'))}><span class="tile-ico"><${I} n="folder-up" s=${36} /></span><span class="tile-name">..</span></button>`}
        ${shown.map((e) => html`<div class=${'tile' + (sel === e ? ' sel' : '')} key=${e.name}>
          <button class="tile-main" title=${e.name} onClick=${() => (pick || e.dir ? open(e) : setSel(e))} onDblClick=${() => open(e)}>
            ${e.dir ? html`<span class="tile-ico dir-ico"><${I} n="folder" s=${40} /></span>`
              : isImageName(e.name) ? html`<img src=${api.url(root, full(e.name)) + '&t=' + +new Date(e.mtime)} alt="" loading="lazy" />`
              : html`<span class="tile-ico"><${I} n="file" s=${40} /></span>`}
            <span class="tile-name">${e.name}</span>
          </button>
          ${!pick && html`<div class="tile-actions">
            ${!e.dir && html`<${IconBtn} n="copy" label=${t('Pfad von {name} kopieren', { name: e.name })} onClick=${() => copyPath(publicUrl(root, full(e.name)))} />`}
            <${IconBtn} n="pencil" label=${t('{name} umbenennen', { name: e.name })} onClick=${() => rename(e)} />
            <${IconBtn} n="trash-2" cls="del" label=${t('{name} löschen', { name: e.name })} onClick=${() => remove(e)} />
          </div>`}
        </div>`)}
        ${!shown.length && html`<p class="muted">${t('Keine Bilder. Dateien hierher ziehen oder „Hochladen“.')}</p>`}
      </div>`
    : html`<div class="filelist" role="list">
        ${path && html`<div class="frow" role="listitem"><button class="fmain" onClick=${() => nav(root, crumbs.slice(0, -1).join('/'))}>
          <span class="ftype"><${I} n="folder-up" /></span><span>..</span></button></div>`}
        ${shown.map((e) => html`<div role="listitem" class=${'frow' + (sel === e ? ' sel' : '')} key=${e.name}>
          <button class="fmain" onClick=${() => setSel(e)} onDblClick=${() => open(e)}>
            <span class="ftype">${e.dir ? html`<span class="dir-ico"><${I} n="folder" s=${18} /></span>` : (e.name.split('.').pop() || '').slice(0, 4).toUpperCase()}</span>
            <span class="fname">${e.name}${VISUAL[full(e.name)] && root === 'config' ? html` <span class="badge">${t('visuell')}</span>` : ''}</span>
            <span class="muted small">${e.dir ? t('Ordner') : fmtSize(e.size)}</span>
            <span class="muted small">${fmtTime(e.mtime)}</span>
          </button>
          <span class="factions">
            <button class="btn small" onClick=${() => open(e)}>${t('Öffnen')}</button>
            <${IconBtn} n="pencil" label=${t('{name} umbenennen (F2)', { name: e.name })} onClick=${() => rename(e)} />
            <${IconBtn} n="trash-2" cls="del" label=${t('{name} löschen (Entf)', { name: e.name })} onClick=${() => remove(e)} />
          </span>
        </div>`)}
        ${!shown.length && html`<p class="muted pad">${t('Leer.')}</p>`}
      </div>`}
    ${dropping && html`<div class="drop-overlay">${t('Dateien hier ablegen zum Hochladen')}</div>`}
  </div>`;
}
registerFileBrowser(FileBrowser);
