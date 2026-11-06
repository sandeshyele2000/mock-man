// Created by Sandesh
package storage

import (
	"encoding/json"
	"mockman/internal/engine"
)

func Sample() engine.Config {
	endpoint := engine.Endpoint{
		ID: "accept", Name: "Accept agreement", Method: "POST", Path: "/v1/agreements/acceptances", Enabled: true,
		Active: map[string]string{"development": "retry", "staging": "retry"},
		Responses: []engine.Response{
			{ID: "failure", Name: "Temporary failure", Status: 500, DelayMS: 10000, Headers: map[string]string{"Content-Type": "application/json"}, Body: json.RawMessage(`{"error":"Temporary failure"}`)},
			{ID: "success", Name: "Accepted", Status: 200, DelayMS: 200, Headers: map[string]string{"Content-Type": "application/json"}, Body: json.RawMessage(`{"success":true}`)},
		},
		Scenarios: []engine.Scenario{{ID: "retry", Name: "Retry then succeed", Behavior: "failFirst", Count: 3, ResponseIDs: []string{"failure", "success"}, Exhaustion: "repeat", Conditions: []engine.Condition{}}},
	}
	return engine.Config{Version: 1, Projects: []engine.Project{{ID: "demo", Name: "Demo application", Environments: []string{"development", "staging"}, Features: []engine.Feature{{ID: "agreements", Name: "Agreements", Endpoints: []engine.Endpoint{endpoint}}}}}}
}
