package storage_test

import (
	"context"
	"encoding/json"
	"errors"
	"mockman/internal/admin"
	"mockman/internal/engine"
	"mockman/internal/storage"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestProjectEditsAreIndependentAndLegacySaveConflicts(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	c, err := s.Config(ctx)
	if err != nil {
		t.Fatal(err)
	}
	other := c.Projects[0]
	other.ID = "other"
	other, _, err = s.CreateProject(ctx, other)
	if err != nil {
		t.Fatal(err)
	}
	legacy, err := s.Config(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	errs := make(chan error, 2)
	for _, project := range []engine.Project{c.Projects[0], other} {
		wg.Go(func() {
			_, _, err := s.UpdateProject(ctx, project.ID, project.Version, func(p *engine.Project) error { p.Name = "Edited " + p.ID; return nil })
			errs <- err
		})
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	if _, err := s.Save(ctx, legacy); !errors.Is(err, storage.ErrConflict) {
		t.Fatalf("stale legacy save: %v", err)
	}
	called := false
	_, _, err = s.UpdateProject(ctx, "demo", c.Projects[0].Version, func(p *engine.Project) error { called = true; return nil })
	if !errors.Is(err, storage.ErrConflict) || called {
		t.Fatalf("stale edit: err=%v called=%v", err, called)
	}
	saved, err := s.Config(ctx)
	if err != nil {
		t.Fatal(err)
	}
	for _, p := range saved.Projects {
		if p.Name != "Edited "+p.ID {
			t.Fatalf("edit lost: %+v", p)
		}
	}
}

func TestMockMatchingDoesNotLockOtherProjectsOrWorkspace(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	c, err := s.Config(ctx)
	if err != nil {
		t.Fatal(err)
	}
	other := c.Projects[0]
	other.ID = "other"
	if _, _, err := s.CreateProject(ctx, other); err != nil {
		t.Fatal(err)
	}
	tx := s.DB.Begin()
	defer tx.Rollback()
	if err := tx.Exec("SELECT id FROM projects WHERE id = 'demo' FOR UPDATE").Error; err != nil {
		t.Fatal(err)
	}
	if err := tx.Exec("SELECT id FROM workspace_state FOR UPDATE").Error; err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() { _, err := s.Match(ctx, "other", "development", "independent", req()); done <- err }()
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("unrelated project blocked mock matching")
	}
}

func TestTargetedResponseAPIValidationAndRevisions(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	c, err := s.Config(ctx)
	if err != nil {
		t.Fatal(err)
	}
	p := c.Projects[0]
	f := p.Features[0]
	e := f.Endpoints[0]
	response := e.Responses[0]
	h := admin.Server{Store: s, Origin: "http://admin.test", DashboardOrigin: "http://admin.test"}.Handler()
	path := "http://admin.test/api/projects/" + p.ID + "/features/" + f.ID + "/endpoints/" + e.ID + "/responses/" + response.ID
	send := func(method string, version int64, value any) *httptest.ResponseRecorder {
		data, err := json.Marshal(map[string]any{"version": version, "value": value})
		if err != nil {
			t.Fatal(err)
		}
		r := httptest.NewRequest(method, path, strings.NewReader(string(data)))
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("X-Mockman-Admin", "1")
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w
	}
	response.Body = json.RawMessage(`{"updated":true}`)
	w := send(http.MethodPut, p.Version, response)
	if w.Code != 200 {
		t.Fatalf("status=%d body=%s", w.Code, w.Body)
	}
	var result struct {
		Version          int64
		WorkspaceVersion int64
		Value            engine.Response
		Revisions        map[string]string
		Versions         map[string]struct {
			Version  int64
			Revision string
		}
	}
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result.Version != p.Version+1 || result.Value.ID != response.ID || len(result.Versions) == 0 || strings.Contains(w.Body.String(), "features") {
		t.Fatalf("not a targeted result: %s", w.Body)
	}
	for _, scenario := range e.Scenarios {
		if result.Revisions[scenario.ID] == scenario.Revision {
			t.Fatal("response edit did not revise scenario")
		}
	}
	if w := send(http.MethodPut, p.Version, response); w.Code != 409 {
		t.Fatalf("stale edit status=%d", w.Code)
	}
	// Removing a referenced response must fail and leave project data/version intact.
	if w := send(http.MethodDelete, result.Version, nil); w.Code != 422 {
		t.Fatalf("invalid deletion status=%d body=%s", w.Code, w.Body)
	}
	saved, err := s.Project(ctx, p.ID)
	if err != nil {
		t.Fatal(err)
	}
	if saved.Version != result.Version || len(saved.Features[0].Endpoints[0].Responses) != len(e.Responses) {
		t.Fatal("invalid edit was committed")
	}
}

func TestGlobalCapacityRemainsBoundedAcrossProjects(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	c, err := s.Config(ctx)
	if err != nil {
		t.Fatal(err)
	}
	other := c.Projects[0]
	other.ID = "other"
	if _, _, err := s.CreateProject(ctx, other); err != nil {
		t.Fatal(err)
	}
	if err := s.DB.Exec(`INSERT INTO attempts(project,environment,endpoint,revision,session,attempt) SELECT 'full','development','endpoint','old','s'||i,1 FROM generate_series(1,9999) i`).Error; err != nil {
		t.Fatal(err)
	}
	results := make(chan error, 2)
	for _, id := range []string{"demo", "other"} {
		go func() { _, err := s.Match(ctx, id, "development", "capacity", req()); results <- err }()
	}
	successes, rejected := 0, 0
	for range 2 {
		err := <-results
		switch {
		case err == nil:
			successes++
		case errors.Is(err, storage.ErrCapacity):
			rejected++
		default:
			t.Fatal(err)
		}
	}
	if successes != 1 || rejected != 1 {
		t.Fatalf("successes=%d rejected=%d", successes, rejected)
	}
	var count int64
	if err := s.DB.Table("attempts").Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 10000 {
		t.Fatalf("global capacity=%d", count)
	}
}

func TestRecreatedProjectRejectsPreviousLifetimeVersion(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	c, err := s.Config(ctx)
	if err != nil {
		t.Fatal(err)
	}
	original := c.Projects[0]
	if _, err := s.DeleteProject(ctx, original.ID, original.Version); err != nil {
		t.Fatal(err)
	}
	recreated, _, err := s.CreateProject(ctx, original)
	if err != nil {
		t.Fatal(err)
	}
	if recreated.Version <= original.Version {
		t.Fatal("project version reused after recreation")
	}
	_, _, err = s.UpdateProject(ctx, original.ID, original.Version, func(p *engine.Project) error { p.Name = "Stale edit"; return nil })
	if !errors.Is(err, storage.ErrConflict) {
		t.Fatalf("stale lifetime accepted: %v", err)
	}
}

func TestTargetedSaveWithWorkspaceLargerThanLegacyLimit(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	c, err := s.Config(ctx)
	if err != nil {
		t.Fatal(err)
	}
	large := json.RawMessage(`"` + strings.Repeat("x", 1100000) + `"`)
	p, _, err := s.UpdateProject(ctx, "demo", c.Projects[0].Version, func(p *engine.Project) error {
		p.Features[0].Endpoints[0].Responses[0].Body = large
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	other := p
	other.ID = "other"
	other, _, err = s.CreateProject(ctx, other)
	if err != nil {
		t.Fatal(err)
	}
	c, err = s.Config(ctx)
	if err != nil {
		t.Fatal(err)
	}
	workspace, err := json.Marshal(c)
	if err != nil {
		t.Fatal(err)
	}
	if len(workspace) <= 2<<20 {
		t.Fatal("fixture must exceed the previous workspace limit")
	}
	f := p.Features[0]
	e := f.Endpoints[0]
	response := e.Responses[1]
	response.Name = "Edited small response"
	payload, err := json.Marshal(map[string]any{"version": response.Version, "value": response})
	if err != nil {
		t.Fatal(err)
	}
	h := admin.Server{Store: s, Origin: "http://admin.test", DashboardOrigin: "http://admin.test"}.Handler()
	path := "http://admin.test/api/projects/demo/features/" + f.ID + "/endpoints/" + e.ID + "/responses/" + response.ID
	r := httptest.NewRequest(http.MethodPut, path, strings.NewReader(string(payload)))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("X-Mockman-Admin", "1")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 200 {
		t.Fatalf("large workspace blocked targeted save: %d %s", w.Code, w.Body)
	}
	if w.Body.Len() > 10000 {
		t.Fatal("targeted result included unrelated response bodies")
	}
	unchanged, err := s.Project(ctx, "other")
	if err != nil {
		t.Fatal(err)
	}
	if unchanged.Version != other.Version {
		t.Fatal("unrelated project was rewritten")
	}
}
