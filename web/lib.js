// Shared building blocks: API client, YAML helpers, form components, modals, code editor.
import { html, render, useState, useEffect, useRef, useMemo } from './vendor/preact-htm.js';
import * as YAML from './vendor/yaml/index.js';
import { ICONS } from './vendor/lucide.js';
import { t, tServer, lang } from './i18n.js';
export { html, render, useState, useEffect, useRef, useMemo, YAML, t };

// ---------------- UI icons (Lucide) ----------------
export const I = ({ n, s = 16 }) => html`<svg class="i" width=${s} height=${s} viewBox="0 0 24 24" fill="none" stroke="currentColor"
  stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" dangerouslySetInnerHTML=${{ __html: ICONS[n] }}></svg>`;

export const IconBtn = ({ n, label, onClick, cls = '' }) => html`<button type="button" class=${'btn icon-btn ' + cls} title=${label}
  aria-label=${label} onClick=${onClick}><${I} n=${n} /></button>`;

/** Modal layout: fixed header and footer, only the content scrolls. */
export function Dlg({ title, onClose, onSubmit, footer, children }) {
  return html`<form class="dlg" onSubmit=${(e) => { e.preventDefault(); onSubmit?.(); }}>
    <header class="dlg-head"><h3>${title}</h3><${IconBtn} n="x" label=${t('Schließen')} onClick=${onClose} /></header>
    <div class="dlg-content">${children}</div>
    ${footer && html`<footer class="dlg-actions">${footer}</footer>`}
  </form>`;
}

/** Text input with a styled suggestion list (replaces the native <datalist>). */
export function Combo({ id, value, options, onValue, placeholder }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState(false);
  const [act, setAct] = useState(0);
  const str = value == null ? '' : String(value);
  const list = (typed ? options.filter((o) => o.toLowerCase().includes(str.toLowerCase())) : options).slice(0, 200);
  const choose = (o) => { onValue(o); setOpen(false); setTyped(false); };
  const key = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) return setOpen(true);
      setAct((a) => Math.max(0, Math.min(list.length - 1, a + (e.key === 'ArrowDown' ? 1 : -1))));
    } else if (e.key === 'Enter' && open && list[act]) {
      e.preventDefault();
      choose(list[act]);
    } else if (e.key === 'Escape' && open) {
      e.preventDefault(); // keep the surrounding dialog open
      e.stopPropagation();
      setOpen(false);
    }
  };
  useEffect(() => {
    if (open) document.getElementById(`${id}-o${act}`)?.scrollIntoView({ block: 'nearest' });
  }, [act, open]);
  return html`<div class="combo">
    <input id=${id} class="inp" role="combobox" aria-expanded=${open} aria-controls=${id + '-list'} aria-autocomplete="list"
      aria-activedescendant=${open && list[act] ? `${id}-o${act}` : undefined} autocomplete="off" value=${str} placeholder=${placeholder}
      onFocus=${() => { setOpen(true); setTyped(false); setAct(Math.max(0, options.indexOf(str))); }}
      onBlur=${() => setOpen(false)} onKeyDown=${key}
      onInput=${(e) => { onValue(e.target.value); setTyped(true); setOpen(true); setAct(0); }} />
    <span class="combo-chev"><${I} n="chevron-down" s=${14} /></span>
    ${open && list.length > 0 && html`<ul class="combo-list" role="listbox" id=${id + '-list'}>
      ${list.map((o, i) => html`<li id=${`${id}-o${i}`} role="option" aria-selected=${o === str}
        class=${(i === act ? 'act ' : '') + (o === str ? 'cur' : '')} onMouseDown=${(e) => { e.preventDefault(); choose(o); }}
        onMouseEnter=${() => setAct(i)}>${o}</li>`)}
    </ul>`}
  </div>`;
}
const { isMap, isSeq, isScalar, Scalar, Pair } = YAML;
export { isMap, isSeq, isScalar };

// ---------------- API ----------------
export const meta = {};

/** Apply the accent colour from the editor settings (empty/invalid = stylesheet default). */
export function applyAccent(hex) {
  const s = document.documentElement.style;
  if (!/^#[0-9a-f]{6}$/i.test(hex || '')) { s.removeProperty('--accent'); s.removeProperty('--accent-ink'); return; }
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  s.setProperty('--accent', hex);
  s.setProperty('--accent-ink', 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#14110a' : '#ffffff'); // same rule as the server
}

async function req(method, url, body) {
  const r = await fetch(url, { method, body });
  if (r.status === 401) { location.href = '/login'; throw new Error(t('Nicht angemeldet')); }
  if (!r.ok) {
    const e = new Error(tServer((await r.text()).trim() || r.statusText));
    e.status = r.status;
    throw e;
  }
  return r;
}
const qs = (o) => new URLSearchParams(o).toString();
export const api = {
  meta: () => req('GET', '/api/meta').then((r) => r.json()),
  saveSettings: (v) => req('PUT', '/api/settings', JSON.stringify(v)),
  resetSettings: () => req('DELETE', '/api/settings'),
  revokeSessions: () => req('POST', '/api/sessions/revoke'),
  list: (root, path = '') => req('GET', `/api/list?${qs({ root, path })}`).then((r) => r.json()),
  read: (root, path) => req('GET', `/api/file?${qs({ root, path })}`).then((r) => r.text()),
  readOr: (root, path, def) => api.read(root, path).catch((e) => { if (e.status === 404) return def; throw e; }),
  write: (root, path, text) => req('PUT', `/api/file?${qs({ root, path })}`, text),
  del: (root, path) => req('DELETE', `/api/file?${qs({ root, path })}`),
  mkdir: (root, path) => req('POST', `/api/mkdir?${qs({ root, path })}`),
  rename: (root, path, to) => req('POST', `/api/rename?${qs({ root, path, to })}`),
  upload(root, path, files) {
    const fd = new FormData();
    for (const f of files) fd.append('files', f);
    return req('POST', `/api/upload?${qs({ root, path })}`, fd).then((r) => r.json());
  },
  url: (root, path) => `/api/file?${qs({ root, path })}`,
};

export const joinPath = (...p) => p.filter(Boolean).join('/');
export const isImageName = (n) => /\.(png|jpe?g|webp|gif|svg|ico|avif)$/i.test(n);
export const fmtSize = (b) => (b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1048576).toFixed(1)} MB`);
export const fmtTime = (t) => new Date(t).toLocaleString(lang, { dateStyle: 'short', timeStyle: 'short' });

// Public URL (as Homepage sees it) of an image inside the icons/backgrounds root.
export const publicUrl = (root, path) => `${root === 'icons' ? meta.iconsUrl : meta.backgroundsUrl}/${path}`;

// Resolve a Homepage icon/image value to something the browser can preview.
export function iconSrc(icon) {
  if (!icon || typeof icon !== 'string') return null;
  if (/^https?:\/\//.test(icon)) return icon;
  if (meta.iconsUrl && icon.startsWith(meta.iconsUrl + '/')) return api.url('icons', icon.slice(meta.iconsUrl.length + 1));
  if (meta.backgroundsUrl && icon.startsWith(meta.backgroundsUrl + '/')) return api.url('backgrounds', icon.slice(meta.backgroundsUrl.length + 1));
  if (icon.startsWith('/')) return meta.homepageUrl ? meta.homepageUrl.replace(/\/$/, '') + icon : null;
  let m;
  if ((m = icon.match(/^mdi-(.+?)(-#[0-9a-f]{3,8})?$/i))) return `https://cdn.jsdelivr.net/npm/@mdi/svg@7/svg/${m[1]}.svg`;
  if ((m = icon.match(/^si-(.+?)(-#[0-9a-f]{3,8})?$/i))) return `https://cdn.jsdelivr.net/npm/simple-icons@13/icons/${m[1]}.svg`;
  if ((m = icon.match(/^sh-(.+?)(?:\.(svg|png|webp))?$/))) return `https://cdn.jsdelivr.net/gh/selfhst/icons/${m[2] || 'png'}/${m[1]}.${m[2] || 'png'}`;
  m = icon.match(/^(.+?)(?:\.(svg|png|webp))?$/);
  return `https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/${m[2] || 'png'}/${m[1]}.${m[2] || 'png'}`;
}

export function Icon({ icon, size = 28 }) {
  const src = iconSrc(icon);
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [src]);
  if (!src || broken) return html`<span class="icon-ph" style=${`width:${size}px;height:${size}px`}>${(icon || '?').toString().replace(/^(mdi|si|sh)-/, '').slice(0, 2)}</span>`;
  const mono = /^(mdi|si)-/.test(icon) && !/-#[0-9a-f]+$/i.test(icon);
  return html`<img class=${'icon' + (mono ? ' mono' : '')} src=${src} width=${size} height=${size} loading="lazy" alt="" onError=${() => setBroken(true)} />`;
}

// ---------------- YAML helpers (work on Document nodes so comments + unknown keys survive) ----------------
export const parseDoc = (text) => YAML.parseDocument(text);
/** Serialize with whichever indent (2 or 4) reproduces `src` most closely; mixed indentation gets normalized. */
export function stringifyDoc(doc, src = '') {
  const a = src.split(/\r?\n/);
  let best = null;
  for (const indent of [2, 4]) {
    const out = doc.toString({ lineWidth: 0, indent, flowCollectionPadding: false });
    const b = out.split('\n');
    let d = 0;
    for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) d++;
    if (!best || d < best.d) best = { d, out };
  }
  return best.out;
}
export const keyOf = (pair) => (isScalar(pair.key) ? pair.key.value : pair.key);

/** For a list entry like `- Name: value` return {pair, name, value}. */
export function single(item) {
  if (!isMap(item) || !item.items.length) return null;
  const pair = item.items[0];
  return { pair, name: String(keyOf(pair) ?? ''), value: pair.value };
}

export function setKey(pair, name) {
  if (isScalar(pair.key)) pair.key.value = name;
  else pair.key = new Scalar(name);
}

export function findPair(map, key) {
  return isMap(map) ? map.items.find((p) => keyOf(p) === key) : undefined;
}

/** Scalar value of map[key]; a node if it is a collection; undefined if missing. */
export function getVal(map, key) {
  const p = findPair(map, key);
  if (!p) return undefined;
  return isScalar(p.value) ? p.value.value : p.value;
}

/** Set map[key] to a scalar, reusing the existing node (keeps comments / quoting). '' or null removes it. */
export function setVal(map, key, v, keepEmpty = false) {
  const p = findPair(map, key);
  if ((v === '' || v === null || v === undefined) && !keepEmpty) {
    if (p) map.items.splice(map.items.indexOf(p), 1);
    return;
  }
  if (p && isScalar(p.value)) p.value.value = v;
  else if (p) p.value = new Scalar(v);
  else map.items.push(new Pair(new Scalar(key), new Scalar(v)));
}

/** Return map[key] as a YAMLMap, creating it when `create` is set. */
export function subMap(doc, map, key, create) {
  const p = findPair(map, key);
  if (p && isMap(p.value)) return p.value;
  if (!create) return null;
  const m = doc.createNode({});
  if (p) p.value = m;
  else map.items.push(new Pair(new Scalar(key), m));
  return m;
}

export function moveItem(fromSeq, fromIdx, toSeq, toIdx) {
  const [it] = fromSeq.items.splice(fromIdx, 1);
  if (fromSeq === toSeq && toIdx > fromIdx) toIdx--;
  toSeq.items.splice(toIdx, 0, it);
}

export function containsNode(node, target) {
  if (node === target) return true;
  if (isMap(node) || isSeq(node)) return node.items.some((it) => containsNode(isMap(node) ? it.value : it, target));
  return false;
}

// ---------------- dirty tracking (warn before leaving with unsaved changes) ----------------
let dirty = false;
export const setDirty = (d) => { dirty = d; };
export const isDirty = () => dirty;
addEventListener('beforeunload', (e) => { if (dirty) e.preventDefault(); });

/** In-app navigation that asks before dropping unsaved changes. */
export async function go(hash) {
  if (location.hash === hash) return;
  if (dirty && !(await confirmDlg(t('Ungespeicherte Änderungen verwerfen?'), t('Die Änderungen gehen verloren.'), t('Verwerfen'), true))) return;
  dirty = false;
  location.hash = hash;
}

// ---------------- toast ----------------
export function toast(msg, kind = 'ok') {
  let box = document.querySelector('.toasts');
  if (!box) { box = document.createElement('div'); box.className = 'toasts'; box.setAttribute('role', 'status'); document.body.append(box); }
  const t = document.createElement('div');
  t.className = `toast ${kind}`;
  t.textContent = msg;
  box.append(t);
  setTimeout(() => t.remove(), kind === 'err' ? 6000 : 2500);
}

// ---------------- modals ----------------
/** Render Comp into a modal <dialog>; resolves with the value passed to close(). */
export function openModal(Comp, props = {}, cls = '') {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'modal ' + cls;
    document.body.append(dlg);
    const close = (v = null) => { render(null, dlg); dlg.remove(); resolve(v); };
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(null); });
    render(html`<${Comp} ...${props} close=${close} />`, dlg);
    dlg.showModal();
  });
}

function AskDialog({ title, text, input, ok, danger, close }) {
  const [v, setV] = useState(input ?? '');
  return html`<${Dlg} title=${title} onClose=${() => close(null)} onSubmit=${() => close(input !== undefined ? v.trim() || null : true)}
    footer=${html`<button type="button" class="btn" onClick=${() => close(null)}>${t('Abbrechen')}</button>
      <button class=${'btn ' + (danger ? 'danger' : 'primary')}>${ok}</button>`}>
    ${text && html`<p class="muted">${text}</p>`}
    ${input !== undefined && html`<input class="inp" aria-label=${title} autofocus value=${v} onInput=${(e) => setV(e.target.value)} />`}
  <//>`;
}
export const confirmDlg = (title, text, ok = 'OK', danger = false) => openModal(AskDialog, { title, text, ok, danger });
export const promptDlg = (title, input = '', text = '', ok = 'OK') => openModal(AskDialog, { title, text, input, ok });

// ---------------- form fields ----------------
// field: {k, label, type: text|number|bool|select|secret|icon|bg, options?, placeholder?, hint?}
export const BOOL_OPTS = [['', '–'], [true, t('an')], [false, t('aus')]];

function Secret({ value, onInput, placeholder, id }) {
  const [show, setShow] = useState(false);
  return html`<div class="row-inp">
    <input id=${id} class="inp" type=${show ? 'text' : 'password'} autocomplete="off" value=${value ?? ''} placeholder=${placeholder} onInput=${onInput} />
    <${IconBtn} n=${show ? 'eye-off' : 'eye'} label=${show ? t('Verbergen') : t('Anzeigen')} onClick=${() => setShow(!show)} />
  </div>`;
}

export function ImageInput({ value, onValue, root, id, placeholder }) {
  const pick = async () => {
    const p = await pickImage(root);
    if (p) onValue(publicUrl(root, p));
  };
  return html`<div class="row-inp">
    <span class="prev">${value ? html`<${Icon} icon=${value} size=${24} />` : null}</span>
    <input id=${id} class="inp" value=${value ?? ''} placeholder=${placeholder} onInput=${(e) => onValue(e.target.value)} />
    <button type="button" class="btn" onClick=${pick}>${t('Auswählen…')}</button>
  </div>`;
}

let uid = 0;
export function Field({ f, value, onValue }) {
  const id = useMemo(() => `f${++uid}`, []);
  let input;
  const str = value === undefined || value === null ? '' : String(value);
  switch (f.type) {
    case 'bool':
      input = html`<select id=${id} class="inp" value=${value === true ? 'true' : value === false ? 'false' : ''}
        onChange=${(e) => onValue(e.target.value === '' ? '' : e.target.value === 'true')}>
        ${BOOL_OPTS.map(([v, l]) => html`<option value=${String(v)}>${l}</option>`)}</select>`;
      break;
    case 'select': {
      const opts = f.options.includes(str) || str === '' ? f.options : [...f.options, str];
      input = html`<select id=${id} class="inp" value=${str} onChange=${(e) => onValue(e.target.value)}>
        <option value="">–</option>${opts.map((o) => html`<option value=${o}>${o}</option>`)}</select>`;
      break;
    }
    case 'number':
      input = html`<input id=${id} class="inp" inputmode="decimal" value=${str} placeholder=${f.placeholder}
        onInput=${(e) => { const t = e.target.value.trim(); onValue(t === '' ? '' : /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : t); }} />`;
      break;
    case 'secret':
      input = html`<${Secret} id=${id} value=${str} placeholder=${f.placeholder} onInput=${(e) => onValue(e.target.value)} />`;
      break;
    case 'icon':
    case 'bg':
      input = html`<${ImageInput} id=${id} value=${str} root=${f.type === 'icon' ? 'icons' : 'backgrounds'} placeholder=${f.placeholder} onValue=${onValue} />`;
      break;
    case 'combo':
      input = html`<${Combo} id=${id} value=${str} options=${f.options || []} placeholder=${f.placeholder} onValue=${onValue} />`;
      break;
    default:
      input = html`<input id=${id} class="inp" value=${str} placeholder=${f.placeholder} onInput=${(e) => onValue(e.target.value)} />`;
  }
  return html`<div class=${'field' + (f.wide ? ' wide' : '')}>
    <label for=${id}>${f.label || f.k}</label>${input}
    ${f.hint && html`<small class="muted">${f.hint}</small>`}
  </div>`;
}

/**
 * Form for known keys of a YAML map. `map` may be null; `ensure()` creates it on first write.
 * Keys whose value is a collection are skipped here and left to <KV>.
 */
export function Fields({ map, ensure, fields, touch }) {
  return html`<div class="fields">
    ${fields.filter((f) => !isMap(getVal(map, f.k)) && !isSeq(getVal(map, f.k))).map((f) => html`<${Field} key=${f.k} f=${f}
      value=${getVal(map, f.k)}
      onValue=${(v) => { const m = map || ensure(); setVal(m, f.k, v); touch(); }} />`)}
  </div>`;
}
/** Keys a <Fields> block renders (so <KV> can skip them). */
export const shownKeys = (map, fields) => fields.filter((f) => !isMap(getVal(map, f.k)) && !isSeq(getVal(map, f.k))).map((f) => f.k);

const SECRET_KEY = /(pass|secret|token|key)$/i;

// Text for a value in the generic key/value editor; collections are shown as JSON (valid YAML flow).
const kvText = (node) => (isScalar(node) ? (node.value === null ? '' : String(node.value)) : node && node.toJSON ? JSON.stringify(node.toJSON()) : String(node ?? ''));

/** Generic key/value editor for every key of `map` not in `exclude`. */
export function KV({ doc, map, ensure, exclude = [], touch, title = t('Weitere Optionen'), quick = [] }) {
  const pairs = isMap(map) ? map.items.filter((p) => !exclude.includes(keyOf(p))) : [];
  const [bad, setBad] = useState({});
  const add = async (k) => {
    k = k || (await promptDlg(t('Neue Option'), '', t('Name des Schlüssels, z. B. url, key, fields')));
    if (!k) return;
    const m = map || ensure();
    if (findPair(m, k)) return toast(t('„{k}“ existiert bereits', { k }), 'err');
    m.items.push(new Pair(new Scalar(k), new Scalar('')));
    touch();
  };
  const setValue = (p, i, text) => {
    const prev = p.value;
    const isColl = prev && !isScalar(prev);
    const looksColl = /^\s*\[/.test(text) || (/^\s*\{/.test(text) && !/^\s*\{\{/.test(text));
    if (isColl || looksColl) {
      try {
        p.value = doc.createNode(YAML.parse(text), { flow: true });
        setBad({ ...bad, [i]: false });
      } catch {
        setBad({ ...bad, [i]: true });
        return;
      }
    } else {
      let v = text;
      if (!(isScalar(prev) && typeof prev.value === 'string')) {
        if (/^-?\d+(\.\d+)?$/.test(text)) v = Number(text);
        else if (text === 'true' || text === 'false') v = text === 'true';
      }
      if (isScalar(prev)) prev.value = v;
      else p.value = new Scalar(v);
    }
    touch();
  };
  const missingQuick = quick.filter((k) => !findPair(map, k));
  return html`<div class="kv">
    <div class="kv-head"><span class="label">${title}</span>
      <span class="kv-quick">${missingQuick.map((k) => html`<button type="button" class="chip" onClick=${() => add(k)}>+ ${k}</button>`)}
      <button type="button" class="chip" onClick=${() => add()}>+ ${t('Option')}</button></span></div>
    ${pairs.map((p, i) => {
      const k = String(keyOf(p));
      const secret = SECRET_KEY.test(k) && isScalar(p.value);
      return html`<div class="kv-row" key=${i}>
        <input class="inp kv-k" aria-label=${t('Schlüssel')} value=${k} onInput=${(e) => { setKey(p, e.target.value); touch(); }} />
        ${secret
          ? html`<${Secret} value=${kvText(p.value)} onInput=${(e) => setValue(p, i, e.target.value)} />`
          : html`<input class=${'inp kv-v' + (bad[i] ? ' invalid' : '')} aria-label=${t('Wert für {k}', { k })} value=${kvText(p.value)} onInput=${(e) => setValue(p, i, e.target.value)} />`}
        <${IconBtn} n="x" label=${t('„{k}“ entfernen', { k })} onClick=${() => { map.items.splice(map.items.indexOf(p), 1); touch(); }} />
      </div>`;
    })}
    ${!pairs.length && html`<p class="muted small">${t('Keine weiteren Optionen.')}</p>`}
  </div>`;
}

// ---------------- code editor (CodeMirror 5, loaded as global) ----------------
export function cmMode(path) {
  const ext = (path.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();
  return { yaml: 'yaml', yml: 'yaml', css: 'css', js: 'javascript', mjs: 'javascript', json: { name: 'javascript', json: true } }[ext] || null;
}

export function CodeEditor({ value, mode, onChange, onSave, errorLine }) {
  const el = useRef();
  const cm = useRef();
  const cb = useRef();
  cb.current = { onChange, onSave };
  useEffect(() => {
    const save = () => cb.current.onSave?.();
    cm.current = window.CodeMirror(el.current, {
      value, mode, theme: 'hpe', lineNumbers: true, indentUnit: 2, tabSize: 2, smartIndent: true,
      extraKeys: { 'Ctrl-S': save, 'Cmd-S': save, Tab: (c) => c.execCommand(c.somethingSelected() ? 'indentMore' : 'insertSoftTab') },
    });
    cm.current.on('change', (c) => cb.current.onChange(c.getValue()));
    return () => { el.current && (el.current.innerHTML = ''); };
  }, []);
  useEffect(() => { if (cm.current && value !== cm.current.getValue()) cm.current.setValue(value); }, [value]);
  useEffect(() => {
    const c = cm.current;
    if (!c || errorLine == null) return;
    c.addLineClass(errorLine, 'background', 'cm-error-line');
    c.scrollIntoView({ line: errorLine, ch: 0 }, 100);
    return () => c.removeLineClass(errorLine, 'background', 'cm-error-line');
  }, [errorLine]);
  return html`<div class="code" ref=${el}></div>`;
}

/** Ctrl/Cmd+S anywhere outside CodeMirror (CodeMirror handles its own). */
export function useSaveKey(fn) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const h = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && !e.defaultPrevented) { e.preventDefault(); ref.current(); }
    };
    addEventListener('keydown', h);
    return () => removeEventListener('keydown', h);
  }, []);
}

const yamlErrText = (e) => (e.line != null ? t('YAML-Fehler in Zeile {line}: {msg}', { line: e.line + 1, msg: e.msg }) : t('YAML-Fehler: {msg}', { msg: e.msg }));
const yamlErr = (doc) => {
  const e = doc.errors[0];
  return e ? { msg: e.message.split('\n')[0], line: e.linePos?.[0]?.line ? e.linePos[0].line - 1 : null } : null;
};

// ---------------- plain file editor (fallback for everything without a visual editor) ----------------
export function FileEditor({ root, path }) {
  const [text, setText] = useState(null);
  const [err, setErr] = useState(null);
  const [isDirtyState, setDirtyState] = useState(false);
  const cur = useRef('');
  const mode = cmMode(path);
  useEffect(() => {
    setText(null);
    api.readOr(root, path, '').then((t) => { cur.current = t; setText(t); setDirtyState(false); setDirty(false); })
      .catch((e) => toast(e.message, 'err'));
    return () => setDirty(false);
  }, [root, path]);
  const save = async () => {
    if (mode === 'yaml') {
      const e = yamlErr(parseDoc(cur.current));
      setErr(e);
      if (e) return toast(t('YAML-Fehler: {msg}', { msg: e.msg }), 'err');
    }
    try {
      await api.write(root, path, cur.current);
      setDirtyState(false); setDirty(false);
      toast(t('Gespeichert'));
    } catch (e) { toast(e.message, 'err'); }
  };
  useSaveKey(save);
  if (text === null) return html`<div class="muted pad">${t('Lade…')}</div>`;
  return html`<div class="view">
    <header class="view-head">
      <div><h1>${path.split('/').pop()}</h1><div class="muted small">${root}/${path}</div></div>
      <div class="actions">
        ${isDirtyState && html`<span class="badge">${t('ungespeichert')}</span>`}
        <button class="btn primary" onClick=${save}><${I} n="save" /> ${t('Speichern')}</button>
      </div>
    </header>
    ${err && html`<div class="alert">${yamlErrText(err)}</div>`}
    <${CodeEditor} value=${text} mode=${mode} errorLine=${err?.line} onSave=${save}
      onChange=${(t) => { cur.current = t; if (!isDirtyState) { setDirtyState(true); setDirty(true); } }} />
  </div>`;
}

// ---------------- visual YAML view wrapper ----------------
/**
 * Loads config/<file>, parses it and renders form(doc, touch). The code editor is only the fallback:
 * opened via "Als Code bearbeiten" or automatically when the YAML cannot be parsed.
 */
export function YamlView({ file, title, subtitle, empty = '', form, actions, afterSave, onLoad }) {
  const [st, setSt] = useState({ loading: true });
  const docRef = useRef(null);
  const textRef = useRef('');
  const origRef = useRef('');
  const [, setTick] = useState(0);

  const load = async () => {
    onLoad?.(); // e.g. reload a second file edited alongside (services view: settings.yaml)
    try {
      const text = await api.readOr('config', file, empty);
      textRef.current = origRef.current = text;
      const doc = parseDoc(text);
      const err = yamlErr(doc);
      docRef.current = err ? null : doc;
      setSt({ mode: err ? 'code' : 'form', err, dirty: false, ver: Date.now() });
      setDirty(false);
    } catch (e) { setSt({ fatal: e.message }); }
  };
  useEffect(() => { load(); return () => setDirty(false); }, [file]);

  // touch(false) resets the dirty flag, e.g. after a cancelled dialog restored the previous state.
  const touch = (d = true) => { setSt((s) => (s.dirty === d ? s : { ...s, dirty: d })); setDirty(d); setTick((t) => t + 1); };

  const toCode = () => {
    if (st.dirty && docRef.current) textRef.current = stringifyDoc(docRef.current, origRef.current);
    setSt((s) => ({ ...s, mode: 'code', ver: Date.now() }));
  };
  const toForm = () => {
    const doc = parseDoc(textRef.current);
    const err = yamlErr(doc);
    if (err) { setSt((s) => ({ ...s, err })); return toast(t('YAML-Fehler: {msg}', { msg: err.msg }), 'err'); }
    docRef.current = doc;
    setSt((s) => ({ ...s, mode: 'form', err: null }));
  };
  const save = async () => {
    const text = st.mode === 'form' ? stringifyDoc(docRef.current, origRef.current) : textRef.current;
    const err = yamlErr(parseDoc(text));
    if (err) {
      // Never write broken YAML; show it in the code editor instead.
      textRef.current = text;
      setSt((s) => ({ ...s, mode: 'code', err, ver: Date.now() }));
      return toast(t('Nicht gespeichert – YAML-Fehler: {msg}', { msg: err.msg }), 'err');
    }
    try {
      await api.write('config', file, text);
      textRef.current = origRef.current = text;
      if (st.mode === 'code') docRef.current = parseDoc(text);
      setSt((s) => ({ ...s, dirty: false, err: null }));
      setDirty(false);
      toast(t('{file} gespeichert', { file }));
    } catch (e) { return toast(e.message, 'err'); }
    await afterSave?.(text);
  };
  useSaveKey(save);

  if (st.fatal) return html`<div class="alert pad">${st.fatal}</div>`;
  if (st.loading) return html`<div class="muted pad">${t('Lade…')}</div>`;
  return html`<div class="view">
    <header class="view-head">
      <div><h1>${title}</h1><div class="muted small">${subtitle || 'config/' + file}</div></div>
      <div class="actions">
        ${st.dirty && html`<span class="badge">${t('ungespeichert')}</span>`}
        ${st.mode === 'form' && actions}
        ${st.mode === 'form'
          ? html`<button class="btn ghost" onClick=${toCode}><${I} n="code-xml" /> ${t('Als Code bearbeiten')}</button>`
          : html`<button class="btn ghost" onClick=${toForm}><${I} n="layout-grid" /> ${t('Zurück zum visuellen Editor')}</button>`}
        <button class="btn" onClick=${async () => { if (!st.dirty || (await confirmDlg(t('Änderungen verwerfen?'), t('Die Datei wird neu geladen.'), t('Verwerfen'), true))) load(); }}><${I} n="rotate-ccw" /> ${t('Neu laden')}</button>
        <button class="btn primary" onClick=${save}><${I} n="save" /> ${t('Speichern')}</button>
      </div>
    </header>
    ${st.err && html`<div class="alert">${yamlErrText(st.err)}
      ${st.mode === 'code' && ' – ' + t('bitte im Code korrigieren, dann zurück zum visuellen Editor.')}</div>`}
    ${st.mode === 'form'
      ? html`<div class="form-area">${form(docRef.current, touch)}</div>`
      : html`<${CodeEditor} key=${st.ver} value=${textRef.current} mode="yaml" errorLine=${st.err?.line} onSave=${save}
          onChange=${(t) => { textRef.current = t; touch(); }} />`}
  </div>`;
}

// ---------------- image picker (uses the file browser in pick mode) ----------------
let FileBrowserRef = null;
export const registerFileBrowser = (c) => { FileBrowserRef = c; };

function PickDialog({ root, close }) {
  return html`<${Dlg} title=${root === 'icons' ? t('Icon auswählen') : t('Hintergrund auswählen')} onClose=${() => close(null)}>
    <${FileBrowserRef} root=${root} grid=${true} pick=${(p) => close(p)} embedded=${true} />
  <//>`;
}
export const pickImage = (root) => openModal(PickDialog, { root }, 'wide');
