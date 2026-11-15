import {
  html, useState, useEffect, useRef, YAML, isMap, isSeq, single, setKey, getVal, setVal, findPair, subMap, moveItem, containsNode,
  Icon, YamlView, Field, Fields, KV, shownKeys, promptDlg, confirmDlg, openModal, api, I, IconBtn, Dlg, isDirty,
  parseDoc, stringifyDoc, toast, t,
} from '../lib.js';
import { groupTree, syncLayoutTree, LAYOUT, isEmptyNode } from './settings.js';

export const WIDGET_TYPES = `adguard audiobookshelf authentik autobrr azuredevops bazarr beszel caddy calendar calibreweb changedetectionio
channelsdvrserver cloudflared coinmarketcap crowdsec customapi deluge develancacheui diskstation downloadstation emby esphome evcc
fileflows firefly flood freshrss frigate fritzbox gamedig gatus ghostfolio gitea gitlab glances gluetun gotify grafana hdhomerun
headscale healthchecks homeassistant homebox homebridge iframe immich jackett jdownloader jellyfin jellyseerr karakeep kavita komga
kopia lidarr linkwarden lubelogger mailcow mastodon mealie medusa mikrotik minecraft miniflux mjpeg moonraker mylar myspeed navidrome
netalertx netdata nextcloud nextdns npm nzbget octoprint omada ombi opendtu openmediavault openwrt opnsense overseerr paperlessngx
peanut pfsense photoprism pihole plantit plex portainer prometheus prometheusmetric prowlarr proxmox proxmoxbackupserver pterodactyl
pyload qbittorrent qnap radarr readarr romm rutorrent sabnzbd scrutiny sonarr speedtest stash swagdashboard syncthingrelayserver
tailscale tandoor tautulli tdarr traefik transmission truenas tubearchivist unifi unmanic uptimekuma uptimerobot urbackup vikunja
watchtower wgeasy whatsupdocker xteve zabbix`.split(/\s+/);

const SVC_FIELDS = [
  { k: 'href', label: t('Link (href)'), placeholder: 'https://…', wide: true },
  { k: 'description', label: t('Beschreibung'), wide: true },
  { k: 'icon', label: t('Icon'), type: 'icon', wide: true, placeholder: 'sonarr.png · mdi-home · si-github · sh-… · /images/icons/x.png',
    hint: t('Eigene Bilder über „Auswählen…“, sonst Name aus Dashboard-Icons bzw. mdi-/si-/sh-Präfix.') },
  { k: 'siteMonitor', label: t('Site-Monitor (URL)'), placeholder: t('http://intern:port') },
  { k: 'ping', label: t('Ping (Host)') },
  { k: 'statusStyle', label: t('Status-Stil'), type: 'select', options: ['dot', 'basic'] },
  { k: 'target', label: t('Link-Ziel'), type: 'select', options: ['_blank', '_self', '_top'] },
  { k: 'server', label: t('Docker-Server') },
  { k: 'container', label: t('Docker-Container') },
  { k: 'showStats', label: t('Docker-Stats zeigen'), type: 'bool' },
  { k: 'proxmoxNode', label: t('Proxmox-Node'), type: 'combo', options: [] },
  { k: 'proxmoxVMID', label: t('Proxmox-VMID'), type: 'number' },
  { k: 'proxmoxType', label: t('Proxmox-Typ'), type: 'select', options: ['qemu', 'lxc'] },
];
const TOP = t('— oberste Ebene (Tab)');

// ---------- settings.yaml: the layout lives there, but is edited here together with services.yaml ----------

function layoutMap(ldoc) {
  const l = isMap(ldoc?.contents) ? getVal(ldoc.contents, 'layout') : null;
  return isMap(l) ? l : null;
}

/** [pair, parentMap] of the layout entry for a group path like ['Infra', 'Server'], or null. */
function layoutPair(ldoc, path) {
  let map = layoutMap(ldoc);
  let found = null;
  for (const name of path) {
    const pair = isMap(map) ? findPair(map, name) : null;
    if (!pair) return null;
    found = [pair, map];
    map = pair.value;
  }
  return found;
}
const layoutEntry = (ldoc, path) => { const p = layoutPair(ldoc, path); return p && isMap(p[0].value) ? p[0].value : null; };

/** Create `layout` if needed, mirror the services tree into it and return the (map) entry for `path`. */
function ensureEntry(ldoc, sdoc, path) {
  if (ldoc.contents == null) ldoc.contents = ldoc.createNode({});
  syncLayoutTree(ldoc, subMap(ldoc, ldoc.contents, 'layout', true), groupTree(sdoc.contents));
  const [pair] = layoutPair(ldoc, path);
  if (!isMap(pair.value)) pair.value = ldoc.createNode({});
  return pair.value;
}

function useSettingsDoc() {
  const [st, setSt] = useState({});
  const ref = useRef(st);
  ref.current = st;
  const set = (v) => { ref.current = v; setSt(v); }; // ref first: YamlView takes its undo snapshot right after reload()
  const reload = async () => {
    try {
      const src = await api.readOr('config', 'settings.yaml', '');
      const doc = parseDoc(src);
      if (doc.errors.length || (doc.contents != null && !isMap(doc.contents))) {
        return set({ err: t('settings.yaml enthält Fehler – Layout ist hier nicht bearbeitbar. Bitte unter „Einstellungen“ korrigieren.') });
      }
      set({ doc, src, base: stringifyDoc(doc, src) });
    } catch (e) { set({ err: e.message }); }
  };
  /** settings.yaml as it would be written together with `servicesText`, or null without a usable settings doc. */
  const layoutText = (servicesText) => {
    const { doc, src } = ref.current;
    if (!doc) return null;
    const layout = layoutMap(doc);
    if (layout) syncLayoutTree(doc, layout, groupTree(parseDoc(servicesText).contents));
    return stringifyDoc(doc, src);
  };
  // after services.yaml was saved: write the layout too, if it changed
  const save = async (servicesText) => {
    const out = layoutText(servicesText);
    if (out == null || out === ref.current.base) return;
    try {
      await api.write('config', 'settings.yaml', out);
      set({ doc: ref.current.doc, src: out, base: out });
      toast(t('Layout in settings.yaml gespeichert'));
    } catch (e) { toast(t('settings.yaml nicht gespeichert: {msg}', { msg: e.message }), 'err'); }
  };
  // second file for YamlView: undo snapshots and the compare dialog
  const extra = {
    snap: () => ref.current.doc?.toString({ lineWidth: 0 }) ?? '',
    restore: (text) => { if (ref.current.doc) ref.current.doc.contents = parseDoc(text).contents; },
    pending: (servicesText) => {
      const out = layoutText(servicesText);
      return out != null && out !== ref.current.base ? { file: 'settings.yaml', before: ref.current.src, after: out } : null;
    },
  };
  return { ...st, reload, save, extra };
}

export function Services() {
  const lay = useSettingsDoc();
  return html`<${YamlView} file="services.yaml" title=${t('Services')} empty="[]" onLoad=${lay.reload} afterSave=${lay.save} extra=${lay.extra}
    form=${(doc, touch) => html`<${ServicesForm} doc=${doc} touch=${touch} lay=${lay} />`} />`;
}

// ---------- tree helpers ----------

const isGroupNode = (item, depth) => { const s = single(item); return !!s && (isSeq(s.value) || (depth === 0 && isEmptyNode(s.value))); };
const ensureSeq = (doc, item) => { const s = single(item); if (!isSeq(s.pair.value)) s.pair.value = doc.createNode([]); return s.pair.value; };

/** Every group as a possible target: {label: 'A › B', node, seq()} (skip excludes a group and its subtree). */
function containers(doc, skip) {
  const out = [];
  (function walk(seq, path, depth) {
    if (!isSeq(seq)) return;
    for (const it of seq.items) {
      if (it === skip || !isGroupNode(it, depth)) continue;
      const s = single(it);
      const p = [...path, s.name];
      out.push({ label: p.join(' › '), node: it, seq: () => ensureSeq(doc, it) });
      walk(s.value, p, depth + 1);
    }
  })(doc.contents, [], 0);
  return out;
}

// ---------- drag & drop: the target container is outlined and named, so nothing lands in the wrong place ----------

let drag = null; // { seq, idx, group }
let hoverBox = null;
let hoverItem = null;
function mark(box, item) {
  if (hoverBox !== box) { hoverBox?.classList.remove('drop-target'); box?.classList.add('drop-target'); hoverBox = box; }
  if (hoverItem !== item) { hoverItem?.classList.remove('drop-before'); item?.classList.add('drop-before'); hoverItem = item; }
}
const startDrag = (seq, idx, group) => (e) => {
  e.stopPropagation();
  drag = { seq, idx, group };
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', '');
  document.body.classList.add('dragging');
};
const endDrag = () => { drag = null; mark(null, null); document.body.classList.remove('dragging'); };

function moveDragged(ctx, toSeq, toIdx) {
  const it = drag.seq.items[drag.idx];
  if (drag.group && toSeq !== ctx.doc.contents) ensureSeq(ctx.doc, it); // an empty `Group:` must stay a group when nested
  moveItem(drag.seq, drag.idx, toSeq, toIdx ?? toSeq.items.length);
}

/**
 * Drop "before idx" (or append when idx is null) into the list getSeq() returns.
 * guard: the group that owns that list – a group can't be dropped into itself or its children.
 */
function dropProps(ctx, guard, getSeq, idx) {
  const ok = () => drag && !containsNode(drag.seq.items[drag.idx], guard) && (guard !== ctx.doc.contents || drag.group);
  return {
    onDragOver: (e) => {
      if (!ok()) return;
      e.preventDefault();
      e.stopPropagation();
      mark(e.currentTarget.closest('[data-container]'), e.currentTarget);
    },
    onDrop: (e) => {
      if (!ok()) return;
      e.preventDefault();
      e.stopPropagation();
      const name = hoverBox?.dataset.container;
      const from = drag.seq;
      const to = getSeq();
      moveDragged(ctx, to, idx);
      endDrag();
      ctx.touch();
      if (from !== to && name) toast(t('Verschoben nach {name}', { name }));
    },
  };
}

// ---------- search: matching services are outlined, the rest dimmed; tabs show their number of hits ----------

const svcHit = (q, s) => {
  const m = isMap(s.value) ? s.value : null;
  return [s.name, getVal(m, 'description'), getVal(m, 'href')].some((v) => typeof v === 'string' && v.toLowerCase().includes(q));
};
/** Matching services in `items` (list entries at `depth`), counted through all subgroups. */
function countHits(q, items, depth) {
  let n = 0;
  for (const it of items) {
    const s = single(it);
    if (!s) continue;
    n += isGroupNode(it, depth) ? countHits(q, isSeq(s.value) ? s.value.items : [], depth + 1) : svcHit(q, s) ? 1 : 0;
  }
  return n;
}

// The quick search (Ctrl+K) asks for a service: picked up when the form mounts, or via event when it is already shown.
let pendingQuery = '';
const takeQuery = () => { const q = pendingQuery; pendingQuery = ''; return q; };
export function searchServices(q) { pendingQuery = q; dispatchEvent(new Event('hpe-search')); }

// ---------- page ----------

function ServicesForm({ doc, touch, lay }) {
  const [active, setActive] = useState(0);
  const [query, setQuery] = useState('');
  const searchRef = useRef(null); // set below, after the early return for broken files
  useEffect(() => {
    const h = () => { const q = takeQuery(); if (q) searchRef.current?.(q); };
    h();
    addEventListener('hpe-search', h);
    return () => removeEventListener('hpe-search', h);
  }, []);
  if (doc.contents == null) doc.contents = doc.createNode([]);
  if (!isSeq(doc.contents)) return html`<div class="alert">${t('services.yaml ist keine Liste von Gruppen. Bitte „Als Code bearbeiten“ nutzen.')}</div>`;
  const top = doc.contents.items;
  const cur = Math.max(0, Math.min(active, top.length - 1));
  // every change re-mirrors the group tree into the layout, so group settings always sit at the right place
  const tick = (d) => { const l = layoutMap(lay.doc); if (l) syncLayoutTree(lay.doc, l, groupTree(doc.contents)); touch(d); };
  const q = query.trim().toLowerCase();
  const hits = q ? top.map((it) => countHits(q, [it], 0)) : null;
  const ctx = { doc, touch: tick, lay, active: cur, setActive, q, hits };
  const search = (v) => {
    setQuery(v);
    const nq = v.trim().toLowerCase();
    // current tab has no hit: jump to the first one that has
    if (nq && !countHits(nq, [top[cur]], 0)) { const i = top.findIndex((it) => countHits(nq, [it], 0)); if (i >= 0) setActive(i); }
  };
  searchRef.current = search;

  const addTab = async () => {
    const n = await promptDlg(t('Neuer Tab'), '', t('Name der neuen obersten Gruppe (so heißt sie auch in services.yaml)'));
    if (!n) return;
    if (top.some((it) => single(it)?.name === n)) return toast(t('„{name}“ gibt es schon', { name: n }), 'err');
    top.push(doc.createNode({ [n]: [] }));
    setActive(top.length - 1);
    tick();
  };

  return html`<div class="services" onDragOver=${() => mark(null, null)}>
    ${lay.err && html`<div class="alert">${lay.err}</div>`}
    <div class="svc-tabs">
      <div class="svc-tablist" role="tablist" aria-label=${t('Oberste Gruppen')}>
        ${top.map((_, i) => html`<${Tab} key=${i} ctx=${ctx} idx=${i} />`)}
        <button class="chip" onClick=${addTab}><${I} n="plus" s=${12} /> ${t('Tab')}</button>
      </div>
      <input class="inp filter" type="search" placeholder=${t('Services suchen…')} aria-label=${t('Services suchen')} value=${query}
        onInput=${(e) => search(e.target.value)} onKeyDown=${(e) => { if (e.key === 'Escape' && query) { e.preventDefault(); setQuery(''); } }} />
    </div>
    ${top.length
      ? html`<${Item} key=${cur} ctx=${ctx} seq=${doc.contents} idx=${cur} depth=${0} path=${[]} guard=${doc.contents} panel=${true} />`
      : html`<p class="muted pad">${t('Noch keine Gruppen. Lege mit „+ Tab“ die erste an.')}</p>`}
    <p class="muted small hint">${t('Ziehen zum Umsortieren – der Ziel-Container wird umrandet und benannt. Auf einen Tab ziehen verschiebt in diese Gruppe (kurz halten öffnet den Tab). Exakt geht es über „Gruppe“ bzw. „Liegt in“ im Dialog.')}</p>
  </div>`;
}

function Tab({ ctx, idx }) {
  const top = ctx.doc.contents;
  const item = top.items[idx];
  const s = single(item);
  const timer = useRef(null);
  const name = s ? s.name : '?';
  const count = s && isSeq(s.value) ? s.value.items.length : 0;
  const reorder = () => drag && drag.seq === top && drag.idx !== idx;
  const into = () => drag && drag.seq !== top && isGroupNode(item, 0) && !containsNode(drag.seq.items[drag.idx], item);
  const active = idx === ctx.active;
  const hits = ctx.hits?.[idx];
  return html`<button role="tab" aria-selected=${active} class=${'svc-tab' + (active ? ' active' : '') + (hits === 0 ? ' dim' : '')} data-container=${name}
    draggable="true" onDragStart=${startDrag(top, idx, true)} onDragEnd=${endDrag} onClick=${() => ctx.setActive(idx)}
    onDragEnter=${() => { if (into()) { clearTimeout(timer.current); timer.current = setTimeout(() => ctx.setActive(idx), 700); } }}
    onDragLeave=${() => clearTimeout(timer.current)}
    onDragOver=${(e) => {
      if (!reorder() && !into()) return;
      e.preventDefault();
      e.stopPropagation();
      if (reorder()) mark(null, e.currentTarget);
      else mark(e.currentTarget, null);
    }}
    onDrop=${(e) => {
      clearTimeout(timer.current);
      if (!reorder() && !into()) return;
      e.preventDefault();
      e.stopPropagation();
      if (reorder()) {
        const shown = top.items[ctx.active];
        moveDragged(ctx, top, idx);
        ctx.setActive(top.items.indexOf(shown));
      } else {
        moveDragged(ctx, ensureSeq(ctx.doc, item), null);
        toast(t('Verschoben nach {name}', { name }));
      }
      endDrag();
      ctx.touch();
    }}>
    <span>${name}</span>${hits == null ? html`<span class="count">${count}</span>`
      : html`<span class=${'count' + (hits ? ' hit' : '')} title=${t('Treffer')}>${hits}</span>`}
  </button>`;
}

function DropEnd({ ctx, guard, getSeq }) {
  return html`<div class="drop-end" ...${dropProps(ctx, guard, getSeq, null)}>${t('hier ablegen (ans Ende)')}</div>`;
}

function Item({ ctx, seq, idx, depth, path, guard, panel }) {
  const item = seq.items[idx];
  const s = single(item);
  if (!s) return html`<div class="svc bad">${t('Unbekannter Eintrag (im Code bearbeiten)')}</div>`;
  return isGroupNode(item, depth)
    ? html`<${Group} ctx=${ctx} seq=${seq} idx=${idx} s=${s} depth=${depth} path=${path} guard=${guard} panel=${panel} />`
    : html`<${Service} ctx=${ctx} seq=${seq} idx=${idx} s=${s} guard=${guard} />`;
}

// Homepage (components/services/group.jsx + list.jsx): with style "row", services AND subgroups form a grid of
// `columns` columns (none set = 1); otherwise both are stacked. `columns` without "row" has no effect.
const styleLabel = (style, cols) => (style === 'row' ? `${t('Zeile')} · ${cols || 1} ${cols > 1 ? t('Spalten') : t('Spalte')}` : t('Spalte'));

function Group({ ctx, seq, idx, s, depth, path, guard, panel }) {
  const { doc } = ctx;
  const [open, setOpen] = useState(true);
  const item = seq.items[idx];
  const myPath = [...path, s.name];
  const entry = layoutEntry(ctx.lay.doc, myPath);
  const style = getVal(entry, 'style') === 'row' ? 'row' : 'column';
  const cols = Number(getVal(entry, 'columns')) || null;
  const grid = style === 'row' ? `grid-template-columns:repeat(${cols || 1},minmax(0,1fr))` : '';
  const icon = getVal(entry, 'icon');
  const tab = getVal(entry, 'tab');
  const list = isSeq(s.value) ? s.value : null;
  const svcs = [];
  const subs = [];
  (list?.items || []).forEach((it, i) => (isGroupNode(it, depth + 1) ? subs : svcs).push(i));
  const getSeq = () => ensureSeq(doc, item);

  const addService = async () => {
    const n = await promptDlg(t('Neuer Service'), '', t('In „{path}“', { path: myPath.join(' › ') }));
    if (!n) return;
    const node = doc.createNode({ [n]: {} });
    getSeq().items.push(node);
    ctx.touch();
    editService(ctx, getSeq(), node, true);
  };
  const addSub = async () => {
    const n = await promptDlg(t('Neue Untergruppe'), '', t('In „{path}“', { path: myPath.join(' › ') }));
    if (!n) return;
    getSeq().items.push(doc.createNode({ [n]: [] }));
    ctx.touch();
  };

  // Homepage shows a group's services first, then its subgroups – so does this preview.
  return html`<section class=${`group depth-${Math.min(depth, 3)} ${style}${panel ? ' panel' : ''}`}>
    <header class="group-head" draggable=${!panel} onDragStart=${panel ? undefined : startDrag(seq, idx, true)} onDragEnd=${endDrag}
      ...${panel ? {} : dropProps(ctx, guard, () => seq, idx)}>
      ${!panel && html`<span class="handle"><${I} n="grip-vertical" /></span>`}
      ${typeof icon === 'string' && icon && html`<${Icon} icon=${icon} size=${20} />`}
      ${panel
        ? html`<span class="group-name">${s.name}</span>`
        : html`<button class="link-btn group-name" aria-expanded=${open} onClick=${() => setOpen(!open)}><${I} n=${open ? 'chevron-down' : 'chevron-right'} /> ${s.name}</button>`}
      <span class="badge ghost" title=${t('Layout aus settings.yaml')}>${styleLabel(style, cols)}</span>
      ${tab && html`<span class="badge ghost">${t('Tab')}: ${String(tab)}</span>`}
      <span class="count">${list ? list.items.length : 0}</span>
      <span class="group-actions">
        ${panel
          ? html`<button class="chip" onClick=${addService}><${I} n="plus" s=${12} /> ${t('Service')}</button>
            <button class="chip" onClick=${addSub}><${I} n="plus" s=${12} /> ${t('Untergruppe')}</button>`
          : html`<${IconBtn} n="plus" label=${t('Service in {name} anlegen', { name: s.name })} onClick=${addService} />
            <${IconBtn} n="folder-plus" label=${t('Untergruppe in {name} anlegen', { name: s.name })} onClick=${addSub} />`}
        <${IconBtn} n="settings" label=${t('Gruppe {name} bearbeiten', { name: s.name })} onClick=${() => editGroup(ctx, seq, item, path)} />
      </span>
    </header>
    ${(open || panel || ctx.q) && html`<div class="group-body" data-container=${myPath.join(' › ')}>
      ${svcs.length > 0 && html`<div class=${'svc-list ' + style} style=${grid}>
        ${svcs.map((i) => html`<${Item} key=${i} ctx=${ctx} seq=${list} idx=${i} depth=${depth + 1} path=${myPath} guard=${item} />`)}
      </div>`}
      ${subs.length > 0 && html`<div class="sub-groups" style=${grid}>
        ${subs.map((i) => html`<${Item} key=${i} ctx=${ctx} seq=${list} idx=${i} depth=${depth + 1} path=${myPath} guard=${item} />`)}
      </div>`}
      ${!svcs.length && !subs.length && html`<div class="muted small pad-s">${t('Leer – Services oder Untergruppen hierher ziehen.')}</div>`}
      <${DropEnd} ctx=${ctx} guard=${item} getSeq=${getSeq} />
    </div>`}
  </section>`;
}

function Service({ ctx, seq, idx, s, guard }) {
  const m = isMap(s.value) ? s.value : null;
  const icon = getVal(m, 'icon');
  const widget = getVal(m, 'widget');
  const wtype = isMap(widget) ? getVal(widget, 'type') : isSeq(getVal(m, 'widgets')) ? t('mehrere') : null;
  const sub = getVal(m, 'description') || getVal(m, 'href') || '';
  const hit = ctx.q ? (svcHit(ctx.q, s) ? ' hit' : ' dim') : '';
  const href = getVal(m, 'href');
  return html`<div class="svc-wrap"><button class=${'svc' + hit} draggable="true" onDragStart=${startDrag(seq, idx, false)} onDragEnd=${endDrag}
      ...${dropProps(ctx, guard, () => seq, idx)} onClick=${() => editService(ctx, seq, seq.items[idx], false)}>
    <${Icon} icon=${typeof icon === 'string' ? icon : null} size=${32} />
    <span class="svc-text"><strong>${s.name}</strong><span class="muted small">${String(sub)}</span></span>
    <span class="svc-badges">
      ${wtype && html`<span class="badge">${wtype}</span>`}
      ${getVal(m, 'proxmoxVMID') != null && html`<span class="badge">PVE ${getVal(m, 'proxmoxVMID')}</span>`}
    </span>
  </button>
  ${typeof href === 'string' && /^https?:\/\//.test(href) && html`<a class="svc-open" href=${href} target="_blank" rel="noopener"
    title=${t('{name} öffnen', { name: s.name })} aria-label=${t('{name} öffnen', { name: s.name })}><${I} n="external-link" s=${13} /></a>`}
  </div>`;
}

// ---------- group dialog: name, parent and layout (settings.yaml) in one place ----------

async function editGroup(ctx, seq, item, parentPath) {
  const { doc, lay } = ctx;
  const backup = item.clone();
  const layBackup = lay.doc?.clone();
  const wasDirty = isDirty();
  const move = { to: null };
  const res = await openModal(GroupDialog, { ctx, item, parentPath, from: seq, move }, 'wide');
  const i = seq.items.indexOf(item);
  if (i < 0) return;
  if (res === 'delete') {
    const lp = layoutPair(lay.doc, [...parentPath, single(item).name]);
    if (lp) lp[1].items.splice(lp[1].items.indexOf(lp[0]), 1);
    seq.items.splice(i, 1);
    return ctx.touch();
  }
  if (res !== 'ok') {
    seq.items[i] = backup;
    if (layBackup) lay.doc.contents = layBackup.contents;
    return ctx.touch(wasDirty);
  }
  const to = move.to === TOP ? doc.contents : move.to?.seq();
  if (to && to !== seq) {
    if (to !== doc.contents) ensureSeq(doc, item);
    seq.items.splice(i, 1);
    to.items.push(item);
    if (to === doc.contents) ctx.setActive(to.items.length - 1);
    toast(t('Verschoben nach {name}', { name: move.to === TOP ? t('oberste Ebene') : move.to.label }));
  }
  ctx.touch();
}

function GroupDialog({ ctx, item, parentPath, from, move, close }) {
  const { doc, lay } = ctx;
  const [, setT] = useState(0);
  const tick = () => { setT((x) => x + 1); ctx.touch(); };
  const s = single(item);
  const path = [...parentPath, s.name];
  const targets = containers(doc, item);
  const current = from === doc.contents ? TOP : targets.find((c) => single(c.node).value === from)?.label;
  const [parent, setParent] = useState(current);
  const count = isSeq(s.value) ? s.value.items.length : 0;

  const rename = (v) => {
    const lp = layoutPair(lay.doc, path); // the layout entry is keyed by name – rename it too
    setKey(s.pair, v);
    if (lp) setKey(lp[0], v);
    tick();
  };
  const entry = lay.doc ? layoutEntry(lay.doc, path) : null;

  return html`<${Dlg} title=${t('Gruppe „{name}“', { name: s.name })} onClose=${() => close('cancel')} onSubmit=${() => close('ok')}
    footer=${html`
      <button type="button" class="btn danger" onClick=${async () => {
        if (await confirmDlg(t('Gruppe „{name}“ löschen?', { name: s.name }), t('Enthält {n} Einträge, die mit gelöscht werden.', { n: count }), t('Löschen'), true)) close('delete');
      }}><${I} n="trash-2" /> ${t('Gruppe löschen')}</button>
      <span class="spacer"></span>
      <button type="button" class="btn" onClick=${() => close('cancel')}>${t('Abbrechen')}</button>
      <button class="btn primary">${t('Übernehmen')}</button>`}>
    <div class="fields">
      <${Field} f=${{ k: 'name', label: t('Name') }} value=${s.name} onValue=${rename} />
      <${Field} f=${{ k: 'parent', label: t('Liegt in'), type: 'select', options: [TOP, ...targets.map((c) => c.label)] }} value=${parent}
        onValue=${(v) => { setParent(v); move.to = v === TOP ? TOP : targets.find((c) => c.label === v) || null; }} />
    </div>
    <h4>${t('Layout')}</h4>
    ${lay.err ? html`<div class="alert">${lay.err}</div>` : !lay.doc ? html`<p class="muted">${t('Lade settings.yaml…')}</p>` : html`
      <p class="muted small">${t('Wird beim Speichern in settings.yaml unter layout geschrieben. „row“ zeigt Services und Untergruppen nebeneinander in der gewählten Spaltenzahl, „column“ untereinander.')}</p>
      <${Fields} map=${entry} ensure=${() => ensureEntry(lay.doc, doc, path)} fields=${LAYOUT} touch=${tick} />`}
  <//>`;
}

// ---------- service dialog ----------

async function editService(ctx, seq, item, isNew) {
  const backup = item.clone();
  const wasDirty = isDirty();
  const move = { to: null };
  const res = await openModal(ServiceDialog, { ctx, item, isNew, from: seq, move }, 'wide');
  const i = seq.items.indexOf(item);
  if (i < 0) return;
  const keep = res === 'ok' || res === 'duplicate'; // "Duplizieren" applies the dialog first
  if (res === 'delete' || (isNew && !keep)) seq.items.splice(i, 1);
  else if (!keep) { seq.items[i] = backup; return ctx.touch(wasDirty); }
  else if (move.to && move.to.seq() !== seq) {
    seq.items.splice(i, 1);
    move.to.seq().items.push(item);
    toast(t('Verschoben nach {name}', { name: move.to.label }));
  }
  if (res === 'duplicate') {
    const home = seq.items.includes(item) ? seq : move.to.seq();
    const copy = item.clone();
    setKey(single(copy).pair, t('{name} (Kopie)', { name: single(item).name }));
    home.items.splice(home.items.indexOf(item) + 1, 0, copy);
    ctx.touch();
    return editService(ctx, home, copy, true);
  }
  ctx.touch();
}

/** Top-level keys of a config file (Proxmox nodes, Docker servers) as suggestions; [] if missing or broken. */
function useKeys(file) {
  const [keys, setKeys] = useState([]);
  useEffect(() => {
    api.readOr('config', file, '').then((txt) => {
      try { const v = YAML.parse(txt); if (v && typeof v === 'object' && !Array.isArray(v)) setKeys(Object.keys(v)); } catch { /* no suggestions */ }
    }, () => {});
  }, []);
  return keys;
}

function ServiceDialog({ ctx, item, isNew, from, move, close }) {
  const { doc } = ctx;
  const s = single(item);
  if (!isMap(s.pair.value)) s.pair.value = doc.createNode({});
  const map = s.pair.value;
  const [, setT] = useState(0);
  const tick = () => { setT((x) => x + 1); ctx.touch(); };
  const nodes = useKeys('proxmox.yaml');
  const servers = useKeys('docker.yaml');
  const targets = containers(doc, null);
  const [group, setGroup] = useState(targets.find((c) => single(c.node).value === from)?.label);

  const widget = getVal(map, 'widget');
  const widgets = getVal(map, 'widgets');
  const addWidget = () => {
    if (isSeq(widgets)) widgets.items.push(doc.createNode({ type: '' }));
    else setValNode(map, 'widget', doc.createNode({ type: '' }));
    tick();
  };
  const removeKey = (k) => { const p = findPair(map, k); map.items.splice(map.items.indexOf(p), 1); tick(); };

  const fields = SVC_FIELDS.map((f) => (f.k === 'proxmoxNode' ? { ...f, options: nodes } : f.k === 'server' ? { ...f, type: 'combo', options: servers } : f));

  return html`<${Dlg} title=${isNew ? t('Neuer Service') : t('Service bearbeiten')} onClose=${() => close('cancel')} onSubmit=${() => close('ok')}
    footer=${html`
      ${!isNew && html`<button type="button" class="btn danger" onClick=${async () => {
        if (await confirmDlg(t('„{name}“ löschen?', { name: s.name }), '', t('Löschen'), true)) close('delete');
      }}><${I} n="trash-2" /> ${t('Service löschen')}</button>
      <button type="button" class="btn" onClick=${() => close('duplicate')}><${I} n="copy-plus" /> ${t('Duplizieren')}</button>`}
      <span class="spacer"></span>
      <button type="button" class="btn" onClick=${() => close('cancel')}>${t('Abbrechen')}</button>
      <button class="btn primary">${t('Übernehmen')}</button>`}>
    <div class="fields">
      <${Field} f=${{ k: 'name', label: t('Name') }} value=${s.name} onValue=${(v) => { setKey(s.pair, v); tick(); }} />
      <${Field} f=${{ k: 'group', label: t('Gruppe'), type: 'select', options: targets.map((c) => c.label) }} value=${group}
        onValue=${(v) => { setGroup(v); move.to = targets.find((c) => c.label === v) || null; }} />
    </div>
    <${Fields} map=${map} fields=${fields} touch=${tick} />

    <h4>${t('Widget')}</h4>
    ${isMap(widget) && html`<${WidgetEditor} doc=${doc} map=${widget} touch=${tick} onRemove=${() => removeKey('widget')} />`}
    ${isSeq(widgets) && widgets.items.map((w, i) => isMap(w) && html`<${WidgetEditor} key=${i} doc=${doc} map=${w} touch=${tick}
      onRemove=${() => { widgets.items.splice(i, 1); tick(); }} />`)}
    ${!isMap(widget) && html`<div><button type="button" class="chip" onClick=${addWidget}><${I} n="plus" s=${12} /> ${t('Widget hinzufügen')}</button></div>`}

    <${KV} doc=${doc} map=${map} exclude=${[...shownKeys(map, SVC_FIELDS), 'widget', 'widgets']} touch=${tick} />
  <//>`;
}

function setValNode(map, key, node) {
  const p = findPair(map, key);
  if (p) p.value = node;
  else map.items.push(new YAML.Pair(new YAML.Scalar(key), node));
}

function WidgetEditor({ doc, map, touch, onRemove }) {
  const type = getVal(map, 'type');
  return html`<div class="widget-box">
    <div class="row-inp">
      <${Field} f=${{ k: 'type', label: t('Widget-Typ'), type: 'combo', options: WIDGET_TYPES, placeholder: t('z. B. sonarr') }} value=${type}
        onValue=${(v) => { setVal(map, 'type', v, true); touch(); }} />
      ${type && html`<a class="small" target="_blank" rel="noopener" href=${`https://gethomepage.dev/widgets/services/${type}/`}>${t('Doku')} ↗</a>`}
      <button type="button" class="btn ghost small" onClick=${onRemove}><${I} n="trash-2" s=${14} /> ${t('Widget entfernen')}</button>
    </div>
    <${KV} doc=${doc} map=${map} exclude=${['type']} touch=${touch} title=${t('Widget-Optionen')} quick=${['url', 'key', 'username', 'password', 'fields']} />
  </div>`;
}
