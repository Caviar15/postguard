#!/usr/bin/env bash
# Signed-in dashboard tests against the production build and a mocked Buffer API.
# Requires `npm run build` first. Does not call Buffer or production.
set -euo pipefail
cd "$(dirname "$0")/.."
export SESSION_SECRET=e2e-secret-e2e-secret-e2e-secret-1234
export BUFFER_CLIENT_ID=e2e
export BUFFER_CLIENT_SECRET=e2e
export NODE_OPTIONS="--require $(pwd)/e2e-local/mock-buffer.cjs"
echo '{}' > /tmp/pg-scenario.json
: > /tmp/pg-mock.log
npx next start -p 3100 > /tmp/pg-next.log 2>&1 &
SERVER=$!
cleanup() { kill "$SERVER" 2>/dev/null || true; }
trap cleanup EXIT
for _ in $(seq 1 40); do
  curl -sf -o /dev/null http://127.0.0.1:3100/privacy && break
  sleep 0.5
done
unset NODE_OPTIONS
npx playwright test -c e2e-local/playwright.local.config.ts "$@"
