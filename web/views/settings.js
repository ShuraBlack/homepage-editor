import {
  html, useState, useEffect, YAML, isMap, isSeq, isScalar, findPair, getVal, setVal, subMap, single, keyOf,
  YamlView, Fields, KV, ImageInput, shownKeys, iconSrc, api, t,
} from '../lib.js';

const BLUR = ['none', 'xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl'];
const COLORS = ['slate', 'gray', 'zinc', 'neutral', 'stone', 'amber', 'yellow', 'lime', 'green', 'emerald', 'teal', 'cyan', 'sky',
  'blue', 'indigo', 'violet', 'purple', 'fuchsia', 'pink', 'rose', 'red', 'white'];
const LANGS = ['de', 'en', 'ca', 'es', 'fr', 'he', 'hr', 'hu', 'it', 'nb-NO', 'nl', 'pt', 'ru', 'sv', 'vi', 'zh-Hans', 'zh-Hant'];

const GENERAL = [
  { k: 'title', label: t('Titel') }, { k: 'description', label: t('Beschreibung') },
  { k: 'theme', label: t('Theme'), type: 'select', options: ['dark', 'light'] },
  { k: 'color', label: t('Farbe'), type: 'select', options: COLORS },
  { k: 'language', label: t('Sprache'), type: 'select', options: LANGS },
  { k: 'target', label: t('Link-Ziel'), type: 'select', options: ['_blank', '_self', '_top'] },
  { k: 'favicon', label: t('Favicon'), type: 'icon', wide: true },
  { k: 'startUrl', label: t('Start-URL'), placeholder: '/' }, { k: 'base', label: t('Basis-URL') }, { k: 'instanceName', label: t('Instanzname') },
];
const LOOK = [
  { k: 'headerStyle', label: t('Gruppen-Header'), type: 'select', options: ['underlined', 'boxed', 'clean', 'boxedWidgets'] },
  { k: 'cardBlur', label: t('Karten-Blur'), type: 'select', options: BLUR },
  { k: 'statusStyle', label: t('Status-Stil'), type: 'select', options: ['dot', 'basic'] },
  { k: 'iconStyle', label: t('Icon-Stil'), type: 'select', options: ['gradient', 'theme'] },
  { k: 'cardStyle', label: t('Karten-Stil'), type: 'select', options: ['hairline'] },
  { k: 'blockStyle', label: t('Block-Stil'), type: 'select', options: ['refined'] },
  { k: 'font', label: t('Schrift'), type: 'select', options: ['plex', 'plexData'] },
  { k: 'bookmarksStyle', label: t('Bookmarks-Stil'), type: 'select', options: ['icons'] },
  { k: 'maxGroupColumns', label: t('Max. Gruppen-Spalten'), type: 'number' },
  { k: 'maxBookmarkGroupColumns', label: t('Max. Bookmark-Spalten'), type: 'number' },
  { k: 'fullWidth', label: t('Volle Breite'), type: 'bool' }, { k: 'useEqualHeights', label: t('Gleiche Höhen'), type: 'bool' },
  { k: 'groupsInitiallyCollapsed', label: t('Gruppen eingeklappt'), type: 'bool' }, { k: 'disableCollapse', label: t('Einklappen deaktivieren'), type: 'bool' },
  { k: 'showStats', label: t('Docker-Stats'), type: 'bool' },
];
const MISC = [
  { k: 'hideVersion', label: t('Version ausblenden'), type: 'bool' }, { k: 'hideErrors', label: t('Fehler ausblenden'), type: 'bool' },
  { k: 'disableUpdateCheck', label: t('Update-Check aus'), type: 'bool' }, { k: 'disableIndexing', label: t('Suchmaschinen sperren'), type: 'bool' },
  { k: 'logpath', label: t('Log-Pfad') },
];
const QUICK = [
  { k: 'disabled', label: t('Deaktiviert'), type: 'bool' }, { k: 'searchDescriptions', label: t('Beschreibungen durchsuchen'), type: 'bool' },
  { k: 'hideInternetSearch', label: t('Internetsuche ausblenden'), type: 'bool' }, { k: 'showSearchSuggestions', label: t('Suchvorschläge'), type: 'bool' },
  { k: 'hideVisitURL', label: t('„URL besuchen“ ausblenden'), type: 'bool' },
  { k: 'provider', label: t('Anbieter'), type: 'select', options: ['google', 'duckduckgo', 'bing', 'baidu', 'brave', 'custom'] },
  { k: 'url', label: t('Eigene Such-URL') }, { k: 'suggestionUrl', label: t('Vorschlags-URL') }, { k: 'target', label: t('Ziel') },
  { k: 'mobileButtonPosition', label: t('Mobil-Button'), type: 'select', options: ['top-left', 'top-right', 'bottom-left', 'bottom-right'] },
];
const BG = [
  { k: 'blur', label: t('Blur'), type: 'select', options: BLUR },
  { k: 'saturate', label: t('Sättigung (%)'), type: 'number', placeholder: '100' },
  { k: 'brightness', label: t('Helligkeit (%)'), type: 'number', placeholder: '100' },
  { k: 'opacity', label: t('Deckkraft (0–100)'), type: 'number', placeholder: '100' },
];
export const LAYOUT = [
  { k: 'style', label: t('Stil'), type: 'select', options: ['row', 'column'] },
  { k: 'columns', label: t('Spalten'), type: 'number' },
  { k: 'header', label: t('Header'), type: 'bool' },
  { k: 'tab', label: t('Tab') },
  { k: 'icon', label: t('Icon') },
  { k: 'initiallyCollapsed', label: t('Eingeklappt'), type: 'bool' },
  { k: 'iconsOnly', label: t('Nur Icons'), type: 'bool' },
  { k: 'useEqualHeights', label: t('Gleiche Höhen'), type: 'bool' },
];

export function Settings() {
  return html`<${YamlView} file="settings.yaml" title=${t('Einstellungen')} empty=""
    form=${(doc, touch) => html`<${SettingsForm} doc=${doc} touch=${touch} />`} />`;
}

const Section = ({ title, children, hint }) => html`<section class="card"><header class="card-head"><h2>${title}</h2>
  ${hint && html`<span class="muted small">${hint}</span>`}</header><div class="card-body">${children}</div></section>`;

function SettingsForm({ doc, touch }) {
  if (doc.contents == null) doc.contents = doc.createNode({});
  const root = doc.contents;
  if (!isMap(root)) return html`<div class="alert">${t('settings.yaml ist keine Map. Bitte „Als Code bearbeiten“ nutzen.')}</div>`;
  const quick = subMap(doc, root, 'quicklaunch', false);
  const all = [...GENERAL, ...LOOK, ...MISC];
  return html`<div class="stack">
    <${Section} title=${t('Allgemein')}><${Fields} map=${root} fields=${GENERAL} touch=${touch} /><//>
    <${Section} title=${t('Hintergrund')}><${Background} doc=${doc} root=${root} touch=${touch} /><//>
    <${Section} title=${t('Darstellung')}><${Fields} map=${root} fields=${LOOK} touch=${touch} /><//>
    <${Section} title=${t('Layout')} hint=${t('Pro Gruppe aus services.yaml, verschachtelt wie dort.')}>
      <${Layout} doc=${doc} root=${root} touch=${touch} /><//>
    <${Section} title=${t('Quick Launch')}>
      <${Fields} map=${quick} ensure=${() => subMap(doc, root, 'quicklaunch', true)} fields=${QUICK} touch=${touch} /><//>
    <${Section} title=${t('Sonstiges')}>
      <${Fields} map=${root} fields=${MISC} touch=${touch} />
      <${KV} doc=${doc} map=${root} touch=${touch} title=${t('Weitere Einstellungen (z. B. providers, blockHighlights)')}
        exclude=${[...shownKeys(root, all), 'background', 'layout', 'quicklaunch']} /><//>
  </div>`;
}

function Background({ doc, root, touch }) {
  const pair = findPair(root, 'background');
  const v = pair?.value;
  const obj = isMap(v) ? v : null;
  const image = obj ? getVal(obj, 'image') : isScalar(v) ? v.value : '';
  const setImage = (val) => { obj ? setVal(obj, 'image', val) : setVal(root, 'background', val); touch(); };
  // Filters need the object form `background: {image, ...}`; convert a plain string on first use.
  const ensure = () => {
    const p = findPair(root, 'background');
    if (p && isMap(p.value)) return p.value;
    const m = doc.createNode(image ? { image } : {});
    if (p) p.value = m;
    else root.items.push(new YAML.Pair(new YAML.Scalar('background'), m));
    return m;
  };
  const src = iconSrc(image);
  const num = (k, d) => { const x = getVal(obj, k); return typeof x === 'number' ? x : d; };
  const style = src ? `background-image:url("${src}");filter:saturate(${num('saturate', 100)}%) brightness(${num('brightness', 100)}%);opacity:${num('opacity', 100) / 100}` : '';
  return html`<div class="bg-edit">
    <div class="bg-prev" style=${style}>${!src && html`<span class="muted small">${t('Kein Hintergrund')}</span>`}</div>
    <div class="grow">
      <div class="field wide"><label>${t('Bild')}</label>
        <${ImageInput} value=${image} root="backgrounds" onValue=${setImage} placeholder=${t('/images/hintergrund.jpg oder https://…')} /></div>
      <${Fields} map=${obj} ensure=${ensure} fields=${BG} touch=${touch} />
      ${getVal(root, 'cardBlur') && obj && (getVal(obj, 'blur') || getVal(obj, 'saturate') != null || getVal(obj, 'brightness') != null)
        && html`<p class="muted small">${t('Hinweis: laut Doku verträgt sich cardBlur nicht mit Blur/Sättigung/Helligkeit des Hintergrunds.')}</p>`}
    </div>
  </div>`;
}

// ----- layout: mirrors the (nested) group tree of services.yaml -----
// `- Games:` parses as a Scalar(null), not as null – both mean "empty group" at the top level.
export const isEmptyNode = (v) => v == null || (isScalar(v) && v.value == null);
export function groupTree(seq, depth = 0) {
  if (!isSeq(seq)) return [];
  return seq.items.map(single).filter((s) => s && (isSeq(s.value) || (depth === 0 && isEmptyNode(s.value))))
    .map((s) => ({ name: s.name, children: groupTree(s.value, depth + 1) }));
}

const SLOT = {}; // marks where a group entry was taken out of the layout

/**
 * Make `layout` mirror the group tree of services.yaml: same nesting, same order, one entry per group.
 * Homepage sorts and nests groups by `layout`, so a stale layout overrides services.yaml.
 * Entries move with their options (style, columns, …) and comments; groups without an entry get `{}`.
 * Keys that are no service group (bookmark/docker groups, options) keep their place.
 */
export function syncLayoutTree(doc, layout, groups) {
  const names = new Set();
  (function collect(gs) { for (const g of gs) { names.add(g.name); collect(g.children); } })(groups);

  const pool = new Map(); // group name -> existing entries, wherever they were nested
  (function detach(map) {
    map.items.forEach((p, i) => {
      if (p === SLOT) return;
      const k = String(keyOf(p));
      if (names.has(k)) {
        if (!pool.has(k)) pool.set(k, []);
        pool.get(k).push(p);
        map.items[i] = SLOT;
      }
      if (isMap(p.value)) detach(p.value);
    });
  })(layout);

  const take = (name) => pool.get(name)?.shift() || new YAML.Pair(new YAML.Scalar(name), doc.createNode({}));
  (function place(map, gs) {
    const entries = gs.map((g) => take(g.name));
    const out = [];
    let next = 0;
    let after = -1; // groups without an old slot go right after the last placed group
    for (const it of map.items) {
      if (it !== SLOT) out.push(it);
      else if (next < entries.length) { out.push(entries[next++]); after = out.length; }
    }
    out.splice(after < 0 ? out.length : after, 0, ...entries.slice(next));
    map.items = out;
    gs.forEach((g, i) => {
      if (!g.children.length) return;
      if (!isMap(entries[i].value)) entries[i].value = doc.createNode({});
      place(entries[i].value, g.children);
    });
  })(layout, groups);

  // slots left in maps that are no service group (e.g. a group moved out of a stale entry)
  (function clean(map) {
    map.items = map.items.filter((p) => p !== SLOT);
    for (const p of map.items) if (isMap(p.value)) clean(p.value);
  })(layout);
}

function Layout({ doc, root, touch }) {
  const [groups, setGroups] = useState(null);
  useEffect(() => {
    api.readOr('config', 'services.yaml', '[]')
      .then((txt) => setGroups(groupTree(YAML.parseDocument(txt).contents)))
      .catch(() => setGroups([]));
  }, []);
  const layout = findPair(root, 'layout')?.value;
  if (layout && !isMap(layout)) return html`<p class="muted">${t('Layout ist als Liste definiert – bitte „Als Code bearbeiten“ nutzen.')}</p>`;
  if (!groups) return html`<p class="muted">${t('Lade Gruppen…')}</p>`;
  if (!groups.length) return html`<p class="muted">${t('Keine Gruppen in services.yaml.')}</p>`;
  const ensureLayout = () => subMap(doc, root, 'layout', true);
  const sync = () => syncLayoutTree(doc, ensureLayout(), groups);
  return html`<div class="layout-tree">
    ${isMap(layout) && html`<div class="toolbar"><button type="button" class="btn" onClick=${() => { sync(); touch(); }}>${t('An services.yaml angleichen')}</button>
      <span class="muted small">${t('Passiert auch automatisch beim Speichern der Services.')}</span></div>`}
    <div class="layout-row head"><span>${t('Gruppe')}</span>${LAYOUT.map((f) => html`<span>${f.label}</span>`)}</div>
    ${groups.map((g) => html`<${LayoutRow} doc=${doc} parent=${isMap(layout) ? layout : null} ensureParent=${ensureLayout} g=${g} sync=${sync} depth=${0} touch=${touch} />`)}
  </div>`;
}

function LayoutRow({ doc, parent, ensureParent, g, sync, depth, touch }) {
  const entry = parent ? subMap(doc, parent, g.name, false) : null;
  const ensure = () => {
    const m = subMap(doc, parent || ensureParent(), g.name, true);
    sync(); // a new entry is appended at the end; put it (and everything else) where services.yaml has it
    return m;
  };
  return html`<div class="layout-row" style=${`--d:${depth}`}>
      <span class="layout-name" title=${g.name}>${g.name}</span>
      <${Fields} map=${entry} ensure=${ensure} fields=${LAYOUT} touch=${touch} />
    </div>
    ${g.children.map((c) => html`<${LayoutRow} doc=${doc} parent=${entry} ensureParent=${ensure} g=${c} sync=${sync} depth=${depth + 1} touch=${touch} />`)}`;
}
