"use client";

/** Timeline editor for an EditPlan: edit per-scene copy/duration/motion, reorder. */

const MOTIONS: { value: string; label: string }[] = [
  { value: "none", label: "없음" },
  { value: "zoom_punch", label: "줌 강조" },
  { value: "circle_highlight", label: "원형 강조" },
  { value: "arrow_highlight", label: "화살표 강조" },
  { value: "text_popup", label: "텍스트 팝업" },
  { value: "before_after_split", label: "비포/애프터" },
  { value: "number_countup", label: "숫자 카운트" },
  { value: "ending_cta_card", label: "마무리 카드" },
];

// Loose local types (mirror src/schema); avoids importing server code client-side.
export interface UIScene {
  start: number;
  end: number;
  source_clip: string;
  source_in?: number;
  speed: number;
  narration: string;
  subtitle: string;
  subtitle_emphasis: string;
  motion: { type: string; params: Record<string, unknown> };
  sfx: { at: number; type: string }[];
}
export interface UIPlan {
  format: { ratio: string; duration_sec: number; fps: number };
  timeline: UIScene[];
  cta: { text: string; start: number };
  // passthrough fields kept as-is
  [k: string]: unknown;
}

/** Re-derive absolute start/end from per-scene durations so timing stays valid. */
function retime(plan: UIPlan): UIPlan {
  let t = 0;
  const timeline = plan.timeline.map((s) => {
    const dur = Math.max(1, (s.end ?? 0) - (s.start ?? 0)) || 3;
    const start = Math.round(t * 100) / 100;
    const end = Math.round((t + dur) * 100) / 100;
    t = end;
    return { ...s, start, end };
  });
  const total = timeline.length ? timeline[timeline.length - 1].end : 0;
  const cta = { ...plan.cta, start: timeline.length ? timeline[timeline.length - 1].start : 0 };
  return { ...plan, timeline, cta, format: { ...plan.format, duration_sec: total } };
}

export default function PlanEditor({
  plan,
  onChange,
}: {
  plan: UIPlan;
  onChange: (p: UIPlan) => void;
}) {
  const scenes = plan.timeline;

  function updateScene(i: number, patch: Partial<UIScene>) {
    const next = scenes.map((s, idx) => (idx === i ? { ...s, ...patch } : s));
    onChange(retime({ ...plan, timeline: next }));
  }
  function setDuration(i: number, dur: number) {
    const s = scenes[i];
    updateScene(i, { end: s.start + Math.max(1, dur) });
  }
  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= scenes.length) return;
    const next = [...scenes];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(retime({ ...plan, timeline: next }));
  }
  function remove(i: number) {
    if (scenes.length <= 1) return;
    onChange(retime({ ...plan, timeline: scenes.filter((_, idx) => idx !== i) }));
  }

  const total = plan.format.duration_sec;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold tracking-wide text-white/50">
          기획안 편집 — <span translate="no" className="notranslate">{scenes.length}</span>개 장면 ·{" "}
          <span translate="no" className="notranslate">{total.toFixed(1)}초</span>
        </h3>
      </div>

      {scenes.map((s, i) => (
        <div key={i} className="rounded-xl border border-white/10 bg-black/20 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="flex items-center gap-2 text-xs font-medium text-white/50">
              <span className="grid h-6 w-6 place-items-center rounded-full bg-accent/30 text-white">
                {i + 1}
              </span>
              {i === 0 ? "훅(첫 장면)" : i === scenes.length - 1 ? "CTA(마무리)" : `장면 ${i + 1}`} ·{" "}
              <span translate="no" className="notranslate">{(s.end - s.start).toFixed(1)}초</span>
            </span>
            <div className="flex items-center gap-1">
              <IconBtn label="위로" disabled={i === 0} onClick={() => move(i, -1)}>↑</IconBtn>
              <IconBtn label="아래로" disabled={i === scenes.length - 1} onClick={() => move(i, 1)}>↓</IconBtn>
              <IconBtn label="삭제" disabled={scenes.length <= 1} onClick={() => remove(i)}>✕</IconBtn>
            </div>
          </div>

          <input
            value={s.subtitle}
            onChange={(e) => updateScene(i, { subtitle: e.target.value })}
            placeholder="화면 자막"
            className="mb-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm font-medium outline-none focus:border-accent"
          />
          <div className="mb-2 flex gap-2">
            <input
              value={s.subtitle_emphasis}
              onChange={(e) => updateScene(i, { subtitle_emphasis: e.target.value })}
              placeholder="강조할 단어"
              className="w-1/2 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs text-white/70 outline-none focus:border-accent"
            />
            <select
              value={s.motion.type}
              onChange={(e) => updateScene(i, { motion: { ...s.motion, type: e.target.value } })}
              className="w-1/2 rounded-lg border border-white/10 bg-black/30 px-2 py-2 text-xs text-white/70 outline-none focus:border-accent"
            >
              {MOTIONS.map((m) => (
                <option key={m.value} value={m.value} className="bg-[#1a1024]">
                  {m.label}
                </option>
              ))}
            </select>
          </div>
          <input
            value={s.narration}
            onChange={(e) => updateScene(i, { narration: e.target.value })}
            placeholder="나레이션 (음성으로 읽을 문장) — 선택"
            className="mb-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs text-white/60 outline-none focus:border-accent"
          />
          <div className="flex items-center gap-2">
            <span className="text-xs text-white/40">길이</span>
            <input
              type="range"
              min={1}
              max={8}
              step={0.5}
              value={s.end - s.start}
              onChange={(e) => setDuration(i, Number(e.target.value))}
              className="flex-1 accent-accent"
            />
            <span translate="no" className="notranslate w-12 text-right text-xs text-white/60">{(s.end - s.start).toFixed(1)}초</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function IconBtn({
  children,
  onClick,
  disabled,
  label,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="grid h-7 w-7 place-items-center rounded-md border border-white/10 text-xs text-white/70 hover:bg-white/10 disabled:opacity-25"
    >
      {children}
    </button>
  );
}
