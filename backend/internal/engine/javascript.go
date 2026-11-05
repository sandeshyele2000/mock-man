package engine

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"time"

	"github.com/dop251/goja"
)

const (
	maxJavaScriptTime  = 50 * time.Millisecond
	maxJavaScriptStack = 128
	maxJavaScriptBytes = 1 << 20
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
	Request     flowRequest `json:"request"`
	Attempt     int64       `json:"attempt"`
	Session     string      `json:"session"`
	Environment string      `json:"environment"`
	Data        any         `json:"data"`
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
	timer := time.AfterFunc(maxJavaScriptTime, func() {
		vm.Interrupt("JavaScript execution timed out")
	})
	defer timer.Stop()

	script := "(function(input) { 'use strict';\n" + code + "\n})(JSON.parse(" + strconv.Quote(string(inputJSON)) + "))"
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

func newFlowInput(request Request, attempt int64, session, environment string, data any) flowInput {
	if request.Query == nil {
		request.Query = url.Values{}
	}
	if request.Headers == nil {
		request.Headers = http.Header{}
	}
	return flowInput{
		Request: flowRequest{
			Method: request.Method, Path: request.Path, Scenario: request.Scenario,
			Query: request.Query, Headers: request.Headers, Body: request.Body,
		},
		Attempt: attempt, Session: session, Environment: environment, Data: data,
	}
}
