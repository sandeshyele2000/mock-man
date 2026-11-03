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
