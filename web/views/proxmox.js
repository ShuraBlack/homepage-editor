import { html, isMap, keyOf, setKey, YamlView, Field, Fields, KV, shownKeys, promptDlg, confirmDlg, I, IconBtn, t } from '../lib.js';

const NODE_FIELDS = [
  { k: 'url', label: t('URL'), placeholder: 'https://proxmox:8006', wide: true },
  { k: 'token', label: t('Token-ID'), placeholder: 'user@pam!homepage' },
  { k: 'secret', label: t('Secret'), type: 'secret' },
];

export function Proxmox() {
  return html`<${YamlView} file="proxmox.yaml" title="Proxmox" empty=""
    form=${(doc, touch) => html`<${ProxmoxForm} doc=${doc} touch=${touch} />`} />`;
}

function ProxmoxForm({ doc, touch }) {
  if (doc.contents == null) doc.contents = doc.createNode({});
  const root = doc.contents;
  if (!isMap(root)) return html`<div class="alert">${t('proxmox.yaml ist keine Map. Bitte „Als Code bearbeiten“ nutzen.')}</div>`;
  const add = async () => {
    const n = await promptDlg(t('Neuer Node'), '', t('Muss dem Node-Namen in Proxmox entsprechen (z. B. pve).'));
    if (!n) return;
    root.items.push(doc.createNode({ [n]: { url: 'https://', token: '', secret: '' } }).items[0]);
    touch();
  };
  return html`<div>
    <div class="toolbar"><button class="btn" onClick=${add}><${I} n="plus" /> ${t('Node')}</button>
      <span class="muted small">${t('Services verweisen über proxmoxNode auf diese Namen.')}</span></div>
    <div class="stack">
      ${root.items.map((p, i) => {
        const name = String(keyOf(p));
        const map = isMap(p.value) ? p.value : null;
        const ensure = () => { p.value = doc.createNode({}); return p.value; };
        return html`<section class="card" key=${i}>
          <header class="card-head">
            <div class="fields grow"><${Field} f=${{ k: 'name', label: t('Node-Name') }} value=${name} onValue=${(v) => { setKey(p, v); touch(); }} /></div>
            <${IconBtn} n="trash-2" cls="del" label=${t('Node {name} entfernen', { name })} onClick=${async () => {
              if (await confirmDlg(t('Node „{name}“ entfernen?', { name }), '', t('Entfernen'), true)) { root.items.splice(i, 1); touch(); }
            }} />
          </header>
          <div class="card-body">
            <${Fields} map=${map} ensure=${ensure} fields=${NODE_FIELDS} touch=${touch} />
            <${KV} doc=${doc} map=${map} ensure=${ensure} exclude=${shownKeys(map, NODE_FIELDS)} touch=${touch} />
          </div>
        </section>`;
      })}
      ${!root.items.length && html`<p class="muted">${t('Noch keine Nodes.')}</p>`}
    </div>
  </div>`;
}
