/**
 * Provider adapter interfaces. Every external-AI stage (transcription, plan
 * generation, voice) is expressed as an interface with a FREE default impl, so
 * the whole pipeline runs with zero API keys. Paid providers can be dropped in
 * later without touching the pipeline.
 */
import type { EditPlan } from "../schema";

export interface SourceClipInfo {
  id: string; // stable id used as source_clip in the plan
  path: string; // absolute path to the uploaded footage
  durationSec: number;
  width: number;
  height: number;
}

export interface Transcript {
  clipId: string;
  text: string;
  // optional word/segment timings (empty for the free no-STT path)
  segments: { start: number; end: number; text: string }[];
}

/** Speech-to-text over the uploaded footage. Free default returns empty text. */
export interface STTProvider {
  name: string;
  transcribe(clip: SourceClipInfo): Promise<Transcript>;
}

/** Turns (brief + clips + transcripts) into an edit-plan JSON. */
export interface PlanProvider {
  name: string;
  generate(input: {
    brief: string;
    clips: SourceClipInfo[];
    transcripts: Transcript[];
    ratio: EditPlan["format"]["ratio"];
    durationSec: number;
    fps: number;
    reference?: string; // extracted homepage/notes text to tailor the promo
  }): Promise<EditPlan>;
}

/** Narration synthesis. Free default is a no-op (silent / captions-only). */
export interface TTSProvider {
  name: string;
  synthesize(text: string, outPath: string, voiceHint: EditPlan["voice"]): Promise<string | null>;
}
