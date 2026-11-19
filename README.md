# Mockman

## Run published images (no source checkout)

Copy `compose.release.yaml` and `.env.release.example` to a deployment folder on
the host. Install and start Docker, then copy `.env.release.example` to `.env`.
Set `PUBLIC_HOST` to the host's VPN hostname/IP and choose the published ports.
`MOCKMAN_VERSION` selects the backend/dashboard image tag (initially `1.0.0`).

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
