// Homepage Editor: visual editor + file manager for gethomepage.dev configs.
package main

import (
	"bytes"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

//go:embed web
var webFS embed.FS

const (
	cookieName = "hpe_session"
	sessionTTL = 7 * 24 * time.Hour
	maxUpload  = 100 << 20
)

var imageExts = map[string]bool{".png": true, ".jpg": true, ".jpeg": true, ".webp": true, ".gif": true, ".svg": true, ".ico": true, ".avif": true}

// settings can be changed in the UI; env vars only provide the defaults.
type settings struct {
	HomepageURL    string `json:"homepageUrl"`
	IconsURL       string `json:"iconsUrl"`
	BackgroundsURL string `json:"backgroundsUrl"`
	Accent         string `json:"accent"` // #rrggbb, empty = default
}

// state is persisted as JSON so logins and UI settings survive restarts.
type state struct {
	Settings *settings            `json:"settings,omitempty"` // nil = env defaults
	Sessions map[string]time.Time `json:"sessions"`           // sha256(token) -> expiry; raw tokens never hit the disk
}

type server struct {
	user, pass string
	roots      map[string]*os.Root
	defaults   settings
	stateFile  string

	mu      sync.Mutex
	st      state
	saveErr string // last state-file error, shown in the UI
}

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func main() {
	user, pass := os.Getenv("ADMIN_USER"), os.Getenv("ADMIN_PASSWORD")
	if user == "" || pass == "" {
		log.Fatal("ADMIN_USER und ADMIN_PASSWORD müssen gesetzt sein")
	}
	s, err := newServer(user, pass, map[string]string{
		"config":      env("CONFIG_DIR", "/data/config"),
		"icons":       env("ICONS_DIR", "/data/icons"),
		"backgrounds": env("BACKGROUNDS_DIR", "/data/backgrounds"),
	}, env("STATE_FILE", "/data/state/editor.json"), settings{
		HomepageURL:    os.Getenv("HOMEPAGE_URL"),
		IconsURL:       env("ICONS_URL", "/images/icons"),
		BackgroundsURL: env("BACKGROUNDS_URL", "/images"),
	})
	if err != nil {
		log.Fatal(err)
	}
	addr := ":" + env("PORT", "3001")
	log.Printf("Homepage Editor läuft auf %s", addr)
	log.Fatal(http.ListenAndServe(addr, s.routes()))
}

func newServer(user, pass string, dirs map[string]string, stateFile string, defaults settings) (*server, error) {
	defaults, err := defaults.normalize()
	if err != nil {
		return nil, err
	}
	s := &server{user: user, pass: pass, roots: map[string]*os.Root{}, defaults: defaults, stateFile: stateFile,
		st: state{Sessions: map[string]time.Time{}}}
	if b, err := os.ReadFile(stateFile); err == nil {
		// A broken file is fatal on purpose: starting fresh would overwrite the saved settings.
		if err := json.Unmarshal(b, &s.st); err != nil {
			return nil, fmt.Errorf("Status-Datei %s ist beschädigt (löschen setzt alles zurück): %w", stateFile, err)
		}
		if s.st.Sessions == nil {
			s.st.Sessions = map[string]time.Time{}
		}
		s.pruneLocked()
	} else if !errors.Is(err, fs.ErrNotExist) {
		return nil, err
	}
	for name, dir := range dirs {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return nil, err
		}
		r, err := os.OpenRoot(dir)
		if err != nil {
			return nil, err
		}
		s.roots[name] = r
	}
	return s, nil
}

func (s *server) routes() http.Handler {
	web, _ := fs.Sub(webFS, "web")
	mux := http.NewServeMux()
	mux.HandleFunc("GET /login", func(w http.ResponseWriter, r *http.Request) {
		page, err := fs.ReadFile(web, "login.html")
		if err != nil {
			fail(w, err)
			return
		}
		if a := s.current().Accent; a != "" { // validated #rrggbb, safe to inline
			page = bytes.Replace(page, []byte("</head>"), []byte("<style>:root{--accent:"+a+";--accent-ink:"+inkFor(a)+"}</style></head>"), 1)
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write(page)
	})
	mux.HandleFunc("POST /login", s.login)
	mux.HandleFunc("POST /logout", s.logout)

	api := http.NewServeMux()
	api.HandleFunc("GET /api/meta", s.getMeta)
	api.HandleFunc("PUT /api/settings", s.putSettings)
	api.HandleFunc("DELETE /api/settings", s.resetSettings)
	api.HandleFunc("POST /api/sessions/revoke", s.revokeOthers)
	api.HandleFunc("GET /api/list", s.list)
	api.HandleFunc("GET /api/file", s.readFile)
	api.HandleFunc("PUT /api/file", s.writeFile)
	api.HandleFunc("DELETE /api/file", s.deleteFile)
	api.HandleFunc("POST /api/upload", s.upload)
	api.HandleFunc("POST /api/mkdir", s.mkdir)
	api.HandleFunc("POST /api/rename", s.rename)
	api.Handle("/", http.FileServerFS(web))
	mux.Handle("/", s.auth(api))
	// SameSite=Lax lets links from other sites (e.g. the dashboard) keep the login; this blocks their writes instead.
	return http.NewCrossOriginProtection().Handler(mux)
}

// ---------- auth ----------

func eq(a, b string) bool {
	ha, hb := sha256.Sum256([]byte(a)), sha256.Sum256([]byte(b))
	return subtle.ConstantTimeCompare(ha[:], hb[:]) == 1
}

func (s *server) login(w http.ResponseWriter, r *http.Request) {
	okUser, okPass := eq(r.FormValue("user"), s.user), eq(r.FormValue("password"), s.pass)
	if !okUser || !okPass {
		time.Sleep(time.Second) // slows down guessing
		http.Redirect(w, r, "/login?err=1", http.StatusSeeOther)
		return
	}
	b := make([]byte, 32)
	rand.Read(b)
	tok := hex.EncodeToString(b)
	s.mu.Lock()
	s.pruneLocked()
	if old, err := r.Cookie(cookieName); err == nil {
		delete(s.st.Sessions, hashTok(old.Value)) // logging in again replaces the old session
	}
	s.st.Sessions[hashTok(tok)] = time.Now().Add(sessionTTL)
	s.saveLocked() // a failed save only costs persistence, not the login
	s.mu.Unlock()
	http.SetCookie(w, &http.Cookie{
		Name: cookieName, Value: tok, Path: "/", MaxAge: int(sessionTTL.Seconds()),
		HttpOnly: true, SameSite: http.SameSiteLaxMode, // Strict drops the cookie when arriving via a link → endless re-logins
		Secure: r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https",
	})
	http.Redirect(w, r, "/", http.StatusSeeOther)
}

func (s *server) logout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(cookieName); err == nil {
		s.mu.Lock()
		delete(s.st.Sessions, hashTok(c.Value))
		s.saveLocked()
		s.mu.Unlock()
	}
	http.SetCookie(w, &http.Cookie{Name: cookieName, Path: "/", MaxAge: -1})
	http.Redirect(w, r, "/login", http.StatusSeeOther)
}

func (s *server) auth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ok := false
		if c, err := r.Cookie(cookieName); err == nil {
			s.mu.Lock()
			exp, found := s.st.Sessions[hashTok(c.Value)]
			s.mu.Unlock()
			ok = found && time.Now().Before(exp)
		}
		if !ok {
			if strings.HasPrefix(r.URL.Path, "/api/") {
				http.Error(w, "nicht angemeldet", http.StatusUnauthorized)
			} else {
				http.Redirect(w, r, "/login", http.StatusSeeOther)
			}
			return
		}
		next.ServeHTTP(w, r)
	})
}

func hashTok(tok string) string {
	h := sha256.Sum256([]byte(tok))
	return hex.EncodeToString(h[:])
}

// pruneLocked drops expired sessions. Caller holds s.mu.
func (s *server) pruneLocked() {
	now := time.Now()
	for t, exp := range s.st.Sessions {
		if now.After(exp) {
			delete(s.st.Sessions, t)
		}
	}
}

// saveLocked writes the state file atomically. Caller holds s.mu.
func (s *server) saveLocked() error {
	b, err := json.MarshalIndent(s.st, "", "  ")
	if err == nil {
		err = os.MkdirAll(filepath.Dir(s.stateFile), 0o700)
	}
	if err == nil {
		tmp := s.stateFile + ".tmp"
		if err = os.WriteFile(tmp, b, 0o600); err == nil {
			err = os.Rename(tmp, s.stateFile)
		}
	}
	s.saveErr = ""
	if err != nil {
		s.saveErr = err.Error()
		log.Printf("Status-Datei nicht gespeichert: %v", err)
	}
	return err
}

// ---------- settings ----------

func (v settings) normalize() (settings, error) {
	v.HomepageURL = strings.TrimRight(strings.TrimSpace(v.HomepageURL), "/")
	v.IconsURL = strings.TrimRight(strings.TrimSpace(v.IconsURL), "/")
	v.BackgroundsURL = strings.TrimRight(strings.TrimSpace(v.BackgroundsURL), "/")
	if v.HomepageURL != "" && !strings.HasPrefix(v.HomepageURL, "http://") && !strings.HasPrefix(v.HomepageURL, "https://") {
		return v, errors.New("Homepage-URL muss mit http:// oder https:// beginnen")
	}
	if !strings.HasPrefix(v.IconsURL, "/") || !strings.HasPrefix(v.BackgroundsURL, "/") {
		return v, errors.New("Icons- und Hintergrund-URL müssen mit / beginnen, z. B. /images/icons")
	}
	v.Accent = strings.ToLower(strings.TrimSpace(v.Accent))
	if _, err := hex.DecodeString(strings.TrimPrefix(v.Accent, "#")); v.Accent != "" && (len(v.Accent) != 7 || v.Accent[0] != '#' || err != nil) {
		return v, errors.New("Akzentfarbe muss die Form #rrggbb haben")
	}
	return v, nil
}

// inkFor picks dark or white text for an accent background (#rrggbb).
func inkFor(c string) string {
	var r, g, b int
	fmt.Sscanf(c, "#%02x%02x%02x", &r, &g, &b)
	if 299*r+587*g+114*b > 150000 {
		return "#14110a"
	}
	return "#ffffff"
}

func (s *server) current() settings {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.st.Settings != nil {
		return *s.st.Settings
	}
	return s.defaults
}

func (s *server) getMeta(w http.ResponseWriter, r *http.Request) {
	cur := s.current()
	s.mu.Lock()
	n, custom, saveErr := len(s.st.Sessions), s.st.Settings != nil, s.saveErr
	s.mu.Unlock()
	writeJSON(w, struct {
		settings
		Defaults  settings `json:"defaults"`
		Custom    bool     `json:"custom"`
		Sessions  int      `json:"sessions"`
		TTLDays   int      `json:"sessionDays"`
		StateFile string   `json:"stateFile"`
		SaveErr   string   `json:"stateError"`
	}{cur, s.defaults, custom, n, int(sessionTTL.Hours() / 24), s.stateFile, saveErr})
}

func (s *server) putSettings(w http.ResponseWriter, r *http.Request) {
	var v settings
	err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&v)
	if err == nil {
		v, err = v.normalize()
	}
	if err == nil {
		s.mu.Lock()
		s.st.Settings = &v
		err = s.saveLocked()
		s.mu.Unlock()
	}
	if err != nil {
		fail(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) resetSettings(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	s.st.Settings = nil
	err := s.saveLocked()
	s.mu.Unlock()
	if err != nil {
		fail(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) revokeOthers(w http.ResponseWriter, r *http.Request) {
	c, _ := r.Cookie(cookieName) // auth middleware guarantees it
	s.mu.Lock()
	mine := hashTok(c.Value)
	for t := range s.st.Sessions {
		if t != mine {
			delete(s.st.Sessions, t)
		}
	}
	s.saveLocked()
	s.mu.Unlock()
	w.WriteHeader(http.StatusNoContent)
}

// ---------- files ----------

var errLocked = errors.New("gesperrt: dieser Ordner wird im Bereich „Icons“ verwaltet")

// lockedRel returns the icons folder as seen inside the backgrounds root (e.g. "icons"), derived from the
// public URLs: Homepage serves one folder, so /images/icons below /images means images/icons on disk.
func (s *server) lockedRel(root string) string {
	if root != "backgrounds" {
		return ""
	}
	cur := s.current()
	if rel, ok := strings.CutPrefix(cur.IconsURL, cur.BackgroundsURL+"/"); ok {
		return rel
	}
	return ""
}

// touchesLocked: p is the locked folder or inside it, or (with ancestor) a folder containing it.
func (s *server) touchesLocked(root, p string, ancestor bool) bool {
	l := s.lockedRel(root)
	p = filepath.ToSlash(p)
	return l != "" && (p == l || strings.HasPrefix(p, l+"/") || ancestor && (p == "." || strings.HasPrefix(l, p+"/")))
}

// target resolves ?root=&path= to an os.Root and a cleaned relative path.
// os.Root additionally refuses anything (incl. symlinks) that escapes the root.
func (s *server) target(r *http.Request, key string) (*os.Root, string, error) {
	name := r.URL.Query().Get("root")
	root, ok := s.roots[name]
	if !ok {
		return nil, "", errors.New("unbekannter Bereich")
	}
	p := strings.TrimPrefix(path.Clean("/"+r.URL.Query().Get(key)), "/")
	if p == "" {
		p = "."
	}
	if s.touchesLocked(name, p, false) {
		return nil, "", errLocked
	}
	return root, filepath.FromSlash(p), nil
}

func fail(w http.ResponseWriter, err error) {
	code := http.StatusBadRequest
	if errors.Is(err, fs.ErrNotExist) {
		code = http.StatusNotFound
	}
	http.Error(w, err.Error(), code)
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}

type entry struct {
	Name  string    `json:"name"`
	Dir   bool      `json:"dir"`
	Size  int64     `json:"size"`
	MTime time.Time `json:"mtime"`
}

func (s *server) list(w http.ResponseWriter, r *http.Request) {
	root, p, err := s.target(r, "path")
	if err != nil {
		fail(w, err)
		return
	}
	f, err := root.Open(p)
	if err != nil {
		fail(w, err)
		return
	}
	defer f.Close()
	des, err := f.ReadDir(-1)
	if err != nil {
		fail(w, err)
		return
	}
	out := []entry{}
	for _, de := range des {
		if strings.HasPrefix(de.Name(), ".hpe-") || s.touchesLocked(r.URL.Query().Get("root"), filepath.Join(p, de.Name()), false) {
			continue // our own temp files / the locked icons folder
		}
		info, err := de.Info()
		if err != nil {
			continue
		}
		out = append(out, entry{de.Name(), de.IsDir(), info.Size(), info.ModTime()})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Dir != out[j].Dir {
			return out[i].Dir
		}
		return strings.ToLower(out[i].Name) < strings.ToLower(out[j].Name)
	})
	writeJSON(w, out)
}

func (s *server) readFile(w http.ResponseWriter, r *http.Request) {
	root, p, err := s.target(r, "path")
	if err != nil {
		fail(w, err)
		return
	}
	f, err := root.Open(p)
	if err != nil {
		fail(w, err)
		return
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil || st.IsDir() {
		fail(w, errors.New("keine Datei"))
		return
	}
	// Uploaded SVGs must never run script in our origin.
	w.Header().Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "no-cache")
	if ext := strings.ToLower(filepath.Ext(p)); !imageExts[ext] {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	}
	http.ServeContent(w, r, st.Name(), st.ModTime(), f)
}

func (s *server) writeFile(w http.ResponseWriter, r *http.Request) {
	root, p, err := s.target(r, "path")
	if err != nil {
		fail(w, err)
		return
	}
	data, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxUpload))
	if err != nil {
		fail(w, err)
		return
	}
	if err := atomicWrite(root, p, data, true); err != nil {
		fail(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// atomicWrite writes via temp file + rename so Homepage never reads a half-written file.
// With backup, the previous content is kept as <name>.bak.
func atomicWrite(root *os.Root, p string, data []byte, backup bool) error {
	perm := fs.FileMode(0o644)
	if st, err := root.Stat(p); err == nil {
		if st.IsDir() {
			return errors.New("ist ein Ordner")
		}
		perm = st.Mode().Perm()
		if backup {
			old, err := root.ReadFile(p)
			if err != nil {
				return err
			}
			if !bytes.Equal(old, data) {
				if err := root.WriteFile(p+".bak", old, perm); err != nil {
					return err
				}
			}
		}
	}
	tmp := filepath.Join(filepath.Dir(p), ".hpe-"+filepath.Base(p)+".tmp")
	if err := root.WriteFile(tmp, data, perm); err != nil {
		return err
	}
	if err := root.Rename(tmp, p); err != nil {
		// Rename fails e.g. on single-file bind mounts; fall back to a direct write.
		root.Remove(tmp)
		return root.WriteFile(p, data, perm)
	}
	return nil
}

func (s *server) upload(w http.ResponseWriter, r *http.Request) {
	root, dir, err := s.target(r, "path")
	if err != nil {
		fail(w, err)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxUpload)
	if err := r.ParseMultipartForm(32 << 20); err != nil {
		fail(w, err)
		return
	}
	defer r.MultipartForm.RemoveAll()
	onlyImages := r.URL.Query().Get("root") != "config"
	var saved []string
	for _, fh := range r.MultipartForm.File["files"] {
		name := filepath.Base(filepath.FromSlash(strings.ReplaceAll(fh.Filename, "\\", "/")))
		if name == "." || name == ".." || name == string(filepath.Separator) || strings.HasPrefix(name, ".") {
			fail(w, errors.New("ungültiger Dateiname: "+fh.Filename))
			return
		}
		f, err := fh.Open()
		if err != nil {
			fail(w, err)
			return
		}
		data, err := io.ReadAll(f)
		f.Close()
		if err != nil {
			fail(w, err)
			return
		}
		if onlyImages && !isImage(name, data) {
			fail(w, errors.New("kein Bild: "+name))
			return
		}
		if err := atomicWrite(root, filepath.Join(dir, name), data, false); err != nil {
			fail(w, err)
			return
		}
		saved = append(saved, name)
	}
	writeJSON(w, saved)
}

func isImage(name string, data []byte) bool {
	ext := strings.ToLower(filepath.Ext(name))
	if !imageExts[ext] {
		return false
	}
	if ext == ".svg" {
		return bytes.Contains(data[:min(len(data), 4096)], []byte("<svg"))
	}
	if ext == ".avif" || ext == ".ico" { // DetectContentType does not know avif; ico is often sniffed oddly
		return len(data) > 0
	}
	return strings.HasPrefix(http.DetectContentType(data), "image/")
}

func (s *server) mkdir(w http.ResponseWriter, r *http.Request) {
	root, p, err := s.target(r, "path")
	if err == nil {
		err = root.MkdirAll(p, 0o755)
	}
	if err != nil {
		fail(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) rename(w http.ResponseWriter, r *http.Request) {
	root, from, err := s.target(r, "path")
	if err != nil {
		fail(w, err)
		return
	}
	_, to, err := s.target(r, "to")
	if err == nil && s.touchesLocked(r.URL.Query().Get("root"), from, true) {
		err = errLocked
	}
	if err != nil {
		fail(w, err)
		return
	}
	if from == "." || to == "." {
		fail(w, errors.New("ungültiger Pfad"))
		return
	}
	if _, err := root.Lstat(to); err == nil {
		fail(w, errors.New("Ziel existiert bereits"))
		return
	}
	if err := root.Rename(from, to); err != nil {
		fail(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) deleteFile(w http.ResponseWriter, r *http.Request) {
	root, p, err := s.target(r, "path")
	if err == nil && p == "." {
		err = errors.New("Bereich selbst kann nicht gelöscht werden")
	}
	if err == nil && s.touchesLocked(r.URL.Query().Get("root"), p, true) {
		err = errLocked
	}
	if err == nil {
		err = root.RemoveAll(p)
	}
	if err != nil {
		fail(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
