"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import PlanEditor, { type UIPlan } from "./PlanEditor";

type Ratio = "9:16" | "1:1" | "16:9";
type CaptionStyle = "bold-pop" | "karaoke-bar" | "minimal" | "boxed";
const CAPTION_STYLES: { value: CaptionStyle; label: string }[] = [
  { value: "bold-pop", label: "Bold Pop" },
  { value: "karaoke-bar", label: "Karaoke" },
  { value: "minimal", label: "Minimal" },
  { value: "boxed", label: "Boxed" },
];
type JobStatus =
  | "queued"
  | "ingest"
  | "plan"
  | "validate"
  | "render"
  | "composite"
  | "done"
  | "error";

interface Job {
  id: string;
  status: JobStatus;
  progress: number;
  message: string;
  error: string | null;
  planSummary: { scenes: number; duration: number } | null;
  videoUrl: string | null;
  thumbnailUrl: string | null;
  queuePosition?: number;
}

const RATIOS: { value: Ratio; label: string; box: string }[] = [
  { value: "9:16", label: "9:16 Reels", box: "aspect-[9/16]" },
  { value: "1:1", label: "1:1 Feed", box: "aspect-square" },
  { value: "16:9", label: "16:9 YouTube", box: "aspect-video" },
];

const STAGES: { key: JobStatus; label: string }[] = [
  { key: "ingest", label: "Ingest" },
  { key: "plan", label: "Plan" },
  { key: "validate", label: "Validate" },
  { key: "render", label: "Render" },
  { key: "composite", label: "Composite" },
  { key: "done", label: "Done" },
];

function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={`${className} animate-spin`} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

type BusyAction = "plan" | "generate" | "render" | null;
const BUSY_LABEL: Record<Exclude<BusyAction, null>, string> = {
  plan: "업로드 및 편집 계획 생성 중…",
  generate: "업로드 및 작업 시작 중…",
  render: "렌더링 요청 중…",
};

export default function Home() {
  const [brief, setBrief] = useState("");
  const [ratio, setRatio] = useState<Ratio>("9:16");
  const [duration, setDuration] = useState(20);
  const [captionStyle, setCaptionStyle] = useState<CaptionStyle>("bold-pop");
  const [clips, setClips] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [job, setJob] = useState<Job | null>(null);
  const [busy, setBusy] = useState(false);
  const [busyAction, setBusyAction] = useState<BusyAction>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [plan, setPlan] = useState<UIPlan | null>(null); // editable draft
  const [planId, setPlanId] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const addFiles = useCallback((incoming: FileList | File[]) => {
    const vids = Array.from(incoming).filter((f) => f.type.startsWith("video/"));
    setClips((prev) => [...prev, ...vids]);
  }, []);

  function begin(action: Exclude<BusyAction, null>) {
    setBusy(true);
    setBusyAction(action);
    setStartedAt(Date.now());
    setElapsed(0);
  }
  function end() {
    setBusy(false);
    setBusyAction(null);
  }

  // poll job status
  useEffect(() => {
    if (!job || job.status === "done" || job.status === "error") {
      if (pollRef.current) clearInterval(pollRef.current);
      return;
    }
    pollRef.current = setInterval(async () => {
      try {
        const r = await fetch(`/api/jobs/${job.id}`, { cache: "no-store" });
        if (r.ok) setJob(await r.json());
      } catch {
        /* keep last state */
      }
    }, 1200);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [job?.id, job?.status]);

  function briefForm() {
    const fd = new FormData();
    fd.append("brief", brief);
    fd.append("ratio", ratio);
    fd.append("duration", String(duration));
    fd.append("caption_style", captionStyle);
    clips.forEach((f) => fd.append("videos", f));
    return fd;
  }

  function startJob(id: string) {
    setJob({
      id,
      status: "queued",
      progress: 0,
      message: "Queued",
      error: null,
      planSummary: null,
      videoUrl: null,
      thumbnailUrl: null,
    });
  }

  // One-shot: generate + render immediately.
  async function handleGenerate() {
    if (!brief.trim()) return;
    begin("generate");
    setJob(null);
    setPlan(null);
    try {
      const r = await fetch("/api/generate", { method: "POST", body: briefForm() });
      if (!r.ok) throw new Error((await r.json()).error || "Failed to start");
      startJob((await r.json()).id);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      end();
    }
  }

  // Two-step: get an editable plan first.
  async function handleReviewEdit() {
    if (!brief.trim()) return;
    begin("plan");
    setJob(null);
    setPlan(null);
    try {
      const r = await fetch("/api/plan", { method: "POST", body: briefForm() });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Plan failed");
      setPlan(data.plan as UIPlan);
      setPlanId(data.planId as string);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      end();
    }
  }

  // Render the (edited) plan.
  async function handleRenderPlan() {
    if (!plan) return;
    begin("render");
    setJob(null);
    try {
      const r = await fetch("/api/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId, plan }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Render failed");
      startJob(data.id);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      end();
    }
  }

  const done = job?.status === "done" && job.videoUrl;
  const running = job !== null && job.status !== "done" && job.status !== "error";
  const loading = busy || running;
  // elapsed-time counter while anything is in flight
  useEffect(() => {
    if (!loading || startedAt === null) return;
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(t);
  }, [loading, startedAt]);
  const loadingText =
    busyAction !== null
      ? BUSY_LABEL[busyAction]
      : job?.status === "queued"
        ? job.queuePosition
          ? `대기열 ${job.queuePosition}번째…`
          : "대기 중…"
        : job?.message || "처리 중…";
  const boxClass = RATIOS.find((r) => r.value === ratio)?.box ?? "aspect-[9/16]";

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">🎬 ShortsDirector</h1>
        <p className="mt-1 text-white/60">
          Upload your footage and one line. AI plans the edit — captions, motion &amp; a CTA — and
          renders a vertical short. <span className="text-emerald-400">Free · no API keys.</span>
        </p>
      </header>

      <div className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr]">
        {/* ---- Left: inputs ---- */}
        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 space-y-5">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-white/70">One-line brief</span>
            <input
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              placeholder="예: 여름 세일 홍보 / 발가락 교정 발건강 관리"
              className="w-full rounded-xl border border-white/10 bg-black/25 px-3.5 py-2.5 text-sm outline-none focus:border-accent"
            />
          </label>

          {/* dropzone */}
          <div>
            <span className="mb-1.5 block text-sm font-medium text-white/70">
              Your video clips <span className="text-white/40">(optional)</span>
            </span>
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                addFiles(e.dataTransfer.files);
              }}
              className={`rounded-xl border-2 border-dashed p-6 text-center transition ${
                dragOver ? "border-accent bg-accent/10" : "border-white/15 bg-black/20"
              }`}
            >
              <p className="text-sm text-white/60">
                Drag &amp; drop clips here, or{" "}
                <label className="cursor-pointer text-accent underline">
                  browse
                  <input
                    type="file"
                    accept="video/*"
                    multiple
                    className="hidden"
                    onChange={(e) => e.target.files && addFiles(e.target.files)}
                  />
                </label>
              </p>
              <p className="mt-1 text-xs text-white/40">
                No clips? AI uses stylish placeholder backgrounds. (Google-Drive downloads work too.)
              </p>
            </div>
            {clips.length > 0 && (
              <ul className="mt-3 space-y-1.5">
                {clips.map((f, i) => (
                  <li
                    key={i}
                    className="flex items-center justify-between rounded-lg bg-white/5 px-3 py-1.5 text-xs"
                  >
                    <span className="truncate">🎞️ {f.name}</span>
                    <button
                      onClick={() => setClips((c) => c.filter((_, idx) => idx !== i))}
                      className="ml-2 text-white/40 hover:text-white"
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* ratio */}
          <div>
            <span className="mb-1.5 block text-sm font-medium text-white/70">Aspect ratio</span>
            <div className="inline-flex rounded-xl border border-white/10 bg-black/20 p-1">
              {RATIOS.map((r) => (
                <button
                  key={r.value}
                  onClick={() => setRatio(r.value)}
                  className={`rounded-lg px-3 py-2 text-xs font-medium transition ${
                    ratio === r.value ? "bg-accent text-white" : "text-white/60 hover:text-white"
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>

          {/* caption style */}
          <div>
            <span className="mb-1.5 block text-sm font-medium text-white/70">Caption style</span>
            <div className="inline-flex flex-wrap gap-1 rounded-xl border border-white/10 bg-black/20 p-1">
              {CAPTION_STYLES.map((c) => (
                <button
                  key={c.value}
                  onClick={() => setCaptionStyle(c.value)}
                  className={`rounded-lg px-3 py-2 text-xs font-medium transition ${
                    captionStyle === c.value ? "bg-accent text-white" : "text-white/60 hover:text-white"
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          {/* duration */}
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-white/70">
              Duration: {duration}s
            </span>
            <input
              type="range"
              min={10}
              max={40}
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
              className="w-full accent-accent"
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={handleReviewEdit}
              disabled={busy || !brief.trim() || running}
              className="rounded-xl bg-accent py-3 font-semibold transition hover:bg-accent-dark disabled:cursor-not-allowed disabled:opacity-40"
              title="Generate an editable plan you can tweak before rendering"
            >
              {busyAction === "plan" ? (
                <span className="inline-flex items-center gap-2">
                  <Spinner /> Working…
                </span>
              ) : (
                "📝 Review & Edit"
              )}
            </button>
            <button
              onClick={handleGenerate}
              disabled={busy || !brief.trim() || running}
              className="rounded-xl border border-white/15 py-3 font-semibold transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
              title="Skip editing and render straight away"
            >
              {busyAction === "generate" || (running && !plan) ? (
                <span className="inline-flex items-center gap-2">
                  <Spinner /> Generating…
                </span>
              ) : (
                "⚡ Quick Generate"
              )}
            </button>
          </div>

          {plan && (
            <div className="mt-2 rounded-xl border border-accent/30 bg-accent/5 p-4">
              <PlanEditor plan={plan} onChange={setPlan} />
              <div className="mt-4 flex gap-2">
                <button
                  onClick={handleRenderPlan}
                  disabled={busy || running}
                  className="flex-1 rounded-xl bg-accent py-2.5 font-semibold transition hover:bg-accent-dark disabled:opacity-40"
                >
                  {running || busyAction === "render" ? (
                    <span className="inline-flex items-center justify-center gap-2">
                      <Spinner /> Rendering…
                    </span>
                  ) : (
                    "🎬 Render Video"
                  )}
                </button>
                <button
                  onClick={() => setPlan(null)}
                  className="rounded-xl border border-white/10 px-4 py-2.5 text-sm text-white/60 transition hover:bg-white/5"
                >
                  Discard
                </button>
              </div>
            </div>
          )}
        </section>

        {/* ---- Right: preview / progress ---- */}
        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-white/50">
            Preview
          </h2>
          <div
            className={`mx-auto flex ${boxClass} w-full max-w-[300px] items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-black/40`}
          >
            {done ? (
              <video
                key={job!.videoUrl!}
                src={job!.videoUrl!}
                controls
                autoPlay
                loop
                className="h-full w-full object-contain"
              />
            ) : (
              loading ? (
                <div className="flex flex-col items-center gap-3 px-6 text-center" role="status" aria-live="polite">
                  <Spinner className="h-10 w-10 text-accent" />
                  <p className="text-sm text-white/80">{loadingText}</p>
                  <p translate="no" className="notranslate text-xs tabular-nums text-white/40">
                    {`${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")} 경과`}
                  </p>
                  <p className="text-[11px] text-white/30">무료 서버라 1~3분 걸릴 수 있어요. 창을 닫지 마세요.</p>
                </div>
              ) : (
                <div className="px-6 text-center text-sm text-white/40">Your short will appear here</div>
              )
            )}
          </div>

          {job && (
            <div className="mt-5 space-y-3">
              {/* progress bar */}
              <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    job.status === "error" ? "bg-red-500" : "bg-accent"
                  }`}
                  style={{ width: `${job.progress}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className={job.status === "error" ? "text-red-400" : "text-white/70"}>
                  {job.status === "error" ? job.error : job.message}
                </span>
                <span translate="no" className="notranslate text-white/40">{`${job.progress}%`}</span>
              </div>
              {/* stage chips */}
              <div className="flex flex-wrap gap-1.5 text-xs text-white/50">
                {STAGES.map((s) => (
                  <span
                    key={s.key}
                    className={`rounded px-2 py-0.5 ${
                      job.status === s.key ? "bg-accent text-white" : "bg-white/5"
                    }`}
                  >
                    {s.label}
                  </span>
                ))}
              </div>
              {job.planSummary && (
                <p className="text-xs text-white/40">
                  Plan: {job.planSummary.scenes} scenes · {job.planSummary.duration}s
                </p>
              )}
              {done && (
                <div className="space-y-2">
                  <a
                    href={job!.videoUrl!}
                    download
                    className="block w-full rounded-xl border border-accent py-2.5 text-center font-medium text-accent transition hover:bg-accent hover:text-white"
                  >
                    ⬇ Download MP4
                  </a>
                  {job.thumbnailUrl && (
                    <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/20 p-2">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={job.thumbnailUrl}
                        alt="thumbnail"
                        className="h-16 w-16 rounded-lg object-cover"
                      />
                      <a
                        href={job.thumbnailUrl}
                        download
                        className="flex-1 text-center text-sm font-medium text-white/70 hover:text-white"
                      >
                        🖼️ Download thumbnail
                      </a>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
