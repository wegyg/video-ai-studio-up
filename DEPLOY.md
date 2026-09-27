# Deploying ShortsDirector

ShortsDirector renders video **on the server** (headless Chromium via Remotion +
FFmpeg). That shapes where it can run.

## TL;DR
- ✅ **Self-host** (a VM / container / any always-on Node host) — recommended.
- ⚠️ **Vercel / serverless** — the UI and `/api/plan` work, but full renders are
  a poor fit (no FFmpeg, no Chromium, short timeouts, ephemeral disk). Use a
  separate render worker if you want Vercel for the front end.

---

## Option A — Docker (recommended)

The included `Dockerfile` bundles Node 22, FFmpeg, Chromium runtime libs, and
Noto CJK fonts (for Korean captions).

```bash
docker build -t shorts-director .
docker run -p 3000:3000 -v $(pwd)/data:/data shorts-director
# open http://localhost:3000
```

- Rendered files + job working dirs go to `/data` (mount a volume to persist).
- Add optional keys with `-e LLM_API_KEY=... -e TTS_API_KEY=...` (see `.env.example`).

Works on any Docker host: Fly.io, Render, Railway, a plain VM, etc.

## Option B — Bare VM / any Node host

Requirements on the host:
- Node 18+ and **FFmpeg** on `PATH`
- A CJK-capable font (e.g. `fonts-noto-cjk`) for Korean captions
- Enough CPU/RAM for Chromium (2 vCPU / 2 GB is comfortable for short clips)

```bash
npm ci
npm run build
SD_WORK_DIR=/var/data/shorts-director npm run start   # http://localhost:3000
```

First render downloads Remotion's headless Chromium shell automatically.

## Option C — Vercel (front end only)

`npm run build` succeeds and the UI + `/api/plan` deploy fine, but **rendering
on Vercel is not supported** here (no FFmpeg binary, serverless function limits,
ephemeral `/tmp`). If you want Vercel for the UI:

1. Deploy this app to Vercel for the interface + plan generation.
2. Run the **render** on a separate always-on worker (Option A/B) and point
   `/api/render` at it (e.g. a small queue + the same `renderPlan()`).

---

## Environment

All optional — the app runs free/local with none set. See `.env.example`:
- `LLM_API_KEY` / `LLM_BASE_URL` / `LLM_MODEL` — smarter scripts (Groq/OpenRouter/Cerebras; not Google)
- `TTS_API_KEY` / `TTS_BASE_URL` / `TTS_MODEL` / `TTS_VOICE` — spoken narration
- `MUSIC_ENABLED` — background music on/off (default on)
- `RATIO` / `DURATION_SEC` / `FPS` — render defaults
- `SD_WORK_DIR` — where outputs are written (default: OS temp)

## Scaling notes
- Rendering is CPU-bound; run one render per core or add a queue for concurrency.
- The in-memory job store (`src/server/jobs.ts`) is per-process. For multiple
  instances, back it with Redis/DB and store outputs in shared/object storage.
