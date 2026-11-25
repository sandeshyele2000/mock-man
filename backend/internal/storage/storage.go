// Created by Sandesh
package storage

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"slices"
	"time"

	"mockman/internal/engine"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"gorm.io/gorm/logger"
)

var ErrConflict = errors.New("configuration changed; reload before saving")
var ErrContext = errors.New("unknown project or environment")
var ErrCapacity = errors.New("runtime session capacity reached; reset attempts or wait for retention cleanup")

type Store struct {
	DB               *gorm.DB
	MaxResponseBytes int64
}
type Log struct {
	ID        int64           `json:"id"`
	CreatedAt time.Time       `json:"createdAt"`
	Detail    json.RawMessage `json:"detail"`
}
type Detail struct {
	Feature  string   `json:"feature,omitempty"`
	Method   string   `json:"method"`
	Path     string   `json:"path"`
	Endpoint string   `json:"endpoint"`
	Scenario string   `json:"scenario"`
	Revision string   `json:"revision"`
	Session  string   `json:"session"`
	Attempt  int64    `json:"attempt"`
	Status   int      `json:"status"`
	DelayMS  int      `json:"delayMs"`
	Reason   string   `json:"reason"`
	Payload  *Payload `json:"payload,omitempty"`
}

func Revision() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}
func Open(ctx context.Context, url string) (*Store, error) {
	// Keep SQL parameters out of logs: documents and conditions can contain private data.
	db, err := gorm.Open(postgres.Open(url), &gorm.Config{
		DisableAutomaticPing: true,
		Logger:               logger.Default.LogMode(logger.Silent),
	})
	if err != nil {
		return nil, err
	}
	pool, err := db.DB()
	if err != nil {
		return nil, err
	}
	pool.SetMaxOpenConns(10)
	pool.SetMaxIdleConns(10)
	pool.SetConnMaxIdleTime(5 * time.Minute)
	if err = pool.PingContext(ctx); err != nil {
		_ = pool.Close()
		return nil, err
	}
	return &Store{DB: db}, nil
}

func (s *Store) Close() error {
	pool, err := s.DB.DB()
	if err != nil {
		return err
	}
	return pool.Close()
}

func assignRevisions(next *engine.Config, old engine.Config) {
	previous := indexEndpoints(old)
	for projectIndex := range next.Projects {
		project := &next.Projects[projectIndex]
		for featureIndex := range project.Features {
			feature := &project.Features[featureIndex]
			for endpointIndex := range feature.Endpoints {
				endpoint := &feature.Endpoints[endpointIndex]
				oldEndpoint := previous[endpointKey(project.ID, endpoint.ID)]
				assignEndpointRevisions(endpoint, oldEndpoint)
			}
		}
	}
}

func indexEndpoints(config engine.Config) map[string]engine.Endpoint {
	endpoints := make(map[string]engine.Endpoint)
	for _, project := range config.Projects {
		for _, feature := range project.Features {
			for _, endpoint := range feature.Endpoints {
				endpoints[endpointKey(project.ID, endpoint.ID)] = endpoint
			}
		}
	}
	return endpoints
}

func endpointKey(projectID, endpointID string) string { return projectID + "/" + endpointID }

func assignEndpointRevisions(endpoint *engine.Endpoint, previous engine.Endpoint) {
	for index := range endpoint.Scenarios {
		scenario := &endpoint.Scenarios[index]
		if old := unchangedScenarioRevision(*scenario, endpoint.Responses, previous); old != "" {
			scenario.Revision = old
			continue
		}
		scenario.Revision = Revision()
	}
}

func unchangedScenarioRevision(scenario engine.Scenario, responses []engine.Response, previous engine.Endpoint) string {
	for _, oldScenario := range previous.Scenarios {
		if oldScenario.ID != scenario.ID {
			continue
		}
		current, old := scenarioWithoutLayout(scenario), scenarioWithoutLayout(oldScenario)
		current.Revision = ""
		old.Revision = ""
		current.Version, old.Version = 0, 0
		if reflect.DeepEqual(current, old) && sameResponses(responses, previous.Responses) {
			return oldScenario.Revision
		}
	}
	return ""
}

func scenarioWithoutLayout(scenario engine.Scenario) engine.Scenario {
	if scenario.Behavior != "flow" || scenario.Flow == nil {
		scenario.Flow = nil
		return scenario
	}
	flow := *scenario.Flow
	flow.Nodes = append([]engine.FlowNode(nil), flow.Nodes...)
	for index := range flow.Nodes {
		flow.Nodes[index].X = 0
		flow.Nodes[index].Y = 0
	}
	scenario.Flow = &flow
	return scenario
}

func (s *Store) Match(ctx context.Context, project, environment, session string, request engine.Request) (engine.Plan, error) {
	var plan engine.Plan
	err := s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		match, err := selectLockedMatch(ctx, tx, project, environment, request)
		if err != nil {
			return err
		}
		request.Feature = match.Feature
		if err := checkAttemptCapacity(ctx, tx, project, environment, session, match); err != nil {
			return err
		}
		attempt, cursor, lastResponse, err := allocateAttempt(ctx, tx, project, environment, session, match)
		if err != nil {
			return err
		}
		if match.Scenario.Behavior == "flow" {
			plan, err = engine.ResolveFlow(match, attempt, request, session, environment, cursor, lastResponse)
			if err != nil {
				return fmt.Errorf("%w: %v", engine.ErrFlowExecution, err)
			}
			if err := saveFlowCursor(ctx, tx, project, environment, session, match, plan); err != nil {
				return err
			}
		} else if match.Scenario.Behavior == "javascript" {
			plan, err = engine.ResolveJavaScript(match, attempt, request, session, environment)
			if err != nil {
				return fmt.Errorf("%w: %v", engine.ErrScriptExecution, err)
			}
		} else {
			plan = engine.Resolve(match, attempt)
		}
		if plan.Response.Body == nil {
			var saved entityRow
			if err := tx.Table("responses").Select("body").Where("project_id = ? AND endpoint_id = ? AND id = ?", project, match.Endpoint.ID, plan.Response.ID).Take(&saved).Error; err != nil {
				return err
			}
			plan.Response.Body = saved.Body
		}
		if err := writeRequestLog(ctx, tx, project, environment, session, request, plan); err != nil {
			return err
		}
		return pruneRequestLogs(ctx, tx)
	})
	return plan, err
}

func selectLockedMatch(ctx context.Context, tx *gorm.DB, project, environment string, request engine.Request) (engine.Match, error) {
	if err := configurationLock(ctx, tx, false); err != nil {
		return engine.Match{}, err
	}
	if err := entityLock(ctx, tx, project, false); err != nil {
		return engine.Match{}, err
	}
	var row entityRow
	if err := tx.Table("projects").Where("id = ?", project).Take(&row).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return engine.Match{}, ErrContext
		}
		return engine.Match{}, err
	}
	var candidate engine.Project
	if err := json.Unmarshal(row.Document, &candidate); err != nil {
		return engine.Match{}, err
	}
	if !slices.Contains(candidate.Environments, environment) {
		return engine.Match{}, ErrContext
	}
	var routes []struct{ ID, FeatureID string }
	q := tx.Table("endpoints AS e").Select("e.id,e.feature_id").Joins("JOIN features f ON f.project_id=e.project_id AND f.id=e.feature_id").Where("e.project_id = ? AND e.method = ? AND e.path = ? AND (e.document->>'enabled')::boolean AND NOT COALESCE((f.document->>'mockingDisabled')::boolean,false)", project, request.Method, request.Path)
	if request.Feature != "" {
		q = q.Where("e.feature_id = ?", request.Feature)
	}
	if err := q.Find(&routes).Error; err != nil {
		return engine.Match{}, err
	}
	if len(routes) > 1 {
		return engine.Match{}, engine.ErrAmbiguousFeature
	}
	if len(routes) == 0 {
		return engine.Match{}, engine.ErrNoMatch
	}
	scope := Scope{Project: project, Feature: routes[0].FeatureID, Endpoint: routes[0].ID}
	if err := lockScope(ctx, tx, scope, false); err != nil {
		return engine.Match{}, err
	}
	endpoint, feature, err := loadRuntimeEndpoint(ctx, tx, scope)
	if err != nil {
		return engine.Match{}, err
	}
	candidate.Features = []engine.Feature{feature}
	candidate.Features[0].Endpoints = []engine.Endpoint{endpoint}
	return engine.Select(candidate, environment, request)
}

func sameResponses(a, b []engine.Response) bool {
	a, b = slices.Clone(a), slices.Clone(b)
	for i := range a {
		a[i].Version = 0
	}
	for i := range b {
		b[i].Version = 0
	}
	return reflect.DeepEqual(a, b)
}

func checkAttemptCapacity(ctx context.Context, tx *gorm.DB, project, environment, session string, match engine.Match) error {
	existing, err := gorm.G[attemptRecord](tx).Where("project = ? AND environment = ? AND endpoint = ? AND revision = ? AND session = ?", project, environment, match.Endpoint.ID, match.Scenario.Revision, session).Count(ctx, "*")
	if err != nil || existing > 0 {
		return err
	}
	// Only new counter keys contend on capacity. Existing sessions remain independent.
	if err := tx.WithContext(ctx).Exec("SELECT pg_advisory_xact_lock(hashtext(current_schema()), 1297040204)").Error; err != nil {
		return err
	}
	count, err := gorm.G[attemptRecord](tx).Count(ctx, "*")
	if err != nil {
		return err
	}
	if count >= 10000 {
		return ErrCapacity
	}
	return nil
}

func allocateAttempt(ctx context.Context, tx *gorm.DB, project, environment, session string, match engine.Match) (int64, string, string, error) {
	counter := attemptRecord{Project: project, Environment: environment, Endpoint: match.Endpoint.ID, Revision: match.Scenario.Revision, Session: session, Attempt: 1}
	err := gorm.G[attemptRecord](tx, clause.OnConflict{
		Columns:   []clause.Column{{Name: "project"}, {Name: "environment"}, {Name: "endpoint"}, {Name: "revision"}, {Name: "session"}},
		DoUpdates: clause.Assignments(map[string]any{"attempt": gorm.Expr("attempts.attempt + 1"), "touched_at": gorm.Expr("now()")}),
	}, clause.Returning{Columns: []clause.Column{{Name: "attempt"}, {Name: "cursor"}, {Name: "last_response"}}}).Create(ctx, &counter)
	return counter.Attempt, counter.Cursor, counter.LastResponse, err
}

func saveFlowCursor(ctx context.Context, tx *gorm.DB, project, environment, session string, match engine.Match, plan engine.Plan) error {
	return tx.WithContext(ctx).Model(&attemptRecord{}).
		Where("project = ? AND environment = ? AND endpoint = ? AND revision = ? AND session = ?", project, environment, match.Endpoint.ID, match.Scenario.Revision, session).
		Updates(map[string]any{"cursor": plan.NextNode, "last_response": plan.LastResponse, "touched_at": time.Now()}).Error
}

func writeRequestLog(ctx context.Context, tx *gorm.DB, project, environment, session string, request engine.Request, plan engine.Plan) error {
	// Keep the global log cap exact when requests in different projects commit together.
	if err := tx.WithContext(ctx).Exec("SELECT pg_advisory_xact_lock(hashtext(current_schema()), 1297040205)").Error; err != nil {
		return err
	}
	detail, err := json.Marshal(Detail{
		Method: request.Method, Path: request.Path, Feature: plan.Match.Feature, Endpoint: plan.Match.Endpoint.ID,
		Scenario: plan.Match.Scenario.ID, Revision: plan.Match.Scenario.Revision,
		Session: session, Attempt: plan.Attempt, Status: plan.Response.Status,
		DelayMS: plan.Response.DelayMS, Reason: plan.Match.Reason,
		Payload: capturePayload(request.RawBody, request.Headers.Get("Content-Type")),
	})
	if err != nil {
		return err
	}
	return gorm.G[requestLog](tx).Create(ctx, &requestLog{Project: project, Environment: environment, Session: session, Detail: detail})
}

func pruneRequestLogs(ctx context.Context, tx *gorm.DB) error {
	cutoff := tx.Model(&requestLog{}).Select("id").Order("id DESC").Offset(9999).Limit(1)
	_, err := gorm.G[requestLog](tx).Where("id < (?)", cutoff).Delete(ctx)
	return err
}

func (s *Store) Reset(ctx context.Context, project, env, session, endpoint string) error {
	return s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := configurationLock(ctx, tx, false); err != nil {
			return err
		}
		if err := entityLock(ctx, tx, project, true); err != nil {
			return err
		}
		query := gorm.G[attemptRecord](tx).Where("project = ? AND environment = ?", project, env)
		if session != "" {
			query = query.Where("session = ?", session)
		}
		if endpoint != "" {
			query = query.Where("endpoint = ?", endpoint)
		}
		_, err := query.Delete(ctx)
		return err
	})
}

func (s *Store) Logs(ctx context.Context, project, env string) ([]Log, error) {
	rows, err := gorm.G[requestLog](s.DB).Where("project = ? AND environment = ?", project, env).
		Order("id DESC").Limit(200).Find(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]Log, 0, len(rows))
	for _, row := range rows {
		out = append(out, Log{row.ID, row.CreatedAt, row.Detail})
	}
	return out, nil
}

func (s *Store) Cleanup(ctx context.Context) error {
	return s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if _, err := gorm.G[attemptRecord](tx).Where("touched_at < now() - interval '7 days'").Delete(ctx); err != nil {
			return err
		}
		_, err := gorm.G[requestLog](tx).Where("created_at < now() - interval '7 days'").Delete(ctx)
		return err
	})
}
