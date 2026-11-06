// Created by Sandesh
package engine

import (
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"sync"
	"time"

	"github.com/dop251/goja"
)

const (
	maxJavaScriptTime  = 50 * time.Millisecond
	maxJavaScriptStack = 128
	maxJavaScriptBytes = 1 << 20
)

// The embedded libraries run inside Goja; scripts do not receive Node APIs.
//
//go:embed assets/lodash.min.js
var lodashSource string

//go:embed assets/moment.min.js
var momentSource string

var (
	libraryProgramsOnce sync.Once
	lodashProgram       *goja.Program
	momentProgram       *goja.Program
	libraryProgramsErr  error
)

type flowRequest struct {
	Method   string              `json:"method"`
	Path     string              `json:"path"`
	Scenario string              `json:"scenario"`
	Query    map[string][]string `json:"query"`
	Headers  map[string][]string `json:"headers"`
	Body     any                 `json:"body"`
}

type flowInput struct {
	Request     flowRequest      `json:"request"`
	Responses   []scriptResponse `json:"responses"`
	Attempt     int64            `json:"attempt"`
	Session     string           `json:"session"`
	Environment string           `json:"environment"`
	Data        any              `json:"data"`
}

type scriptResponse struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Status int    `json:"status"`
}

type customHTTPResponse struct {
	Status  int               `json:"status"`
	Headers map[string]string `json:"headers"`
	Body    json.RawMessage   `json:"body"`
	DelayMS int               `json:"delayMs"`
}

type javaScriptResult struct {
	Output     string              `json:"output"`
	Data       any                 `json:"data"`
	ResponseID string              `json:"responseId"`
	Response   *customHTTPResponse `json:"response"`
}

func runJavaScript(code string, input flowInput) (result javaScriptResult, err error) {
	if len(code) == 0 || len(code) > 32768 {
		return result, errors.New("JavaScript code must be between 1 byte and 32 KiB")
	}
	inputJSON, err := json.Marshal(input)
	if err != nil {
		return result, fmt.Errorf("encode JavaScript input: %w", err)
	}
	if len(inputJSON) > maxJavaScriptBytes {
		return result, errors.New("JavaScript input exceeds 1 MiB")
	}

	vm := goja.New()
	vm.SetMaxCallStackSize(maxJavaScriptStack)
	lodash, moment, err := loadJavaScriptLibraries()
	if err != nil {
		return result, err
	}
	if _, err = vm.RunProgram(lodash); err != nil {
		return result, fmt.Errorf("load Lodash: %w", err)
	}
	if _, err = vm.RunProgram(moment); err != nil {
		return result, fmt.Errorf("load Moment: %w", err)
	}
	timer := time.AfterFunc(maxJavaScriptTime, func() {
		vm.Interrupt("JavaScript execution timed out")
	})
	defer timer.Stop()

	script := "(function(input, _, moment) { 'use strict'; const request = input.request; const responses = input.responses; const attempt = input.attempt; const session = input.session; const environment = input.environment;\n" + code + "\n})(JSON.parse(" + strconv.Quote(string(inputJSON)) + "), _, moment)"
	value, err := vm.RunString(script)
	if err != nil {
		return result, fmt.Errorf("JavaScript node: %w", err)
	}
	if goja.IsUndefined(value) || goja.IsNull(value) {
		return result, errors.New("JavaScript node must return an object")
	}
	encoded, err := json.Marshal(value.Export())
	if err != nil {
		return result, fmt.Errorf("JavaScript node returned a non-JSON value: %w", err)
	}
	if len(encoded) > maxJavaScriptBytes {
		return result, errors.New("JavaScript output exceeds 1 MiB")
	}
	if err := json.Unmarshal(encoded, &result); err != nil {
		return result, errors.New("JavaScript node must return an object")
	}
	return result, nil
}

func loadJavaScriptLibraries() (*goja.Program, *goja.Program, error) {
	libraryProgramsOnce.Do(func() {
		lodashProgram, libraryProgramsErr = goja.Compile("lodash.min.js", lodashSource, false)
		if libraryProgramsErr != nil {
			return
		}
		momentProgram, libraryProgramsErr = goja.Compile("moment.min.js", momentSource, false)
	})
	return lodashProgram, momentProgram, libraryProgramsErr
}

func newFlowInput(request Request, attempt int64, session, environment string, data any, endpoint Endpoint, allowedIDs []string) flowInput {
	if request.Query == nil {
		request.Query = url.Values{}
	}
	if request.Headers == nil {
		request.Headers = http.Header{}
	}
	allowed := make(map[string]bool, len(allowedIDs))
	for _, id := range allowedIDs {
		allowed[id] = true
	}
	responses := make([]scriptResponse, 0, len(allowed))
	for _, response := range endpoint.Responses {
		if len(allowed) > 0 && !allowed[response.ID] {
			continue
		}
		responses = append(responses, scriptResponse{
			ID: response.ID, Name: response.Name, Status: response.Status,
		})
	}
	return flowInput{
		Request: flowRequest{
			Method: request.Method, Path: request.Path, Scenario: request.Scenario,
			Query: request.Query, Headers: request.Headers, Body: request.Body,
		},
		Responses: responses,
		Attempt:   attempt, Session: session, Environment: environment, Data: data,
	}
}

func ResolveJavaScript(match Match, attempt int64, request Request, session, environment string) (Plan, error) {
	scenario := match.Scenario
	input := newFlowInput(request, attempt, session, environment, nil, match.Endpoint, scenario.ResponseIDs)
	result, err := runJavaScript(scenario.Code, input)
	if err != nil {
		return Plan{}, fmt.Errorf("scenario %s: %w", scenario.ID, err)
	}
	if result.ResponseID != "" && result.Response != nil {
		return Plan{}, errors.New("JavaScript must return either responseId or response, not both")
	}
	if result.ResponseID != "" {
		allowed := false
		for _, id := range scenario.ResponseIDs {
			if id == result.ResponseID {
				allowed = true
				break
			}
		}
		if !allowed {
			return Plan{}, fmt.Errorf("JavaScript selected response %s, which is not enabled for this scenario", result.ResponseID)
		}
		response, exists := findResponse(match.Endpoint, result.ResponseID)
		if !exists {
			return Plan{}, fmt.Errorf("JavaScript selected unknown response %s", result.ResponseID)
		}
		return Plan{Response: response, Attempt: attempt, Match: match}, nil
	}
	if result.Response != nil {
		response, err := makeCustomResponse(*result.Response)
		if err != nil {
			return Plan{}, err
		}
		return Plan{Response: response, Attempt: attempt, Match: match}, nil
	}
	return Plan{}, errors.New("JavaScript must return responseId or response")
}
