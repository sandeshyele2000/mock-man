// Package dashboard serves the optional embedded dashboard alongside the admin API.
package dashboard

import (
	"bytes"
	"encoding/json"
	"io/fs"
	"net/http"
	"strings"
	"time"
)

func Handler(api http.Handler, apiURL, mockURL string) http.Handler {
	return handler(files, api, apiURL, mockURL)
}

func handler(content fs.FS, api http.Handler, apiURL, mockURL string) http.Handler {
	config, _ := json.Marshal(struct {
		APIURL  string `json:"apiURL"`
		MockURL string `json:"mockURL"`
	}{apiURL, mockURL})
	runtimeConfig := []byte("window.__MOCKMAN_CONFIG__ = " + string(config) + ";\n")
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api" || strings.HasPrefix(r.URL.Path, "/api/") {
			api.ServeHTTP(w, r)
			return
		}
		if content == nil {
			api.ServeHTTP(w, r)
			return
		}
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.Header().Set("Allow", "GET, HEAD")
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		w.Header().Set("X-Content-Type-Options", "nosniff")
		if r.URL.Path == "/runtime-config.js" {
			w.Header().Set("Content-Type", "application/javascript; charset=utf-8")
			w.Header().Set("Cache-Control", "no-store")
			http.ServeContent(w, r, "runtime-config.js", time.Time{}, bytes.NewReader(runtimeConfig))
			return
		}
		name := strings.TrimPrefix(r.URL.Path, "/")
		if name == "" {
			name = "index.html"
		}
		// ReadFile rejects traversal and directories; missing assets must remain 404s.
		data, err := fs.ReadFile(content, name)
		if err != nil {
			http.NotFound(w, r)
			return
		}
		if name == "index.html" {
			w.Header().Set("Cache-Control", "no-store")
		}
		http.ServeContent(w, r, name, time.Time{}, bytes.NewReader(data))
	})
}
