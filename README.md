# 🎬 ShortsDirector

**Your footage + a one-line brief → a movie-CF-style vertical short.**

Upload your own video clips (or none) and a single line describing the promo.
An AI "director" produces a structured **edit-plan JSON**, a validator enforces
short-form best-practices, and the plan is rendered to a 9:16 MP4 with animated
captions, motion graphics, and a CTA — **fully free, with zero external APIs by
default**.

> No API keys. No credit card. No bill surprises. Paid providers (better
> scripts / voice) are optional add-ons behind adapters.

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

```bash
npm install

# From a one-line brief only (placeholder backgrounds):
npx tsx scripts/generate.ts "여름 세일 홍보" out/promo.mp4

# With your own footage (Google-Drive downloads work too — just pass the files):
npx tsx scripts/generate.ts "발가락 교정 발건강 관리" out/promo.mp4 clipA.mp4 clipB.mp4

# Render the built-in sample plan:
npx tsx scripts/render-sample.ts out/sample.mp4

# Preview/iterate in the Remotion studio:
npm run remotion:studio
```

### Requirements
- Node 18+ and **FFmpeg** on PATH
- A CJK-capable font (e.g. Noto Sans CJK) for Korean captions

---

## Rendering notes
- **No footage** → Remotion renders the full video (placeholder gradient
  backgrounds).
- **With footage** → Remotion renders a **transparent overlay** (captions +
  motion) and **FFmpeg** composites it over your normalized clips. This hybrid
  path avoids Remotion's bundled video compositor (which needs a newer GLIBC
  than some hosts provide) and is robust everywhere FFmpeg runs.

---

## Optional paid providers (off by default)
Set keys in `.env` to upgrade individual stages — the pipeline runs without any
of them. See `.env.example`. Adapters live behind `src/providers/` so nothing
in the pipeline changes when you add a key.

## Project layout
```
src/
  schema.ts          edit-plan JSON (zod)
  validate.ts        5 checks + banned-words filter
  pipeline.ts        ingest → plan → validate → render
  probe.ts           ffprobe helper
  providers/         STT / Plan / TTS adapters (free defaults)
  fixtures/          sample edit plan
remotion/
  Root.tsx, index.ts composition registration
  PlanVideo.tsx      plan → timeline of scenes
  components/        SceneBackground, Subtitle, Motion
scripts/
  generate.ts        run the full pipeline (CLI)
  render-sample.ts   render the sample plan
```

## License
MIT
