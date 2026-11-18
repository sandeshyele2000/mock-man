// Created by Sandesh
package storage_test

import (
	"context"
	"encoding/json"
	"io"
	"mockman/internal/engine"
	mockruntime "mockman/internal/runtime"
	"mockman/internal/storage"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func waitLog(t *testing.T, s *storage.Store, session string) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		logs, err := s.Logs(context.Background(), "demo", "development")
		if err != nil {
			t.Fatal(err)
		}
		for _, l := range logs {
			var d storage.Detail
			_ = json.Unmarshal(l.Detail, &d)
			if d.Session == session {
				return
			}
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("request never allocated")
}
func TestHTTPInFlightSnapshotResetAndCancellation(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	c, err := s.Config(ctx)
	if err != nil {
		t.Fatal(err)
	}
	e := &c.Projects[0].Features[0].Endpoints[0]
	e.Responses[0].DelayMS = 250
	e.Responses[0].Headers["X-Configured"] = "preserved"
	e.Responses[1].DelayMS = 0
	c, err = s.Save(ctx, c)
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(mockruntime.Handler(s))
	defer server.Close()
	result := make(chan *http.Response, 1)
	failures := make(chan error, 1)
	go func() {
		r, _ := http.NewRequest("POST", server.URL+e.Path+"?original=query", strings.NewReader(`{}`))
		r.Header.Set("X-Mock-Session", "inflight")
		response, err := server.Client().Do(r)
		if err != nil {
			failures <- err
			return
		}
		result <- response
	}()
	waitLog(t, s, "inflight")
	// Reset and save while the first request is sleeping. Neither changes its selected response.
	if err = s.Reset(ctx, "demo", "development", "inflight", e.ID); err != nil {
		t.Fatal(err)
	}
	c.Projects[0].Features[0].Endpoints[0].Responses[0].Status = 503
	c, err = s.Save(ctx, c)
	if err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-failures:
		t.Fatal(err)
	case response := <-result:
		defer response.Body.Close()
		body, _ := io.ReadAll(response.Body)
		if response.StatusCode != 500 || response.Header.Get("X-Configured") != "preserved" || string(body) != `{"error":"Temporary failure"}` {
			t.Fatalf("snapshot response %d %s", response.StatusCode, body)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("delayed request stuck")
	}
	p, err := s.Match(ctx, "demo", "development", "inflight", req())
	if err != nil || p.Attempt != 1 || p.Response.Status != 503 {
		t.Fatalf("new revision/reset %+v %v", p, err)
	}
	cancelCtx, cancel := context.WithCancel(ctx)
	r, _ := http.NewRequestWithContext(cancelCtx, "POST", server.URL+e.Path, nil)
	r.Header.Set("X-Mock-Session", "cancelled")
	done := make(chan error, 1)
	go func() {
		resp, err := server.Client().Do(r)
		if resp != nil {
			resp.Body.Close()
		}
		done <- err
	}()
	waitLog(t, s, "cancelled")
	cancel()
	if err = <-done; err == nil {
		t.Fatal("request was not cancelled")
	}
	p, err = s.Match(ctx, "demo", "development", "cancelled", req())
	if err != nil || p.Attempt != 2 {
		t.Fatalf("cancelled attempt not consumed %+v %v", p, err)
	}
}
func TestHTTPStatusHeadersBodyAndLimits(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	c, _ := s.Config(ctx)
	template := c.Projects[0].Features[0].Endpoints[0]
	endpoints := []engine.Endpoint{}
	for i, tt := range []struct {
		method string
		status int
		path   string
	}{{"GET", 201, "/created"}, {"HEAD", 200, "/head"}, {"GET", 204, "/empty"}, {"GET", 205, "/reset"}, {"GET", 304, "/cached"}} {
		e := template
		e.ID = tt.path[1:]
		e.Method = tt.method
		e.Path = tt.path
		e.Responses = []engine.Response{{ID: "data", Name: "Data", Status: tt.status, DelayMS: 0, Headers: map[string]string{"Content-Type": "application/json", "X-Test": "kept"}, Body: json.RawMessage(`{"arbitrary":[1,true]}`)}}
		e.Scenarios = []engine.Scenario{{ID: "always", Name: "Always", Behavior: "always", ResponseIDs: []string{"data"}, Conditions: []engine.Condition{}}}
		e.Active = map[string]string{"development": "always"}
		endpoints = append(endpoints, e)
		_ = i
	}
	c.Projects[0].Features[0].Endpoints = endpoints
	if _, err := s.Save(ctx, c); err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(mockruntime.Handler(s))
	defer server.Close()
	for i, e := range endpoints {
		r, _ := http.NewRequest(e.Method, server.URL+e.Path, nil)
		response, err := server.Client().Do(r)
		if err != nil {
			t.Fatal(err)
		}
		body, _ := io.ReadAll(response.Body)
		response.Body.Close()
		if response.StatusCode != e.Responses[0].Status || response.Header.Get("X-Test") != "kept" {
			t.Fatalf("status/header %s", e.Path)
		}
		if i == 0 && string(body) != string(e.Responses[0].Body) {
			t.Fatalf("body changed: %s", body)
		}
		if i > 0 && len(body) != 0 {
			t.Fatalf("forbidden body for %s", e.Path)
		}
	}
	for _, tt := range []struct {
		path, body string
		want       int
	}{{"/unmatched", "", 404}, {"/created", strings.Repeat("x", mockruntime.MaxRequestBytes+1), 413}} {
		r, _ := http.NewRequest("GET", server.URL+tt.path, strings.NewReader(tt.body))
		response, err := server.Client().Do(r)
		if err != nil {
			t.Fatal(err)
		}
		response.Body.Close()
		if response.StatusCode != tt.want {
			t.Fatalf("got %d want %d", response.StatusCode, tt.want)
		}
	}
}

func TestHTTPPayloadLogs(t *testing.T) {
	store := testStore(t)
	ctx := context.Background()
	config, err := store.Config(ctx)
	if err != nil {
		t.Fatal(err)
	}
	endpoint := &config.Projects[0].Features[0].Endpoints[0]
	for index := range endpoint.Responses {
		endpoint.Responses[index].DelayMS = 0
	}
	if _, err := store.Save(ctx, config); err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(mockruntime.Handler(store))
	defer server.Close()
	for _, test := range []struct{ session, body, contentType, encoding string }{
		{"json-payload", "{\n\"id\":9007199254740993,\"accepted\":true\n}", "application/json", "utf-8"},
		{"form-payload", "name=Jane+Doe", "application/x-www-form-urlencoded", "utf-8"},
		{"empty-payload", "", "", "utf-8"},
		{"large-payload", strings.Repeat("a", 70000), "text/plain", "utf-8"},
		{"binary-payload", "a\x00b", "application/octet-stream", "base64"},
	} {
		t.Run(test.session, func(t *testing.T) {
			request, err := http.NewRequest(http.MethodPost, server.URL+endpoint.Path, strings.NewReader(test.body))
			if err != nil {
				t.Fatal(err)
			}
			request.Header.Set("X-Mock-Session", test.session)
			request.Header.Set("Content-Type", test.contentType)
			response, err := server.Client().Do(request)
			if err != nil {
				t.Fatal(err)
			}
			_, _ = io.Copy(io.Discard, response.Body)
			response.Body.Close()
			if response.StatusCode != 500 {
				t.Fatalf("mock behavior changed: %d", response.StatusCode)
			}
			logs, err := store.Logs(ctx, "demo", "development")
			if err != nil {
				t.Fatal(err)
			}
			var detail storage.Detail
			if err := json.Unmarshal(logs[0].Detail, &detail); err != nil {
				t.Fatal(err)
			}
			if detail.Session != test.session || detail.Payload == nil {
				t.Fatalf("missing payload: %+v", detail)
			}
			payload := detail.Payload
			if payload.SizeBytes != len(test.body) || payload.ContentType != test.contentType || payload.Encoding != test.encoding {
				t.Fatalf("invalid payload metadata: %+v", payload)
			}
			wantBody := test.body
			if len(wantBody) > 64<<10 {
				wantBody = wantBody[:64<<10]
			}
			if payload.Truncated != (len(test.body) > 64<<10) {
				t.Fatal("incorrect truncation flag")
			}
			if test.encoding == "utf-8" && payload.Body != wantBody {
				t.Fatalf("body not preserved: %q", payload.Body)
			}
		})
	}
}

func TestHTTPFeatureRoutingAndIsolation(t *testing.T) {
	store := testStore(t)
	ctx := context.Background()
	config, err := store.Config(ctx)
	if err != nil {
		t.Fatal(err)
	}
	first := &config.Projects[0].Features[0]
	for index := range first.Endpoints[0].Responses {
		first.Endpoints[0].Responses[index].DelayMS = 0
	}
	encoded, err := json.Marshal(first)
	if err != nil {
		t.Fatal(err)
	}
	var second engine.Feature
	if err := json.Unmarshal(encoded, &second); err != nil {
		t.Fatal(err)
	}
	second.ID, second.Name = "billing", "Billing"
	second.Endpoints[0].ID = "billing-accept"
	second.Endpoints[0].Responses[0].Body = json.RawMessage(`{"feature":"billing"}`)
	config.Projects[0].Features = append(config.Projects[0].Features, second)
	config, err = store.Save(ctx, config)
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(mockruntime.Handler(store))
	defer server.Close()
	send := func(feature string, want int) string {
		t.Helper()
		request, err := http.NewRequest(http.MethodPost, server.URL+second.Endpoints[0].Path, strings.NewReader(`{"client":true}`))
		if err != nil {
			t.Fatal(err)
		}
		request.Header.Set("X-Mock-Feature", feature)
		request.Header.Set("X-Mock-Session", "shared-session")
		response, err := server.Client().Do(request)
		if err != nil {
			t.Fatal(err)
		}
		body, _ := io.ReadAll(response.Body)
		response.Body.Close()
		if response.StatusCode != want {
			t.Fatalf("feature=%q status=%d body=%s", feature, response.StatusCode, body)
		}
		return string(body)
	}
	if body := send("", 409); !strings.Contains(body, "X-Mock-Feature") {
		t.Fatal("ambiguous error lacks routing guidance")
	}
	send("missing", 404)
	send("bad/feature", 400)
	send("agreements", 500)
	if body := send("billing", 500); body != `{"feature":"billing"}` {
		t.Fatalf("wrong feature response: %s", body)
	}
	logs, err := store.Logs(ctx, "demo", "development")
	if err != nil {
		t.Fatal(err)
	}
	if len(logs) != 2 {
		t.Fatalf("rejected requests allocated state: log count %d", len(logs))
	}
	for index, feature := range []string{"billing", "agreements"} {
		var detail storage.Detail
		if err := json.Unmarshal(logs[index].Detail, &detail); err != nil {
			t.Fatal(err)
		}
		if detail.Feature != feature || detail.Attempt != 1 {
			t.Fatalf("feature isolation: %+v", detail)
		}
	}
	config.Projects[0].Features[1].MockingDisabled = true
	config, err = store.Save(ctx, config)
	if err != nil {
		t.Fatal(err)
	}
	send("billing", 404)
	send("", 500) // One enabled feature: legacy callers still work.
	// JavaScript receives the resolved feature even for legacy, unscoped requests.
	scenario := &config.Projects[0].Features[0].Endpoints[0].Scenarios[0]
	scenario.Behavior = "javascript"
	scenario.Code = `return { response: { status: 200, body: { feature: request.feature } } };`
	if _, err := store.Save(ctx, config); err != nil {
		t.Fatal(err)
	}
	if body := send("", 200); body != `{"feature":"agreements"}` {
		t.Fatalf("script feature context: %s", body)
	}
}
