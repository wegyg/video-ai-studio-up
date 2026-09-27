/**
 * LLM-backed plan provider (OpenAI-compatible Chat Completions).
 *
 * Works with any OpenAI-compatible, card-free endpoint — Groq, OpenRouter,
 * Cerebras, etc. (Google is intentionally NOT used.) Configure via env:
 *   LLM_API_KEY, LLM_BASE_URL (e.g. https://api.groq.com/openai/v1), LLM_MODEL
 *
 * The LLM decides the creative BEATS (subtitle, emphasis, narration, motion,
 * cta, caption, hashtags). We then assemble timings deterministically so the
 * validator's pacing/hook/CTA rules always hold — the model can't produce a
 * broken timeline. On ANY error or missing key we fall back to the template.
 */
import { z } from "zod";
import { MotionType, type EditPlan } from "../schema";
import type { PlanProvider } from "./types";
import { freePlanProvider } from "./free";

// The narrow, safe shape we ask the model for (no absolute timings).
const LlmBeat = z.object({
  role: z.enum(["hook", "problem", "cause", "solution", "transformation", "proof", "cta"]).optional(),
  subtitle: z.string().min(1),
  subtitle_emphasis: z.string().default(""),
  narration: z.string().default(""),
  motion: MotionType.default("none"),
  motion_text: z.string().default(""), // used by text_popup / cta button
});
const LlmResponse = z.object({
  beats: z.array(LlmBeat).min(3).max(9),
  cta_text: z.string().default("지금 확인하세요"),
  caption: z.string().default(""),
  hashtags: z.array(z.string()).default([]),
  thumbnail_text: z.string().default(""),
  music_mood: z.string().default("밝고 신뢰감 있는"),
  music_bpm: z.number().int().positive().default(100),
  voice_tone: z.string().default("밝고 신뢰감 있는"),
});

function llmConfig() {
  const apiKey = process.env.LLM_API_KEY?.trim();
  const baseUrl = (process.env.LLM_BASE_URL || "https://api.groq.com/openai/v1").replace(/\/$/, "");
  const model = process.env.LLM_MODEL || "llama-3.3-70b-versatile";
  return { apiKey, baseUrl, model };
}

export function llmAvailable(): boolean {
  return Boolean(process.env.LLM_API_KEY?.trim());
}

const SYSTEM = `You are a short-form (Reels/Shorts/TikTok) ad DIRECTOR.
Given a one-line brief, design a punchy vertical promo as a sequence of BEATS.
Rules:
- 5 to 7 beats, ordered: hook, problem, cause, solution, transformation, proof, cta (you may merge/skip to fit).
- The FIRST beat is a HOOK: a short question or curiosity line.
- Keep each subtitle short (a few words). Narration is one short spoken sentence (<= ~12 syllables).
- Choose a motion per beat from: zoom_punch, circle_highlight, arrow_highlight, text_popup, before_after_split, number_countup, ending_cta_card. The LAST beat MUST use ending_cta_card.
- subtitle_emphasis is a single word from the subtitle to highlight.
- NEVER use medical/absolute claims (치료/치유/재활/진단/처방/완치/100%/무조건/부작용 없/즉시 완화).
- Match the brief's language (Korean brief -> Korean copy).
Return STRICT JSON only, matching:
{"beats":[{"role":"hook","subtitle":"...","subtitle_emphasis":"...","narration":"...","motion":"zoom_punch","motion_text":""}],"cta_text":"...","caption":"...","hashtags":["#.."],"thumbnail_text":"...","music_mood":"...","music_bpm":100,"voice_tone":"..."}`;

async function callLLM(brief: string): Promise<z.infer<typeof LlmResponse>> {
  const { apiKey, baseUrl, model } = llmConfig();
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.8,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: `Brief: ${brief}\nReturn the JSON now.` },
      ],
    }),
    // node fetch: no timeout by default; guard with AbortController
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`LLM HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error("LLM returned empty content");
  const parsed = JSON.parse(content);
  return LlmResponse.parse(parsed);
}

/** Assemble deterministic timings around the LLM's creative beats. */
function assemble(
  llm: z.infer<typeof LlmResponse>,
  args: { brief: string; clipIds: string[]; ratio: EditPlan["format"]["ratio"]; durationSec: number; fps: number },
): EditPlan {
  const { clipIds, ratio, durationSec, fps } = args;
  const pick = (i: number) => clipIds[i % clipIds.length] ?? "placeholder";

  const beats = [...llm.beats];
  // ensure the final beat is a CTA card
  const last = beats[beats.length - 1];
  if (last.motion !== "ending_cta_card") last.motion = "ending_cta_card";

  const HOOK = 1.5;
  const CTA = 2.0;
  const middleCount = Math.max(1, beats.length - 2);
  let midLen = (durationSec - HOOK - CTA) / middleCount;
  midLen = Math.min(4, Math.max(2, midLen));

  const timeline = beats.map((b, i) => {
    const isHook = i === 0;
    const isCta = i === beats.length - 1;
    const len = isHook ? HOOK : isCta ? CTA : midLen;
    const start = i === 0 ? 0 : NaN; // filled below
    return { b, len, isHook, isCta, start };
  });
  let t = 0;
  const scenes = timeline.map(({ b, len }, i) => {
    const start = Math.round(t * 100) / 100;
    const end = Math.round((t + len) * 100) / 100;
    t = end;
    const params: Record<string, unknown> = {};
    if (b.motion === "text_popup") params.text = b.motion_text || b.subtitle;
    if (b.motion === "ending_cta_card") params.button = b.motion_text || llm.cta_text;
    if (b.motion === "circle_highlight" || b.motion === "arrow_highlight") {
      params.x = 0.5;
      params.y = 0.58;
    }
    if (b.motion === "number_countup") {
      params.from = 0;
      params.to = 1000;
      params.suffix = "+";
    }
    return {
      start,
      end,
      source_clip: pick(i),
      source_in: 0,
      speed: 1,
      narration: b.narration ?? "",
      subtitle: b.subtitle,
      subtitle_emphasis: b.subtitle_emphasis ?? "",
      motion: { type: b.motion, params },
      sfx: [{ at: 0, type: (i === 0 ? "riser" : i === timeline.length - 1 ? "pop" : "ding") as "riser" | "pop" | "ding" }],
    };
  });

  const total = scenes[scenes.length - 1].end;
  return {
    assumptions: [
      clipIds.length && clipIds[0] !== "placeholder"
        ? `업로드 클립 ${clipIds.length}개를 씬에 배치`
        : "소스 영상 미제공 → 플레이스홀더 배경",
      `LLM 디렉터(${llmConfig().model}) 초안, 타이밍은 규칙 기반 재조정`,
    ],
    format: { ratio, duration_sec: total, fps, caption_style: "bold-pop" },
    cut_ranges: [],
    timeline: scenes,
    music: {
      genre: "soft ambient / light pop",
      bpm: llm.music_bpm,
      mood: llm.music_mood,
      duck_db: -18,
      ai_prompt: `${llm.music_mood}, no vocals, royalty-free`,
    },
    voice: { gender: "neutral", age: "adult", tone: llm.voice_tone, speed: 1 },
    cta: { text: llm.cta_text, start: scenes[scenes.length - 1].start },
    caption: {
      text: llm.caption || `${args.brief} — 지금 확인해 보세요.`,
      hashtags: llm.hashtags.length ? llm.hashtags : ["#숏츠", "#릴스", "#홍보영상"],
    },
    thumbnail_text: llm.thumbnail_text || args.brief,
  } satisfies EditPlan;
}

export const llmPlanProvider: PlanProvider = {
  name: "llm",
  async generate(input) {
    const clipIds = input.clips.length ? input.clips.map((c) => c.id) : ["placeholder"];
    try {
      const llm = await callLLM(input.brief);
      return assemble(llm, {
        brief: input.brief,
        clipIds,
        ratio: input.ratio,
        durationSec: input.durationSec,
        fps: input.fps,
      });
    } catch (err) {
      // Any failure -> deterministic template plan (never breaks the pipeline).
      console.warn(`[llm] falling back to template: ${(err as Error).message}`);
      return freePlanProvider.generate(input);
    }
  },
};

/** Pick the best available plan provider given env. */
export function selectPlanProvider(): PlanProvider {
  return llmAvailable() ? llmPlanProvider : freePlanProvider;
}
