#!/bin/sh
set -eu

# Serialize public settings as JSON; do not interpolate environment values into JS.
{
  printf 'window.__MOCKMAN_CONFIG__ = '
  jq -n --arg apiURL "${ADMIN_ORIGIN:?ADMIN_ORIGIN is required}" \
    --arg mockURL "${MOCK_ORIGIN:?MOCK_ORIGIN is required}" \
    '{apiURL: $apiURL, mockURL: $mockURL}'
  printf ';\n'
} > /usr/share/nginx/html/runtime-config.js
