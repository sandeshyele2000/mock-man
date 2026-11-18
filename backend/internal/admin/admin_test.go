// Created by Sandesh
package admin_test

import (
	"mockman/internal/admin"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestAdminProtections(t *testing.T) {
	h := admin.Server{Origin: "http://127.0.0.1:8080", DashboardOrigin: "http://127.0.0.1:5173"}.Handler()
	for _, tt := range []struct{ name, host, origin, contentType, header string }{{"foreign host", "attacker.test", "", "application/json", "1"}, {"foreign origin", "127.0.0.1:8080", "https://attacker.test", "application/json", "1"}, {"simple form", "127.0.0.1:8080", "", "text/plain", "1"}, {"missing header", "127.0.0.1:8080", "", "application/json", ""}} {
		t.Run(tt.name, func(t *testing.T) {
			r := httptest.NewRequest(http.MethodPut, "http://"+tt.host+"/api/config", strings.NewReader(`{}`))
			r.Header.Set("Origin", tt.origin)
			r.Header.Set("Content-Type", tt.contentType)
			r.Header.Set("X-Mockman-Admin", tt.header)
			w := httptest.NewRecorder()
			h.ServeHTTP(w, r)
			if w.Code != 403 {
				t.Fatalf("status %d", w.Code)
			}
		})
	}
}

func TestTryFeatureHeader(t *testing.T) {
	for _, test := range []struct {
		name, body, feature string
		status              int
	}{
		{"structured feature", `{"project":"demo","environment":"development","feature":"agreements","method":"POST","path":"/same","headers":{"X-Mock-Feature":"billing"}}`, "agreements", 200},
		{"header-only feature", `{"project":"demo","environment":"development","method":"POST","path":"/same","headers":{"X-Mock-Feature":"billing"}}`, "billing", 200},
		{"legacy unscoped", `{"project":"demo","environment":"development","method":"POST","path":"/same"}`, "", 200},
		{"invalid feature", `{"feature":"bad/feature","method":"POST","path":"/same"}`, "", 422},
	} {
		t.Run(test.name, func(t *testing.T) {
			called := false
			runtime := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				called = true
				if got := r.Header.Get("X-Mock-Feature"); got != test.feature {
					t.Errorf("feature=%q want %q", got, test.feature)
				}
				w.WriteHeader(http.StatusNoContent)
			})
			handler := admin.Server{Origin: "http://admin.test", Runtime: runtime}.Handler()
			request := httptest.NewRequest(http.MethodPost, "http://admin.test/api/try", strings.NewReader(test.body))
			request.Header.Set("Content-Type", "application/json")
			request.Header.Set("X-Mockman-Admin", "1")
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, request)
			if response.Code != test.status || called != (test.status == 200) {
				t.Fatalf("status=%d runtime called=%v body=%s", response.Code, called, response.Body.String())
			}
		})
	}
}
