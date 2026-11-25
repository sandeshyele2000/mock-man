package storage_test

import (
	"context"
	"encoding/json"
	"mockman/internal/admin"
	"mockman/internal/engine"
	"mockman/internal/storage"
	"mockman/migrations"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func mutation(t *testing.T, h http.Handler, method, path string, version int64, value any) *httptest.ResponseRecorder {
	t.Helper()
	body, err := json.Marshal(map[string]any{"version": version, "value": value})
	if err != nil {
		t.Fatal(err)
	}
	r := httptest.NewRequest(method, "http://admin.test"+path, strings.NewReader(string(body)))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("X-Mockman-Admin", "1")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}
func projectHandler(s *storage.Store) http.Handler {
	return admin.Server{Store: s, Origin: "http://admin.test", DashboardOrigin: "http://admin.test"}.Handler()
}
func endpointURL(p engine.Project) string {
	return "/api/projects/" + p.ID + "/features/" + p.Features[0].ID + "/endpoints/" + p.Features[0].Endpoints[0].ID
}
func requireStatus(t *testing.T, w *httptest.ResponseRecorder, status int) {
	t.Helper()
	if w.Code != status {
		t.Fatalf("status=%d want=%d: %s", w.Code, status, w.Body)
	}
}

func TestFreshStorageIsEmptyAndLegacyDatabaseIsNotModified(t *testing.T) {
	s := testStore(t, false)
	ctx := context.Background()
	c, err := s.Config(ctx)
	if err != nil || len(c.Projects) != 0 {
		t.Fatalf("not empty: %+v %v", c, err)
	}
	if err := s.Init(ctx, migrations.Schema); err != nil {
		t.Fatal(err)
	}
	if err := s.DB.Exec("CREATE TABLE configuration(id boolean PRIMARY KEY, document json NOT NULL); INSERT INTO configuration VALUES(true,'{\"keep\":true}')").Error; err != nil {
		t.Fatal(err)
	}
	if err := s.Init(ctx, migrations.Schema); err == nil || !strings.Contains(err.Error(), "fresh PostgreSQL") {
		t.Fatalf("legacy schema not rejected: %v", err)
	}
	var data string
	if err := s.DB.Raw("SELECT document::text FROM configuration").Scan(&data).Error; err != nil || data != `{"keep":true}` {
		t.Fatalf("legacy data changed: %s %v", data, err)
	}
}

func TestLargeFeatureMetadataAndScenarioEditsDoNotRewriteBodies(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	c, err := s.Config(ctx)
	if err != nil {
		t.Fatal(err)
	}
	e := &c.Projects[0].Features[0].Endpoints[0]
	for i := range e.Responses {
		e.Responses[i].Body = json.RawMessage(`"` + strings.Repeat("x", 3<<20) + `"`)
	}
	c, err = s.Save(ctx, c)
	if err != nil {
		t.Fatal(err)
	}
	p := c.Projects[0]
	f := p.Features[0]
	ep := f.Endpoints[0]
	h := projectHandler(s)
	type payload struct{ ID, Body, XID string }
	var before, after []payload
	query := "SELECT id,body::text AS body,xmin::text AS xid FROM responses ORDER BY id"
	if err := s.DB.Raw(query).Scan(&before).Error; err != nil {
		t.Fatal(err)
	}
	featurePath := "/api/projects/" + p.ID + "/features/" + f.ID
	requireStatus(t, mutation(t, h, "PATCH", featurePath, f.MetadataVersion, map[string]any{"id": f.ID, "name": "Renamed large feature", "mockingDisabled": true}), 200)
	requireStatus(t, mutation(t, h, "PATCH", endpointURL(p), ep.MetadataVersion, map[string]any{"id": ep.ID, "name": "Renamed endpoint", "method": ep.Method, "path": ep.Path, "enabled": ep.Enabled, "active": ep.Active}), 200)
	scenario := ep.Scenarios[0]
	scenario.Name = "Edited scenario without response payloads"
	requireStatus(t, mutation(t, h, "PUT", endpointURL(p)+"/scenarios/"+scenario.ID, scenario.Version, scenario), 200)
	if err := s.DB.Raw(query).Scan(&after).Error; err != nil {
		t.Fatal(err)
	}
	if len(before) != len(after) {
		t.Fatal("response count changed")
	}
	for i := range before {
		if before[i] != after[i] {
			t.Fatal("metadata/scenario save rewrote a response payload")
		}
	}
	// A response larger than the former 2 MiB cap is accepted independently.
	response := ep.Responses[0]
	response.Body = json.RawMessage(`"` + strings.Repeat("y", 3<<20) + `"`)
	requireStatus(t, mutation(t, h, "PUT", endpointURL(p)+"/responses/"+response.ID, response.Version, response), 200)
}

func TestConcurrentResponseEditsUseTheirOwnVersions(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	c, err := s.Config(ctx)
	if err != nil {
		t.Fatal(err)
	}
	p := c.Projects[0]
	ep := p.Features[0].Endpoints[0]
	h := projectHandler(s)
	results := make(chan *httptest.ResponseRecorder, 2)
	for i, response := range ep.Responses {
		response.Status = 210 + i
		go func() {
			data, _ := json.Marshal(map[string]any{"version": response.Version, "value": response})
			r := httptest.NewRequest("PUT", "http://admin.test"+endpointURL(p)+"/responses/"+response.ID, strings.NewReader(string(data)))
			r.Header.Set("Content-Type", "application/json")
			r.Header.Set("X-Mockman-Admin", "1")
			w := httptest.NewRecorder()
			h.ServeHTTP(w, r)
			results <- w
		}()
	}
	for range 2 {
		requireStatus(t, <-results, 200)
	}
	saved, err := s.Project(ctx, p.ID)
	if err != nil {
		t.Fatal(err)
	}
	for i, r := range saved.Features[0].Endpoints[0].Responses {
		if r.Status != 210+i {
			t.Fatal("independent response edit lost")
		}
	}
	// Reusing an old token for the same response still conflicts.
	requireStatus(t, mutation(t, h, "PUT", endpointURL(p)+"/responses/"+ep.Responses[0].ID, ep.Responses[0].Version, ep.Responses[0]), 409)
}

func TestReferencesCascadesAndPayloadsSurviveDeletion(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	c, err := s.Config(ctx)
	if err != nil {
		t.Fatal(err)
	}
	p := c.Projects[0]
	ep := p.Features[0].Endpoints[0]
	h := projectHandler(s)
	requireStatus(t, mutation(t, h, "DELETE", endpointURL(p)+"/responses/failure", ep.Responses[0].Version, nil), 422)
	scenario := ep.Scenarios[0]
	scenario.Behavior = "always"
	scenario.ResponseIDs = []string{"success"}
	scenario.Count = 0
	requireStatus(t, mutation(t, h, "PUT", endpointURL(p)+"/scenarios/"+scenario.ID, scenario.Version, scenario), 200)
	requireStatus(t, mutation(t, h, "DELETE", endpointURL(p)+"/responses/failure", ep.Responses[0].Version, nil), 200)
	saved, err := s.Project(ctx, p.ID)
	if err != nil {
		t.Fatal(err)
	}
	remaining := saved.Features[0].Endpoints[0].Responses
	if len(remaining) != 1 || string(remaining[0].Body) != string(ep.Responses[1].Body) {
		t.Fatal("deletion erased surviving response body")
	}
	requireStatus(t, mutation(t, h, "DELETE", "/api/projects/"+p.ID+"/features/"+p.Features[0].ID, saved.Features[0].Version, nil), 200)
	for _, table := range []string{"features", "endpoints", "responses", "scenarios"} {
		var count int64
		if err := s.DB.Table(table).Count(&count).Error; err != nil || count != 0 {
			t.Fatalf("cascade left %s: %d %v", table, count, err)
		}
	}
}

func TestInvalidBatchRollsBackEveryEntity(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	c, err := s.Config(ctx)
	if err != nil {
		t.Fatal(err)
	}
	p := c.Projects[0]
	ep := p.Features[0].Endpoints[0]
	response := ep.Responses[0]
	response.ID = "new-response"
	scenario := ep.Scenarios[0]
	scenario.ID = "new-scenario"
	scenario.ResponseIDs = []string{"missing"}
	body, _ := json.Marshal(map[string]any{"version": ep.Version, "changes": []any{map[string]any{"kind": "response", "id": response.ID, "version": 0, "value": response}, map[string]any{"kind": "scenario", "id": scenario.ID, "version": 0, "value": scenario}}})
	r := httptest.NewRequest("POST", "http://admin.test"+endpointURL(p)+"/changes", strings.NewReader(string(body)))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("X-Mockman-Admin", "1")
	w := httptest.NewRecorder()
	projectHandler(s).ServeHTTP(w, r)
	requireStatus(t, w, 422)
	saved, err := s.Project(ctx, p.ID)
	if err != nil {
		t.Fatal(err)
	}
	if saved.Version != p.Version || len(saved.Features[0].Endpoints[0].Responses) != len(ep.Responses) {
		t.Fatal("partial batch committed")
	}
}

func TestResponseLimitsAndExactLargeNumbers(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	c, err := s.Config(ctx)
	if err != nil {
		t.Fatal(err)
	}
	ep := &c.Projects[0].Features[0].Endpoints[0]
	ep.Responses[0].Body = json.RawMessage(`{"number":9007199254740992}`)
	c, err = s.Save(ctx, c)
	if err != nil {
		t.Fatal(err)
	}
	p := c.Projects[0]
	response := p.Features[0].Endpoints[0].Responses[0]
	response.Body = json.RawMessage(`{"number":9007199254740993}`)
	requireStatus(t, mutation(t, projectHandler(s), "PUT", endpointURL(p)+"/responses/"+response.ID, response.Version, response), 200)
	saved, err := s.Project(ctx, p.ID)
	if err != nil {
		t.Fatal(err)
	}
	if string(saved.Features[0].Endpoints[0].Responses[0].Body) != string(response.Body) {
		t.Fatal("large integer precision lost")
	}
	s.MaxResponseBytes = 1024
	small := admin.Server{Store: s, Origin: "http://admin.test", MaxResponseBytes: 1024, MaxImportBytes: 2048}.Handler()
	response = saved.Features[0].Endpoints[0].Responses[0]
	response.Body = json.RawMessage(`"` + strings.Repeat("x", 1500) + `"`)
	requireStatus(t, mutation(t, small, "PUT", endpointURL(p)+"/responses/"+response.ID, response.Version, response), 422)
	response.Body = json.RawMessage(`"` + strings.Repeat("x", (1<<20)+2048) + `"`)
	requireStatus(t, mutation(t, small, "PUT", endpointURL(p)+"/responses/"+response.ID, response.Version, response), 413)
}

func TestDerivedRevisionsDoNotAuthorizeStaleScenarioOrParentEdits(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	c, err := s.Config(ctx)
	if err != nil {
		t.Fatal(err)
	}
	p := c.Projects[0]
	f := p.Features[0]
	ep := f.Endpoints[0]
	h := projectHandler(s)
	scenario := ep.Scenarios[0]
	scenario.Name = "Concurrent scenario edit"
	requireStatus(t, mutation(t, h, "PUT", endpointURL(p)+"/scenarios/"+scenario.ID, scenario.Version, scenario), 200)
	requireStatus(t, mutation(t, h, "PATCH", "/api/projects/"+p.ID+"/features/"+f.ID, f.MetadataVersion, map[string]any{"id": f.ID, "name": "Concurrent feature rename", "mockingDisabled": false}), 200)
	response := ep.Responses[0]
	response.Status = 502
	w := mutation(t, h, "PUT", endpointURL(p)+"/responses/"+response.ID, response.Version, response)
	requireStatus(t, w, 200)
	var result struct {
		Versions  map[string]struct{ Version, MetadataVersion int64 }
		Revisions map[string]string
	}
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result.Versions["feature/"+f.ID].MetadataVersion != 0 {
		t.Fatal("advanced unseen ancestor metadata token")
	}
	if _, ok := result.Versions["scenario/"+ep.ID+"/"+scenario.ID]; ok {
		t.Fatal("advanced unseen scenario content token")
	}
	if result.Revisions[scenario.ID] == "" {
		t.Fatal("runtime revision missing")
	}
	requireStatus(t, mutation(t, h, "PUT", endpointURL(p)+"/scenarios/"+scenario.ID, ep.Scenarios[0].Version, ep.Scenarios[0]), 409)
	requireStatus(t, mutation(t, h, "PATCH", "/api/projects/"+p.ID+"/features/"+f.ID, f.MetadataVersion, map[string]any{"id": f.ID, "name": "Stale feature name", "mockingDisabled": true}), 409)
}

func TestLeafSaveDoesNotAuthorizeBulkReplacementOfUnseenChanges(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	c, err := s.Config(ctx)
	if err != nil {
		t.Fatal(err)
	}
	p := c.Projects[0]
	f := p.Features[0]
	e := f.Endpoints[0]
	h := projectHandler(s)
	// Another user changes a sibling response before this client's independent edit.
	sibling := e.Responses[1]
	sibling.Status = 201
	requireStatus(t, mutation(t, h, "PUT", endpointURL(p)+"/responses/"+sibling.ID, sibling.Version, sibling), 200)
	response := e.Responses[0]
	response.Status = 502
	payload, _ := json.Marshal(map[string]any{"version": response.Version, "value": response, "ancestors": map[string]int64{"project": p.Version, "feature/" + f.ID: f.Version, "endpoint/" + e.ID: e.Version}})
	r := httptest.NewRequest("PUT", "http://admin.test"+endpointURL(p)+"/responses/"+response.ID, strings.NewReader(string(payload)))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("X-Mockman-Admin", "1")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	requireStatus(t, w, 200)
	var result struct {
		Stale    bool
		Versions map[string]struct{ Version *int64 }
	}
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if !result.Stale {
		t.Fatal("unseen sibling change was not signaled")
	}
	if result.Versions["endpoint/"+e.ID].Version != nil {
		t.Fatal("advanced incomplete endpoint snapshot")
	}
	requireStatus(t, mutation(t, h, "PUT", endpointURL(p), e.Version, e), 409)
}

func TestMetadataAndBatchActiveSelectionsKeepEnvironmentIntegrity(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	c, err := s.Config(ctx)
	if err != nil {
		t.Fatal(err)
	}
	p := c.Projects[0]
	e := p.Features[0].Endpoints[0]
	h := projectHandler(s)
	requireStatus(t, mutation(t, h, "PATCH", "/api/projects/"+p.ID, p.MetadataVersion, map[string]any{"id": p.ID, "name": p.Name, "environments": []string{"staging"}}), 422)
	body, _ := json.Marshal(map[string]any{"version": e.Version, "metadataVersion": e.MetadataVersion - 1, "changes": []any{}, "active": e.Active})
	r := httptest.NewRequest("POST", "http://admin.test"+endpointURL(p)+"/changes", strings.NewReader(string(body)))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("X-Mockman-Admin", "1")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	requireStatus(t, w, 409)
	saved, err := s.Project(ctx, p.ID)
	if err != nil {
		t.Fatal(err)
	}
	if saved.Version != p.Version || len(saved.Environments) != 2 {
		t.Fatal("invalid metadata edit committed")
	}
}

func TestPartialMetadataPatchesPreserveUnspecifiedState(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	c, err := s.Config(ctx)
	if err != nil {
		t.Fatal(err)
	}
	p := c.Projects[0]
	f := p.Features[0]
	h := projectHandler(s)
	path := "/api/projects/" + p.ID + "/features/" + f.ID
	requireStatus(t, mutation(t, h, "PATCH", path, f.MetadataVersion, map[string]any{"id": f.ID, "mockingDisabled": true}), 200)
	latest, err := s.Project(ctx, p.ID)
	if err != nil {
		t.Fatal(err)
	}
	requireStatus(t, mutation(t, h, "PATCH", path, latest.Features[0].MetadataVersion, map[string]any{"id": f.ID, "name": "Rename while paused"}), 200)
	saved, err := s.Project(ctx, p.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !saved.Features[0].MockingDisabled || saved.Features[0].Name != "Rename while paused" {
		t.Fatal("partial patch overwrote unspecified state")
	}
	requireStatus(t, mutation(t, h, "PATCH", path, saved.Features[0].MetadataVersion, map[string]any{"id": f.ID, "name": nil}), 400)
}
