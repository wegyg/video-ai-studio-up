#!/usr/bin/env bash
set -e
cd "$(dirname "$0")/.."
mkdir -p out
node node_modules/next/dist/bin/next start -p 3000 > out/server.log 2>&1 &
SRV=$!
for i in $(seq 1 30); do
  if curl -sf "http://127.0.0.1:3000" >/dev/null 2>&1; then break; fi
  sleep 1
done
set +e
node scripts/test-editflow.mjs
RC=$?
kill "$SRV" 2>/dev/null
wait "$SRV" 2>/dev/null
exit $RC
