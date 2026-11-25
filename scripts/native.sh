#!/bin/sh
# Build on the source machine; copy release/ to the target Mac and run ./run.sh.
set -eu
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
case "${1:-run}" in
  build)
    project_dir=$(dirname "$script_dir")
    cd "$project_dir"
    npm --prefix frontend ci
    npm --prefix frontend run build
    rm -rf backend/internal/dashboard/dist
    cp -R frontend/dist backend/internal/dashboard/dist
    mkdir -p release
    CGO_ENABLED=0 go -C backend build -tags dashboard -trimpath -ldflags='-s -w' -o ../release/mockman ./cmd/mockman
    cp scripts/native.sh release/run.sh
    cp deploy/native.env.example release/.env.example
    chmod +x release/run.sh
    printf '%s\n' 'Built release/. Copy it to the target host, configure .env, then run ./run.sh.'
    ;;
  run)
    if [ -x "$script_dir/mockman" ]; then
      cd "$script_dir"
    else
      cd "$script_dir/../release"
    fi
    if [ ! -f .env ]; then
      printf '%s\n' 'Create .env from .env.example and configure PostgreSQL/public URLs first.' >&2
      exit 1
    fi
    exec ./mockman
    ;;
  *) printf '%s\n' 'Usage: native.sh build | run' >&2; exit 1 ;;
esac
