// Created by Sandesh
package engine

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"strings"
)

func validateConfig(config Config) error {
	if config.Projects == nil {
		return errors.New("projects must be an array")
	}
	if len(config.Projects) > 50 {
		return errors.New("maximum 50 projects")
	}
	seen := make(map[string]bool, len(config.Projects))
	for _, project := range config.Projects {
		if err := validateProject(project, seen); err != nil {
			return err
		}
	}
	return nil
}

func validateProject(project Project, seen map[string]bool) error {
	if !ValidID(project.ID) || seen[project.ID] || strings.TrimSpace(project.Name) == "" {
		return errors.New("projects need unique valid IDs and names")
	}
	if project.Features == nil || len(project.Features) > 100 || len(project.Name) > 160 {
		return errors.New("project needs a features array (maximum 100) and a name up to 160 characters")
	}
	seen[project.ID] = true
	environments, err := validateEnvironments(project.Environments)
	if err != nil {
		return err
	}
	featureIDs := map[string]bool{}
	endpointIDs := map[string]bool{}
	routes := map[string]bool{}
	for _, feature := range project.Features {
		if err := validateFeature(feature, featureIDs, endpointIDs, routes, environments); err != nil {
			return err
		}
	}
	return nil
}

func validateEnvironments(values []string) (map[string]bool, error) {
	if len(values) == 0 || len(values) > 20 {
		return nil, errors.New("use 1–20 environments")
	}
	seen := make(map[string]bool, len(values))
	for _, value := range values {
		if !ValidID(value) || seen[value] {
			return nil, errors.New("environments need unique valid IDs")
		}
		seen[value] = true
	}
	return seen, nil
}

func validateFeature(feature Feature, seen, endpointIDs, routes, environments map[string]bool) error {
	if !ValidID(feature.ID) || seen[feature.ID] || strings.TrimSpace(feature.Name) == "" {
		return errors.New("features need unique valid IDs and names")
	}
	if feature.Endpoints == nil || len(feature.Name) > 160 {
		return errors.New("feature needs an endpoints array and a name up to 160 characters")
	}
	seen[feature.ID] = true
	for _, endpoint := range feature.Endpoints {
		if err := validateEndpoint(endpoint, endpointIDs, routes, environments); err != nil {
			return err
		}
	}
	return nil
}

func validateEndpoint(endpoint Endpoint, seen, routes, environments map[string]bool) error {
	if !ValidID(endpoint.ID) || seen[endpoint.ID] || strings.TrimSpace(endpoint.Name) == "" {
		return errors.New("endpoints need unique valid IDs and names")
	}
	if endpoint.Responses == nil || endpoint.Scenarios == nil || endpoint.Active == nil || len(endpoint.Responses) > 100 || len(endpoint.Scenarios) > 100 || len(endpoint.Name) > 160 || len(endpoint.Path) > 2048 {
		return errors.New("endpoint needs response/scenario arrays (maximum 100 each), active selections and bounded name/path")
	}
	seen[endpoint.ID] = true
	if !slices.Contains([]string{"GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"}, endpoint.Method) || !strings.HasPrefix(endpoint.Path, "/") || strings.ContainsAny(endpoint.Path, "?#\\\r\n") {
		return errors.New("endpoint needs a supported method and absolute path without query")
	}
	route := endpoint.Method + " " + endpoint.Path
	if routes[route] {
		return fmt.Errorf("ambiguous duplicate route %s", route)
	}
	routes[route] = true
	responses, err := validateResponses(endpoint.Responses)
	if err != nil {
		return err
	}
	scenarios, err := validateScenarios(endpoint.Scenarios, responses)
	if err != nil {
		return err
	}
	if err := validatePriorities(endpoint.Scenarios); err != nil {
		return err
	}
	return validateActiveScenarios(endpoint.Active, environments, scenarios)
}

func validateResponses(values []Response) (map[string]bool, error) {
	seen := make(map[string]bool, len(values))
	for _, response := range values {
		if err := validateResponse(response, seen); err != nil {
			return nil, err
		}
	}
	return seen, nil
}

func validateResponse(response Response, seen map[string]bool) error {
	if !ValidID(response.ID) || seen[response.ID] || response.Name == "" {
		return errors.New("responses need unique valid IDs and names")
	}
	if response.Headers == nil || len(response.Headers) > 50 || len(response.Name) > 160 {
		return errors.New("response needs a headers object (maximum 50) and a bounded name")
	}
	seen[response.ID] = true
	if response.Status < 200 || response.Status > 599 || response.DelayMS < 0 || response.DelayMS > MaxDelay || !json.Valid(response.Body) {
		return errors.New("response needs status 200–599, JSON body and delay 0–30000 ms")
	}
	headerNames := map[string]bool{}
	for name, value := range response.Headers {
		canonical := http.CanonicalHeaderKey(name)
		if !validHeader(name) || !validHeaderValue(value) || headerNames[canonical] || len(value) > 8192 || slices.Contains([]string{"Content-Length", "Transfer-Encoding", "Connection", "Trailer", "Upgrade", "Keep-Alive", "Proxy-Authenticate", "Proxy-Authorization"}, canonical) {
			return errors.New("invalid, duplicate or transport-managed response header")
		}
		headerNames[canonical] = true
	}
	return nil
}

func validateScenarios(values []Scenario, responses map[string]bool) (map[string]bool, error) {
	seen := make(map[string]bool, len(values))
	for _, scenario := range values {
		if err := validateScenario(scenario, seen, responses); err != nil {
			return nil, err
		}
	}
	return seen, nil
}

func validateScenario(scenario Scenario, seen, responses map[string]bool) error {
	if !ValidID(scenario.ID) || seen[scenario.ID] || scenario.Name == "" {
		return errors.New("scenarios need unique valid IDs and names")
	}
	if scenario.Conditions == nil || len(scenario.Conditions) > 20 || len(scenario.Name) > 160 || scenario.Priority < -1000000 || scenario.Priority > 1000000 {
		return errors.New("scenario needs a conditions array (maximum 20), bounded name and priority within +/-1000000")
	}
	seen[scenario.ID] = true
	count := len(scenario.ResponseIDs)
	if scenario.Behavior == "flow" && (scenario.Flow == nil || count > 100) {
		return errors.New("flow scenarios need a flow graph and at most 100 response IDs")
	}
	if scenario.Behavior == "javascript" && (strings.TrimSpace(scenario.Code) == "" || len(scenario.Code) > 32768 || scenario.Count < 0 || scenario.Count > 1000000 || count == 0 || count > 100) {
		return errors.New("JavaScript scenarios need code up to 32 KiB and 1–100 allowed responses")
	}
	if scenario.Behavior != "javascript" && scenario.Code != "" {
		return errors.New("only JavaScript scenarios can contain code")
	}
	if scenario.Flow != nil {
		if err := validateFlow(*scenario.Flow, responses); err != nil {
			return err
		}
	}
	if scenario.Behavior != "flow" && scenario.Behavior != "javascript" && (scenario.Count < 0 || scenario.Count > 1000000 || count == 0 || count > 100 || !slices.Contains([]string{"always", "failFirst", "failAfter", "sequence"}, scenario.Behavior)) {
		return errors.New("invalid scenario behavior, count or response list")
	}
	if scenario.Behavior == "always" && count != 1 || (scenario.Behavior == "failFirst" || scenario.Behavior == "failAfter") && count != 2 {
		return errors.New("always needs one response; failFirst/failAfter need [failure, success]")
	}
	if scenario.Behavior == "sequence" && !slices.Contains([]string{"repeat", "loop"}, scenario.Exhaustion) {
		return errors.New("sequence exhaustion must be repeat or loop")
	}
	for _, id := range scenario.ResponseIDs {
		if !responses[id] {
			return fmt.Errorf("unknown response %s", id)
		}
	}
	return validateConditions(scenario.Conditions)
}

func validateFlow(flow FlowGraph, responses map[string]bool) error {
	if len(flow.Nodes) == 0 || len(flow.Nodes) > 200 || len(flow.Connections) > 400 {
		return errors.New("flow needs 1–200 nodes and at most 400 connections")
	}
	nodes := make(map[string]FlowNode, len(flow.Nodes))
	outputs := make(map[string]map[string]bool, len(flow.Nodes))
	startCount := 0
	for _, node := range flow.Nodes {
		if !ValidID(node.ID) || nodes[node.ID].ID != "" {
			return errors.New("flow nodes need unique valid IDs")
		}
		switch node.Type {
		case "start":
			startCount++
		case "response":
			if !responses[node.ResponseID] {
				return fmt.Errorf("flow response node references unknown response %s", node.ResponseID)
			}
		case "javascript":
			if strings.TrimSpace(node.Code) == "" || len(node.Code) > 32768 || len(node.Outputs) == 0 || len(node.Outputs) > 16 {
				return errors.New("JavaScript nodes need code up to 32 KiB and 1–16 outputs")
			}
			ports := make(map[string]bool, len(node.Outputs))
			for _, port := range node.Outputs {
				if !ValidID(port) || ports[port] {
					return errors.New("JavaScript output names need unique valid IDs")
				}
				ports[port] = true
			}
			outputs[node.ID] = ports
		case "end":
		default:
			return fmt.Errorf("unsupported flow node type %s", node.Type)
		}
		nodes[node.ID] = node
	}
	if startCount != 1 || nodes[flow.StartNodeID].Type != "start" {
		return errors.New("flow needs exactly one start node matching startNodeId")
	}
	connectionIDs := make(map[string]bool, len(flow.Connections))
	outgoing := make(map[string]int, len(flow.Nodes))
	portsUsed := make(map[string]map[string]bool, len(flow.Nodes))
	for _, connection := range flow.Connections {
		source, sourceExists := nodes[connection.Source]
		_, targetExists := nodes[connection.Target]
		if !ValidID(connection.ID) || connectionIDs[connection.ID] || !sourceExists || !targetExists {
			return errors.New("flow connections need unique valid IDs and existing nodes")
		}
		connectionIDs[connection.ID] = true
		if source.Type == "end" {
			return errors.New("end nodes cannot have outgoing connections")
		}
		if source.Type == "javascript" {
			if !outputs[source.ID][connection.SourcePort] {
				return errors.New("JavaScript connection uses an undeclared output")
			}
			if portsUsed[source.ID] == nil {
				portsUsed[source.ID] = map[string]bool{}
			}
			if portsUsed[source.ID][connection.SourcePort] {
				return errors.New("each JavaScript output can have only one connection")
			}
			portsUsed[source.ID][connection.SourcePort] = true
		} else if connection.SourcePort != "" {
			return errors.New("only JavaScript connections can name an output")
		}
		outgoing[connection.Source]++
		if source.Type != "javascript" && outgoing[connection.Source] > 1 {
			return errors.New("start and response nodes can have only one outgoing connection")
		}
	}
	if outgoing[flow.StartNodeID] != 1 {
		return errors.New("the start node must connect to one node")
	}
	return nil
}

func validateConditions(conditions []Condition) error {
	keys := map[string]bool{}
	for _, condition := range conditions {
		key := condition.Source + ":" + condition.Key
		if condition.Source == "header" {
			key = strings.ToLower(key)
		}
		if !slices.Contains([]string{"query", "header", "body"}, condition.Source) || condition.Key == "" || len(condition.Key) > 256 || len(condition.Value) > 8192 || keys[key] {
			return errors.New("conditions need unique source/key pairs")
		}
		keys[key] = true
	}
	return nil
}

func validatePriorities(scenarios []Scenario) error {
	for i, first := range scenarios {
		for _, second := range scenarios[i+1:] {
			if first.Priority == second.Priority && len(first.Conditions) > 0 && len(second.Conditions) > 0 && overlap(first.Conditions, second.Conditions) {
				return errors.New("ambiguous conditional scenarios: overlapping rules need different priorities")
			}
		}
	}
	return nil
}

func validateActiveScenarios(active map[string]string, environments, scenarios map[string]bool) error {
	for environment, id := range active {
		if !environments[environment] || !scenarios[id] {
			return errors.New("active selection references unknown environment or scenario")
		}
	}
	return nil
}
