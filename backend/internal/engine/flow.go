package engine

import (
	"errors"
	"fmt"
)

const maxFlowSteps = 100

func ResolveFlow(match Match, attempt int64, request Request, session, environment, cursor, lastResponse string) (Plan, error) {
	flow := match.Scenario.Flow
	if flow == nil {
		return Plan{}, errors.New("flow scenario has no graph")
	}
	nodes := make(map[string]FlowNode, len(flow.Nodes))
	for _, node := range flow.Nodes {
		nodes[node.ID] = node
	}
	current := cursor
	if current == "" {
		current = flow.StartNodeID
	}
	var data any
	for step := 0; step < maxFlowSteps; step++ {
		node, exists := nodes[current]
		if !exists {
			return Plan{}, fmt.Errorf("flow cursor references missing node %s", current)
		}
		switch node.Type {
		case "start":
			next, ok := flowConnection(flow, node.ID, "")
			if !ok {
				return Plan{}, errors.New("flow start node has no outgoing connection")
			}
			current = next.Target
		case "response":
			response, ok := findResponse(match.Endpoint, node.ResponseID)
			if !ok {
				return Plan{}, fmt.Errorf("flow response %s does not exist", node.ResponseID)
			}
			next, _ := flowConnection(flow, node.ID, "")
			return Plan{
				Response: response, Attempt: attempt, Match: match,
				NextNode: next.Target, LastResponse: response.ID,
			}, nil
		case "javascript":
			result, err := runJavaScript(node.Code, newFlowInput(request, attempt, session, environment, data, match.Endpoint, nil))
			if err != nil {
				return Plan{}, fmt.Errorf("node %s: %w", node.ID, err)
			}
			if result.Data != nil {
				data = result.Data
			}
			if result.ResponseID != "" && result.Response != nil {
				return Plan{}, errors.New("JavaScript node cannot return responseId and response together")
			}
			if result.ResponseID != "" {
				response, ok := findResponse(match.Endpoint, result.ResponseID)
				if !ok {
					return Plan{}, fmt.Errorf("JavaScript node selected unknown response %s", result.ResponseID)
				}
				next, err := flowNext(flow, node, result.Output)
				if err != nil {
					return Plan{}, err
				}
				return Plan{
					Response: response, Attempt: attempt, Match: match,
					NextNode: next, LastResponse: response.ID,
				}, nil
			}
			if result.Response != nil {
				response, err := makeCustomResponse(*result.Response)
				if err != nil {
					return Plan{}, fmt.Errorf("node %s: %w", node.ID, err)
				}
				next, err := flowNext(flow, node, result.Output)
				if err != nil {
					return Plan{}, err
				}
				return Plan{
					Response: response, Attempt: attempt, Match: match,
					NextNode: next, LastResponse: lastResponse,
				}, nil
			}
			if result.Output == "" {
				return Plan{}, fmt.Errorf("JavaScript node %s must return output, responseId, or response", node.ID)
			}
			next, err := flowNext(flow, node, result.Output)
			if err != nil {
				return Plan{}, err
			}
			current = next
		case "end":
			response, ok := findResponse(match.Endpoint, lastResponse)
			if !ok {
				return Plan{}, errors.New("flow ended before selecting a saved response")
			}
			return Plan{
				Response: response, Attempt: attempt, Match: match,
				NextNode: node.ID, LastResponse: response.ID,
			}, nil
		default:
			return Plan{}, fmt.Errorf("unsupported flow node type %s", node.Type)
		}
	}
	return Plan{}, fmt.Errorf("flow exceeded the %d node execution limit", maxFlowSteps)
}

func flowNext(flow *FlowGraph, node FlowNode, output string) (string, error) {
	if output == "" {
		return "", nil
	}
	connection, ok := flowConnection(flow, node.ID, output)
	if !ok {
		return "", fmt.Errorf("node %s selected unconnected output %s", node.ID, output)
	}
	return connection.Target, nil
}

func flowConnection(flow *FlowGraph, source, port string) (FlowConnection, bool) {
	for _, connection := range flow.Connections {
		if connection.Source == source && connection.SourcePort == port {
			return connection, true
		}
	}
	return FlowConnection{}, false
}

func findResponse(endpoint Endpoint, responseID string) (Response, bool) {
	for _, response := range endpoint.Responses {
		if response.ID == responseID {
			return response, true
		}
	}
	return Response{}, false
}

func makeCustomResponse(value customHTTPResponse) (Response, error) {
	if value.Headers == nil {
		value.Headers = map[string]string{}
	}
	response := Response{
		ID: "javascript", Name: "JavaScript response", Status: value.Status,
		Headers: value.Headers, Body: value.Body, DelayMS: value.DelayMS,
	}
	if err := validateResponse(response, map[string]bool{}); err != nil {
		return Response{}, fmt.Errorf("invalid custom HTTP response: %w", err)
	}
	return response, nil
}
