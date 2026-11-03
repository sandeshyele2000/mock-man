.PHONY: infra dev build test generate e2e
infra:
	docker compose up -d --wait

dev:
	go -C backend run ./cmd/mockman

build:
	npm run build

test:
	go -C backend test -race ./...

generate:
	npm --prefix frontend run generate

e2e:
	npm --prefix frontend run test:e2e
