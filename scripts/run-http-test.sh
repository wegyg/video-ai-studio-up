#!/usr/bin/env bash
# Start the built Next.js server, run the HTTP e2e test, then shut it down.
set -e
cd "$(dirname "$0")/.."

# make a small test clip so we exercise the footage-composite path
mkdir -p tmp out
ffmpeg -y -f lavfi -i "testsrc=size=720x1280:rate=30:duration=4" -pix_fmt yuv420p tmp/http-clip.mp4 >/dev/null 2>&1 || true

PORT=3000
node node_modules/next/dist/bin/next start -p "$PORT" > out/server.log 2>&1 &
SRV=$!

# wait for readiness
for i in $(seq 1 30); do
  if curl -sf "http://127.0.0.1:$PORT" >/dev/null 2>&1; then break; fi
  sleep 1
done

set +e
node scripts/test-http.mjs
RC=$?
kill "$SRV" 2>/dev/null
wait "$SRV" 2>/dev/null
exit $RC
