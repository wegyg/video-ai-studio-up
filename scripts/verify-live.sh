#!/usr/bin/env bash
# Run the built Docker image and verify the live container end-to-end over HTTP.
set -e
cd "$(dirname "$0")/.."
mkdir -p out

CID=$(docker run -d -p 3000:3000 -e RENDER_CONCURRENCY=2 shorts-director:live)
echo "container: $CID"
cleanup() { docker rm -f "$CID" >/dev/null 2>&1 || true; }
trap cleanup EXIT

for i in $(seq 1 40); do
  if curl -sf "http://127.0.0.1:3000" >/dev/null 2>&1; then echo "server up"; break; fi
  sleep 1
done

# 1) plan
echo "POST /api/plan"
PLAN=$(curl -s -X POST http://127.0.0.1:3000/api/plan \
  -F "brief=여름 세일 홍보 도커 검증" -F "ratio=9:16" -F "duration=16")
PLAN_ID=$(echo "$PLAN" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).planId))")
echo "planId: $PLAN_ID"

# 2) render (send the plan back verbatim)
echo "POST /api/render"
JOB=$(echo "$PLAN" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const d=JSON.parse(s);process.stdout.write(JSON.stringify({planId:d.planId,plan:d.plan}));})" \
  | curl -s -X POST http://127.0.0.1:3000/api/render -H "Content-Type: application/json" --data-binary @-)
JOB_ID=$(echo "$JOB" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).id))")
echo "jobId: $JOB_ID"

# 3) poll (allow time for first-render Chromium download)
LAST=""
for i in $(seq 1 180); do
  sleep 2
  ST=$(curl -s http://127.0.0.1:3000/api/jobs/$JOB_ID)
  MSG=$(echo "$ST" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const d=JSON.parse(s);console.log(d.status+' '+d.progress+'% '+(d.message||''))})")
  [ "$MSG" != "$LAST" ] && echo "  $MSG" && LAST="$MSG"
  echo "$ST" | grep -q '"status":"done"' && {
    curl -s http://127.0.0.1:3000/api/jobs/$JOB_ID/video -o out/live-result.mp4
    curl -s http://127.0.0.1:3000/api/jobs/$JOB_ID/thumbnail -o out/live-thumb.png
    echo "VIDEO_BYTES=$(stat -c%s out/live-result.mp4)"
    echo "THUMB_BYTES=$(stat -c%s out/live-thumb.png)"
    exit 0
  }
  echo "$ST" | grep -q '"status":"error"' && { echo "JOB ERROR: $ST"; docker logs "$CID" 2>&1 | tail -20; exit 1; }
done
echo "TIMED OUT"; docker logs "$CID" 2>&1 | tail -20; exit 1
