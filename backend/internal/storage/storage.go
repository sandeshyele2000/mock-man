package storage

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
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

type Store struct{ DB *gorm.DB }
type Log struct {
	ID        int64           `json:"id"`
	CreatedAt time.Time       `json:"createdAt"`
	Detail    json.RawMessage `json:"detail"`
}
type Detail struct {
	Method   string `json:"method"`
	Path     string `json:"path"`
	Endpoint string `json:"endpoint"`
	Scenario string `json:"scenario"`
	Revision string `json:"revision"`
	Session  string `json:"session"`
	Attempt  int64  `json:"attempt"`
	Status   int    `json:"status"`
	DelayMS  int    `json:"delayMs"`
	Reason   string `json:"reason"`
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

func (s *Store) Init(ctx context.Context, schema string) error {
	// Explicit migrations retain the existing PostgreSQL constraints and JSON types.
	if err := s.DB.WithContext(ctx).Exec(schema).Error; err != nil {
		return err
	}
	sample := Sample()
	assignRevisions(&sample, engine.Config{})
	document, err := json.Marshal(sample)
	if err != nil {
		return err
	}
	row := configuration{ID: true, Version: 1, Document: document}
	return gorm.G[configuration](s.DB, clause.OnConflict{DoNothing: true}).Create(ctx, &row)
}

func (s *Store) Config(ctx context.Context) (engine.Config, error) {
	row, err := gorm.G[configuration](s.DB).Where("id = ?", true).Take(ctx)
	if err != nil {
		return engine.Config{}, err
	}
	var c engine.Config
	err = json.Unmarshal(row.Document, &c)
	c.Version = row.Version
	return c, err
}

func lockConfig(ctx context.Context, tx *gorm.DB) (configuration, error) {
	return gorm.G[configuration](tx, clause.Locking{Strength: "UPDATE"}).Where("id = ?", true).Take(ctx)
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
		current, old := scenario, oldScenario
		current.Revision = ""
		old.Revision = ""
		if reflect.DeepEqual(current, old) && reflect.DeepEqual(responses, previous.Responses) {
			return oldScenario.Revision
		}
	}
	return ""
}
func (s *Store) Save(ctx context.Context, c engine.Config) (engine.Config, error) {
	if err := engine.Validate(c); err != nil {
		return c, err
	}
	err := s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		row, err := lockConfig(ctx, tx)
		if err != nil {
			return err
		}
		if row.Version != c.Version {
			return ErrConflict
		}
		var old engine.Config
		if err = json.Unmarshal(row.Document, &old); err != nil {
			return err
		}
		assignRevisions(&c, old)
		c.Version++
		document, err := json.Marshal(c)
		if err != nil {
			return err
		}
		_, err = gorm.G[configuration](tx).Where("id = ?", true).
			Select("Version", "Document").Updates(ctx, configuration{Version: c.Version, Document: document})
		return err
	})
	return c, err
}

func (s *Store) Match(ctx context.Context, project, environment, session string, request engine.Request) (engine.Plan, error) {
	var plan engine.Plan
	err := s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		match, err := selectLockedMatch(ctx, tx, project, environment, request)
		if err != nil {
			return err
		}
		if err := checkAttemptCapacity(ctx, tx, project, environment, session, match); err != nil {
			return err
		}
		attempt, err := allocateAttempt(ctx, tx, project, environment, session, match)
		if err != nil {
			return err
		}
		plan = engine.Resolve(match, attempt)
		if err := writeRequestLog(ctx, tx, project, environment, session, request, plan); err != nil {
			return err
		}
		return pruneRequestLogs(ctx, tx)
	})
	return plan, err
}

func selectLockedMatch(ctx context.Context, tx *gorm.DB, project, environment string, request engine.Request) (engine.Match, error) {
	row, err := lockConfig(ctx, tx)
	if err != nil {
		return engine.Match{}, err
	}
	var config engine.Config
	if err := json.Unmarshal(row.Document, &config); err != nil {
		return engine.Match{}, err
	}
	for _, candidate := range config.Projects {
		if candidate.ID != project {
			continue
		}
		if !slices.Contains(candidate.Environments, environment) {
			return engine.Match{}, ErrContext
		}
		return engine.Select(candidate, environment, request)
	}
	return engine.Match{}, ErrContext
}

func checkAttemptCapacity(ctx context.Context, tx *gorm.DB, project, environment, session string, match engine.Match) error {
	count, err := gorm.G[attemptRecord](tx).Count(ctx, "*")
	if err != nil {
		return err
	}
	if count < 10000 {
		return nil
	}
	existing, err := gorm.G[attemptRecord](tx).Where("project = ? AND environment = ? AND endpoint = ? AND revision = ? AND session = ?", project, environment, match.Endpoint.ID, match.Scenario.Revision, session).Count(ctx, "*")
	if err != nil {
		return err
	}
	if existing == 0 {
		return ErrCapacity
	}
	return nil
}

func allocateAttempt(ctx context.Context, tx *gorm.DB, project, environment, session string, match engine.Match) (int64, error) {
	counter := attemptRecord{Project: project, Environment: environment, Endpoint: match.Endpoint.ID, Revision: match.Scenario.Revision, Session: session, Attempt: 1}
	err := gorm.G[attemptRecord](tx, clause.OnConflict{
		Columns:   []clause.Column{{Name: "project"}, {Name: "environment"}, {Name: "endpoint"}, {Name: "revision"}, {Name: "session"}},
		DoUpdates: clause.Assignments(map[string]any{"attempt": gorm.Expr("attempts.attempt + 1"), "touched_at": gorm.Expr("now()")}),
	}, clause.Returning{Columns: []clause.Column{{Name: "attempt"}}}).Create(ctx, &counter)
	return counter.Attempt, err
}

func writeRequestLog(ctx context.Context, tx *gorm.DB, project, environment, session string, request engine.Request, plan engine.Plan) error {
	detail, err := json.Marshal(Detail{request.Method, request.Path, plan.Match.Endpoint.ID, plan.Match.Scenario.ID, plan.Match.Scenario.Revision, session, plan.Attempt, plan.Response.Status, plan.Response.DelayMS, plan.Match.Reason})
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
		if _, err := lockConfig(ctx, tx); err != nil {
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
