/**
 * Edit-Plan JSON schema — the contract of ShortsDirector.
 *
 * The AI "director" outputs a plan matching this schema; the validator checks
 * it; the Remotion renderer consumes it. Everything downstream depends on this
 * shape, so it is defined once here with zod (runtime validation + TS types).
 */
import { z } from "zod";

// --- Format ----------------------------------------------------------------
export const AspectRatio = z.enum(["9:16", "1:1", "16:9"]);
export type AspectRatio = z.infer<typeof AspectRatio>;

export const Format = z.object({
  ratio: AspectRatio.default("9:16"),
  duration_sec: z.number().positive().max(180).default(20),
  fps: z.number().int().positive().max(60).default(30),
});
export type Format = z.infer<typeof Format>;

// --- Motion graphics presets (rendered by Remotion) ------------------------
export const MotionType = z.enum([
  "none",
  "zoom_punch", // quick scale-in emphasis on a subject
  "circle_highlight", // animated ring around a region
  "arrow_highlight", // arrow pointing to a region
  "text_popup", // a label pops onto screen
  "before_after_split", // split screen wipe
  "number_countup", // animated counter
  "ending_cta_card", // full CTA card with button
]);
export type MotionType = z.infer<typeof MotionType>;

export const Motion = z.object({
  type: MotionType.default("none"),
  // free-form params interpreted per motion type (target, text, from/to, etc.)
  params: z.record(z.any()).default({}),
});
export type Motion = z.infer<typeof Motion>;

// --- Sound effects ---------------------------------------------------------
export const SfxType = z.enum(["whoosh", "pop", "ding", "riser", "click"]);
export const Sfx = z.object({
  at: z.number().min(0), // seconds, relative to scene start
  type: SfxType,
});
export type Sfx = z.infer<typeof Sfx>;

// --- A cut range to remove from a source clip ------------------------------
export const CutRange = z.object({
  source_clip: z.string().optional(), // which clip; omit for global
  start: z.number().min(0),
  end: z.number().min(0),
  reason: z.string().default(""),
});
export type CutRange = z.infer<typeof CutRange>;

// --- One scene in the timeline --------------------------------------------
export const Scene = z.object({
  start: z.number().min(0), // absolute timeline seconds
  end: z.number().min(0),
  source_clip: z.string(), // id/name of the footage to show (or a placeholder)
  source_in: z.number().min(0).optional(), // in-point within the source clip
  speed: z.number().positive().default(1),
  narration: z.string().default(""), // spoken line (may be empty)
  subtitle: z.string().default(""), // on-screen caption
  subtitle_emphasis: z.string().default(""), // word within subtitle to highlight
  motion: Motion.default({ type: "none", params: {} }),
  sfx: z.array(Sfx).default([]),
});
export type Scene = z.infer<typeof Scene>;

// --- Audio -----------------------------------------------------------------
export const Music = z.object({
  genre: z.string().default("soft ambient"),
  bpm: z.number().int().positive().default(90),
  mood: z.string().default("neutral"),
  duck_db: z.number().default(-18), // how much to duck under narration
  ai_prompt: z.string().default(""), // hint for a music generator (optional)
});
export type Music = z.infer<typeof Music>;

export const Voice = z.object({
  gender: z.enum(["female", "male", "neutral"]).default("neutral"),
  age: z.string().default("adult"),
  tone: z.string().default("calm"),
  speed: z.number().positive().default(1),
});
export type Voice = z.infer<typeof Voice>;

// --- Publish metadata ------------------------------------------------------
export const Cta = z.object({
  text: z.string(),
  start: z.number().min(0), // when the CTA appears (seconds)
});
export type Cta = z.infer<typeof Cta>;

export const Caption = z.object({
  text: z.string().default(""),
  hashtags: z.array(z.string()).default([]),
});
export type Caption = z.infer<typeof Caption>;

// --- The full Edit Plan ----------------------------------------------------
export const EditPlan = z.object({
  assumptions: z.array(z.string()).default([]),
  format: Format,
  cut_ranges: z.array(CutRange).default([]),
  timeline: z.array(Scene).min(1),
  music: Music.default({}),
  voice: Voice.default({}),
  cta: Cta,
  caption: Caption.default({ text: "", hashtags: [] }),
  thumbnail_text: z.string().default(""),
});
export type EditPlan = z.infer<typeof EditPlan>;

/** Parse + fill defaults, throwing zod errors on invalid input. */
export function parseEditPlan(input: unknown): EditPlan {
  return EditPlan.parse(input);
}

/** Safe parse variant returning success/error without throwing. */
export function safeParseEditPlan(input: unknown) {
  return EditPlan.safeParse(input);
}
