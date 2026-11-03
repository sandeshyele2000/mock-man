package engine_test

import (
	"encoding/json"
	"mockman/internal/engine"
	"mockman/internal/storage"
	"net/http"
	"net/url"
	"testing"
)

func TestBoundariesAndSequences(t *testing.T) {
	for _, tt := range []struct {
		name, behavior, exhaustion string
		count                      int64
		want                       []int
	}{
		{"failFirst3", "failFirst", "", 3, []int{500, 500, 500, 200, 200}},
		{"failFirst0", "failFirst", "", 0, []int{200, 200}},
		{"failAfter3", "failAfter", "", 3, []int{200, 200, 200, 500, 500}},
		{"failAfter0", "failAfter", "", 0, []int{500, 500}},
		{"repeat", "sequence", "repeat", 0, []int{500, 200, 200, 200}},
		{"loop", "sequence", "loop", 0, []int{500, 200, 500, 200}},
	} {
		t.Run(tt.name, func(t *testing.T) {
			e := storage.Sample().Projects[0].Features[0].Endpoints[0]
			s := e.Scenarios[0]
			s.Behavior = tt.behavior
			s.Count = tt.count
			s.Exhaustion = tt.exhaustion
			for i, w := range tt.want {
				p := engine.Resolve(engine.Match{Endpoint: e, Scenario: s}, int64(i+1))
				if p.Response.Status != w {
					t.Fatalf("attempt %d: got %d want %d", i+1, p.Response.Status, w)
				}
			}
		})
	}
}
func TestConditionsPriorityAndAmbiguity(t *testing.T) {
	c := storage.Sample()
	e := &c.Projects[0].Features[0].Endpoints[0]
	s := e.Scenarios[0]
	s.ID = "conditional"
	s.Priority = 10
	s.Conditions = []engine.Condition{{Source: "query", Key: "mode", Value: "retry"}, {Source: "header", Key: "x-test", Value: "yes"}, {Source: "body", Key: "user.accepted", Value: "true"}}
	e.Scenarios = append(e.Scenarios, s)
	if err := engine.Validate(c); err != nil {
		t.Fatal(err)
	}
	r := engine.Request{Method: "POST", Path: e.Path, Query: url.Values{"mode": {"retry"}}, Headers: http.Header{"X-Test": {"yes"}}, Body: map[string]any{"user": map[string]any{"accepted": true}}}
	m, err := engine.Select(c.Projects[0], "development", r)
	if err != nil || m.Scenario.ID != "conditional" {
		t.Fatalf("match=%+v err=%v", m, err)
	}
	r.Headers.Del("X-Test")
	m, err = engine.Select(c.Projects[0], "development", r)
	if err != nil || m.Scenario.ID != "retry" {
		t.Fatal("should fall back to active")
	}
	r.Scenario = "conditional"
	if _, err = engine.Select(c.Projects[0], "development", r); err == nil {
		t.Fatal("override must honor conditions")
	}
	s.ID = "ambiguous"
	e.Scenarios = append(e.Scenarios, s)
	if engine.Validate(c) == nil {
		t.Fatal("overlap accepted")
	}
	e.Scenarios[2].Conditions = append([]engine.Condition(nil), e.Scenarios[2].Conditions...)
	e.Scenarios[2].Conditions[0].Value = "different"
	if err = engine.Validate(c); err != nil {
		t.Fatal(err)
	}
	e2 := *e
	e2.ID = "duplicate"
	c.Projects[0].Features[0].Endpoints = append(c.Projects[0].Features[0].Endpoints, e2)
	if engine.Validate(c) == nil {
		t.Fatal("duplicate route accepted")
	}
}
func TestValidation(t *testing.T) {
	for _, mutate := range []func(*engine.Endpoint){func(e *engine.Endpoint) { e.Responses[0].DelayMS = 30001 }, func(e *engine.Endpoint) { e.Responses[0].Headers["X-Unsafe"] = "hello\r\ninjected" }, func(e *engine.Endpoint) { e.Responses[0].Headers["content-length"] = "2" }, func(e *engine.Endpoint) { e.Responses[0].Body = json.RawMessage(`invalid`) }, func(e *engine.Endpoint) { e.Scenarios[0].ResponseIDs = []string{"missing", "success"} }, func(e *engine.Endpoint) { e.Active["unknown"] = "retry" }} {
		c := storage.Sample()
		mutate(&c.Projects[0].Features[0].Endpoints[0])
		if engine.Validate(c) == nil {
			t.Fatal("invalid configuration accepted")
		}
	}
}
