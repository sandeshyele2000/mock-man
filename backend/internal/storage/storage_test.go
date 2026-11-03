package storage_test

import (
	"context"
	"encoding/json"
	"fmt"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"mockman/internal/engine"
	"mockman/internal/storage"
	"mockman/migrations"
	"net/url"
	"os"
	"sync"
	"testing"
	"time"
)

func testStore(t *testing.T) *storage.Store {
	t.Helper()
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("set TEST_DATABASE_URL for PostgreSQL integration checks")
	}
	ctx := context.Background()
	root, err := gorm.Open(postgres.Open(databaseURL), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "test_" + storage.Revision()
	if err = root.Exec("CREATE SCHEMA " + schema).Error; err != nil {
		t.Fatal(err)
	}
	scopedURL, err := withSearchPath(databaseURL, schema)
	if err != nil {
		t.Fatal(err)
	}
	store, err := storage.Open(ctx, scopedURL)
	if err != nil {
		t.Fatal(err)
	}
	if err = store.Init(ctx, migrations.Schema); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = store.Close()
		_ = root.Exec("DROP SCHEMA " + schema + " CASCADE").Error
		pool, _ := root.DB()
		_ = pool.Close()
	})
	return store
}

func withSearchPath(databaseURL, schema string) (string, error) {
	parsed, err := url.Parse(databaseURL)
	if err != nil {
		return "", err
	}
	query := parsed.Query()
	query.Set("options", "-csearch_path="+schema)
	parsed.RawQuery = query.Encode()
	return parsed.String(), nil
}

func req() engine.Request { return engine.Request{Method: "POST", Path: "/v1/agreements/acceptances"} }
func TestConcurrentIsolationResetRevisionAndPersistence(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	const n = 32
	attempts := make(chan int64, n)
	errs := make(chan error, n)
	var wg sync.WaitGroup
	for range n {
		wg.Go(func() {
			p, err := s.Match(ctx, "demo", "development", "parallel", req())
			if err != nil {
				errs <- err
				return
			}
			attempts <- p.Attempt
		})
	}
	wg.Wait()
	close(attempts)
	close(errs)
	for err := range errs {
		t.Fatal(err)
	}
	seen := map[int64]bool{}
	for a := range attempts {
		if seen[a] || a < 1 || a > n {
			t.Fatalf("invalid attempt %d", a)
		}
		seen[a] = true
	}
	if len(seen) != n {
		t.Fatalf("got %d attempts", len(seen))
	}
	for _, context := range [][2]string{{"development", "other"}, {"staging", "parallel"}} {
		p, err := s.Match(ctx, "demo", context[0], context[1], req())
		if err != nil || p.Attempt != 1 {
			t.Fatalf("isolation %+v %v", p, err)
		}
	}
	c, err := s.Config(ctx)
	if err != nil {
		t.Fatal(err)
	}
	project := c.Projects[0]
	project.ID = "other"
	c.Projects = append(c.Projects, project)
	c, err = s.Save(ctx, c)
	if err != nil {
		t.Fatal(err)
	}
	p, err := s.Match(ctx, "other", "development", "parallel", req())
	if err != nil || p.Attempt != 1 {
		t.Fatalf("project isolation %+v %v", p, err)
	}
	if err = s.Reset(ctx, "demo", "development", "parallel", ""); err != nil {
		t.Fatal(err)
	}
	p, err = s.Match(ctx, "demo", "development", "parallel", req())
	if err != nil || p.Attempt != 1 {
		t.Fatalf("reset %+v %v", p, err)
	}
	oldRevision := p.Match.Scenario.Revision
	oldPlan := p
	stale := c
	c.Projects[0].Features[0].Endpoints[0].Responses[0].Status = 502
	c, err = s.Save(ctx, c)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.Save(ctx, stale); err != storage.ErrConflict {
		t.Fatalf("expected conflict got %v", err)
	}
	p, err = s.Match(ctx, "demo", "development", "parallel", req())
	if err != nil || p.Attempt != 1 || p.Match.Scenario.Revision == oldRevision || p.Response.Status != 502 {
		t.Fatalf("revision %+v %v", p, err)
	}
	if oldPlan.Response.Status != 500 {
		t.Fatal("snapshot changed")
	}
	// Close and reopen all database connections, then verify durable config and counters.
	pool, err := s.DB.DB()
	if err != nil {
		t.Fatal(err)
	}
	pool.SetMaxIdleConns(0)
	if err = pool.PingContext(ctx); err != nil {
		t.Fatal(err)
	}
	persisted, err := s.Config(ctx)
	if err != nil || persisted.Version != c.Version {
		t.Fatal("config did not persist", err)
	}
	p, err = s.Match(ctx, "demo", "development", "parallel", req())
	if err != nil || p.Attempt != 2 {
		t.Fatalf("counter did not persist %+v %v", p, err)
	}
	logs, err := s.Logs(ctx, "demo", "development")
	if err != nil || len(logs) < n {
		t.Fatal("missing logs", err)
	}
	var detail storage.Detail
	if err = json.Unmarshal(logs[0].Detail, &detail); err != nil || detail.Attempt != 2 || detail.Reason == "" {
		t.Fatal("invalid log", err)
	}
}
func TestResetScopesAndRetention(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	for _, env := range []string{"development", "staging"} {
		for _, session := range []string{"a", "b"} {
			if _, err := s.Match(ctx, "demo", env, session, req()); err != nil {
				t.Fatal(err)
			}
		}
	}
	if err := s.Reset(ctx, "demo", "development", "", ""); err != nil {
		t.Fatal(err)
	}
	for _, tt := range []struct {
		env, session string
		want         int64
	}{{"development", "a", 1}, {"development", "b", 1}, {"staging", "a", 2}} {
		p, err := s.Match(ctx, "demo", tt.env, tt.session, req())
		if err != nil || p.Attempt != tt.want {
			t.Fatal(fmt.Sprintf("scope %+v got %d %v", tt, p.Attempt, err))
		}
	}
	err := s.DB.WithContext(ctx).Exec(`UPDATE attempts SET touched_at = ?`, time.Now().Add(-8*24*time.Hour)).Error
	if err != nil {
		t.Fatal(err)
	}
	err = s.DB.WithContext(ctx).Exec(`UPDATE request_logs SET created_at = ?`, time.Now().Add(-8*24*time.Hour)).Error
	if err != nil {
		t.Fatal(err)
	}
	if err = s.Cleanup(ctx); err != nil {
		t.Fatal(err)
	}
	logs, err := s.Logs(ctx, "demo", "development")
	if err != nil || len(logs) != 0 {
		t.Fatal("retention failed", err)
	}
}

func TestRuntimeCapacityAndLogCap(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	err := s.DB.WithContext(ctx).Exec(`INSERT INTO attempts(project,environment,endpoint,revision,session,attempt) SELECT 'full','development','endpoint','old','s'||i,1 FROM generate_series(1,10000) i`).Error
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.Match(ctx, "demo", "development", "new", req()); err != storage.ErrCapacity {
		t.Fatalf("capacity accepted new key: %v", err)
	}
	if err = s.Reset(ctx, "full", "development", "", ""); err != nil {
		t.Fatal(err)
	}
	err = s.DB.WithContext(ctx).Exec(`INSERT INTO request_logs(project,environment,session,detail) SELECT 'other','development','seed','{}'::jsonb FROM generate_series(1,10005)`).Error
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.Match(ctx, "demo", "development", "new", req()); err != nil {
		t.Fatal(err)
	}
	var count int
	if err = s.DB.WithContext(ctx).Raw(`SELECT count(*) FROM request_logs`).Scan(&count).Error; err != nil || count != 10000 {
		t.Fatalf("log cap: count %d err %v", count, err)
	}
}
