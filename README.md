# Mockman

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
