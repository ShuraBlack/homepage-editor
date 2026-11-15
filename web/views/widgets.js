import { html, useState, isMap, isSeq, single, moveItem, YamlView, Fields, KV, shownKeys, confirmDlg, openModal, I, IconBtn, Dlg, t } from '../lib.js';

const SIZES = ['4xl', '3xl', '2xl', 'xl', 'lg', 'md', 'sm', 'xs'];
const UNITS = ['metric', 'imperial'];
const TARGETS = ['_blank', '_self', '_top'];

// Known info widgets: type -> fields. Everything else (and nested options like `format`) goes to the key/value editor.
export const INFO_WIDGETS = {
  resources: [
    { k: 'label', label: t('Beschriftung') }, { k: 'cpu', label: t('CPU'), type: 'bool' }, { k: 'memory', label: t('RAM'), type: 'bool' },
    { k: 'disk', label: t('Disk (Pfad)'), placeholder: '/' }, { k: 'cputemp', label: t('CPU-Temperatur'), type: 'bool' },
    { k: 'tempmin', label: t('Temp. min'), type: 'number' }, { k: 'tempmax', label: t('Temp. max'), type: 'number' },
    { k: 'uptime', label: t('Uptime'), type: 'bool' }, { k: 'network', label: t('Netzwerk'), placeholder: t('true oder Interface') },
    { k: 'units', label: t('Einheiten'), type: 'select', options: UNITS }, { k: 'diskUnits', label: t('Disk-Einheiten'), type: 'select', options: ['bytes', 'bbytes'] },
    { k: 'refresh', label: t('Refresh (ms)'), type: 'number' }, { k: 'expanded', label: t('Ausgeklappt'), type: 'bool' },
  ],
  search: [
    { k: 'provider', label: t('Anbieter'), type: 'select', options: ['google', 'duckduckgo', 'bing', 'baidu', 'brave', 'custom'] },
    { k: 'url', label: t('Eigene Such-URL'), placeholder: 'https://…?q=' }, { k: 'suggestionUrl', label: t('Vorschlags-URL') },
    { k: 'target', label: t('Ziel'), type: 'select', options: TARGETS }, { k: 'focus', label: t('Autofokus'), type: 'bool' },
    { k: 'showSearchSuggestions', label: t('Vorschläge'), type: 'bool' },
  ],
  datetime: [{ k: 'text_size', label: t('Textgröße'), type: 'select', options: SIZES }, { k: 'locale', label: t('Locale'), placeholder: 'de' }],
  greeting: [{ k: 'text', label: t('Text'), wide: true }, { k: 'text_size', label: t('Textgröße'), type: 'select', options: SIZES }],
  openmeteo: [
    { k: 'label', label: t('Beschriftung') }, { k: 'latitude', label: t('Breitengrad'), type: 'number' }, { k: 'longitude', label: t('Längengrad'), type: 'number' },
    { k: 'timezone', label: t('Zeitzone'), placeholder: 'Europe/Berlin' }, { k: 'units', label: t('Einheiten'), type: 'select', options: UNITS },
    { k: 'cache', label: t('Cache (min)'), type: 'number' },
  ],
  openweathermap: [
    { k: 'label', label: t('Beschriftung') }, { k: 'latitude', label: t('Breitengrad'), type: 'number' }, { k: 'longitude', label: t('Längengrad'), type: 'number' },
    { k: 'units', label: t('Einheiten'), type: 'select', options: UNITS }, { k: 'provider', label: t('Provider') },
    { k: 'apiKey', label: t('API-Key'), type: 'secret' }, { k: 'cache', label: t('Cache (min)'), type: 'number' },
  ],
  glances: [
    { k: 'label', label: t('Beschriftung') }, { k: 'url', label: t('URL'), wide: true }, { k: 'username', label: t('Benutzer') },
    { k: 'password', label: t('Passwort'), type: 'secret' }, { k: 'version', label: t('Version'), type: 'number' },
    { k: 'cpu', label: t('CPU'), type: 'bool' }, { k: 'mem', label: t('RAM'), type: 'bool' }, { k: 'cputemp', label: t('CPU-Temperatur'), type: 'bool' },
    { k: 'uptime', label: t('Uptime'), type: 'bool' }, { k: 'disk', label: t('Disk') }, { k: 'expanded', label: t('Ausgeklappt'), type: 'bool' },
  ],
  logo: [{ k: 'icon', label: t('Icon'), type: 'icon', wide: true }, { k: 'href', label: t('Link') }, { k: 'target', label: t('Ziel'), type: 'select', options: TARGETS }],
  unifi_console: [
    { k: 'label', label: t('Beschriftung') }, { k: 'url', label: t('URL') }, { k: 'username', label: t('Benutzer') },
    { k: 'password', label: t('Passwort'), type: 'secret' }, { k: 'key', label: t('API-Key'), type: 'secret' }, { k: 'site', label: t('Site') },
  ],
  kubernetes: [], longhorn: [], stocks: [], customapi: [],
};

let drag = null;
// Stable keys per YAML node, so open/closed state and focus follow a widget when it is moved.
const ids = new WeakMap();
let nextId = 0;
const nodeKey = (node) => { if (!ids.has(node)) ids.set(node, ++nextId); return ids.get(node); };

export function Widgets() {
  return html`<${YamlView} file="widgets.yaml" title=${t('Info-Widgets')} empty="[]"
    form=${(doc, touch) => html`<${WidgetsForm} doc=${doc} touch=${touch} />`} />`;
}

function WidgetsForm({ doc, touch }) {
  if (doc.contents == null) doc.contents = doc.createNode([]);
  if (!isSeq(doc.contents)) return html`<div class="alert">${t('widgets.yaml ist keine Liste. Bitte „Als Code bearbeiten“ nutzen.')}</div>`;
  const seq = doc.contents;
  const add = async () => {
    const type = await openModal(TypePicker);
    if (!type) return;
    seq.items.push(doc.createNode({ [type]: {} }));
    touch();
  };
  return html`<div>
    <div class="toolbar"><button class="btn" onClick=${add}><${I} n="plus" /> ${t('Widget')}</button>
      <span class="muted small">${t('Reihenfolge per Ziehen am Griff oder mit den Pfeilen ändern.')}</span></div>
    <div class="stack">
      ${seq.items.map((item, i) => html`<${WidgetCard} key=${nodeKey(item)} doc=${doc} seq=${seq} idx=${i} touch=${touch} />`)}
      ${!seq.items.length && html`<p class="muted">${t('Noch keine Widgets.')}</p>`}
    </div>
  </div>`;
}

function WidgetCard({ doc, seq, idx, touch }) {
  const s = single(seq.items[idx]);
  const [open, setOpen] = useState(true);
  if (!s) return html`<div class="card alert">${t('Unbekannter Eintrag – im Code bearbeiten.')}</div>`;
  const fields = INFO_WIDGETS[s.name] || [];
  const map = isMap(s.value) ? s.value : null;
  const ensure = () => { s.pair.value = doc.createNode({}); return s.pair.value; };
  const move = (d) => {
    const id = nodeKey(seq.items[idx]);
    moveItem(seq, idx, seq, idx + (d > 0 ? 2 : -1)); // moveItem inserts before the target index
    touch();
    // keep keyboard focus on the moved widget; at the first/last place the other arrow is the one left enabled
    requestAnimationFrame(() => {
      const btns = [...document.querySelectorAll(`#wc-${id} [data-move]:not([disabled])`)];
      (btns.find((b) => b.dataset.move === String(d)) || btns[0])?.focus();
    });
  };
  const remove = async () => { if (await confirmDlg(t('Widget „{name}“ entfernen?', { name: s.name }), '', t('Entfernen'), true)) { seq.items.splice(idx, 1); touch(); } };
  const dnd = {
    onDragOver: (e) => { if (drag) { e.preventDefault(); e.currentTarget.classList.add('drop-before'); } },
    onDragLeave: (e) => e.currentTarget.classList.remove('drop-before'),
    onDrop: (e) => { e.currentTarget.classList.remove('drop-before'); if (!drag) return; moveItem(drag.seq, drag.idx, seq, idx); drag = null; touch(); },
  };
  return html`<section class="card" id=${'wc-' + nodeKey(seq.items[idx])} ...${dnd}>
    <header class="card-head" draggable="true" onDragStart=${(e) => { drag = { seq, idx }; e.dataTransfer.setData('text/plain', ''); }} onDragEnd=${() => { drag = null; }}>
      <span class="handle"><${I} n="grip-vertical" /></span>
      <button class="link-btn" aria-expanded=${open} onClick=${() => setOpen(!open)}><${I} n=${open ? 'chevron-down' : 'chevron-right'} /> <strong>${s.name}</strong></button>
      <a class="small" target="_blank" rel="noopener" href=${`https://gethomepage.dev/widgets/info/${s.name}/`}>${t('Doku')} ↗</a>
      <span class="spacer"></span>
      <${IconBtn} n="arrow-up" label=${t('Widget {name} nach oben', { name: s.name })} data-move="-1" disabled=${idx === 0} onClick=${() => move(-1)} />
      <${IconBtn} n="arrow-down" label=${t('Widget {name} nach unten', { name: s.name })} data-move="1" disabled=${idx === seq.items.length - 1} onClick=${() => move(1)} />
      <${IconBtn} n="trash-2" cls="del" label=${t('Widget {name} entfernen', { name: s.name })} onClick=${remove} />
    </header>
    ${open && html`<div class="card-body">
      ${fields.length > 0 && html`<${Fields} map=${map} ensure=${ensure} fields=${fields} touch=${touch} />`}
      <${KV} doc=${doc} map=${map} ensure=${ensure} exclude=${shownKeys(map, fields)} touch=${touch}
        title=${fields.length ? t('Weitere Optionen') : t('Optionen')} />
    </div>`}
  </section>`;
}

function TypePicker({ close }) {
  const [custom, setCustom] = useState('');
  return html`<${Dlg} title=${t('Widget hinzufügen')} onClose=${() => close(null)} onSubmit=${() => custom.trim() && close(custom.trim())}>
    <div class="chips">${Object.keys(INFO_WIDGETS).map((ty) => html`<button type="button" class="chip" onClick=${() => close(ty)}>${ty}</button>`)}</div>
    <div class="row-inp">
      <input class="inp" aria-label=${t('Anderer Typ')} placeholder=${t('anderer Typ…')} value=${custom} onInput=${(e) => setCustom(e.target.value)} />
      <button class="btn">${t('Hinzufügen')}</button>
    </div>
  <//>`;
}
