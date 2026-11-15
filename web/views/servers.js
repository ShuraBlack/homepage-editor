// proxmox.yaml and docker.yaml: both are a map of named servers with a few known keys.
import { html, isMap, keyOf, setKey, YamlView, Field, Fields, KV, shownKeys, promptDlg, confirmDlg, I, IconBtn, t } from '../lib.js';

const PROXMOX = {
  file: 'proxmox.yaml', title: 'Proxmox', add: t('Node'), newTitle: t('Neuer Node'), nameLabel: t('Node-Name'),
  newHint: t('Muss dem Node-Namen in Proxmox entsprechen (z. B. pve).'), hint: t('Services verweisen über proxmoxNode auf diese Namen.'),
  empty: t('Noch keine Nodes.'), init: { url: 'https://', token: '', secret: '' },
  fields: [
    { k: 'url', label: t('URL'), placeholder: 'https://proxmox:8006', wide: true },
    { k: 'token', label: t('Token-ID'), placeholder: 'user@pam!homepage' },
    { k: 'secret', label: t('Secret'), type: 'secret' },
  ],
};
const DOCKER = {
  file: 'docker.yaml', title: 'Docker', add: t('Server'), newTitle: t('Neuer Docker-Server'), nameLabel: t('Server-Name'),
  newHint: t('Frei wählbar, z. B. my-docker.'), hint: t('Services verweisen über „Docker-Server“ (server) auf diese Namen. Entweder Host + Port oder Socket.'),
  empty: t('Noch keine Docker-Server.'), init: { host: '', port: 2375 },
  fields: [
    { k: 'host', label: t('Host'), placeholder: '192.168.1.10' },
    { k: 'port', label: t('Port'), type: 'number', placeholder: '2375' },
    { k: 'socket', label: t('Socket'), placeholder: '/var/run/docker.sock', wide: true },
    { k: 'swarm', label: t('Swarm'), type: 'bool' },
  ],
};

export const Proxmox = () => html`<${ServerView} cfg=${PROXMOX} />`;
export const Docker = () => html`<${ServerView} cfg=${DOCKER} />`;

function ServerView({ cfg }) {
  return html`<${YamlView} key=${cfg.file} file=${cfg.file} title=${cfg.title} empty=""
    form=${(doc, touch) => html`<${ServerForm} cfg=${cfg} doc=${doc} touch=${touch} />`} />`;
}

function ServerForm({ cfg, doc, touch }) {
  if (doc.contents == null) doc.contents = doc.createNode({});
  const root = doc.contents;
  if (!isMap(root)) return html`<div class="alert">${t('{file} ist keine Map. Bitte „Als Code bearbeiten“ nutzen.', { file: cfg.file })}</div>`;
  const add = async () => {
    const n = await promptDlg(cfg.newTitle, '', cfg.newHint);
    if (!n) return;
    root.items.push(doc.createNode({ [n]: cfg.init }).items[0]);
    touch();
  };
  return html`<div>
    <div class="toolbar"><button class="btn" onClick=${add}><${I} n="plus" /> ${cfg.add}</button>
      <span class="muted small">${cfg.hint}</span></div>
    <div class="stack">
      ${root.items.map((p, i) => {
        const name = String(keyOf(p));
        const map = isMap(p.value) ? p.value : null;
        const ensure = () => { p.value = doc.createNode({}); return p.value; };
        return html`<section class="card" key=${i}>
          <header class="card-head">
            <div class="fields grow"><${Field} f=${{ k: 'name', label: cfg.nameLabel }} value=${name} onValue=${(v) => { setKey(p, v); touch(); }} /></div>
            <${IconBtn} n="trash-2" cls="del" label=${t('{name} entfernen', { name })} onClick=${async () => {
              if (await confirmDlg(t('„{name}“ entfernen?', { name }), '', t('Entfernen'), true)) { root.items.splice(i, 1); touch(); }
            }} />
          </header>
          <div class="card-body">
            <${Fields} map=${map} ensure=${ensure} fields=${cfg.fields} touch=${touch} />
            <${KV} doc=${doc} map=${map} ensure=${ensure} exclude=${shownKeys(map, cfg.fields)} touch=${touch} />
          </div>
        </section>`;
      })}
      ${!root.items.length && html`<p class="muted">${cfg.empty}</p>`}
    </div>
  </div>`;
}
