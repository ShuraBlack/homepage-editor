
# Homepage Editor

A small web UI for editing the configuration of a [gethomepage.dev](https://gethomepage.dev) dashboard: visual editors for the YAML files, a code editor as fallback and a file manager for icons and background images.

It runs as one extra container next to your existing Homepage container and works directly on the same `config/` and `images/` folders. No database, no build step: a single Go binary with the frontend embedded.

## Features
<img width="1354" height="720" alt="Login" src="https://github.com/user-attachments/assets/3970aad4-62ff-4d60-8ca2-e7f7b5c3e335" />

- **Services editor** (`services.yaml`)
  - One tab per top-level group; `+ Tab` creates a new one.
  - Groups and subgroups are previewed with their Homepage layout: `style: row` shows services and subgroups side by side in `columns` columns, `column` stacks them.
  - Drag & drop between groups. The target container is outlined and named while dragging; dropping onto a tab moves the item into that group.
  - Service dialog with all common fields, icon picker, widget editor (type suggestions + link to the widget docs) and a generic key/value editor for everything else.
  - Group dialog for name, parent group and all layout options (`style`, `columns`, `header`, `tab`, `icon`, …). The layout is written to `settings.yaml`.
<img width="1354" height="720" alt="Image import" src="https://github.com/user-attachments/assets/3a48617a-a662-490e-ac7e-a87a8cb835e7" />
- **Keeps `settings.yaml` → `layout` in sync.** Homepage orders and nests groups by `layout` when it exists. When you save the services, the layout gets the same structure: moved subgroups move along, every group gets an entry, existing options and comments are kept.
- **Visual editors** for `widgets.yaml`, `settings.yaml` (incl. background, layout, quick launch) and `proxmox.yaml`.
- **Code editor** (CodeMirror) for `custom.css`, `custom.js` and every other file, with YAML validation – broken YAML is never saved.
- **File manager** for icons and backgrounds: upload (drag & drop), rename, delete, preview, copy the public path. Uploads to the image folders are checked to really be images.
- **Safe writes:** every save is atomic (temp file + rename) and keeps the previous version as `<file>.bak`.
- **Comments and unknown keys survive** visual editing.
- **Editor settings in the UI:** accent colour, Homepage URL, public paths of the image folders, sign out other sessions.
- **Languages:** English, German, French, Italian. The choice is stored in the browser.
<img width="1354" height="720" alt="Themes" src="https://github.com/user-attachments/assets/2825bf32-b582-4fd7-9c08-ff7d33fcf614" />

## How it works

```
┌──────────────────────┐         ┌──────────────────────┐
│ homepage             │         │ homepage-editor      │
│ /app/config  ◄───────┼── ./config ──►  /data/config   │
│ /app/public/images ◄─┼── ./images ──►  /data/backgrounds
│                      │   ./images/icons ► /data/icons │
└──────────────────────┘         └──────────────────────┘
```

- The editor mounts the **same host folders** as Homepage. Homepage picks up config changes on its own; there is no API between the two containers.
- The backend is a small Go HTTP server. It only exposes three areas (`config`, `icons`, `backgrounds`) and uses `os.Root`, so no path – not even a symlink – can escape them.
- The frontend (Preact + htm, eemeli/yaml, CodeMirror 5) is plain ES modules embedded into the binary. YAML is edited as a document tree, which is why comments and unknown keys are preserved.
- If the icons folder lies inside the backgrounds folder (`images/icons` inside `images`), it is hidden and locked in the backgrounds area so it can't be deleted by accident. The editor derives this from the public URLs (`/images/icons` below `/images`).
- Logins and editor settings are kept in a small JSON state file (only a hash of each session cookie is stored).

## Adding it to your Homepage compose file

The examples assume the usual Homepage setup: a folder with `docker-compose.yml`, `config/` and `images/` (backgrounds), with icons in `images/icons/`.

```
homepage/
├── docker-compose.yml
├── config/            # services.yaml, settings.yaml, widgets.yaml, …
├── images/            # backgrounds
│   └── icons/         # icons
└── editor/            # ← this repository
```

**1. Get the code next to your compose file**<img width="1354" height="720" alt="export-1794622581227" src="https://github.com/user-attachments/assets/eac90a82-ecb8-47ea-b0d0-bec3d9756421" />


```sh
cd homepage
git clone https://github.com/ShuraBlack/homepage-editor.git editor
```

**2. Add the service to your existing `docker-compose.yml`**

```yaml
services:
  homepage:
    image: ghcr.io/gethomepage/homepage:latest
    container_name: homepage
    ports:
      - "3000:3000"
    volumes:
      - ./config:/app/config
      - ./images:/app/public/images   # icons are then /images/icons/<file>, backgrounds /images/<file>
    restart: unless-stopped

  homepage-editor:
    build: ./editor
    container_name: homepage-editor
    restart: unless-stopped
    ports:
      - "3001:3001"
    environment:
      ADMIN_USER: admin
      ADMIN_PASSWORD: ${HOMEPAGE_EDITOR_PASSWORD}   # e.g. from a .env file
      HOMEPAGE_URL: http://192.168.1.10:3000          # optional: "Open Homepage" link + icon previews
    volumes:
      - ./config:/data/config
      - ./images/icons:/data/icons
      - ./images:/data/backgrounds
      - ./editor-data:/data/state                     # sessions + editor settings
```

Keep your own `homepage` service as it is – the important part is that both containers mount the **same** `config` and `images` folders. If your Homepage serves the images under a different path, set `ICONS_URL` / `BACKGROUNDS_URL` accordingly (or change them later in the editor settings).

**3. Start it**

```sh
echo "HOMEPAGE_EDITOR_PASSWORD=a-long-random-password" >> .env
docker compose up -d --build
```

Open `http://<host>:3001` and sign in.

**Updating:** `git -C editor pull && docker compose up -d --build homepage-editor`.

### File ownership

The container runs as root by default, so it can write files owned by any user. If you'd rather run it unprivileged, add `user: "UID:GID"` matching the owner of `config/` and `images/` – otherwise saving will fail with "permission denied".

### Behind a reverse proxy (Traefik, Caddy, nginx, …)

Drop the `ports:` mapping and route a hostname to port `3001` of the container. Use HTTPS when the editor is reachable from outside your LAN; the session cookie is marked `Secure` automatically when the proxy sends `X-Forwarded-Proto: https`. Writes from other origins are rejected, so the editor can safely sit behind the same proxy as your dashboard.

## Configuration

| Variable | Default | Description |
|---|---|---|
| `ADMIN_USER`, `ADMIN_PASSWORD` | – (required) | Login credentials |
| `CONFIG_DIR` | `/data/config` | Homepage config folder |
| `ICONS_DIR` | `/data/icons` | Icons folder |
| `BACKGROUNDS_DIR` | `/data/backgrounds` | Backgrounds folder |
| `STATE_FILE` | `/data/state/editor.json` | Sessions and editor settings |
| `ICONS_URL` | `/images/icons` | Path under which Homepage serves the icons¹ |
| `BACKGROUNDS_URL` | `/images` | Path under which Homepage serves the backgrounds¹ |
| `HOMEPAGE_URL` | – | URL of your Homepage instance¹ |
| `PORT` | `3001` | HTTP port |

¹ Defaults only. Values saved under *Settings* in the editor take precedence until you click *Reset to defaults*.

## Sessions and the state file

- A sign-in stays valid for 7 days, including container restarts – **as long as `/data/state` is a volume**. Without it the state file is lost on every `docker compose up --build`.
- Signing in again from the same browser replaces the old session; *Settings → Sign out all others* revokes every other session.
- If the state file can't be written, the editor shows a warning on the settings page.
- If the file is corrupt, the editor refuses to start instead of silently overwriting your settings. Deleting it resets sessions and editor settings.

## Language

The UI is available in English, German, French and Italian. Choose it under *Settings → Appearance* or on the sign-in page; the choice is stored in the browser (`localStorage`) and defaults to the browser language.

Translations live in `web/i18n-dict.js`, keyed by the German source text. A missing entry falls back to German, so adding a language means adding one more dictionary there and its name in `web/i18n.js`.

## Development

Requirements: Go 1.25 or newer.

```sh
go test ./...

ADMIN_USER=admin ADMIN_PASSWORD=dev PORT=3002 STATE_FILE=./dev-state.json \
  CONFIG_DIR=../homepage/config ICONS_DIR=../homepage/images/icons BACKGROUNDS_DIR=../homepage/images \
  go run .
```

The frontend has no build step. It is embedded with `go:embed`, so restart the server after changing files in `web/`.

```
main.go            HTTP server: auth, sessions, state file, file API
main_test.go       API tests (auth, path traversal, uploads, locking, sessions)
web/
  index.html       app shell          login.html   sign-in page
  app.js           routing + sidebar  lib.js       API client, YAML helpers, form components, editors
  i18n.js          translation core   i18n-dict.js translations
  views/           services, widgets, settings, proxmox, files, editor settings
  vendor/          Preact + htm, eemeli/yaml, CodeMirror 5, Lucide icons
Dockerfile         multi-stage build → distroless image
```

### API

All endpoints except `/login` require a session. Files are addressed with `root` (`config`, `icons`, `backgrounds`) and `path`.

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/meta` | Editor settings, defaults, session info |
| `PUT` / `DELETE` | `/api/settings` | Save / reset editor settings |
| `POST` | `/api/sessions/revoke` | Sign out all other sessions |
| `GET` | `/api/list?root=&path=` | List a folder |
| `GET` / `PUT` / `DELETE` | `/api/file?root=&path=` | Read / write (atomic, with `.bak`) / delete |
| `POST` | `/api/upload?root=&path=` | Multipart upload (`files`), max. 100 MB |
| `POST` | `/api/mkdir?root=&path=` | Create a folder |
| `POST` | `/api/rename?root=&path=&to=` | Rename or move |

## Credits

Built for [Homepage](https://github.com/gethomepage/homepage). Bundled third-party code in `web/vendor/` comes with its own licenses: [Preact](https://preactjs.com/) and [htm](https://github.com/developit/htm), [yaml](https://github.com/eemeli/yaml), [CodeMirror 5](https://codemirror.net/5/), [Lucide](https://lucide.dev/) icons.
