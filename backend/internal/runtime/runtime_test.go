// Created by Sandesh
package runtime_test

import (
	"context"
	mockruntime "mockman/internal/runtime"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	start := time.Now()
	if mockruntime.Wait(ctx, 30000) {
		t.Fatal("cancellation ignored")
	}
	if time.Since(start) > 100*time.Millisecond {
		t.Fatal("cancellation was slow")
	}
	if !mockruntime.Wait(context.Background(), 1) {
		t.Fatal("normal delay failed")
	}
}
func TestContext(t *testing.T) {
	r := httptest.NewRequest(http.MethodGet, "/original?query=preserved", nil)
	p, e, s, err := mockruntime.Context(r)
	if err != nil || p != "demo" || e != "development" || s != "default" {
		t.Fatal("invalid defaults")
	}
	r.Header.Set("X-Mock-Session", "bad/session")
	if _, _, _, err = mockruntime.Context(r); err == nil {
		t.Fatal("invalid ID accepted")
	}
}

func TestCORSPreflight(t *testing.T) {
	called := false
	handler := mockruntime.CORS(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { called = true; w.WriteHeader(202) }), []string{"http://localhost:3000"})
	r := httptest.NewRequest("OPTIONS", "/original", nil)
	r.Header.Set("Origin", "http://localhost:3000")
	r.Header.Set("Access-Control-Request-Method", "POST")
	r.Header.Set("Access-Control-Request-Headers", "x-mock-session, content-type")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)
	if called || w.Code != 204 || w.Header().Get("Access-Control-Allow-Origin") != "http://localhost:3000" || w.Header().Get("Access-Control-Allow-Credentials") != "" {
		t.Fatal("invalid preflight", w.Code, w.Header())
	}
	r.Header.Set("Origin", "http://foreign.example")
	w = httptest.NewRecorder()
	handler.ServeHTTP(w, r)
	if !called || w.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Fatal("foreign origin allowed")
	}
}
