// Created by Sandesh
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

func TestPathValidation(t *testing.T) {
	for _, path := range []string{"/users", "/v1/agreements/acceptances"} {
		t.Run("accept "+path, func(t *testing.T) {
			config := storage.Sample()
			config.Projects[0].Features[0].Endpoints[0].Path = path
			if err := engine.Validate(config); err != nil {
				t.Fatalf("valid path %q rejected: %v", path, err)
			}
		})
	}

	for _, path := range []string{"/users?active=true", "/users#details", "/users\\admin", "/users\radmin", "/users\nadmin"} {
		t.Run("reject "+path, func(t *testing.T) {
			config := storage.Sample()
			config.Projects[0].Features[0].Endpoints[0].Path = path
			if err := engine.Validate(config); err == nil {
				t.Fatalf("invalid path %q accepted", path)
			}
		})
	}
}

func TestFeaturePausePreservesEndpointSettings(t *testing.T) {
	config := storage.Sample()
	project := config.Projects[0]
	endpoint := project.Features[0].Endpoints[0]
	request := engine.Request{Method: endpoint.Method, Path: endpoint.Path}
	if _, err := engine.Select(project, "development", request); err != nil {
		t.Fatal(err)
	}
	project.Features[0].MockingDisabled = true
	request.Scenario = endpoint.Scenarios[0].ID
	if _, err := engine.Select(project, "development", request); err != engine.ErrNoMatch {
		t.Fatalf("override bypassed disabled feature: %v", err)
	}
	project.Features[0].MockingDisabled = false
	if _, err := engine.Select(project, "development", request); err != nil {
		t.Fatal(err)
	}
	if !project.Features[0].Endpoints[0].Enabled {
		t.Fatal("pause changed endpoint settings")
	}
	project.Features[0].Endpoints[0].Enabled = false
	if _, err := engine.Select(project, "development", request); err != engine.ErrNoMatch {
		t.Fatalf("disabled endpoint matched: %v", err)
	}
}

func featureRoutingConfig() engine.Config {
	config := storage.Sample()
	second := config.Projects[0].Features[0]
	second.ID, second.Name = "billing", "Billing"
	second.Endpoints = append([]engine.Endpoint(nil), second.Endpoints...)
	second.Endpoints[0].ID = "billing-accept"
	config.Projects[0].Features = append(config.Projects[0].Features, second)
	return config
}

func TestFeatureRoutingAndValidation(t *testing.T) {
	config := featureRoutingConfig()
	if err := engine.Validate(config); err != nil {
		t.Fatalf("cross-feature routes should be allowed: %v", err)
	}
	request := engine.Request{Method: "POST", Path: "/v1/agreements/acceptances"}
	if _, err := engine.Select(config.Projects[0], "development", request); err != engine.ErrAmbiguousFeature {
		t.Fatalf("unscoped shared route: %v", err)
	}
	for _, feature := range config.Projects[0].Features {
		request.Feature = feature.ID
		match, err := engine.Select(config.Projects[0], "development", request)
		if err != nil || match.Feature != feature.ID || match.Endpoint.ID != feature.Endpoints[0].ID {
			t.Fatalf("wrong feature matched: %+v %v", match, err)
		}
	}
	request.Feature = "missing"
	if _, err := engine.Select(config.Projects[0], "development", request); err != engine.ErrNoMatch {
		t.Fatalf("unknown feature fell back: %v", err)
	}
	config.Projects[0].Features[1].MockingDisabled = true
	request.Feature = "billing"
	if _, err := engine.Select(config.Projects[0], "development", request); err != engine.ErrNoMatch {
		t.Fatalf("disabled feature fell back: %v", err)
	}
	request.Feature = ""
	match, err := engine.Select(config.Projects[0], "development", request)
	if err != nil || match.Feature != "agreements" {
		t.Fatalf("unique enabled feature did not match: %+v %v", match, err)
	}
	config.Projects[0].Features[1].MockingDisabled = false
	config.Projects[0].Features[1].Endpoints[0].Enabled = false
	if _, err := engine.Select(config.Projects[0], "development", request); err != nil {
		t.Fatalf("disabled endpoint should not create ambiguity: %v", err)
	}
	// Conditions and scenario overrides cannot route an otherwise ambiguous request.
	config = featureRoutingConfig()
	request.Scenario = "retry"
	config.Projects[0].Features[1].Endpoints[0].Active = map[string]string{}
	if _, err := engine.Select(config.Projects[0], "development", request); err != engine.ErrAmbiguousFeature {
		t.Fatalf("scenario bypassed feature routing: %v", err)
	}
	// Endpoint IDs must still be project-wide unique for counters and logs.
	config.Projects[0].Features[1].Endpoints[0].ID = "accept"
	if err := engine.Validate(config); err == nil {
		t.Fatal("duplicate endpoint IDs accepted across features")
	}
}
