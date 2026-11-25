package dashboard

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
)

func TestDashboardAndAPI(t *testing.T) {
	content := fstest.MapFS{
		"index.html":    {Data: []byte(`<script src="./runtime-config.js"></script>`)},
		"assets/app.js": {Data: []byte(`console.log("dashboard")`)},
	}
	api := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Admin", "yes")
		w.WriteHeader(http.StatusForbidden)
	})
	h := handler(content, api, "https://host/mockman-api/", "https://host/mockman-mock/")
	for _, tt := range []struct {
		path   string
		status int
	}{
		{"/", 200}, {"/index.html", 200}, {"/assets/app.js", 200},
		{"/assets/missing.js", 404}, {"/assets/", 404}, {"/../index.html", 404},
		{"/api/config", 403}, {"/api/unknown", 403}, {"/api", 403},
	} {
		t.Run(tt.path, func(t *testing.T) {
			w := httptest.NewRecorder()
			h.ServeHTTP(w, httptest.NewRequest("GET", tt.path, nil))
			if w.Code != tt.status {
				t.Fatalf("status = %d, want %d", w.Code, tt.status)
			}
			if strings.HasPrefix(tt.path, "/api") && w.Header().Get("X-Admin") != "yes" {
				t.Fatal("API bypassed admin handler")
			}
		})
	}
	for _, method := range []string{"GET", "HEAD", "POST"} {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest(method, "/runtime-config.js", nil))
		if method == "POST" {
			if w.Code != 405 {
				t.Fatal(w.Code)
			}
			continue
		}
		if w.Code != 200 || w.Header().Get("Cache-Control") != "no-store" {
			t.Fatal(w.Result())
		}
		if method == "HEAD" {
			if w.Body.Len() != 0 {
				t.Fatal("HEAD returned a body")
			}
			continue
		}
		body := strings.TrimSuffix(strings.TrimPrefix(w.Body.String(), "window.__MOCKMAN_CONFIG__ = "), ";\n")
		var config map[string]string
		if err := json.Unmarshal([]byte(body), &config); err != nil {
			t.Fatal(err)
		}
		if config["apiURL"] != "https://host/mockman-api/" || config["mockURL"] != "https://host/mockman-mock/" {
			t.Fatal(config)
		}
	}
}

func TestWithoutEmbeddedDashboard(t *testing.T) {
	h := handler(nil, http.NotFoundHandler(), "", "")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", "/", nil))
	if w.Code != 404 {
		t.Fatal(w.Code)
	}
}
