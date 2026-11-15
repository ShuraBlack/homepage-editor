// bookmarks.yaml: groups of bookmarks, each entry is `- Name: [ {abbr, href, icon, description} ]` (a list with one map).
import {
  html, useState, isMap, isSeq, single, setKey, getVal, moveItem, YamlView, Field, Fields, KV, shownKeys, Icon,
  promptDlg, confirmDlg, openModal, isDirty, toast, I, IconBtn, Dlg, t,
} from '../lib.js';

const FIELDS = [
  { k: 'href', label: t('Link (href)'), placeholder: 'https://…', wide: true },
  { k: 'abbr', label: t('Kürzel'), placeholder: 'GH' },
  { k: 'icon', label: t('Icon'), type: 'icon', wide: true, placeholder: 'github.png · mdi-github · si-github' },
  { k: 'description', label: t('Beschreibung'), wide: true },
];

export function Bookmarks() {
  return html`<${YamlView} file="bookmarks.yaml" title=${t('Bookmarks')} empty="[]"
    form=${(doc, touch) => html`<${BookmarksForm} doc=${doc} touch=${touch} />`} />`;
}

/** The map of a bookmark entry; with `create` a missing/odd value becomes `[{}]`. */
function entryMap(doc, item, create) {
  const s = single(item);
  if (!s) return null;
  if (isSeq(s.value) && isMap(s.value.items[0])) return s.value.items[0];
  if (!create) return null;
  s.pair.value = doc.createNode([{}]);
  return s.pair.value.items[0];
}
/** A group's bookmark list, created when the group is still empty (`- Group:`). */
const groupSeq = (doc, group) => { const s = single(group); if (!isSeq(s.pair.value)) s.pair.value = doc.createNode([]); return s.pair.value; };

let drag = null; // { seq, idx } of the dragged bookmark

function BookmarksForm({ doc, touch }) {
  if (doc.contents == null) doc.contents = doc.createNode([]);
  if (!isSeq(doc.contents)) return html`<div class="alert">${t('bookmarks.yaml ist keine Liste von Gruppen. Bitte „Als Code bearbeiten“ nutzen.')}</div>`;
  const groups = doc.contents;
  const addGroup = async () => {
    const n = await promptDlg(t('Neue Bookmark-Gruppe'), '');
    if (!n) return;
    groups.items.push(doc.createNode({ [n]: [] }));
    touch();
  };
  return html`<div>
    <div class="toolbar"><button class="btn" onClick=${addGroup}><${I} n="plus" /> ${t('Gruppe')}</button>
      <span class="muted small">${t('Bookmarks per Ziehen umsortieren oder in eine andere Gruppe ziehen; exakt über „Gruppe“ im Dialog.')}</span></div>
    <div class="stack">
      ${groups.items.map((_, i) => html`<${BmGroup} key=${i} doc=${doc} groups=${groups} idx=${i} touch=${touch} />`)}
      ${!groups.items.length && html`<p class="muted">${t('Noch keine Bookmarks.')}</p>`}
    </div>
  </div>`;
}

function BmGroup({ doc, groups, idx, touch }) {
  const g = groups.items[idx];
  const s = single(g);
  if (!s) return html`<div class="card alert">${t('Unbekannter Eintrag – im Code bearbeiten.')}</div>`;
  const items = isSeq(s.value) ? s.value.items : [];
  const add = async () => {
    const n = await promptDlg(t('Neues Bookmark'), '', t('In „{path}“', { path: s.name }));
    if (!n) return;
    const node = doc.createNode({ [n]: [{}] });
    groupSeq(doc, g).items.push(node);
    touch();
    editBookmark(doc, groups, groupSeq(doc, g), node, true, touch);
  };
  const remove = async () => {
    if (await confirmDlg(t('Gruppe „{name}“ löschen?', { name: s.name }), t('Enthält {n} Einträge, die mit gelöscht werden.', { n: items.length }), t('Löschen'), true)) {
      groups.items.splice(idx, 1);
      touch();
    }
  };
  const move = (d) => { moveItem(groups, idx, groups, idx + (d > 0 ? 2 : -1)); touch(); }; // moveItem inserts before the index
  // dropping on the free area of a group appends there
  const dropEnd = {
    onDragOver: (e) => { if (drag) e.preventDefault(); },
    onDrop: (e) => {
      if (!drag) return;
      e.preventDefault();
      const to = groupSeq(doc, g);
      moveItem(drag.seq, drag.idx, to, to.items.length);
      drag = null;
      touch();
    },
  };
  return html`<section class="card">
    <header class="card-head">
      <div class="fields grow"><${Field} f=${{ k: 'name', label: t('Gruppe') }} value=${s.name} onValue=${(v) => { setKey(s.pair, v); touch(); }} /></div>
      <span class="count">${items.length}</span>
      <${IconBtn} n="arrow-up" label=${t('Gruppe {name} nach oben', { name: s.name })} disabled=${idx === 0} onClick=${() => move(-1)} />
      <${IconBtn} n="arrow-down" label=${t('Gruppe {name} nach unten', { name: s.name })} disabled=${idx === groups.items.length - 1} onClick=${() => move(1)} />
      <${IconBtn} n="trash-2" cls="del" label=${t('Gruppe {name} löschen', { name: s.name })} onClick=${remove} />
    </header>
    <div class="card-body" ...${dropEnd}>
      ${items.length > 0 && html`<div class="bm-list">
        ${items.map((_, i) => html`<${BmItem} key=${i} doc=${doc} groups=${groups} seq=${s.value} idx=${i} touch=${touch} />`)}
      </div>`}
      <div><button type="button" class="chip" onClick=${add}><${I} n="plus" s=${12} /> ${t('Bookmark')}</button></div>
    </div>
  </section>`;
}

function BmItem({ doc, groups, seq, idx, touch }) {
  const item = seq.items[idx];
  const s = single(item);
  if (!s) return html`<div class="svc bad">${t('Unbekannter Eintrag (im Code bearbeiten)')}</div>`;
  const m = entryMap(doc, item, false);
  const icon = getVal(m, 'icon');
  const abbr = getVal(m, 'abbr');
  return html`<button class="svc" draggable="true"
    onDragStart=${(e) => { drag = { seq, idx }; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', ''); }}
    onDragEnd=${() => { drag = null; }}
    onDragOver=${(e) => { if (drag) { e.preventDefault(); e.stopPropagation(); e.currentTarget.classList.add('drop-before'); } }}
    onDragLeave=${(e) => e.currentTarget.classList.remove('drop-before')}
    onDrop=${(e) => {
      e.currentTarget.classList.remove('drop-before');
      if (!drag) return;
      e.preventDefault();
      e.stopPropagation();
      moveItem(drag.seq, drag.idx, seq, idx);
      drag = null;
      touch();
    }}
    onClick=${() => editBookmark(doc, groups, seq, item, false, touch)}>
    ${typeof icon === 'string' && icon ? html`<${Icon} icon=${icon} size=${28} />`
      : html`<span class="icon-ph" style="width:28px;height:28px">${String(abbr || s.name).slice(0, 2)}</span>`}
    <span class="svc-text"><strong>${s.name}</strong><span class="muted small">${String(getVal(m, 'description') || getVal(m, 'href') || '')}</span></span>
  </button>`;
}

async function editBookmark(doc, groups, seq, item, isNew, touch) {
  const backup = item.clone();
  const wasDirty = isDirty();
  const move = { to: null, label: '' };
  const res = await openModal(BookmarkDialog, { doc, groups, seq, item, isNew, move, touch }, 'wide');
  const i = seq.items.indexOf(item);
  if (i < 0) return;
  if (res === 'delete' || (isNew && res !== 'ok')) seq.items.splice(i, 1);
  else if (res !== 'ok') { seq.items[i] = backup; return touch(wasDirty); }
  else if (move.to && move.to !== seq) {
    seq.items.splice(i, 1);
    move.to.items.push(item);
    toast(t('Verschoben nach {name}', { name: move.label }));
  }
  touch();
}

function BookmarkDialog({ doc, groups, seq, item, isNew, move, touch, close }) {
  const [, setT] = useState(0);
  const tick = () => { setT((x) => x + 1); touch(); };
  const s = single(item);
  const map = entryMap(doc, item, true);
  const named = groups.items.map(single).filter(Boolean);
  const [group, setGroup] = useState(named.find((g) => g.value === seq)?.name);
  const pickGroup = (v) => {
    setGroup(v);
    const g = groups.items.find((x) => single(x)?.name === v);
    if (g) { move.to = groupSeq(doc, g); move.label = v; }
  };
  return html`<${Dlg} title=${isNew ? t('Neues Bookmark') : t('Bookmark bearbeiten')} onClose=${() => close('cancel')} onSubmit=${() => close('ok')}
    footer=${html`
      ${!isNew && html`<button type="button" class="btn danger" onClick=${async () => {
        if (await confirmDlg(t('„{name}“ löschen?', { name: s.name }), '', t('Löschen'), true)) close('delete');
      }}><${I} n="trash-2" /> ${t('Löschen')}</button>`}
      <span class="spacer"></span>
      <button type="button" class="btn" onClick=${() => close('cancel')}>${t('Abbrechen')}</button>
      <button class="btn primary">${t('Übernehmen')}</button>`}>
    <div class="fields">
      <${Field} f=${{ k: 'name', label: t('Name') }} value=${s.name} onValue=${(v) => { setKey(s.pair, v); tick(); }} />
      <${Field} f=${{ k: 'group', label: t('Gruppe'), type: 'select', options: named.map((g) => g.name) }} value=${group} onValue=${pickGroup} />
    </div>
    <${Fields} map=${map} fields=${FIELDS} touch=${tick} />
    <${KV} doc=${doc} map=${map} exclude=${shownKeys(map, FIELDS)} touch=${tick} />
  <//>`;
}
