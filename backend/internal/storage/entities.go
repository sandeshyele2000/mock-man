package storage

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"mockman/internal/engine"
	"reflect"
	"slices"

	"gorm.io/gorm"
)

// Scope identifies an entity; ancestor locks protect structural changes while
// independent endpoints can be edited without optimistic version conflicts.
type Scope struct {
	Project, Feature, Endpoint, Response, Scenario string
	Batch                                          bool
	MetadataOnly                                   bool
}

func (s Scope) table() string {
	switch {
	case s.Response != "":
		return "responses"
	case s.Scenario != "":
		return "scenarios"
	case s.Endpoint != "":
		return "endpoints"
	case s.Feature != "":
		return "features"
	default:
		return "projects"
	}
}
func (s Scope) key() map[string]any {
	switch s.table() {
	case "projects":
		return map[string]any{"id": s.Project}
	case "features":
		return map[string]any{"project_id": s.Project, "id": s.Feature}
	case "endpoints":
		return map[string]any{"project_id": s.Project, "id": s.Endpoint, "feature_id": s.Feature}
	case "responses":
		return map[string]any{"project_id": s.Project, "endpoint_id": s.Endpoint, "id": s.Response}
	default:
		return map[string]any{"project_id": s.Project, "endpoint_id": s.Endpoint, "id": s.Scenario}
	}
}
func entityLock(ctx context.Context, tx *gorm.DB, key string, exclusive bool) error {
	function := "pg_advisory_xact_lock_shared"
	if exclusive {
		function = "pg_advisory_xact_lock"
	}
	return tx.WithContext(ctx).Exec("SELECT "+function+"(hashtextextended(current_schema() || ?, 0))", "/mockman/"+key).Error
}
func lockScope(ctx context.Context, tx *gorm.DB, s Scope, create bool) error {
	// New features need the project lock exclusively to enforce the feature cap;
	// new endpoints take the feature lock exclusively to stabilize route discovery.
	if err := entityLock(ctx, tx, s.Project, s.Feature == "" || (s.Endpoint == "" && create)); err != nil {
		return err
	}
	if s.Feature != "" {
		if err := entityLock(ctx, tx, s.Project+"/"+s.Feature, s.Endpoint == "" || create && s.Response == "" && s.Scenario == ""); err != nil {
			return err
		}
	}
	if s.Endpoint != "" {
		return entityLock(ctx, tx, s.Project+"/"+s.Feature+"/"+s.Endpoint, true)
	}
	return nil
}
func entity(ctx context.Context, tx *gorm.DB, s Scope) (entityRow, error) {
	var row entityRow
	err := tx.WithContext(ctx).Table(s.table()).Where(s.key()).Take(&row).Error
	return row, err
}
func metadata(value any, omit ...string) json.RawMessage {
	data, err := json.Marshal(value)
	if err != nil {
		panic(err)
	} // Engine values contain validated JSON only.
	var object map[string]json.RawMessage
	if err := json.Unmarshal(data, &object); err != nil {
		panic(err)
	}
	for _, key := range append(omit, "version", "metadataVersion") {
		delete(object, key)
	}
	data, err = json.Marshal(object)
	if err != nil {
		panic(err)
	}
	return data
}

type storedEntity struct {
	Table string
	Row   entityRow
}

func (e storedEntity) key() map[string]any {
	key := map[string]any{"id": e.Row.ID}
	if e.Table != "projects" {
		key["project_id"] = e.Row.ProjectID
	}
	if e.Table == "responses" || e.Table == "scenarios" {
		key["endpoint_id"] = e.Row.EndpointID
	}
	return key
}
func (e storedEntity) id() string {
	return e.Table + "/" + e.Row.ProjectID + "/" + e.Row.EndpointID + "/" + e.Row.ID
}
func flatten(p engine.Project, position int64) []storedEntity {
	meta := p
	meta.Features = nil
	result := []storedEntity{{"projects", entityRow{ID: p.ID, Position: position, Document: metadata(meta, "features")}}}
	for fi, f := range p.Features {
		fm := f
		fm.Endpoints = nil
		result = append(result, storedEntity{"features", entityRow{ID: f.ID, ProjectID: p.ID, Position: int64(fi), Document: metadata(fm, "endpoints")}})
		for ei, e := range f.Endpoints {
			em := e
			em.Responses = nil
			em.Scenarios = nil
			result = append(result, storedEntity{"endpoints", entityRow{ID: e.ID, ProjectID: p.ID, FeatureID: f.ID, Position: int64(ei), Document: metadata(em, "responses", "scenarios")}})
			for ri, r := range e.Responses {
				rm := r
				rm.Body = nil
				result = append(result, storedEntity{"responses", entityRow{ID: r.ID, ProjectID: p.ID, EndpointID: e.ID, Position: int64(ri), Document: metadata(rm, "body"), Body: r.Body}})
			}
			for si, s := range e.Scenarios {
				result = append(result, storedEntity{"scenarios", entityRow{ID: s.ID, ProjectID: p.ID, EndpointID: e.ID, Position: int64(si), Revision: s.Revision, Document: metadata(s, "revision")}})
			}
		}
	}
	return result
}
func sameJSON(a, b json.RawMessage) bool {
	var x, y any
	left, right := json.NewDecoder(bytes.NewReader(a)), json.NewDecoder(bytes.NewReader(b))
	left.UseNumber()
	right.UseNumber()
	return left.Decode(&x) == nil && right.Decode(&y) == nil && reflect.DeepEqual(x, y)
}
func sameEntity(a, b storedEntity) bool {
	return a.Row.FeatureID == b.Row.FeatureID && a.Row.Position == b.Row.Position && (a.Table != "scenarios" || a.Row.Revision == b.Row.Revision) && sameJSON(a.Row.Document, b.Row.Document) && (a.Table != "responses" || sameJSON(a.Row.Body, b.Row.Body))
}
func loadProject(ctx context.Context, tx *gorm.DB, id string, bodies bool, filters ...Scope) (engine.Project, error) {
	var row entityRow
	if err := tx.WithContext(ctx).Table("projects").Where("id = ?", id).Take(&row).Error; err != nil {
		return engine.Project{}, err
	}
	var p engine.Project
	if err := json.Unmarshal(row.Document, &p); err != nil {
		return p, err
	}
	p.Version, p.MetadataVersion = row.Version, row.MetadataVersion
	p.Features = []engine.Feature{}
	var filter Scope
	if len(filters) > 0 {
		filter = filters[0]
	}
	var features, endpoints, responses, scenarios []entityRow
	for _, query := range []struct {
		table string
		rows  *[]entityRow
	}{{"features", &features}, {"endpoints", &endpoints}, {"responses", &responses}, {"scenarios", &scenarios}} {
		q := tx.WithContext(ctx).Table(query.table).Where("project_id = ?", id).Order("position, id")
		if filter.MetadataOnly && filter.Endpoint == "" {
			if query.table != "features" || filter.Feature == "" {
				q = q.Where("false")
			}
		}
		if filter.Feature != "" {
			if query.table == "features" {
				q = q.Where("id = ?", filter.Feature)
			} else if query.table == "endpoints" {
				q = q.Where("feature_id = ?", filter.Feature)
			} else {
				q = q.Where("endpoint_id IN (SELECT id FROM endpoints WHERE project_id = ? AND feature_id = ?)", id, filter.Feature)
			}
		}
		if filter.Endpoint != "" {
			if query.table == "endpoints" {
				q = q.Where("id = ?", filter.Endpoint)
			} else if query.table != "features" {
				q = q.Where("endpoint_id = ?", filter.Endpoint)
			}
		}

		if query.table == "responses" && !bodies {
			q = q.Select("project_id, endpoint_id, id, version, metadata_version, position, document, 'null'::jsonb AS body")
		}
		if err := q.Find(query.rows).Error; err != nil {
			return p, err
		}
	}
	featureIndex := map[string]int{}
	for _, r := range features {
		var f engine.Feature
		if err := json.Unmarshal(r.Document, &f); err != nil {
			return p, err
		}
		f.Version, f.MetadataVersion = r.Version, r.MetadataVersion
		f.Endpoints = []engine.Endpoint{}
		featureIndex[f.ID] = len(p.Features)
		p.Features = append(p.Features, f)
	}
	type location struct{ feature, endpoint int }
	endpointIndex := map[string]location{}
	for _, r := range endpoints {
		var e engine.Endpoint
		if err := json.Unmarshal(r.Document, &e); err != nil {
			return p, err
		}
		e.Version, e.MetadataVersion = r.Version, r.MetadataVersion
		e.Responses = []engine.Response{}
		e.Scenarios = []engine.Scenario{}
		fi, ok := featureIndex[r.FeatureID]
		if !ok {
			return p, fmt.Errorf("endpoint parent missing")
		}
		endpointIndex[e.ID] = location{fi, len(p.Features[fi].Endpoints)}
		p.Features[fi].Endpoints = append(p.Features[fi].Endpoints, e)
	}
	for _, r := range responses {
		var response engine.Response
		if err := json.Unmarshal(r.Document, &response); err != nil {
			return p, err
		}
		response.Version, response.Body = r.Version, r.Body
		loc := endpointIndex[r.EndpointID]
		e := &p.Features[loc.feature].Endpoints[loc.endpoint]
		e.Responses = append(e.Responses, response)
	}
	for _, r := range scenarios {
		var scenario engine.Scenario
		if err := json.Unmarshal(r.Document, &scenario); err != nil {
			return p, err
		}
		scenario.Version = r.Version
		scenario.Revision = r.Revision
		loc := endpointIndex[r.EndpointID]
		e := &p.Features[loc.feature].Endpoints[loc.endpoint]
		e.Scenarios = append(e.Scenarios, scenario)
	}
	return p, nil
}
func hydrateScope(ctx context.Context, tx *gorm.DB, p *engine.Project, s Scope) error {
	for fi := range p.Features {
		f := &p.Features[fi]
		if s.Feature != "" && s.Feature != f.ID {
			continue
		}
		for ei := range f.Endpoints {
			e := &f.Endpoints[ei]
			if s.Endpoint != "" && s.Endpoint != e.ID {
				continue
			}
			for ri := range e.Responses {
				r := &e.Responses[ri]
				if s.Response != "" && s.Response != r.ID {
					continue
				}
				var row entityRow
				if err := tx.WithContext(ctx).Table("responses").Select("body").Where("project_id = ? AND endpoint_id = ? AND id = ?", p.ID, e.ID, r.ID).Take(&row).Error; err != nil {
					return err
				}
				r.Body = row.Body
			}
		}
	}
	return nil
}

// persistDiff writes only changed entity rows. Ancestors receive version counters,
// never rewritten child arrays or response payloads.
func persistDiff(ctx context.Context, tx *gorm.DB, before, after engine.Project, position, version int64, partial ...bool) error {
	old := map[string]storedEntity{}
	for _, e := range flatten(before, position) {
		if e.Row.ID != "" {
			old[e.id()] = e
		}
	}
	next := flatten(after, position)
	touchedFeatures, touchedEndpoints := map[string]bool{}, map[string]bool{}
	for _, e := range next {
		previous, exists := old[e.id()]
		preserve := len(partial) > 0 && partial[0]
		if preserve && exists {
			previous.Row.Position = e.Row.Position
		}
		delete(old, e.id())
		if exists && sameEntity(previous, e) {
			if !preserve {
				if err := tx.WithContext(ctx).Table(e.Table).Where(e.key()).Update("position", e.Row.Position).Error; err != nil {
					return err
				}
			}
			continue
		}
		values := map[string]any{"id": e.Row.ID, "position": e.Row.Position, "document": e.Row.Document, "version": version, "metadata_version": version}
		if e.Table != "projects" {
			values["project_id"] = after.ID
		}
		if e.Table == "endpoints" {
			values["feature_id"] = e.Row.FeatureID
			touchedFeatures[e.Row.FeatureID] = true
			touchedEndpoints[e.Row.ID] = true
		}
		if e.Table == "features" {
			touchedFeatures[e.Row.ID] = true
		}
		if e.Table == "responses" || e.Table == "scenarios" {
			values["endpoint_id"] = e.Row.EndpointID
			touchedEndpoints[e.Row.EndpointID] = true
		}
		if e.Table == "responses" && (!exists || !sameJSON(previous.Row.Body, e.Row.Body)) {
			values["body"] = e.Row.Body
		}
		if exists && sameJSON(previous.Row.Document, e.Row.Document) && (e.Table != "responses" || sameJSON(previous.Row.Body, e.Row.Body)) {
			delete(values, "metadata_version")
		}
		if e.Table == "scenarios" {
			values["revision"] = e.Row.Revision
			if exists && sameJSON(previous.Row.Document, e.Row.Document) {
				delete(values, "version")
				delete(values, "metadata_version")
				delete(values, "document")
			}
		}

		if preserve {
			if exists {
				delete(values, "position")
			} else {
				q := tx.WithContext(ctx).Table(e.Table).Select("COALESCE(MAX(position),-1)+1")
				if e.Table != "projects" {
					q = q.Where("project_id = ?", after.ID)
				}
				if e.Table == "endpoints" {
					q = q.Where("feature_id = ?", e.Row.FeatureID)
				}
				if e.Table == "responses" || e.Table == "scenarios" {
					q = q.Where("endpoint_id = ?", e.Row.EndpointID)
				}
				var nextPosition int64
				if err := q.Scan(&nextPosition).Error; err != nil {
					return err
				}
				values["position"] = nextPosition
			}
		}
		if exists {
			if err := tx.WithContext(ctx).Table(e.Table).Where(e.key()).Updates(values).Error; err != nil {
				return err
			}
		} else {
			if err := tx.WithContext(ctx).Table(e.Table).Create(values).Error; err != nil {
				return err
			}
		}
	}
	// Child rows go first; parent deletion also cascades at the database layer.
	removed := make([]storedEntity, 0, len(old))
	for _, e := range old {
		removed = append(removed, e)
	}
	rank := map[string]int{"scenarios": 0, "responses": 1, "endpoints": 2, "features": 3, "projects": 4}
	slices.SortFunc(removed, func(a, b storedEntity) int { return rank[a.Table] - rank[b.Table] })
	for _, e := range removed {
		if err := tx.WithContext(ctx).Table(e.Table).Where(e.key()).Delete(&entityRow{}).Error; err != nil {
			return err
		}
		if e.Table == "endpoints" {
			touchedFeatures[e.Row.FeatureID] = true
		}
		if e.Row.EndpointID != "" {
			touchedEndpoints[e.Row.EndpointID] = true
		}
	}
	for _, f := range after.Features {
		for _, e := range f.Endpoints {
			if touchedEndpoints[e.ID] {
				if err := tx.WithContext(ctx).Table("endpoints").Where("project_id = ? AND id = ?", after.ID, e.ID).Update("version", version).Error; err != nil {
					return err
				}
				touchedFeatures[f.ID] = true
			}
		}
	}
	for id := range touchedFeatures {
		if err := tx.WithContext(ctx).Table("features").Where("project_id = ? AND id = ?", after.ID, id).Update("version", version).Error; err != nil {
			return err
		}
	}
	return tx.WithContext(ctx).Table("projects").Where("id = ?", after.ID).Update("version", version).Error
}

// Refresh version tokens without fetching response bodies again.
func refreshVersions(ctx context.Context, tx *gorm.DB, p *engine.Project) error {
	var project entityRow
	if err := tx.WithContext(ctx).Table("projects").Select("version, metadata_version").Where("id = ?", p.ID).Take(&project).Error; err != nil {
		return err
	}
	p.Version, p.MetadataVersion = project.Version, project.MetadataVersion
	lookup := map[string]entityRow{}
	featureIDs, endpointIDs := []string{}, []string{}
	for _, f := range p.Features {
		featureIDs = append(featureIDs, f.ID)
		for _, e := range f.Endpoints {
			endpointIDs = append(endpointIDs, e.ID)
		}
	}
	for _, table := range []string{"features", "endpoints", "responses", "scenarios"} {
		var rows []entityRow
		fields := "id, version, metadata_version"
		if table == "responses" || table == "scenarios" {
			fields += ", endpoint_id"
		}
		q := tx.WithContext(ctx).Table(table).Select(fields).Where("project_id = ?", p.ID)
		if table == "features" {
			if len(featureIDs) == 0 {
				continue
			}
			q = q.Where("id IN ?", featureIDs)
		} else {
			if len(endpointIDs) == 0 {
				continue
			}
			if table == "endpoints" {
				q = q.Where("id IN ?", endpointIDs)
			} else {
				q = q.Where("endpoint_id IN ?", endpointIDs)
			}
		}
		if err := q.Find(&rows).Error; err != nil {
			return err
		}
		for _, r := range rows {
			lookup[table+"/"+r.EndpointID+"/"+r.ID] = r
		}
	}
	for fi := range p.Features {
		f := &p.Features[fi]
		r := lookup["features//"+f.ID]
		f.Version, f.MetadataVersion = r.Version, r.MetadataVersion
		for ei := range f.Endpoints {
			e := &f.Endpoints[ei]
			r = lookup["endpoints//"+e.ID]
			e.Version, e.MetadataVersion = r.Version, r.MetadataVersion
			for ri := range e.Responses {
				r := &e.Responses[ri]
				r.Version = lookup["responses/"+e.ID+"/"+r.ID].Version
			}
			for si := range e.Scenarios {
				s := &e.Scenarios[si]
				s.Version = lookup["scenarios/"+e.ID+"/"+s.ID].Version
			}
		}
	}
	return nil
}

// Runtime reads only the matched endpoint, not every project/feature payload.
func loadRuntimeEndpoint(ctx context.Context, tx *gorm.DB, s Scope) (engine.Endpoint, engine.Feature, error) {
	var e engine.Endpoint
	var f engine.Feature
	row, err := entity(ctx, tx, Scope{Project: s.Project, Feature: s.Feature})
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return e, f, engine.ErrNoMatch
	}
	if err != nil {
		return e, f, err
	}
	if err := json.Unmarshal(row.Document, &f); err != nil {
		return e, f, err
	}
	row, err = entity(ctx, tx, s)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return e, f, engine.ErrNoMatch
	}
	if err != nil {
		return e, f, err
	}
	if err := json.Unmarshal(row.Document, &e); err != nil {
		return e, f, err
	}
	e.Responses = []engine.Response{}
	e.Scenarios = []engine.Scenario{}
	var responses, scenarios []entityRow
	if err := tx.Table("responses").Select("project_id, endpoint_id, id, version, position, document").Where("project_id = ? AND endpoint_id = ?", s.Project, s.Endpoint).Order("position,id").Find(&responses).Error; err != nil {
		return e, f, err
	}
	if err := tx.Table("scenarios").Where("project_id = ? AND endpoint_id = ?", s.Project, s.Endpoint).Order("position,id").Find(&scenarios).Error; err != nil {
		return e, f, err
	}
	for _, r := range responses {
		var response engine.Response
		if err := json.Unmarshal(r.Document, &response); err != nil {
			return e, f, err
		}
		response.Body = r.Body
		response.Version = r.Version
		e.Responses = append(e.Responses, response)
	}
	for _, r := range scenarios {
		var scenario engine.Scenario
		if err := json.Unmarshal(r.Document, &scenario); err != nil {
			return e, f, err
		}
		scenario.Version = r.Version
		scenario.Revision = r.Revision
		e.Scenarios = append(e.Scenarios, scenario)
	}
	return e, f, nil
}
