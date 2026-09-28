# 🎬 ShortsDirector

**Your footage + a one-line brief → a movie-CF-style vertical short.**

Upload your own video clips (or none) and a single line describing the promo.
An AI "director" produces a structured **edit-plan JSON**, a validator enforces
short-form best-practices, and the plan is rendered to a 9:16 / 1:1 / 16:9 MP4
with animated captions, motion graphics, background music, a narration track and
a CTA — **fully free, with zero external APIs by default**.

> No API keys. No credit card. No bill surprises. Paid providers (smarter
> scripts / spoken voice) are optional add-ons behind adapters. Google APIs are
> intentionally not used.

## Features
- 🎬 **Footage + one line → finished short** (drag-and-drop web UI or CLI)
- 🤖 **Smarter scripts** — optional free LLM (Groq/OpenRouter/Cerebras) writes
  tailored beats; deterministic template fallback with no key
- ✍️ **Animated captions** — word-by-word pop-in with emphasis highlighting
- 🎞️ **7 motion presets** — zoom punch, highlights, text pop, before/after,
  count-up, CTA card
- 🎵 **Background music** — procedural tone-aware bed (no files) or your own
  tracks, sidechain-ducked under narration
- 🔊 **Narration** — optional spoken voice (OpenAI-compatible TTS); silent
  timing track by default
- ✂️ **Review & Edit** — tweak scene text / order / duration / motion before
  rendering
- 📐 **9:16 / 1:1 / 16:9** outputs
- ✅ **Quality gate** — 5 self-checks + banned-words auto-filter

---

## How it works

```
video clips + one-line brief
        │
   ┌────▼─────┐   ffprobe
   │  ingest  │   inspect each clip
   └────┬─────┘
   ┌────▼─────┐   STT adapter (free = skip)
   │transcribe│
   └────┬─────┘
   ┌────▼─────┐   PlanProvider (free = template "director")
   │   plan   │   → edit-plan JSON (schema.ts)
   └────┬─────┘
   ┌────▼─────┐   5 self-checks + banned-words filter (+ auto-fix)
   │ validate │
   └────┬─────┘
   ┌────▼─────┐   Remotion (captions + motion) + FFmpeg (footage composite)
   │  render  │   → 9:16 MP4
   └──────────┘
```

### The edit-plan JSON (the contract)
Everything flows through one typed object (`src/schema.ts`, zod-validated):
`format`, `cut_ranges`, `timeline[]` (each scene: `source_clip`, `narration`,
`subtitle` + `subtitle_emphasis`, `motion`, `sfx`), `music`, `voice`, `cta`,
`caption`, `thumbnail_text`.

### The validator (quality gate) — `src/validate.ts`
1. **Hook** ends by ~1.5s and asks a question / sparks curiosity
2. **Narration pace** ≤ ~6 Korean syllables/sec (error if exceeded)
3. **Scene length** ≤ ~4s and each scene carries motion (no dead static shots)
4. **Banned words** auto-removed (치료/치유/재활/진단/처방/완치/100%/무조건 …)
5. **CTA** appears within the last ~2s

### Motion presets (Remotion)
`zoom_punch`, `circle_highlight`, `arrow_highlight`, `text_popup`,
`before_after_split`, `number_countup`, `ending_cta_card`.

---

## Usage

### Web app (recommended)
```bash
npm install
npm run build && npm start          # http://localhost:3000
```
In the browser: drop your clips, type a one-line brief, then either
**Quick Generate** (one shot) or **Review & Edit** (tweak the plan first).

### 🖥️ Desktop app (runs on your computer — fastest, no cloud limits)
The same app wrapped in Electron. It boots the Next.js server in-process and
opens a native window; **FFmpeg is bundled** (via `ffmpeg-static`), so nothing
needs to be installed system-wide. All rendering uses your own CPU — no server,
no memory limits, no bill.

```bash
npm install

# Run the desktop app locally (builds the web bundle, then launches Electron):
npm run electron:dev

# Build a distributable installer for your OS:
npm run dist:win     # Windows  -> dist-desktop/*.exe (NSIS installer)
npm run dist:mac     # macOS    -> dist-desktop/*.dmg
npm run dist:linux   # Linux    -> dist-desktop/*.AppImage
```

- Free by default; add optional `LLM_*` / `TTS_*` env vars for smarter scripts /
  spoken voice (same dual free/premium model as the web app).
- On first launch the app fetches Remotion's small headless Chromium once.
- Cross-platform installers are best built **on that OS** (build the Windows
  `.exe` on Windows, the `.dmg` on macOS, etc.).

### CLI
```bash
# From a one-line brief only (placeholder backgrounds):
npx tsx scripts/generate.ts "여름 세일 홍보" out/promo.mp4

# With your own footage (Google-Drive downloads work too — just pass the files):
npx tsx scripts/generate.ts "발가락 교정 발건강 관리" out/promo.mp4 clipA.mp4 clipB.mp4

# Render the built-in sample plan / open the Remotion studio:
npx tsx scripts/render-sample.ts out/sample.mp4
npm run remotion:studio
```

### API (two-step edit flow)
- `POST /api/plan` — multipart (`brief`, `ratio`, `duration`, `videos`) → editable EditPlan JSON
- `POST /api/render` — JSON (`{ planId, plan }`) → `{ id }`, poll `GET /api/jobs/:id`, fetch `GET /api/jobs/:id/video`
- `POST /api/generate` — one-shot (plan + render) → `{ id }`

### Requirements
- Node 18+ and **FFmpeg** on PATH
- A CJK-capable font (e.g. Noto Sans CJK) for Korean captions
- See **[DEPLOY.md](./DEPLOY.md)** for Docker / self-host / Vercel guidance

---

## Rendering notes
- **No footage** → Remotion renders the full video (placeholder gradient
  backgrounds).
- **With footage** → Remotion renders a **transparent overlay** (captions +
  motion) and **FFmpeg** composites it over your normalized clips. This hybrid
  path avoids Remotion's bundled video compositor (which needs a newer GLIBC
  than some hosts provide) and is robust everywhere FFmpeg runs.

---

## Optional upgrades (off by default, never surprise-bill)
Set keys in `.env` to upgrade individual stages — the pipeline runs fully
without any of them. On any error/missing key each stage falls back to its free
path. See `.env.example`.

| Stage | Free default | Optional upgrade |
|-------|--------------|------------------|
| Script | template director | free LLM: Groq / OpenRouter / Cerebras (`LLM_*`) |
| Narration | silent timing track | OpenAI-compatible TTS (`TTS_*`) |
| Music | procedural bed / `assets/music/` | your own tracks in `assets/music/` |

## Project layout
```
src/
  schema.ts          edit-plan JSON (zod)
  validate.ts        5 checks + banned-words filter
  pipeline.ts        generatePlan() + renderPlan() + runPipeline()
  probe.ts           ffprobe helper
  audio.ts           narration track build + mux (sidechain duck)
  music.ts           procedural bed + local track resolver
  providers/         STT / Plan(llm+template) / TTS adapters
  server/jobs.ts     in-memory job store (progress)
  fixtures/          sample edit plan
remotion/            Root, PlanVideo, components (SceneBackground/Subtitle/Motion)
app/                 Next.js UI (page + PlanEditor) + API routes
                       /api/plan, /api/render, /api/generate, /api/jobs/[id]
scripts/             generate.ts, render-sample.ts, e2e test harnesses
Dockerfile, DEPLOY.md
```

## License
MIT
