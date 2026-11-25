# Mockman

## Run published images (no source checkout)

Copy `compose.release.yaml` and `.env.release.example` to a deployment folder on
the host. Install and start Docker, then copy `.env.release.example` to `.env`.
Set `PUBLIC_HOST` to the host's VPN hostname/IP and choose the published ports.
`MOCKMAN_VERSION` selects the backend/dashboard image tag (default `2.0.0`).

For deployment without a registry login, make both GHCR packages
(`mockman-backend` and `mockman-dashboard`) public once. In the publisher's
GitHub profile, open **Packages**, select each package, then open
**Package settings → Danger Zone → Change visibility → Public** and confirm
with the package name. Package visibility is separate from repository visibility;
GitHub does not allow a public package to become private again.

After both packages are public, deployment hosts run the commands below without
`docker login` or a GitHub token. Authentication is still required to publish
new image versions. Registry credentials do not belong in the deployment `.env`.

```sh
cp .env.release.example .env
# Edit .env before starting.
docker compose -f compose.release.yaml config --quiet
docker compose -f compose.release.yaml pull
docker compose -f compose.release.yaml up -d
docker compose -f compose.release.yaml ps
```

Open `http://<PUBLIC_HOST>:<DASHBOARD_PORT>`. No Go, Node.js, Dockerfiles, or
source code are required on this host. The release file sets the Compose project
name to `mockman` so its database volume remains consistent across folder moves.
Services restart when Docker restarts; Docker itself must be running.

For an update, publish both images under the new version tag, change
`MOCKMAN_VERSION` in `.env`, and run `pull` followed by `up -d` again. Host/port
changes need only `up -d`. Stop with `docker compose -f compose.release.yaml down`;
avoid `down -v` unless you intend to delete the database volume.

## Run with Docker Compose

Install Docker with Compose, then run from the repository root:

```sh
docker compose up --build -d
```

Open the dashboard at <http://localhost:5173>. The admin API is available at
<http://localhost:8080> and the mock API at <http://localhost:9091>. PostgreSQL
data is stored in a named volume and the schema is initialized automatically.
Stop the services with `docker compose down`; add `-v` only when you want to
delete the stored database too.

Configure `.env` from `.env.example` before starting. For VPN access to a Mac Studio:

```dotenv
PUBLIC_HOST=mac-studio.your-vpn-name
BIND_ADDRESS=0.0.0.0
DASHBOARD_PORT=5173
ADMIN_PORT=8080
MOCK_PORT=9091
```

All public URLs derive from `PUBLIC_HOST` and these ports. Change the host in one
place when moving machines. If your existing `.env` contains `ADMIN_ORIGIN`,
`DASHBOARD_ORIGIN`, `MOCK_ORIGIN`, `ADMIN_ADDR`, or `MOCK_ADDR`, remove those
legacy overrides to use the shared settings. Set `MOCK_ALLOWED_ORIGINS` to the
browser app origins that should call mock routes. The admin API has no user
authentication, so keep it on a trusted network or VPN.

Build images once with `docker compose build`. After changing host or ports,
run `docker compose up -d --force-recreate`; rebuilding is unnecessary. The
dashboard reads public URLs from a startup-generated configuration file.
Container listen ports stay fixed; the configured ports are published on the
host. Direct Go/Vite development uses the same configured ports.

## Run both (development)

```sh
npm install
npm run dev
```

## Build both

```sh
npm run build
```

## Backend only

```sh
# From the repository root
docker compose up -d --wait
cd backend
go run ./cmd/mockman
```

```sh
# From backend/
go build -o ../mockman ./cmd/mockman
```

## Web only

```sh
cd frontend
npm ci
npm run dev
```

```sh
# From frontend/
npm run build
```


## Server addresses

The root `.env` is shared by the backend, frontend and dev launcher. `PUBLIC_HOST`
is the public hostname or IP, and `BIND_ADDRESS` is the local listen interface.
Use `ADMIN_PORT`, `MOCK_PORT`, and `DASHBOARD_PORT` to set ports (1–65535).
Restart development servers after editing `.env`.

Optional `ADMIN_ORIGIN`, `DASHBOARD_ORIGIN`, and `MOCK_ORIGIN` override public
URLs for reverse proxies. `ADMIN_ADDR` and `MOCK_ADDR` override direct backend
listen addresses. Browser-only `VITE_API_URL` and `VITE_MOCK_URL` are development
or static-build overrides; Docker uses runtime `ADMIN_ORIGIN` and `MOCK_ORIGIN`.
All browser configuration is public; never put secrets in it.

## Hosting behind a path-based HTTPS proxy

Use the following public settings in the deployment `.env`:

```dotenv
DASHBOARD_ORIGIN=https://atlas.example.com
ADMIN_ORIGIN=https://atlas.example.com/mockman-api/
MOCK_ORIGIN=https://atlas.example.com/mockman-mock/
```

`DASHBOARD_ORIGIN` must contain only the browser origin (scheme and hostname,
plus port if needed), without `/mockman/`. The backend uses it to validate the
browser's Origin header. The API URLs include their public prefixes; requests
such as `/api/config` are appended to `ADMIN_ORIGIN`.

In the HTTPS Nginx server, keep the trailing slashes on `proxy_pass` so Nginx
strips each external prefix before forwarding:

```nginx
location = /mockman { return 301 /mockman/; }
location /mockman/ {
    proxy_pass http://dashboard:80/;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
}
location /mockman-api/ {
    proxy_pass http://app:8080/;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
}
location /mockman-mock/ {
    proxy_pass http://app:9091/;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

The proxy must share a Docker network with `app` and `dashboard` for these service
names to resolve. The browser calls the public HTTPS URLs, never Docker service
names. Keep your existing forwarding headers and other service locations.

Build the updated dashboard image once (`docker compose build dashboard`), then
apply settings with `docker compose up -d`. For release deployments, publish and
pull an updated dashboard image containing this support before running
`docker compose -f compose.release.yaml up -d`. Subsequent public API URL
changes only require recreating containers; mount-path changes belong in the
external proxy configuration. Neither requires rebuilding the dashboard.
The same image supports root hosting and proxy subpaths using relative asset
URLs. No dashboard base-path setting is needed. The startup script only generates
public API URLs in `runtime-config.js`; it does not modify HTML or Nginx rules.

The external proxy owns the mount path: redirect `/mockman` to `/mockman/` and
strip `/mockman/` before forwarding to the dashboard container. The trailing
slash is required for relative asset URLs. This applies to the current dashboard,
which has no nested browser routes; introducing client-side routing will require
explicit handling of its base path. Direct Vite development continues at `/`.

To check a running dashboard image without changing backend data, run from
`frontend/` (API calls are mocked by the test):

```sh
DEPLOYMENT_URL=http://127.0.0.1:5173/mockman/ npx playwright test --config playwright.deployment.config.ts
```

## Entity storage and targeted saves

Projects, features, endpoints, responses, and scenarios are stored in separate
PostgreSQL tables. Parent relationships use foreign keys with cascading deletes;
method/path pairs are unique within a feature. Entity metadata uses JSONB and
response bodies use a separate JSON column. Scenario runtime revisions use a
separate text column, so response-driven resets do not rewrite script/flow JSON. Parent rows never contain nested
response payloads.

The dashboard uses metadata-only PATCH requests for project names/environments,
feature names/switches, and endpoint metadata/active selections. Responses and
scenarios have independent PUT/DELETE routes. Scenario imports send only changed
responses, scenarios, and active selections in one atomic endpoint batch. They do
not resend existing response bodies. Full container PUT and workspace PUT are
explicit bulk replacement/import operations, not normal editing paths.

A small edit is not limited by the total size of its project, feature, or endpoint.
Only changed entity rows are written. Ancestor rows receive small version-counter
updates. Mock matching reads route/scenario metadata for the selected endpoint,
then fetches only the selected saved response body. The dashboard still fetches
workspace data at startup; very large workspaces will have higher initial browser
memory and download costs even though edits and matching are scoped.

### Versions and integrity

Each response and scenario has a `version` for its editable content. Response edits
can refresh a scenario's runtime revision without advancing its content version.
Containers expose two tokens:

- `metadataVersion` protects metadata-only PATCH requests.
- `version` protects the whole subtree for full replacement, deletion, or batches.

PUT/DELETE bodies contain the target entity's `version`, not its project's version.
PATCH bodies put the target's `metadataVersion` in the request's `version` field.
Use zero only to create an entity. Updates to independent responses can succeed
from the same initial snapshot; a stale edit to the same response returns HTTP 409.
Child changes invalidate container replacement tokens without blocking unrelated
metadata edits. New/recreated entities get fresh tokens.

Related edits commit in one transaction. Validation rejects dangling response
references, missing active scenarios, duplicate routes, invalid flows, and unknown
environments. Locks protect endpoint state while validating relationships; imports
roll back completely when any part fails. Counters and scenario revisions retain
the existing reset, layout, and matching semantics. Global log/counter caps remain
enforced across concurrent projects.

### Payload limits

| Operation | Default limit |
| --- | --- |
| Individual saved response JSON body | 10 MiB, configurable with `MAX_RESPONSE_MIB` |
| Response PUT request | Response limit plus 1 MiB for its envelope and headers |
| Metadata PATCH or DELETE | 1 MiB |
| Scenario PUT | 10 MiB; existing script and flow limits also apply |
| Explicit container/workspace import or endpoint change batch | 100 MiB, configurable with `MAX_IMPORT_MIB` |

`MAX_RESPONSE_MIB` accepts 1–100. `MAX_IMPORT_MIB` must be greater than the response
limit and at most 512. Settings are read at startup; restart the backend after
changing them. Compose forwards both settings to the app container. The dashboard
reads `/api/limits` for its feature/scenario file import checks. Backend validation
also applies the response-body limit to every response in a bulk import.

Oversized HTTP requests return 413. A valid-sized request containing a response
body over the configured body limit fails validation with 422. These limits bound
individual operations, not total stored project size. Count limits remain 50
projects, 100 features per project, and 100 responses/scenarios per endpoint.
JavaScript execution/output and incoming mock-request limits remain separate.

If an external Nginx proxies the admin API, allow the configured import size there
as well; otherwise Nginx can reject the upload before Go receives it. For example:

```nginx
location /mockman-api/ {
    client_max_body_size 100m;
    proxy_pass http://127.0.0.1:5174/;
    proxy_set_header Host $http_host;
}
```

The admin listener allows up to two minutes to read requests and three minutes to
write responses for explicit imports. Mock listener timeouts remain unchanged.
The admin API has no user authentication; keep it on a trusted network/VPN or put
it behind an authenticated proxy.

### API routes

GET `/api/projects/{project}` reads a project. PUT/DELETE use these resource paths;
PATCH is available only for the first three metadata resources:

- `/api/projects/{project}`
- `/api/projects/{project}/features/{feature}`
- `/api/projects/{project}/features/{feature}/endpoints/{endpoint}`
- `/api/projects/{project}/features/{feature}/endpoints/{endpoint}/responses/{response}`
- `/api/projects/{project}/features/{feature}/endpoints/{endpoint}/scenarios/{scenario}`

PUT/PATCH bodies contain `{ "version": 3, "value": { ...entity } }`; DELETE bodies
contain `{ "version": 3 }`. PATCH values contain metadata fields only, with no child
arrays; omitted metadata fields are preserved and explicit null values are rejected.
Responses contain current entity/ancestor tokens under `versions` and the
saved value when applicable. Runtime revisions are returned separately under `revisions` for the affected
endpoint. Ancestor metadata tokens are not advanced in the browser unless that
metadata was actually saved, so a concurrent rename cannot be silently overwritten.
Mutation envelopes may also include `ancestors`, mapping `project`, `feature/<id>`,
and `endpoint/<id>` to the subtree versions from the loaded snapshot. The dashboard
sends these automatically. Ancestor subtree tokens advance only when that snapshot
was current; otherwise the result sets `stale: true` and the dashboard refreshes.
This prevents a leaf save from authorizing replacement or deletion of unseen changes.
Metadata editors also retain their original edit token and preserve refreshed child
data when a background query completes while the editor is open.

POST `/api/projects/{project}/features/{feature}/endpoints/{endpoint}/changes`
accepts the endpoint subtree version, at most 200 `changes` (each with `kind`, `id`,
`version`, and `value` or `delete: true`), and optional `active` selections. New items
use version zero. Supplying `active` also requires the endpoint's `metadataVersion`
as a separate field. GET/PUT `/api/config` remains available for explicit workspace
reads and atomic bulk replacements, using the workspace version.

### Fresh database setup

This unreleased schema intentionally does not migrate old document storage.
Startup detects `configuration` or `project_configurations` and refuses to proceed
without modifying their data. Use a new, empty database and deploy the rebuilt
backend and dashboard together. Fresh databases contain no demo projects; create
the first project from the dashboard. Startup does not clear or reseed existing
entity tables.

For native PostgreSQL, create a separate database using the existing application
role, then point `DATABASE_URL` at it:

```sh
createdb --owner=mockman mockman_v2
# Set DATABASE_URL to the new database and your actual password, then restart.
```

For a local Compose checkout, keep the previous volume while starting a fresh
project and volume:

```sh
docker compose down
docker compose -p mockman-v2 up --build -d
```

For published-image deployments, publish the updated backend and dashboard first,
then start the release Compose file with a new project name (`-p mockman-v2`). Do
not run older backend versions against the entity schema. Existing development
data remains in the old database/volume until you explicitly remove it.

## Mocking controls and feature import

The feature switch pauses every endpoint in the selected feature while preserving
individual endpoint settings and scenario counters. Endpoint switches control
individual routes. Disabled routes return HTTP 404; requests resume from their
saved state when mocking is enabled again.

Open **Create feature** to import a feature JSON export using the file picker or
drag and drop. Export remains available in the feature toolbar. Imported IDs
are regenerated, and active scenarios are mapped to the project's environments.

## Feature routing

Send `X-Mock-Feature` with the feature **identifier** to target a specific feature:

```sh
curl -X POST http://your-host:9091/v1/agreements/acceptances \
  -H 'X-Mock-Project: demo' \
  -H 'X-Mock-Environment: development' \
  -H 'X-Mock-Feature: agreements'
```

The header is optional for routes unique among enabled features. If more than
one enabled feature contains the same method and path, omitting the header
returns **409 Conflict** with instructions to set `X-Mock-Feature`. Feature
selection happens before scenario matching; conditions or scenario overrides
do not resolve feature ambiguity. Unknown or paused features return **404**;
malformed feature identifiers return **400**.

Duplicate method/path pairs are allowed across features, but not within one
feature. Endpoint IDs remain unique within a project to keep counters, resets,
and logs isolated. Requests rejected for ambiguous or missing features do not
consume attempts. Try request automatically targets the selected feature, and
Connect/curl examples include its header. New logs include the resolved feature
ID, and JavaScript scenarios can read it through `request.feature`.

## Request payload logs

Expand an entry under **Request logs** to inspect the client body, content type,
original byte count, request path, and session. Bodies are captured for matched
requests, including requests sent through **Try request**. JSON and text retain
their original formatting; binary bodies are displayed as base64.

Each log stores at most 64 KiB of body bytes and clearly marks truncation.
Matching still uses the full accepted request (the existing 1 MiB request limit
applies). Empty bodies and older entries without captured payloads are labeled
separately. Payloads follow the existing log retention: at most 10,000 entries
and seven days. Request headers are not captured.
