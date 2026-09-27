/**
 * Free, API-free provider implementations. These make the whole pipeline run
 * with zero keys / zero cost.
 */
import type { EditPlan, Scene } from "../schema";
import type { PlanProvider, STTProvider, TTSProvider, Transcript } from "./types";

// --- STT: no-op (no transcription without an API). -------------------------
export const freeSTT: STTProvider = {
  name: "none",
  async transcribe(clip) {
    return { clipId: clip.id, text: "", segments: [] } satisfies Transcript;
  },
};

// --- TTS: no-op (captions-only; no spoken audio without an API). -----------
export const freeTTS: TTSProvider = {
  name: "none",
  async synthesize() {
    return null; // null => pipeline renders captions/music without narration audio
  },
};

// --- Plan generator: template "director" following CF best-practices. ------
// Structure: Hook -> Problem -> Cause -> Solution -> Transformation -> Proof -> CTA
// Scenes are distributed across the uploaded clips (round-robin). Copy is
// derived from the one-line brief; motions are assigned per beat.
export const freePlanProvider: PlanProvider = {
  name: "template",
  async generate({ brief, clips, ratio, durationSec, fps }) {
    const subject = brief.trim() || "우리 제품";
    const clipIds = clips.length ? clips.map((c) => c.id) : ["placeholder"];
    const pick = (i: number) => clipIds[i % clipIds.length];

    // Beat definitions: label, subtitle, emphasis, narration, motion.
    const beats: Array<Omit<Scene, "start" | "end" | "source_clip" | "speed" | "sfx"> & {
      sfx: Scene["sfx"];
    }> = [
      {
        subtitle: `${subject}, 이거 보셨나요?`,
        subtitle_emphasis: "보셨나요",
        narration: "",
        motion: { type: "zoom_punch", params: { scale: 1.15 } },
        sfx: [{ at: 0, type: "riser" }],
      },
      {
        subtitle: "이런 고민 있으셨죠",
        subtitle_emphasis: "고민",
        narration: `${subject}, 이런 점이 아쉬우셨죠.`,
        motion: { type: "circle_highlight", params: { x: 0.5, y: 0.6 } },
        sfx: [{ at: 0, type: "whoosh" }],
      },
      {
        subtitle: "핵심은 여기",
        subtitle_emphasis: "핵심",
        narration: "핵심은 바로 여기에 있습니다.",
        motion: { type: "arrow_highlight", params: { x: 0.5, y: 0.55 } },
        sfx: [{ at: 0, type: "ding" }],
      },
      {
        subtitle: `${subject}의 해답`,
        subtitle_emphasis: "해답",
        narration: `${subject}, 이렇게 달라집니다.`,
        motion: { type: "text_popup", params: { text: subject } },
        sfx: [{ at: 0, type: "pop" }],
      },
      {
        subtitle: "확실한 변화",
        subtitle_emphasis: "변화",
        narration: "직접 확인해 보세요.",
        motion: { type: "before_after_split", params: {} },
        sfx: [{ at: 0, type: "riser" }],
      },
      {
        subtitle: "많은 분들의 선택",
        subtitle_emphasis: "선택",
        narration: "이미 많은 분들이 함께하고 있습니다.",
        motion: { type: "number_countup", params: { from: 0, to: 1000, suffix: "+" } },
        sfx: [{ at: 0, type: "ding" }],
      },
      {
        subtitle: "지금 확인하세요",
        subtitle_emphasis: "지금",
        narration: "지금 프로필 링크를 확인하세요.",
        motion: { type: "ending_cta_card", params: { button: "지금 확인" } },
        sfx: [{ at: 0, type: "pop" }],
      },
    ];

    // Time budget: hook 1.5s, CTA 2s, the rest split across middle beats,
    // each capped at 4s (validator rule 3).
    const HOOK = 1.5;
    const CTA = 2.0;
    const middle = beats.length - 2;
    let midLen = (durationSec - HOOK - CTA) / middle;
    midLen = Math.min(4, Math.max(2, midLen));

    const timeline: Scene[] = [];
    let t = 0;
    beats.forEach((b, i) => {
      const isHook = i === 0;
      const isCta = i === beats.length - 1;
      const len = isHook ? HOOK : isCta ? CTA : midLen;
      const start = i === 0 ? 0 : t;
      const end = Math.round((start + len) * 100) / 100;
      timeline.push({
        start: Math.round(start * 100) / 100,
        end,
        source_clip: pick(i),
        source_in: 0,
        speed: 1,
        narration: b.narration,
        subtitle: b.subtitle,
        subtitle_emphasis: b.subtitle_emphasis,
        motion: b.motion,
        sfx: b.sfx,
      });
      t = end;
    });

    const total = timeline[timeline.length - 1].end;

    const plan: EditPlan = {
      assumptions: [
        clips.length
          ? `업로드된 ${clips.length}개 클립을 씬에 순차 배치`
          : "소스 영상 미제공 → 플레이스홀더 배경 사용",
        `${ratio} ${total}s, 무료 템플릿 디렉터(외부 API 미사용)`,
      ],
      format: { ratio, duration_sec: total, fps, caption_style: "bold-pop" },
      cut_ranges: [],
      timeline,
      music: {
        genre: "soft ambient / light pop",
        bpm: 100,
        mood: "밝고 신뢰감 있는",
        duck_db: -18,
        ai_prompt: "upbeat but gentle, hopeful, no vocals, royalty-free",
      },
      voice: { gender: "neutral", age: "adult", tone: "밝고 신뢰감 있는", speed: 1 },
      cta: { text: "지금 프로필 링크를 확인하세요", start: timeline[timeline.length - 1].start },
      caption: {
        text: `${subject} — 지금 확인해 보세요.`,
        hashtags: ["#숏츠", "#릴스", "#홍보영상"],
      },
      thumbnail_text: `${subject}`,
    };

    return plan;
  },
};
