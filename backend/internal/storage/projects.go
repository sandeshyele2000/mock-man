package storage

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"mockman/internal/engine"
	"slices"

	"gorm.io/gorm"
)

var ErrNotFound = errors.New("project or resource not found")
var ErrInvalid = errors.New("invalid configuration")

const DefaultResponseBytes int64 = 10 << 20

func configurationLock(ctx context.Context, tx *gorm.DB, exclusive bool) error {
	return entityLock(ctx, tx, "workspace", exclusive)
}
func (s *Store) Init(ctx context.Context, schema string) error {
	return s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := configurationLock(ctx, tx, true); err != nil {
			return err
		}
		var legacy bool
		if err := tx.Raw("SELECT to_regclass('configuration') IS NOT NULL OR to_regclass('project_configurations') IS NOT NULL").Scan(&legacy).Error; err != nil {
			return err
		}
		if legacy {
			return errors.New("legacy document storage detected; use a fresh PostgreSQL database for schema version 2 (existing data was not modified)")
		}
		if err := tx.Exec(schema).Error; err != nil {
			return err
		}
		if err := tx.Exec("INSERT INTO workspace_state(id,version,schema_version) VALUES(true,1,2) ON CONFLICT DO NOTHING").Error; err != nil {
			return err
		}
		var state configuration
		if err := tx.Take(&state).Error; err != nil {
			return err
		}
		if state.SchemaVersion != 2 {
			return errors.New("unsupported database schema version")
		}
		return nil
	})
}
func readConfig(ctx context.Context, tx *gorm.DB) (engine.Config, error) {
	var state configuration
	if err := tx.WithContext(ctx).Take(&state).Error; err != nil {
		return engine.Config{}, err
	}
	var rows []entityRow
	if err := tx.Table("projects").Order("position, id").Find(&rows).Error; err != nil {
		return engine.Config{}, err
	}
	c := engine.Config{Version: state.Version, Projects: []engine.Project{}}
	for _, row := range rows {
		p, err := loadProject(ctx, tx, row.ID, true)
		if err != nil {
			return c, err
		}
		c.Projects = append(c.Projects, p)
	}
	return c, nil
}
func (s *Store) Config(ctx context.Context) (c engine.Config, err error) {
	err = s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error { c, err = readConfig(ctx, tx); return err }, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	return
}
func (s *Store) Project(ctx context.Context, id string) (p engine.Project, err error) {
	err = s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error { p, err = loadProject(ctx, tx, id, true); return err }, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	if errors.Is(err, gorm.ErrRecordNotFound) {
		err = ErrNotFound
	}
	return
}
func bumpWorkspaceVersion(ctx context.Context, tx *gorm.DB) (int64, error) {
	var state configuration
	err := tx.WithContext(ctx).Raw("UPDATE workspace_state SET version = version+1 WHERE id = true RETURNING version").Scan(&state).Error
	return state.Version, err
}
func (s *Store) validateProject(p engine.Project) error {
	if err := engine.Validate(engine.Config{Projects: []engine.Project{p}}); err != nil {
		return fmt.Errorf("%w: %v", ErrInvalid, err)
	}
	limit := s.MaxResponseBytes
	if limit <= 0 {
		limit = DefaultResponseBytes
	}
	for _, f := range p.Features {
		for _, e := range f.Endpoints {
			for _, r := range e.Responses {
				if int64(len(r.Body)) > limit {
					return fmt.Errorf("%w: response %s exceeds %d MiB", ErrInvalid, r.ID, limit>>20)
				}
			}
		}
	}
	return nil
}
func reviseProject(p *engine.Project, old engine.Project) {
	next := engine.Config{Projects: []engine.Project{*p}}
	assignRevisions(&next, engine.Config{Projects: []engine.Project{old}})
	*p = next.Projects[0]
}
func cloneProject(p engine.Project) (engine.Project, error) {
	data, err := json.Marshal(p)
	if err != nil {
		return p, err
	}
	var next engine.Project
	err = json.Unmarshal(data, &next)
	return next, err
}
func (s *Store) UpdateEntity(ctx context.Context, scope Scope, version int64, metadataOnly, remove bool, edit func(*engine.Project) error) (p engine.Project, workspaceVersion int64, err error) {
	err = s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := configurationLock(ctx, tx, false); err != nil {
			return err
		}
		if err := lockScope(ctx, tx, scope, version == 0); err != nil {
			return err
		}
		row, err := entity(ctx, tx, scope)
		if errors.Is(err, gorm.ErrRecordNotFound) {
			if version != 0 || remove || metadataOnly {
				return ErrNotFound
			}
		} else if err != nil {
			return err
		} else {
			expected := row.Version
			if metadataOnly {
				expected = row.MetadataVersion
			}
			if version == 0 || expected != version {
				return ErrConflict
			}
		}
		scope.MetadataOnly = metadataOnly
		if version == 0 && scope.Feature != "" && scope.Endpoint == "" {
			var count int64
			if err := tx.Table("features").Where("project_id = ?", scope.Project).Count(&count).Error; err != nil {
				return err
			}
			if count >= 100 {
				return fmt.Errorf("%w: maximum 100 features", ErrInvalid)
			}
		}
		before, err := loadProject(ctx, tx, scope.Project, false, scope)
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		if !metadataOnly && !remove && scope.Scenario == "" && !scope.Batch {
			if err := hydrateScope(ctx, tx, &before, scope); err != nil {
				return err
			}
		}
		p, err = cloneProject(before)
		if err != nil {
			return err
		}
		if err := edit(&p); err != nil {
			return err
		}
		if p.ID != scope.Project {
			return fmt.Errorf("%w: project ID cannot change", ErrInvalid)
		}
		if err := s.validateScope(p, scope); err != nil {
			return err
		}
		if metadataOnly && scope.Feature == "" && !slices.Equal(before.Environments, p.Environments) {
			var invalid int64
			if err := tx.Table("endpoints e").Joins("CROSS JOIN LATERAL jsonb_object_keys(e.document->'active') AS selection(key)").Where("e.project_id = ? AND selection.key NOT IN ?", p.ID, p.Environments).Count(&invalid).Error; err != nil {
				return err
			}
			if invalid > 0 {
				return fmt.Errorf("%w: environment is still referenced by active scenarios", ErrInvalid)
			}
		}
		reviseProject(&p, before)
		var projectRow entityRow
		if err := tx.Table("projects").Where("id = ?", scope.Project).Take(&projectRow).Error; err != nil {
			return err
		}
		workspaceVersion, err = bumpWorkspaceVersion(ctx, tx)
		if err != nil {
			return err
		}
		if err := persistDiff(ctx, tx, before, p, projectRow.Position, workspaceVersion, true); err != nil {
			return mapConstraintError(err)
		}
		return refreshVersions(ctx, tx, &p)
	})
	return
}
func (s *Store) UpdateProject(ctx context.Context, id string, version int64, edit func(*engine.Project) error) (engine.Project, int64, error) {
	return s.UpdateEntity(ctx, Scope{Project: id}, version, false, false, edit)
}
func (s *Store) CreateProject(ctx context.Context, p engine.Project) (saved engine.Project, workspaceVersion int64, err error) {
	p, err = cloneProject(p)
	if err != nil {
		return
	}
	if err = s.validateProject(p); err != nil {
		return
	}
	err = s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := configurationLock(ctx, tx, true); err != nil {
			return err
		}
		var count int64
		if err := tx.Table("projects").Where("id = ?", p.ID).Count(&count).Error; err != nil {
			return err
		}
		if count != 0 {
			return ErrConflict
		}
		if err := tx.Table("projects").Count(&count).Error; err != nil {
			return err
		}
		if count >= 50 {
			return fmt.Errorf("%w: maximum 50 projects", ErrInvalid)
		}
		var position int64
		if err := tx.Raw("SELECT COALESCE(MAX(position),-1)+1 FROM projects").Scan(&position).Error; err != nil {
			return err
		}
		reviseProject(&p, engine.Project{})
		workspaceVersion, err = bumpWorkspaceVersion(ctx, tx)
		if err != nil {
			return err
		}
		if err := persistDiff(ctx, tx, engine.Project{}, p, position, workspaceVersion); err != nil {
			return mapConstraintError(err)
		}
		if err := refreshVersions(ctx, tx, &p); err != nil {
			return err
		}
		saved = p
		return nil
	})
	return
}
func (s *Store) DeleteProject(ctx context.Context, id string, version int64) (workspaceVersion int64, err error) {
	err = s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := configurationLock(ctx, tx, false); err != nil {
			return err
		}
		if err := lockScope(ctx, tx, Scope{Project: id}, false); err != nil {
			return err
		}
		row, err := entity(ctx, tx, Scope{Project: id})
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		if row.Version != version {
			return ErrConflict
		}
		workspaceVersion, err = bumpWorkspaceVersion(ctx, tx)
		if err != nil {
			return err
		}
		return tx.Table("projects").Where("id = ?", id).Delete(&entityRow{}).Error
	})
	return
}

// Save remains an explicit atomic bulk replacement for imports and older clients.
func (s *Store) Save(ctx context.Context, c engine.Config) (engine.Config, error) {
	if err := engine.Validate(c); err != nil {
		return c, err
	}
	for _, p := range c.Projects {
		if err := s.validateProject(p); err != nil {
			return c, err
		}
	}
	err := s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := configurationLock(ctx, tx, true); err != nil {
			return err
		}
		old, err := readConfig(ctx, tx)
		if err != nil {
			return err
		}
		if old.Version != c.Version {
			return ErrConflict
		}
		previous := map[string]engine.Project{}
		for _, p := range old.Projects {
			previous[p.ID] = p
		}
		assignRevisions(&c, old)
		version, err := bumpWorkspaceVersion(ctx, tx)
		if err != nil {
			return err
		}
		for i := range c.Projects {
			p := &c.Projects[i]
			if err := persistDiff(ctx, tx, previous[p.ID], *p, int64(i), version); err != nil {
				return mapConstraintError(err)
			}
			delete(previous, p.ID)
			if err := refreshVersions(ctx, tx, p); err != nil {
				return err
			}
		}
		for id := range previous {
			if err := tx.Table("projects").Where("id = ?", id).Delete(&entityRow{}).Error; err != nil {
				return err
			}
		}
		c.Version = version
		return nil
	})
	return c, err
}
func mapConstraintError(err error) error {
	var sqlError interface{ SQLState() string }
	if errors.As(err, &sqlError) {
		switch sqlError.SQLState() {
		case "23505", "23503", "23514":
			return fmt.Errorf("%w: duplicate route, identifier, or invalid relationship", ErrInvalid)
		}
	}
	return err
}

func (s *Store) validateScope(p engine.Project, scope Scope) error {
	if scope.Feature == "" {
		return s.validateProject(p)
	}
	if len(p.Features) > 100 {
		return fmt.Errorf("%w: maximum 100 features", ErrInvalid)
	}
	seen := map[string]bool{}
	for _, f := range p.Features {
		for _, e := range f.Endpoints {
			if seen[e.ID] {
				return fmt.Errorf("%w: duplicate endpoint ID", ErrInvalid)
			}
			seen[e.ID] = true
		}
	}
	selected := []engine.Feature{}
	for _, f := range p.Features {
		if f.ID != scope.Feature {
			continue
		}
		if scope.Endpoint != "" {
			endpoints := []engine.Endpoint{}
			for _, e := range f.Endpoints {
				if e.ID == scope.Endpoint {
					endpoints = append(endpoints, e)
				}
			}
			f.Endpoints = endpoints
		}
		selected = append(selected, f)
	}
	p.Features = selected
	return s.validateProject(p)
}
