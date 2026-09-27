/**
 * Edit-Plan validator — the quality gate of ShortsDirector.
 *
 * Enforces the 5 self-checks from the spec plus a banned-words filter, and
 * applies safe auto-fixes where possible. Returns the (possibly fixed) plan,
 * a pass/fail flag, and human-readable issues.
 *
 * The 5 checks:
 *  1. Hook (0–1.5s): first scene should end by ~1.5s and use a question /
 *     curiosity subtitle.
 *  2. Narration pace: <= ~6 Korean syllables per second per scene.
 *  3. Scene length: each scene <= ~4s and should carry some motion (no dead
 *     static shots).
 *  4. Banned words: no medical/absolute claims
 *     (치료/치유/재활/진단/처방/완치/100%/무조건 ...).
 *  5. CTA: appears within the last ~2 seconds.
 */
import type { EditPlan, Scene } from "./schema";

export type Severity = "error" | "warning" | "fixed";

export interface Issue {
  check: string;
  severity: Severity;
  message: string;
  sceneIndex?: number;
}

export interface ValidationResult {
  plan: EditPlan; // possibly auto-fixed
  ok: boolean; // true if no remaining errors
  issues: Issue[];
}

// Words that imply medical treatment or absolute guarantees — not allowed in
// promotional copy. Extend as needed.
export const BANNED_WORDS = [
  "치료",
  "치유",
  "재활",
  "진단",
  "처방",
  "완치",
  "100%",
  "무조건",
  "부작용 없",
  "즉시 완화",
];

const HOOK_MAX_SEC = 1.5;
const SCENE_MAX_SEC = 4.0;
const SYLLABLES_PER_SEC_MAX = 6;
const CTA_WINDOW_SEC = 2.0;
const QUESTION_HINTS = ["?", "？", "까요", "나요", "을까", "ㄹ까", "실까"];

/** Rough Korean syllable count: Hangul syllable block chars + word count for latin. */
function syllableCount(text: string): number {
  const hangul = (text.match(/[\uAC00-\uD7A3]/g) || []).length;
  // count latin "words" as ~1.5 syllables each so English lines aren't underpenalized
  const latinWords = (text.match(/[A-Za-z]+/g) || []).length;
  return hangul + Math.ceil(latinWords * 1.5);
}

function looksLikeQuestion(text: string): boolean {
  return QUESTION_HINTS.some((h) => text.includes(h));
}

/** Strip banned words from a string, returning the cleaned string. */
function stripBanned(text: string): { cleaned: string; hits: string[] } {
  let cleaned = text;
  const hits: string[] = [];
  for (const w of BANNED_WORDS) {
    if (cleaned.includes(w)) {
      hits.push(w);
      cleaned = cleaned.split(w).join(""); // remove occurrences
    }
  }
  cleaned = cleaned.replace(/\s{2,}/g, " ").trim();
  return { cleaned, hits };
}

export function validatePlan(input: EditPlan): ValidationResult {
  // deep clone so auto-fixes don't mutate the caller's object
  const plan: EditPlan = JSON.parse(JSON.stringify(input));
  const issues: Issue[] = [];
  const totalDuration = plan.format.duration_sec;

  // --- Check 4 (banned words) first, across all copy, with auto-fix ---
  const scrub = (label: string, sceneIndex: number | undefined, get: () => string, set: (v: string) => void) => {
    const { cleaned, hits } = stripBanned(get());
    if (hits.length) {
      set(cleaned);
      issues.push({
        check: "banned_words",
        severity: "fixed",
        message: `Removed banned term(s) [${hits.join(", ")}] from ${label}`,
        sceneIndex,
      });
    }
  };
  plan.timeline.forEach((s, i) => {
    scrub(`scene ${i} subtitle`, i, () => s.subtitle, (v) => (s.subtitle = v));
    scrub(`scene ${i} narration`, i, () => s.narration, (v) => (s.narration = v));
  });
  scrub("caption", undefined, () => plan.caption.text, (v) => (plan.caption.text = v));
  scrub("thumbnail_text", undefined, () => plan.thumbnail_text, (v) => (plan.thumbnail_text = v));
  scrub("cta", undefined, () => plan.cta.text, (v) => (plan.cta.text = v));

  // --- Check 1: Hook ---
  const hook: Scene | undefined = plan.timeline[0];
  if (hook) {
    if (hook.end > HOOK_MAX_SEC + 0.01) {
      issues.push({
        check: "hook_timing",
        severity: "warning",
        message: `Hook ends at ${hook.end}s (recommended <= ${HOOK_MAX_SEC}s)`,
        sceneIndex: 0,
      });
    }
    if (!looksLikeQuestion(hook.subtitle)) {
      issues.push({
        check: "hook_curiosity",
        severity: "warning",
        message: "Hook subtitle should pose a question / spark curiosity",
        sceneIndex: 0,
      });
    }
  }

  // --- Checks 2 & 3: per-scene pace + length + motion ---
  plan.timeline.forEach((s, i) => {
    const dur = Math.max(0.01, s.end - s.start);

    // Check 3a: scene length (auto-fixable only by flagging; we don't silently retime)
    if (dur > SCENE_MAX_SEC + 0.01) {
      issues.push({
        check: "scene_length",
        severity: "warning",
        message: `Scene ${i} is ${dur.toFixed(1)}s (recommended <= ${SCENE_MAX_SEC}s)`,
        sceneIndex: i,
      });
    }

    // Check 3b: motion presence (dead static shot)
    if (s.motion.type === "none") {
      issues.push({
        check: "scene_motion",
        severity: "warning",
        message: `Scene ${i} has no motion (add zoom/highlight/etc. to avoid a static shot)`,
        sceneIndex: i,
      });
    }

    // Check 2: narration pace
    if (s.narration.trim()) {
      const syl = syllableCount(s.narration);
      const rate = syl / dur;
      if (rate > SYLLABLES_PER_SEC_MAX + 0.5) {
        issues.push({
          check: "narration_pace",
          severity: "error",
          message: `Scene ${i} narration is too fast: ~${rate.toFixed(1)} syl/s (max ${SYLLABLES_PER_SEC_MAX}). Shorten the line or lengthen the scene.`,
          sceneIndex: i,
        });
      }
    }
  });

  // --- Check 5: CTA within last CTA_WINDOW_SEC ---
  if (plan.cta.start < totalDuration - CTA_WINDOW_SEC - 0.01) {
    issues.push({
      check: "cta_timing",
      severity: "warning",
      message: `CTA appears at ${plan.cta.start}s; recommended within the last ${CTA_WINDOW_SEC}s (>= ${(totalDuration - CTA_WINDOW_SEC).toFixed(1)}s)`,
    });
  }

  // --- Structural sanity: timeline monotonic & within duration ---
  let prevEnd = 0;
  plan.timeline.forEach((s, i) => {
    if (s.end <= s.start) {
      issues.push({ check: "scene_range", severity: "error", message: `Scene ${i} has end <= start`, sceneIndex: i });
    }
    if (s.start < prevEnd - 0.01) {
      issues.push({ check: "scene_overlap", severity: "error", message: `Scene ${i} overlaps the previous scene`, sceneIndex: i });
    }
    prevEnd = Math.max(prevEnd, s.end);
  });
  if (prevEnd > totalDuration + 0.01) {
    issues.push({
      check: "timeline_overflow",
      severity: "error",
      message: `Timeline runs to ${prevEnd.toFixed(1)}s but format.duration_sec is ${totalDuration}s`,
    });
  }

  const ok = !issues.some((i) => i.severity === "error");
  return { plan, ok, issues };
}

/** Convenience: format issues for logs/CLI. */
export function formatIssues(issues: Issue[]): string {
  if (!issues.length) return "  (no issues)";
  return issues
    .map((i) => {
      const tag = i.severity === "error" ? "✗" : i.severity === "fixed" ? "✎" : "!";
      const where = i.sceneIndex != null ? ` [scene ${i.sceneIndex}]` : "";
      return `  ${tag} ${i.check}${where}: ${i.message}`;
    })
    .join("\n");
}
