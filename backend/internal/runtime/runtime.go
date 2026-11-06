package runtime

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"mockman/internal/engine"
	"mockman/internal/storage"
	"net/http"
	"time"
)

const MaxRequestBytes = 1 << 20

func Context(r *http.Request) (project, env, session string, err error) {
	project = r.Header.Get("X-Mock-Project")
	if project == "" {
		project = "demo"
	}
	env = r.Header.Get("X-Mock-Environment")
	if env == "" {
		env = "development"
	}
	session = r.Header.Get("X-Mock-Session")
	if session == "" {
		session = "default"
	}
	for _, s := range []string{project, env, session} {
		if !engine.ValidID(s) {
			err = errors.New("context identifiers must match [a-zA-Z0-9][a-zA-Z0-9_-]{0,63}")
			return
		}
	}
	if s := r.Header.Get("X-Mock-Scenario"); s != "" && !engine.ValidID(s) {
		err = errors.New("invalid scenario identifier")
	}
	return
}
func Wait(ctx context.Context, ms int) bool {
	if ms == 0 {
		return ctx.Err() == nil
	}
	timer := time.NewTimer(time.Duration(ms) * time.Millisecond)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}
func Handler(store *storage.Store) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { serveMockRequest(w, r, store) })
}

func serveMockRequest(w http.ResponseWriter, r *http.Request, store *storage.Store) {
	project, environment, session, err := Context(r)
	if err != nil {
		fail(w, http.StatusBadRequest, err)
		return
	}
	body, err := readRequestBody(w, r)
	if err != nil {
		fail(w, http.StatusRequestEntityTooLarge, err)
		return
	}
	request := engine.Request{Method: r.Method, Path: r.URL.Path, Scenario: r.Header.Get("X-Mock-Scenario"), Query: r.URL.Query(), Headers: r.Header, Body: body}
	plan, err := allocateResponse(r.Context(), store, project, environment, session, request)
	if err != nil {
		writeMatchFailure(w, err)
		return
	}
	writeMockResponse(w, r, plan)
}

func readRequestBody(w http.ResponseWriter, r *http.Request) (any, error) {
	r.Body = http.MaxBytesReader(w, r.Body, MaxRequestBytes)
	raw, err := io.ReadAll(r.Body)
	if err != nil {
		return nil, errors.New("request body exceeds 1 MiB")
	}
	if len(raw) == 0 {
		return nil, nil
	}
	var body any
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	if err := decoder.Decode(&body); err != nil || !json.Valid(raw) {
		return nil, nil
	}
	return body, nil
}

func allocateResponse(parent context.Context, store *storage.Store, project, environment, session string, request engine.Request) (engine.Plan, error) {
	ctx, cancel := context.WithTimeout(parent, 5*time.Second)
	defer cancel()
	return store.Match(ctx, project, environment, session, request)
}

func writeMatchFailure(w http.ResponseWriter, err error) {
	status := http.StatusInternalServerError
	if errors.Is(err, engine.ErrNoMatch) || errors.Is(err, storage.ErrContext) {
		status = http.StatusNotFound
	} else if errors.Is(err, storage.ErrCapacity) {
		status = http.StatusServiceUnavailable
	} else if errors.Is(err, engine.ErrFlowExecution) {
		status = http.StatusBadGateway
		slog.Error("mock flow execution failed", "error", err)
		err = errors.New("mock flow execution failed")
	} else if errors.Is(err, engine.ErrScriptExecution) {
		status = http.StatusBadGateway
		slog.Error("mock JavaScript scenario failed", "error", err)
		err = errors.New("mock JavaScript scenario failed")
	} else {
		slog.Error("mock allocation failed", "error", err)
		err = errors.New("mock storage unavailable")
	}
	fail(w, status, err)
}

func writeMockResponse(w http.ResponseWriter, r *http.Request, plan engine.Plan) {
	if !Wait(r.Context(), plan.Response.DelayMS) {
		return
	}
	for name, value := range plan.Response.Headers {
		w.Header().Set(name, value)
	}
	w.WriteHeader(plan.Response.Status)
	if responseHasBody(r.Method, plan.Response.Status) {
		_, _ = w.Write(plan.Response.Body)
	}
}

func responseHasBody(method string, status int) bool {
	return method != "HEAD" && status != http.StatusNoContent && status != http.StatusResetContent && status != http.StatusNotModified
}

func fail(w http.ResponseWriter, status int, err error) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
}
