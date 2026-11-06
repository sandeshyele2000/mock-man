// Created by Sandesh
package admin

import (
	"encoding/json"
	"errors"
	"github.com/gorilla/mux"
	"io"
	"log/slog"
	"mockman/internal/engine"
	"mockman/internal/storage"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type Server struct {
	Store           *storage.Store
	Origin          string
	DashboardOrigin string
	Runtime         http.Handler
}

type resetRequest struct {
	Project     string `json:"project"`
	Environment string `json:"environment"`
	Session     string `json:"session"`
	Endpoint    string `json:"endpoint"`
}
type tryRequest struct {
	Project     string            `json:"project"`
	Environment string            `json:"environment"`
	Session     string            `json:"session"`
	Scenario    string            `json:"scenario"`
	Method      string            `json:"method"`
	Path        string            `json:"path"`
	Headers     map[string]string `json:"headers"`
	Body        string            `json:"body"`
}

type capture struct {
	header http.Header
	status int
	body   strings.Builder
}

func (c *capture) Header() http.Header         { return c.header }
func (c *capture) WriteHeader(status int)      { c.status = status }
func (c *capture) Write(b []byte) (int, error) { return c.body.Write(b) }

func (s Server) Handler() http.Handler {
	router := mux.NewRouter()
	router.NotFoundHandler = http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		writeErrorMessage(w, http.StatusNotFound, "unknown admin endpoint")
	})
	s.registerRoutes(router)
	router.MethodNotAllowedHandler = http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		writeErrorMessage(w, http.StatusMethodNotAllowed, "method not allowed")
	})
	return s.withSecurity(router)
}

func (s Server) registerRoutes(router *mux.Router) {
	router.HandleFunc("/api/config", s.getConfig).Methods(http.MethodGet, http.MethodHead)
	router.HandleFunc("/api/config", s.putConfig).Methods(http.MethodPut)
	router.HandleFunc("/api/logs", s.getLogs).Methods(http.MethodGet, http.MethodHead)
	router.HandleFunc("/api/reset", s.postReset).Methods(http.MethodPost)
	router.HandleFunc("/api/try", s.postTry).Methods(http.MethodPost)
}

func (s Server) getConfig(w http.ResponseWriter, r *http.Request) {
	config, err := s.Store.Config(r.Context())
	if err != nil {
		s.storageFailure(w, err)
		return
	}
	writeJSON(w, http.StatusOK, config)
}

func (s Server) putConfig(w http.ResponseWriter, r *http.Request) {
	var config engine.Config
	if err := decodeJSON(w, r, &config); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if err := engine.Validate(config); err != nil {
		writeError(w, http.StatusUnprocessableEntity, err)
		return
	}
	saved, err := s.Store.Save(r.Context(), config)
	if errors.Is(err, storage.ErrConflict) {
		writeError(w, http.StatusConflict, err)
		return
	}
	if err != nil {
		s.storageFailure(w, err)
		return
	}
	writeJSON(w, http.StatusOK, saved)
}

func (s Server) getLogs(w http.ResponseWriter, r *http.Request) {
	project, environment := r.URL.Query().Get("project"), r.URL.Query().Get("environment")
	if !engine.ValidID(project) || !engine.ValidID(environment) {
		writeErrorMessage(w, http.StatusBadRequest, "invalid project or environment")
		return
	}
	logs, err := s.Store.Logs(r.Context(), project, environment)
	if err != nil {
		s.storageFailure(w, err)
		return
	}
	writeJSON(w, http.StatusOK, logs)
}

func (s Server) postReset(w http.ResponseWriter, r *http.Request) {
	var input resetRequest
	if err := decodeJSON(w, r, &input); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if !validResetContext(input) {
		writeErrorMessage(w, http.StatusUnprocessableEntity, "invalid reset context")
		return
	}
	if err := s.Store.Reset(r.Context(), input.Project, input.Environment, input.Session, input.Endpoint); err != nil {
		s.storageFailure(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func validResetContext(input resetRequest) bool {
	return engine.ValidID(input.Project) && engine.ValidID(input.Environment) && optionalID(input.Session) && optionalID(input.Endpoint)
}
func optionalID(value string) bool { return value == "" || engine.ValidID(value) }

func (s Server) postTry(w http.ResponseWriter, r *http.Request) {
	var input tryRequest
	if err := decodeJSON(w, r, &input); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	request, err := buildTryHTTPRequest(r, input)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, err)
		return
	}
	result := s.executeTryRequest(request)
	writeJSON(w, http.StatusOK, result)
}

func buildTryHTTPRequest(parent *http.Request, input tryRequest) (*http.Request, error) {
	parsed, err := url.ParseRequestURI(input.Path)
	if err != nil || parsed.IsAbs() || parsed.Host != "" || !strings.HasPrefix(input.Path, "/") {
		return nil, errors.New("use an absolute API path with optional query")
	}
	request, err := http.NewRequestWithContext(parent.Context(), input.Method, "http://mock.local"+input.Path, strings.NewReader(input.Body))
	if err != nil {
		return nil, err
	}
	for name, value := range input.Headers {
		request.Header.Set(name, value)
	}
	request.Header.Set("X-Mock-Project", input.Project)
	request.Header.Set("X-Mock-Environment", input.Environment)
	request.Header.Set("X-Mock-Session", input.Session)
	request.Header.Set("X-Mock-Scenario", input.Scenario)
	return request, nil
}

func (s Server) executeTryRequest(request *http.Request) map[string]any {
	recorder := &capture{header: make(http.Header), status: http.StatusOK}
	started := time.Now()
	s.Runtime.ServeHTTP(recorder, request)
	return map[string]any{"status": recorder.status, "headers": recorder.header, "body": recorder.body.String(), "elapsedMs": time.Since(started).Milliseconds()}
}

func (s Server) withSecurity(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		setSecurityHeaders(w)
		if origin := r.Header.Get("Origin"); origin != "" && origin == s.DashboardOrigin {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Add("Vary", "Origin")
		}
		if r.Method == http.MethodOptions {
			if err := s.authorizeOrigin(r); err != nil {
				writeError(w, http.StatusForbidden, err)
				return
			}
			w.Header().Set("Access-Control-Allow-Methods", "GET, HEAD, PUT, POST, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-Mockman-Admin")
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if err := s.authorizeRequest(r); err != nil {
			writeError(w, http.StatusForbidden, err)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func setSecurityHeaders(w http.ResponseWriter) {
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Security-Policy", "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'")
}

func (s Server) authorizeRequest(r *http.Request) error {
	expected, _ := url.Parse(s.Origin)
	if r.Host != expected.Host {
		return errors.New("admin Host is not the configured origin")
	}
	if err := s.authorizeOrigin(r); err != nil {
		return err
	}
	if r.Method != "GET" && r.Method != "HEAD" && (r.Header.Get("X-Mockman-Admin") != "1" || !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json")) {
		return errors.New("JSON and X-Mockman-Admin: 1 required")
	}
	return nil
}

func (s Server) authorizeOrigin(r *http.Request) error {
	origin := r.Header.Get("Origin")
	if origin == "" || origin == s.Origin {
		return nil
	}
	if origin != s.DashboardOrigin {
		return errors.New("foreign dashboard origin")
	}
	return nil
}

func decodeJSON(w http.ResponseWriter, r *http.Request, target any) error {
	r.Body = http.MaxBytesReader(w, r.Body, 2<<20)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		return errors.New("expected one JSON value")
	}
	return nil
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
func writeError(w http.ResponseWriter, status int, err error) {
	writeJSON(w, status, map[string]string{"error": err.Error()})
}
func writeErrorMessage(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}
func (s Server) storageFailure(w http.ResponseWriter, err error) {
	slog.Error("admin storage error", "error", err)
	writeErrorMessage(w, http.StatusInternalServerError, "database operation failed")
}
