/**
 * TTS providers.
 *
 * - silentTTS: always-available fallback. Emits a silent audio clip sized to
 *   the text length so scene timing / muxing stays correct with NO API and NO
 *   spoken audio (captions-only experience). Default.
 * - openAITTS: OpenAI-compatible /audio/speech endpoint (env-gated). Works with
 *   any compatible, card-optional provider. NOT Google.
 *
 * Configure the spoken option via env:
 *   TTS_API_KEY, TTS_BASE_URL (default https://api.openai.com/v1),
 *   TTS_MODEL (default gpt-4o-mini-tts), TTS_VOICE (default alloy)
 */
import fs from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { TTSProvider } from "./types";

const pexec = promisify(execFile);

/** ~2.7 syllables/words per second speaking pace -> estimated seconds. */
function estimateSeconds(text: string): number {
  const hangul = (text.match(/[\uAC00-\uD7A3]/g) || []).length;
  const words = (text.match(/[A-Za-z]+/g) || []).length;
  const units = hangul + words * 1.4;
  return Math.max(1.2, Math.round((units / 3.2) * 100) / 100);
}

export const silentTTS: TTSProvider = {
  name: "silent",
  async synthesize(text, outPath) {
    const dur = estimateSeconds(text);
    await pexec("ffmpeg", [
      "-y",
      "-f", "lavfi",
      "-i", "anullsrc=r=44100:cl=stereo",
      "-t", String(dur),
      "-c:a", "libmp3lame", "-q:a", "9",
      outPath,
    ]);
    return outPath;
  },
};

export const openAITTS: TTSProvider = {
  name: "openai-compatible",
  async synthesize(text, outPath, voiceHint) {
    const apiKey = process.env.TTS_API_KEY?.trim();
    if (!apiKey) return silentTTS.synthesize(text, outPath, voiceHint);
    const baseUrl = (process.env.TTS_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
    const model = process.env.TTS_MODEL || "gpt-4o-mini-tts";
    const voice = process.env.TTS_VOICE || (voiceHint?.gender === "male" ? "onyx" : "alloy");
    try {
      const res = await fetch(`${baseUrl}/audio/speech`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, voice, input: text, response_format: "mp3" }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error(`TTS HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      fs.writeFileSync(outPath, buf);
      return outPath;
    } catch (err) {
      console.warn(`[tts] falling back to silent: ${(err as Error).message}`);
      return silentTTS.synthesize(text, outPath, voiceHint);
    }
  },
};

/** Pick TTS by env: spoken if TTS_API_KEY set, else silent (timing-only). */
export function selectTTSProvider(): TTSProvider {
  return process.env.TTS_API_KEY?.trim() ? openAITTS : silentTTS;
}
