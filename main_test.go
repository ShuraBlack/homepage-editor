package main

import (
	"bytes"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

var testDefaults = settings{IconsURL: "/images/icons", BackgroundsURL: "/images"}

func newTestServer(t *testing.T, base string) *server {
	t.Helper()
	s, err := newServer("admin", "geheim", map[string]string{
		"config":      filepath.Join(base, "config"),
		"icons":       filepath.Join(base, "icons"),
		"backgrounds": filepath.Join(base, "bg"),
	}, filepath.Join(base, "state", "editor.json"), testDefaults)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { // Windows can't delete dirs with open handles
		for _, r := range s.roots {
			r.Close()
		}
	})
	return s
}

func setup(t *testing.T) (*server, http.Handler, string, *http.Cookie) {
	t.Helper()
	base := t.TempDir()
	s := newTestServer(t, base)
	os.WriteFile(filepath.Join(base, "secret.txt"), []byte("outside"), 0o644)
	h := s.routes()
	return s, h, base, login(t, h)
}

func login(t *testing.T, h http.Handler) *http.Cookie {
	t.Helper()
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/login", strings.NewReader(url.Values{"user": {"admin"}, "password": {"geheim"}}.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	h.ServeHTTP(rec, req)
	cookies := rec.Result().Cookies()
	if rec.Code != http.StatusSeeOther || len(cookies) != 1 {
		t.Fatalf("login failed: %d %v", rec.Code, cookies)
	}
	return cookies[0]
}

func TestSessionsAndSettingsSurviveRestart(t *testing.T) {
	_, h, base, c := setup(t)
	if rec := do(h, c, "PUT", "/api/settings", []byte(`{"homepageUrl":"http://hp:3000/","iconsUrl":"/img/icons","backgroundsUrl":"/img"}`), ""); rec.Code != http.StatusNoContent {
		t.Fatalf("save settings: %d %s", rec.Code, rec.Body)
	}
	if rec := do(h, c, "PUT", "/api/settings", []byte(`{"homepageUrl":"ftp://x","iconsUrl":"/a","backgroundsUrl":"/b"}`), ""); rec.Code != http.StatusBadRequest {
		t.Errorf("invalid settings: want 400, got %d", rec.Code)
	}
	if raw, _ := os.ReadFile(filepath.Join(base, "state", "editor.json")); strings.Contains(string(raw), c.Value) {
		t.Error("raw session token written to disk")
	}

	h2 := newTestServer(t, base).routes() // "restart"
	rec := do(h2, c, "GET", "/api/meta", nil, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("session lost after restart: %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), `"homepageUrl":"http://hp:3000"`) || !strings.Contains(rec.Body.String(), `"custom":true`) {
		t.Errorf("settings lost after restart: %s", rec.Body)
	}

	other := login(t, h2)
	do(h2, c, "POST", "/api/sessions/revoke", nil, "")
	if rec := do(h2, other, "GET", "/api/meta", nil, ""); rec.Code != http.StatusUnauthorized {
		t.Errorf("revoked session still valid: %d", rec.Code)
	}
	if rec := do(h2, c, "GET", "/api/meta", nil, ""); rec.Code != http.StatusOK {
		t.Errorf("own session revoked: %d", rec.Code)
	}
}

func TestIconsFolderLockedInBackgrounds(t *testing.T) {
	_, h, base, c := setup(t)
	os.MkdirAll(filepath.Join(base, "bg", "icons"), 0o755)
	os.WriteFile(filepath.Join(base, "bg", "icons", "a.png"), []byte("x"), 0o644)
	os.WriteFile(filepath.Join(base, "bg", "wall.jpg"), []byte("x"), 0o644)

	if body := do(h, c, "GET", "/api/list?root=backgrounds&path=", nil, "").Body.String(); strings.Contains(body, `"icons"`) || !strings.Contains(body, "wall.jpg") {
		t.Errorf("listing should hide icons/ but show wall.jpg: %s", body)
	}
	for _, req := range []struct{ method, target string }{
		{"DELETE", "/api/file?root=backgrounds&path=icons"},
		{"DELETE", "/api/file?root=backgrounds&path=icons/a.png"},
		{"POST", "/api/rename?root=backgrounds&path=icons&to=x"},
		{"POST", "/api/rename?root=backgrounds&path=wall.jpg&to=icons/wall.jpg"},
		{"GET", "/api/list?root=backgrounds&path=icons"},
	} {
		if rec := do(h, c, req.method, req.target, nil, ""); rec.Code != http.StatusBadRequest {
			t.Errorf("%s %s: want 400, got %d", req.method, req.target, rec.Code)
		}
	}
	if _, err := os.Stat(filepath.Join(base, "bg", "icons", "a.png")); err != nil {
		t.Errorf("icon was touched: %v", err)
	}
	if rec := do(h, c, "GET", "/api/list?root=icons&path=", nil, ""); rec.Code != http.StatusOK {
		t.Errorf("icons root itself must stay usable, got %d", rec.Code)
	}
}

func do(h http.Handler, c *http.Cookie, method, target string, body []byte, ctype string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, target, bytes.NewReader(body))
	if ctype != "" {
		req.Header.Set("Content-Type", ctype)
	}
	if c != nil {
		req.AddCookie(c)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestAuth(t *testing.T) {
	_, h, _, c := setup(t)
	if rec := do(h, nil, "GET", "/api/meta", nil, ""); rec.Code != http.StatusUnauthorized {
		t.Errorf("no cookie: want 401, got %d", rec.Code)
	}
	if rec := do(h, nil, "GET", "/", nil, ""); rec.Code != http.StatusSeeOther {
		t.Errorf("page without cookie: want redirect, got %d", rec.Code)
	}
	if rec := do(h, &http.Cookie{Name: cookieName, Value: "bogus"}, "GET", "/api/meta", nil, ""); rec.Code != http.StatusUnauthorized {
		t.Errorf("bogus cookie: want 401, got %d", rec.Code)
	}
	if rec := do(h, c, "GET", "/api/meta", nil, ""); rec.Code != http.StatusOK {
		t.Errorf("valid cookie: want 200, got %d", rec.Code)
	}
}

func TestTraversal(t *testing.T) {
	_, h, _, c := setup(t)
	for _, p := range []string{"../secret.txt", "../../secret.txt", "/../secret.txt", "..%2fsecret.txt"} {
		rec := do(h, c, "GET", "/api/file?root=config&path="+p, nil, "")
		if strings.Contains(rec.Body.String(), "outside") {
			t.Errorf("%s leaked a file outside the root", p)
		}
	}
	if rec := do(h, c, "GET", "/api/file?root=nope&path=x", nil, ""); rec.Code != http.StatusBadRequest {
		t.Errorf("unknown root: want 400, got %d", rec.Code)
	}
	if rec := do(h, c, "DELETE", "/api/file?root=config&path=..", nil, ""); rec.Code != http.StatusBadRequest {
		t.Errorf("deleting root: want 400, got %d", rec.Code)
	}
}

func TestWriteKeepsBackup(t *testing.T) {
	_, h, base, c := setup(t)
	do(h, c, "PUT", "/api/file?root=config&path=services.yaml", []byte("v1"), "")
	do(h, c, "PUT", "/api/file?root=config&path=services.yaml", []byte("v2"), "")
	got, _ := os.ReadFile(filepath.Join(base, "config", "services.yaml"))
	bak, _ := os.ReadFile(filepath.Join(base, "config", "services.yaml.bak"))
	if string(got) != "v2" || string(bak) != "v1" {
		t.Errorf("got %q, bak %q", got, bak)
	}
}

func upload(h http.Handler, c *http.Cookie, root, name string, data []byte) *httptest.ResponseRecorder {
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	fw, _ := mw.CreateFormFile("files", name)
	fw.Write(data)
	mw.Close()
	return do(h, c, "POST", "/api/upload?root="+root+"&path=", buf.Bytes(), mw.FormDataContentType())
}

func TestUploadValidation(t *testing.T) {
	_, h, base, c := setup(t)
	png := []byte("\x89PNG\r\n\x1a\n0000000000000000")
	if rec := upload(h, c, "icons", "a.png", png); rec.Code != http.StatusOK {
		t.Errorf("png: want 200, got %d %s", rec.Code, rec.Body)
	}
	if rec := upload(h, c, "icons", "evil.png", []byte("<html>")); rec.Code != http.StatusBadRequest {
		t.Errorf("fake png: want 400, got %d", rec.Code)
	}
	if rec := upload(h, c, "icons", "x.sh", []byte("#!/bin/sh")); rec.Code != http.StatusBadRequest {
		t.Errorf("script: want 400, got %d", rec.Code)
	}
	if rec := upload(h, c, "icons", "../../escape.png", png); rec.Code != http.StatusOK {
		t.Errorf("dir part should be stripped: got %d", rec.Code)
	}
	if _, err := os.Stat(filepath.Join(base, "icons", "escape.png")); err != nil {
		t.Errorf("stripped upload missing: %v", err)
	}
	if rec := upload(h, c, "config", "custom.css", []byte("body{}")); rec.Code != http.StatusOK {
		t.Errorf("config accepts any file: got %d", rec.Code)
	}
}

func TestSessionCookieAndAccent(t *testing.T) {
	s, h, _, c := setup(t)
	if c.SameSite != http.SameSiteLaxMode {
		t.Errorf("cookie must be SameSite=Lax so links from the dashboard keep the login, got %v", c.SameSite)
	}

	// logging in again with the old cookie replaces that session instead of piling up a new one
	req := httptest.NewRequest("POST", "/login", strings.NewReader(url.Values{"user": {"admin"}, "password": {"geheim"}}.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.AddCookie(c)
	h.ServeHTTP(httptest.NewRecorder(), req)
	if n := len(s.st.Sessions); n != 1 {
		t.Errorf("re-login should replace the old session, have %d", n)
	}

	// cross-site writes are refused even with a valid cookie
	req = httptest.NewRequest("PUT", "/api/file?root=config&path=x.yaml", strings.NewReader("a: 1"))
	req.Header.Set("Sec-Fetch-Site", "cross-site")
	req.AddCookie(login(t, h))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Errorf("cross-site PUT: want 403, got %d", rec.Code)
	}

	c = login(t, h)
	for _, bad := range []string{"red", "#12345", "#gggggg", "#1234567"} {
		body := `{"iconsUrl":"/images/icons","backgroundsUrl":"/images","accent":"` + bad + `"}`
		if rec := do(h, c, "PUT", "/api/settings", []byte(body), ""); rec.Code != http.StatusBadRequest {
			t.Errorf("accent %q: want 400, got %d", bad, rec.Code)
		}
	}
	if rec := do(h, c, "PUT", "/api/settings", []byte(`{"iconsUrl":"/images/icons","backgroundsUrl":"/images","accent":"#3E63DD"}`), ""); rec.Code != http.StatusNoContent {
		t.Fatalf("valid accent: %d %s", rec.Code, rec.Body)
	}
	page := do(h, nil, "GET", "/login", nil, "").Body.String()
	if !strings.Contains(page, "--accent:#3e63dd;--accent-ink:#ffffff") {
		t.Errorf("login page should use the saved accent: %s", page[:min(len(page), 300)])
	}
}

func TestVersion(t *testing.T) {
	// the release workflow compares this with the tag; the update check in the UI compares it with GitHub's latest release
	if !regexp.MustCompile(`^\d+\.\d+\.\d+$`).MatchString(version) {
		t.Fatalf("VERSION %q is not MAJOR.MINOR.PATCH", version)
	}
	_, h, _, c := setup(t)
	if rec := do(h, c, "GET", "/api/meta", nil, ""); !strings.Contains(rec.Body.String(), `"version":"`+version+`"`) {
		t.Errorf("meta without version: %s", rec.Body)
	}
}
