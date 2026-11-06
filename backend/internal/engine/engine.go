// Package engine contains declarative matching and response selection, independent of HTTP and storage.
package engine

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"slices"
	"strings"
)

const MaxDelay = 30000

var ErrNoMatch = errors.New("no enabled rule matched method, path and conditions")
var ErrFlowExecution = errors.New("flow execution failed")
var ErrScriptExecution = errors.New("JavaScript scenario execution failed")

var identifier = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$`)

func ValidID(s string) bool { return identifier.MatchString(s) }

type Config struct {
	Version  int64     `json:"version"`
	Projects []Project `json:"projects"`
}
type Project struct {
	ID           string    `json:"id"`
	Name         string    `json:"name"`
	Environments []string  `json:"environments"`
	Features     []Feature `json:"features"`
}
type Feature struct {
	ID        string     `json:"id"`
	Name      string     `json:"name"`
	Endpoints []Endpoint `json:"endpoints"`
}
type Endpoint struct {
	ID        string            `json:"id"`
	Name      string            `json:"name"`
	Method    string            `json:"method"`
	Path      string            `json:"path"`
	Enabled   bool              `json:"enabled"`
	Responses []Response        `json:"responses"`
	Scenarios []Scenario        `json:"scenarios"`
	Active    map[string]string `json:"active"`
}
type Response struct {
	ID      string            `json:"id"`
	Name    string            `json:"name"`
	Status  int               `json:"status"`
	Headers map[string]string `json:"headers"`
	Body    json.RawMessage   `json:"body"`
	DelayMS int               `json:"delayMs"`
}
type Condition struct {
	Source string `json:"source"`
	Key    string `json:"key"`
	Value  string `json:"value"`
}
type FlowGraph struct {
	StartNodeID string           `json:"startNodeId"`
	Nodes       []FlowNode       `json:"nodes"`
	Connections []FlowConnection `json:"connections"`
}
type FlowNode struct {
	ID         string   `json:"id"`
	Type       string   `json:"type"`
	X          int      `json:"x"`
	Y          int      `json:"y"`
	ResponseID string   `json:"responseId,omitempty"`
	Code       string   `json:"code,omitempty"`
	Outputs    []string `json:"outputs,omitempty"`
}
type FlowConnection struct {
	ID         string `json:"id"`
	Source     string `json:"source"`
	Target     string `json:"target"`
	SourcePort string `json:"sourcePort,omitempty"`
}
type Scenario struct {
	ID          string      `json:"id"`
	Name        string      `json:"name"`
	Revision    string      `json:"revision"`
	Behavior    string      `json:"behavior"`
	Count       int64       `json:"count"`
	ResponseIDs []string    `json:"responseIds"`
	Exhaustion  string      `json:"exhaustion"`
	Priority    int         `json:"priority"`
	Conditions  []Condition `json:"conditions"`
	Flow        *FlowGraph  `json:"flow,omitempty"`
	Code        string      `json:"code,omitempty"`
}
type Request struct {
	Method, Path, Scenario string
	Query                  url.Values
	Headers                http.Header
	Body                   any
}
type Match struct {
	Endpoint Endpoint
	Scenario Scenario
	Reason   string
}
type Plan struct {
	Response     Response
	Attempt      int64
	Match        Match
	NextNode     string
	LastResponse string
}

func Validate(config Config) error { return validateConfig(config) }

func validHeader(s string) bool {
	if s == "" {
		return false
	}
	for _, c := range s {
		if !strings.ContainsRune("!#$%&'*+-.^_`|~0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ", c) {
			return false
		}
	}
	return true
}
func overlap(a, b []Condition) bool {
	for _, x := range a {
		for _, y := range b {
			same := x.Key == y.Key
			if x.Source == "header" {
				same = strings.EqualFold(x.Key, y.Key)
			}
			if x.Source == y.Source && same && x.Value != y.Value {
				return false
			}
		}
	}
	return true
}
func Matches(conditions []Condition, request Request) bool {
	for _, condition := range conditions {
		value, found := conditionValue(condition, request)
		if !found || value != condition.Value {
			return false
		}
	}
	return true
}

func conditionValue(condition Condition, request Request) (string, bool) {
	switch condition.Source {
	case "query":
		return firstValue(request.Query, condition.Key)
	case "header":
		return firstValue(http.Header(request.Headers), http.CanonicalHeaderKey(condition.Key))
	case "body":
		return bodyFieldValue(request.Body, condition.Key)
	default:
		return "", false
	}
}

func firstValue(values map[string][]string, key string) (string, bool) {
	items, ok := values[key]
	if !ok || len(items) == 0 {
		return "", false
	}
	return items[0], true
}

func bodyFieldValue(body any, path string) (string, bool) {
	value := body
	for _, part := range strings.Split(path, ".") {
		object, ok := value.(map[string]any)
		if !ok {
			return "", false
		}
		value, ok = object[part]
		if !ok {
			return "", false
		}
	}
	if text, ok := value.(string); ok {
		return text, true
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		return "", false
	}
	return string(encoded), true
}
func Select(project Project, environment string, request Request) (Match, error) {
	for _, feature := range project.Features {
		for _, endpoint := range feature.Endpoints {
			if !endpointMatches(endpoint, request) {
				continue
			}
			match, ok, err := selectEndpointScenario(endpoint, environment, request)
			if err != nil {
				return Match{}, err
			}
			if ok {
				return match, nil
			}
		}
	}
	return Match{}, ErrNoMatch
}

func endpointMatches(endpoint Endpoint, request Request) bool {
	return endpoint.Enabled && endpoint.Method == request.Method && endpoint.Path == request.Path
}

func selectEndpointScenario(endpoint Endpoint, environment string, request Request) (Match, bool, error) {
	scenarios := orderedScenarios(endpoint.Scenarios)
	if request.Scenario != "" {
		return selectOverride(endpoint, scenarios, request)
	}
	if match, ok := selectConditional(endpoint, scenarios, request); ok {
		return match, true, nil
	}
	return selectActive(endpoint, environment, scenarios, request)
}

func orderedScenarios(scenarios []Scenario) []Scenario {
	ordered := slices.Clone(scenarios)
	slices.SortStableFunc(ordered, func(a, b Scenario) int {
		if a.Priority > b.Priority {
			return -1
		}
		if a.Priority < b.Priority {
			return 1
		}
		return strings.Compare(a.ID, b.ID)
	})
	return ordered
}

func selectOverride(endpoint Endpoint, scenarios []Scenario, request Request) (Match, bool, error) {
	for _, scenario := range scenarios {
		if scenario.ID == request.Scenario && Matches(scenario.Conditions, request) {
			return Match{endpoint, scenario, "explicit scenario override; conditions matched"}, true, nil
		}
	}
	return Match{}, false, fmt.Errorf("%w: override scenario absent or conditions did not match", ErrNoMatch)
}

func selectConditional(endpoint Endpoint, scenarios []Scenario, request Request) (Match, bool) {
	for _, scenario := range scenarios {
		if len(scenario.Conditions) > 0 && Matches(scenario.Conditions, request) {
			return Match{endpoint, scenario, fmt.Sprintf("conditions matched; priority %d", scenario.Priority)}, true
		}
	}
	return Match{}, false
}

func selectActive(endpoint Endpoint, environment string, scenarios []Scenario, request Request) (Match, bool, error) {
	activeID := endpoint.Active[environment]
	for _, scenario := range scenarios {
		if activeID == scenario.ID && Matches(scenario.Conditions, request) {
			return Match{endpoint, scenario, "active scenario; conditions matched"}, true, nil
		}
	}
	return Match{}, false, nil
}
func Resolve(m Match, attempt int64) Plan {
	s := m.Scenario
	idx := 0
	switch s.Behavior {
	case "failFirst":
		if attempt > s.Count {
			idx = 1
		}
	case "failAfter":
		if attempt <= s.Count {
			idx = 1
		}
	case "sequence":
		idx = int((attempt - 1) % int64(len(s.ResponseIDs)))
		if s.Exhaustion == "repeat" && attempt > int64(len(s.ResponseIDs)) {
			idx = len(s.ResponseIDs) - 1
		}
	}
	for _, r := range m.Endpoint.Responses {
		if r.ID == s.ResponseIDs[idx] {
			return Plan{Response: r, Attempt: attempt, Match: m}
		}
	}
	panic("validated response reference missing")
}

func validHeaderValue(s string) bool {
	for _, c := range s {
		if (c < 32 && c != 9) || c == 127 {
			return false
		}
	}
	return true
}
