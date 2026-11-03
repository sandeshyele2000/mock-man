CREATE TABLE IF NOT EXISTS configuration (
 id boolean PRIMARY KEY DEFAULT true CHECK (id),
 version bigint NOT NULL DEFAULT 1,
 document json NOT NULL
);
CREATE TABLE IF NOT EXISTS attempts (
 project text NOT NULL, environment text NOT NULL, endpoint text NOT NULL,
 revision text NOT NULL, session text NOT NULL,
 attempt bigint NOT NULL, touched_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(project,environment,endpoint,revision,session)
);
CREATE TABLE IF NOT EXISTS request_logs (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 created_at timestamptz NOT NULL DEFAULT now(),
 project text NOT NULL, environment text NOT NULL, session text NOT NULL,
 detail jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS logs_context ON request_logs(project, environment, id DESC);
