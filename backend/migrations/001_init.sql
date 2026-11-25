-- Fresh schema only. Startup refuses legacy JSON-document databases.
CREATE TABLE IF NOT EXISTS workspace_state (
 id boolean PRIMARY KEY DEFAULT true CHECK (id),
 version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
 schema_version integer NOT NULL DEFAULT 2 CHECK (schema_version = 2)
);
CREATE TABLE IF NOT EXISTS projects (
 id text PRIMARY KEY,
 version bigint NOT NULL CHECK (version > 0),
 metadata_version bigint NOT NULL CHECK (metadata_version > 0),
 position bigint NOT NULL,
 document jsonb NOT NULL CHECK (jsonb_typeof(document) = 'object' AND document->>'id' = id)
);
CREATE TABLE IF NOT EXISTS features (
 project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 id text NOT NULL,
 version bigint NOT NULL CHECK (version > 0),
 metadata_version bigint NOT NULL CHECK (metadata_version > 0),
 position bigint NOT NULL,
 document jsonb NOT NULL CHECK (jsonb_typeof(document) = 'object' AND document->>'id' = id),
 PRIMARY KEY(project_id, id)
);
CREATE TABLE IF NOT EXISTS endpoints (
 project_id text NOT NULL,
 feature_id text NOT NULL,
 id text NOT NULL,
 version bigint NOT NULL CHECK (version > 0),
 metadata_version bigint NOT NULL CHECK (metadata_version > 0),
 position bigint NOT NULL,
 document jsonb NOT NULL CHECK (jsonb_typeof(document) = 'object' AND document->>'id' = id),
 method text GENERATED ALWAYS AS (document->>'method') STORED NOT NULL,
 path text GENERATED ALWAYS AS (document->>'path') STORED NOT NULL,
 PRIMARY KEY(project_id, id),
 FOREIGN KEY(project_id, feature_id) REFERENCES features(project_id, id) ON DELETE CASCADE,
 UNIQUE(project_id, feature_id, method, path)
);
CREATE TABLE IF NOT EXISTS responses (
 project_id text NOT NULL,
 endpoint_id text NOT NULL,
 id text NOT NULL,
 version bigint NOT NULL CHECK (version > 0),
 metadata_version bigint NOT NULL CHECK (metadata_version > 0),
 position bigint NOT NULL,
 document jsonb NOT NULL CHECK (jsonb_typeof(document) = 'object' AND document->>'id' = id),
 body json NOT NULL,
 PRIMARY KEY(project_id, endpoint_id, id),
 FOREIGN KEY(project_id, endpoint_id) REFERENCES endpoints(project_id, id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS scenarios (
 project_id text NOT NULL,
 endpoint_id text NOT NULL,
 id text NOT NULL,
 version bigint NOT NULL CHECK (version > 0),
 metadata_version bigint NOT NULL CHECK (metadata_version > 0),
 position bigint NOT NULL,
 revision text NOT NULL CHECK (revision <> ''),
 document jsonb NOT NULL CHECK (jsonb_typeof(document) = 'object' AND document->>'id' = id),
 PRIMARY KEY(project_id, endpoint_id, id),
 FOREIGN KEY(project_id, endpoint_id) REFERENCES endpoints(project_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS endpoint_routes ON endpoints(project_id, method, path);
CREATE INDEX IF NOT EXISTS endpoints_feature ON endpoints(project_id, feature_id);
CREATE TABLE IF NOT EXISTS attempts (
 project text NOT NULL, environment text NOT NULL, endpoint text NOT NULL,
 revision text NOT NULL, session text NOT NULL,
 attempt bigint NOT NULL, touched_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(project,environment,endpoint,revision,session)
);
ALTER TABLE attempts ADD COLUMN IF NOT EXISTS cursor text NOT NULL DEFAULT '';
ALTER TABLE attempts ADD COLUMN IF NOT EXISTS last_response text NOT NULL DEFAULT '';
CREATE TABLE IF NOT EXISTS request_logs (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 created_at timestamptz NOT NULL DEFAULT now(),
 project text NOT NULL, environment text NOT NULL, session text NOT NULL,
 detail jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS logs_context ON request_logs(project, environment, id DESC);
