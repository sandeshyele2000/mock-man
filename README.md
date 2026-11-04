# Mockman

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

By default, the ports bind to localhost. To let other devices on your LAN use
the app, set `BIND_ADDRESS=0.0.0.0` and set `ADMIN_ORIGIN`, `DASHBOARD_ORIGIN`,
and `MOCK_ORIGIN` in `.env` to URLs using the host's LAN name or IP, then rebuild
the dashboard with `docker compose up --build -d`. Set
`MOCK_ALLOWED_ORIGINS` to the browser app origins that should call mock routes.
The admin API has no user authentication, so keep it on a trusted network.

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

Configure the root `.env` using `.env.example`. The backend reads `ADMIN_ADDR`,
`ADMIN_ORIGIN`, `DASHBOARD_ORIGIN`, and `MOCK_ADDR`. The frontend and dev launcher
use the same settings; mock URLs, curl examples, labels, and the Vite port update
together. `MOCK_ORIGIN` optionally overrides the advertised mock URL when the
listen address differs from the reachable address.

Browser-only overrides are `VITE_API_URL` and `VITE_MOCK_URL`. These values are
public and embedded at build time. Restart development servers after editing
`.env`, or rebuild for production. Go defaults live in
`backend/internal/config/config.go`; frontend toolchain defaults live in
`scripts/config.mjs`. Keep those defaults aligned when changing defaults.
