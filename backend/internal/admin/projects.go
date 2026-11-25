package admin

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"mockman/internal/engine"
	"mockman/internal/storage"
	"net/http"
	"strings"

	"github.com/gorilla/mux"
)

type projectMutation struct {
	Ancestors       map[string]int64   `json:"ancestors,omitempty"`
	MetadataVersion *int64             `json:"metadataVersion,omitempty"`
	Version         int64              `json:"version"`
	Value           json.RawMessage    `json:"value,omitempty"`
	Changes         []resourceChange   `json:"changes,omitempty"`
	Active          *map[string]string `json:"active,omitempty"`
}
type resourceChange struct {
	Kind    string          `json:"kind"`
	ID      string          `json:"id"`
	Version int64           `json:"version"`
	Value   json.RawMessage `json:"value,omitempty"`
	Delete  bool            `json:"delete,omitempty"`
}
type entityVersion struct {
	Version         *int64 `json:"version,omitempty"`
	MetadataVersion int64  `json:"metadataVersion,omitempty"`
}
type projectMutationResult struct {
	Stale            bool                     `json:"stale,omitempty"`
	Versions         map[string]entityVersion `json:"versions,omitempty"`
	Version          int64                    `json:"version"`
	WorkspaceVersion int64                    `json:"workspaceVersion"`
	Value            any                      `json:"value,omitempty"`
	Revisions        map[string]string        `json:"revisions,omitempty"`
}

func (s Server) registerProjectRoutes(router *mux.Router) {
	router.HandleFunc("/api/limits", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]int64{"responseBytes": s.responseLimit(), "importBytes": s.importLimit(), "metadataBytes": 1 << 20, "scenarioBytes": 10 << 20})
	}).Methods(http.MethodGet, http.MethodHead)
	router.HandleFunc("/api/projects/{project}", s.getProject).Methods(http.MethodGet, http.MethodHead)
	for _, path := range []string{
		"/api/projects/{project}",
		"/api/projects/{project}/features/{feature}",
		"/api/projects/{project}/features/{feature}/endpoints/{endpoint}",
		"/api/projects/{project}/features/{feature}/endpoints/{endpoint}/responses/{response}",
		"/api/projects/{project}/features/{feature}/endpoints/{endpoint}/scenarios/{scenario}",
	} {
		router.HandleFunc(path, s.mutateProject).Methods(http.MethodPut, http.MethodPatch, http.MethodDelete)
	}
	router.HandleFunc("/api/projects/{project}/features/{feature}/endpoints/{endpoint}/changes", s.mutateProject).Methods(http.MethodPost)
}
func validResourceIDs(vars map[string]string) bool {
	for _, id := range vars {
		if !engine.ValidID(id) {
			return false
		}
	}
	return true
}
func (s Server) getProject(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	if !validResourceIDs(vars) {
		writeErrorMessage(w, 400, "invalid resource identifier")
		return
	}
	p, err := s.Store.Project(r.Context(), vars["project"])
	if err != nil {
		s.projectFailure(w, err)
		return
	}
	writeJSON(w, 200, p)
}
func decodeResource[T any](raw json.RawMessage) (v T, err error) {
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	err = d.Decode(&v)
	return
}
func updateResource[T any](values *[]T, id string, remove bool, value T, getID func(T) string) error {
	if !remove && getID(value) != id {
		return fmt.Errorf("%w: body ID must match resource path", storage.ErrInvalid)
	}
	for i, v := range *values {
		if getID(v) != id {
			continue
		}
		if remove {
			*values = append((*values)[:i], (*values)[i+1:]...)
		} else {
			(*values)[i] = value
		}
		return nil
	}
	if remove {
		return storage.ErrNotFound
	}
	*values = append(*values, value)
	return nil
}
func featureByID(p *engine.Project, id string) *engine.Feature {
	for i := range p.Features {
		if p.Features[i].ID == id {
			return &p.Features[i]
		}
	}
	return nil
}
func endpointByID(f *engine.Feature, id string) *engine.Endpoint {
	for i := range f.Endpoints {
		if f.Endpoints[i].ID == id {
			return &f.Endpoints[i]
		}
	}
	return nil
}

type projectMetadata struct {
	ID           string   `json:"id"`
	Name         string   `json:"name"`
	Environments []string `json:"environments"`
}
type featureMetadata struct {
	ID              string `json:"id"`
	Name            string `json:"name"`
	MockingDisabled bool   `json:"mockingDisabled"`
}
type endpointMetadata struct {
	ID      string            `json:"id"`
	Name    string            `json:"name"`
	Method  string            `json:"method"`
	Path    string            `json:"path"`
	Enabled bool              `json:"enabled"`
	Active  map[string]string `json:"active"`
}

type projectPatch struct {
	ID           string    `json:"id"`
	Name         *string   `json:"name"`
	Environments *[]string `json:"environments"`
}
type featurePatch struct {
	ID              string  `json:"id"`
	Name            *string `json:"name"`
	MockingDisabled *bool   `json:"mockingDisabled"`
}
type endpointPatch struct {
	ID      string             `json:"id"`
	Name    *string            `json:"name"`
	Method  *string            `json:"method"`
	Path    *string            `json:"path"`
	Enabled *bool              `json:"enabled"`
	Active  *map[string]string `json:"active"`
}

func (s Server) mutateProject(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	if !validResourceIDs(vars) {
		writeErrorMessage(w, 400, "invalid resource identifier")
		return
	}
	scope := storage.Scope{Project: vars["project"], Feature: vars["feature"], Endpoint: vars["endpoint"], Response: vars["response"], Scenario: vars["scenario"]}
	metadataOnly := r.Method == http.MethodPatch
	scope.MetadataOnly = metadataOnly
	batch := r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/changes")
	scope.Batch = batch
	remove := r.Method == http.MethodDelete
	if metadataOnly && (scope.Response != "" || scope.Scenario != "") {
		w.Header().Set("Allow", "PUT, DELETE")
		writeErrorMessage(w, 405, "use PUT to save a response or scenario")
		return
	}
	limit := s.importLimit()
	if metadataOnly || remove {
		limit = 1 << 20
	} else if scope.Response != "" {
		limit = s.responseLimit() + (1 << 20)
	} else if scope.Scenario != "" {
		limit = 10 << 20
	}
	var input projectMutation
	if err := decodeJSONLimit(w, r, &input, limit); err != nil {
		writeDecodeError(w, err)
		return
	}
	if input.Version < 0 {
		writeErrorMessage(w, 400, "version must be nonnegative")
		return
	}
	if !batch && (len(input.Changes) > 0 || input.Active != nil) {
		writeErrorMessage(w, 400, "changes and active require the endpoint changes route")
		return
	}
	if scope.Feature == "" && remove {
		version, err := s.Store.DeleteProject(r.Context(), scope.Project, input.Version)
		if err != nil {
			s.projectFailure(w, err)
			return
		}
		writeJSON(w, 200, projectMutationResult{WorkspaceVersion: version})
		return
	}
	var project engine.Project
	var feature engine.Feature
	var endpoint engine.Endpoint
	var response engine.Response
	var scenario engine.Scenario
	var pm projectPatch
	var fm featurePatch
	var em endpointPatch
	var err error
	if metadataOnly {
		var fields map[string]json.RawMessage
		if err := json.Unmarshal(input.Value, &fields); err != nil {
			writeDecodeError(w, err)
			return
		}
		for _, raw := range fields {
			if bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
				writeErrorMessage(w, 400, "metadata fields cannot be null")
				return
			}
		}
	}
	if !remove && !batch {
		switch {
		case metadataOnly && scope.Endpoint != "":
			em, err = decodeResource[endpointPatch](input.Value)
		case metadataOnly && scope.Feature != "":
			fm, err = decodeResource[featurePatch](input.Value)
		case metadataOnly:
			pm, err = decodeResource[projectPatch](input.Value)
		case scope.Response != "":
			response, err = decodeResource[engine.Response](input.Value)
		case scope.Scenario != "":
			scenario, err = decodeResource[engine.Scenario](input.Value)
		case scope.Endpoint != "":
			endpoint, err = decodeResource[engine.Endpoint](input.Value)
		case scope.Feature != "":
			feature, err = decodeResource[engine.Feature](input.Value)
		default:
			project, err = decodeResource[engine.Project](input.Value)
		}
		if err != nil {
			writeError(w, 400, err)
			return
		}
	}
	var saved engine.Project
	var workspaceVersion int64
	previousVersions := map[string]int64{}

	if scope.Feature == "" && input.Version == 0 && !metadataOnly {
		if project.ID != scope.Project {
			writeErrorMessage(w, 422, "body ID must match resource path")
			return
		}
		saved, workspaceVersion, err = s.Store.CreateProject(r.Context(), project)
	} else {
		saved, workspaceVersion, err = s.Store.UpdateEntity(r.Context(), scope, input.Version, metadataOnly, remove, func(p *engine.Project) error {
			previousVersions["project"] = p.Version
			for _, f := range p.Features {
				if f.ID != scope.Feature {
					continue
				}
				previousVersions["feature/"+f.ID] = f.Version
				for _, e := range f.Endpoints {
					if e.ID == scope.Endpoint {
						previousVersions["endpoint/"+e.ID] = e.Version
					}
				}
			}
			if scope.Feature == "" {
				if metadataOnly {
					if pm.ID != p.ID {
						return storage.ErrInvalid
					}
					if pm.Name != nil {
						p.Name = *pm.Name
					}
					if pm.Environments != nil {
						p.Environments = *pm.Environments
					}
				} else {
					*p = project
				}
				return nil
			}
			if scope.Endpoint == "" {
				if metadataOnly {
					f := featureByID(p, scope.Feature)
					if f == nil {
						return storage.ErrNotFound
					}
					if fm.ID != f.ID {
						return storage.ErrInvalid
					}
					if fm.Name != nil {
						f.Name = *fm.Name
					}
					if fm.MockingDisabled != nil {
						f.MockingDisabled = *fm.MockingDisabled
					}
					return nil
				}
				return updateResource(&p.Features, scope.Feature, remove, feature, func(v engine.Feature) string { return v.ID })
			}
			f := featureByID(p, scope.Feature)
			if f == nil {
				return storage.ErrNotFound
			}
			if scope.Response == "" && scope.Scenario == "" && !batch {
				if metadataOnly {
					e := endpointByID(f, scope.Endpoint)
					if e == nil {
						return storage.ErrNotFound
					}
					if em.ID != e.ID {
						return storage.ErrInvalid
					}
					if em.Name != nil {
						e.Name = *em.Name
					}
					if em.Method != nil {
						e.Method = *em.Method
					}
					if em.Path != nil {
						e.Path = *em.Path
					}
					if em.Enabled != nil {
						e.Enabled = *em.Enabled
					}
					if em.Active != nil {
						e.Active = *em.Active
					}
					return nil
				}
				return updateResource(&f.Endpoints, scope.Endpoint, remove, endpoint, func(v engine.Endpoint) string { return v.ID })
			}
			e := endpointByID(f, scope.Endpoint)
			if e == nil {
				return storage.ErrNotFound
			}
			if batch {
				if input.Active != nil && (input.MetadataVersion == nil || *input.MetadataVersion != e.MetadataVersion) {
					return storage.ErrConflict
				}
				return applyEndpointChanges(e, input)
			}
			if scope.Response != "" {
				return updateResource(&e.Responses, scope.Response, remove, response, func(v engine.Response) string { return v.ID })
			}
			if remove {
				for env, id := range e.Active {
					if id == scope.Scenario {
						delete(e.Active, env)
					}
				}
			}
			return updateResource(&e.Scenarios, scope.Scenario, remove, scenario, func(v engine.Scenario) string { return v.ID })
		})
	}
	if err != nil {
		s.projectFailure(w, err)
		return
	}
	result := projectMutationResult{Version: workspaceVersion, WorkspaceVersion: workspaceVersion, Versions: changedVersions(saved, workspaceVersion, scope, input.Ancestors, previousVersions)}
	for key, prior := range previousVersions {
		if input.Ancestors[key] != prior {
			result.Stale = true
		}
	}

	if !remove && !batch {
		switch {
		case scope.Response != "":
			for _, v := range endpointByID(featureByID(&saved, scope.Feature), scope.Endpoint).Responses {
				if v.ID == scope.Response {
					result.Value = v
				}
			}
		case scope.Scenario != "":
			for _, v := range endpointByID(featureByID(&saved, scope.Feature), scope.Endpoint).Scenarios {
				if v.ID == scope.Scenario {
					result.Value = v
				}
			}
		case scope.Endpoint != "":
			e := endpointByID(featureByID(&saved, scope.Feature), scope.Endpoint)
			if metadataOnly {
				result.Value = endpointMetadata{e.ID, e.Name, e.Method, e.Path, e.Enabled, e.Active}
			} else {
				result.Value = e
			}
		case scope.Feature != "":
			f := featureByID(&saved, scope.Feature)
			if metadataOnly {
				result.Value = featureMetadata{f.ID, f.Name, f.MockingDisabled}
			} else {
				result.Value = f
			}
		default:
			if metadataOnly {
				result.Value = projectMetadata{saved.ID, saved.Name, saved.Environments}
			} else {
				result.Value = saved
			}
		}
	}
	if scope.Endpoint != "" {
		if f := featureByID(&saved, scope.Feature); f != nil {
			if e := endpointByID(f, scope.Endpoint); e != nil {
				result.Revisions = map[string]string{}
				for _, scenario := range e.Scenarios {
					result.Revisions[scenario.ID] = scenario.Revision
				}
			}
		}
	}
	writeJSON(w, 200, result)
}
func applyEndpointChanges(e *engine.Endpoint, input projectMutation) error {
	if len(input.Changes) > 200 {
		return fmt.Errorf("%w: maximum 200 changes", storage.ErrInvalid)
	}
	seen := map[string]bool{}
	for _, change := range input.Changes {
		if !engine.ValidID(change.ID) || seen[change.Kind+"/"+change.ID] {
			return storage.ErrInvalid
		}
		seen[change.Kind+"/"+change.ID] = true
		if change.Kind == "response" {
			current := int64(0)
			for _, r := range e.Responses {
				if r.ID == change.ID {
					current = r.Version
				}
			}
			if current != change.Version {
				return storage.ErrConflict
			}
			value, err := decodeResource[engine.Response](change.Value)
			if err != nil && !change.Delete {
				return fmt.Errorf("%w: invalid response", storage.ErrInvalid)
			}
			if err := updateResource(&e.Responses, change.ID, change.Delete, value, func(v engine.Response) string { return v.ID }); err != nil {
				return err
			}
		} else if change.Kind == "scenario" {
			current := int64(0)
			for _, s := range e.Scenarios {
				if s.ID == change.ID {
					current = s.Version
				}
			}
			if current != change.Version {
				return storage.ErrConflict
			}
			value, err := decodeResource[engine.Scenario](change.Value)
			if err != nil && !change.Delete {
				return fmt.Errorf("%w: invalid scenario", storage.ErrInvalid)
			}
			if err := updateResource(&e.Scenarios, change.ID, change.Delete, value, func(v engine.Scenario) string { return v.ID }); err != nil {
				return err
			}
		} else {
			return storage.ErrInvalid
		}
	}
	if input.Active != nil {
		e.Active = *input.Active
	}
	return nil
}
func changedVersions(p engine.Project, version int64, scope storage.Scope, known, previous map[string]int64) map[string]entityVersion {
	result := map[string]entityVersion{}
	add := func(key string, v, m int64, target, container bool) {
		if v != version && m != version && !target {
			return
		}
		info := entityVersion{}
		complete := !container || previous[key] != 0 && known[key] == previous[key] || target && !scope.MetadataOnly && !scope.Batch
		if complete {
			token := v
			info.Version = &token
		}
		if (m == version || target && scope.MetadataOnly) && (complete || target && scope.MetadataOnly || target && scope.Batch) {
			info.MetadataVersion = m
		}
		if info.Version != nil || info.MetadataVersion > 0 {
			result[key] = info
		}
	}
	add("project", p.Version, p.MetadataVersion, scope.Feature == "", true)
	for _, f := range p.Features {
		add("feature/"+f.ID, f.Version, f.MetadataVersion, scope.Feature == f.ID && scope.Endpoint == "", true)
		for _, e := range f.Endpoints {
			add("endpoint/"+e.ID, e.Version, e.MetadataVersion, scope.Endpoint == e.ID && scope.Response == "" && scope.Scenario == "", true)
			for _, r := range e.Responses {
				add("response/"+e.ID+"/"+r.ID, r.Version, 0, scope.Response == r.ID, false)
			}
			for _, s := range e.Scenarios {
				add("scenario/"+e.ID+"/"+s.ID, s.Version, 0, scope.Scenario == s.ID, false)
			}
		}
	}
	return result
}
func (s Server) responseLimit() int64 {
	if s.MaxResponseBytes > 0 {
		return s.MaxResponseBytes
	}
	return storage.DefaultResponseBytes
}
func (s Server) importLimit() int64 {
	if s.MaxImportBytes > 0 {
		return s.MaxImportBytes
	}
	return 100 << 20
}
func (s Server) projectFailure(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, storage.ErrConflict):
		writeError(w, 409, err)
	case errors.Is(err, storage.ErrNotFound):
		writeError(w, 404, err)
	case errors.Is(err, storage.ErrInvalid):
		writeError(w, 422, err)
	default:
		s.storageFailure(w, err)
	}
}
