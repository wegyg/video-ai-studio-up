"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import PlanEditor, { type UIPlan } from "./PlanEditor";
import { t } from "@/i18n";

type Ratio = "9:16" | "1:1" | "16:9";
type CaptionStyle = "bold-pop" | "karaoke-bar" | "minimal" | "boxed";
const CAPTION_STYLES: { value: CaptionStyle; key: string }[] = [
  { value: "bold-pop", key: "caption.boldPop" },
  { value: "karaoke-bar", key: "caption.karaokeBar" },
  { value: "minimal", key: "caption.minimal" },
  { value: "boxed", key: "caption.boxed" },
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

// Brief card extracted from a homepage (feature 4).
interface Brief {
  name: string;
  services: string[];
  tagline: string;
  contact: string;
  color: string;
  heroImage: string | null;
  sourceUrl?: string;
  crawlFailed?: boolean;
}

const RATIOS: { value: Ratio; key: string; box: string }[] = [
  { value: "9:16", key: "ratio.vertical", box: "aspect-[9/16]" },
  { value: "1:1", key: "ratio.square", box: "aspect-square" },
  { value: "16:9", key: "ratio.landscape", box: "aspect-video" },
];

// Weighted stages for the progress bar (feature 3). Weights sum to 100.
const STAGES: { key: JobStatus; labelKey: string; weight: number }[] = [
  { key: "ingest", labelKey: "stages.reference", weight: 10 },
  { key: "plan", labelKey: "stages.script", weight: 15 },
  { key: "validate", labelKey: "stages.voice", weight: 10 },
  { key: "render", labelKey: "stages.visuals", weight: 15 },
  { key: "composite", labelKey: "stages.render", weight: 45 },
  { key: "done", labelKey: "stages.done", weight: 5 },
];

function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={`${className} animate-spin`} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.max(0, Math.round(sec % 60));
  return `${m}:${String(s).padStart(2, "0")}`;
}

// Persisted last-3 render durations for ETA (feature 3).
function recordDuration(sec: number) {
  try {
    const arr: number[] = JSON.parse(localStorage.getItem("sd_durations") || "[]");
    arr.push(sec);
    localStorage.setItem("sd_durations", JSON.stringify(arr.slice(-3)));
  } catch {
    /* ignore */
  }
}
function avgDuration(): number | null {
  try {
    const arr: number[] = JSON.parse(localStorage.getItem("sd_durations") || "[]");
    if (!arr.length) return null;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  } catch {
    return null;
  }
}

export default function Home() {
  const [brief, setBrief] = useState("");
  const [reference, setReference] = useState("");
  const [briefCard, setBriefCard] = useState<Brief | null>(null); // extracted from URL
  const [ratio, setRatio] = useState<Ratio>("9:16");
  const [duration, setDuration] = useState(20);
  const [captionStyle, setCaptionStyle] = useState<CaptionStyle>("bold-pop");
  const [clips, setClips] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [job, setJob] = useState<Job | null>(null);
  const [busy, setBusy] = useState(false);
  const [busyAction, setBusyAction] = useState<"analyze" | "plan" | "generate" | "render" | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [stalled, setStalled] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [plan, setPlan] = useState<UIPlan | null>(null);
  const [planId, setPlanId] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastProgressRef = useRef<{ p: number; at: number }>({ p: 0, at: Date.now() });

  const addFiles = useCallback((incoming: FileList | File[]) => {
    const vids = Array.from(incoming).filter((f) => f.type.startsWith("video/"));
    setClips((prev) => [...prev, ...vids]);
  }, []);

  function begin(action: NonNullable<typeof busyAction>) {
    setBusy(true);
    setBusyAction(action);
    setStartedAt(Date.now());
    setElapsed(0);
    setStalled(false);
    lastProgressRef.current = { p: 0, at: Date.now() };
  }
  function end() {
    setBusy(false);
    setBusyAction(null);
  }

  // poll job status
  useEffect(() => {
    if (!job || job.status === "done" || job.status === "error") {
      if (pollRef.current) clearInterval(pollRef.current);
      if (job?.status === "done" && startedAt) recordDuration((Date.now() - startedAt) / 1000);
      return;
    }
    pollRef.current = setInterval(async () => {
      try {
        const r = await fetch(`/api/jobs/${job.id}`, { cache: "no-store" });
        if (r.ok) {
          const next: Job = await r.json();
          // stall detection: progress unchanged for >60s
          if (next.progress !== lastProgressRef.current.p) {
            lastProgressRef.current = { p: next.progress, at: Date.now() };
            setStalled(false);
          } else if (Date.now() - lastProgressRef.current.at > 60000) {
            setStalled(true);
          }
          setJob(next);
        } else if (r.status === 404) {
          setJob((j) => (j ? { ...j, status: "error", error: t("status.serverRestarted") } : j));
        }
      } catch {
        /* keep last state */
      }
    }, 1200);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [job?.id, job?.status, startedAt]);

  function briefForm() {
    const fd = new FormData();
    // If a brief card exists, fold it into the brief + reference text.
    const b = brief.trim() || briefCard?.name || "";
    fd.append("brief", b);
    const refText = briefCard ? briefToText(briefCard) : reference;
    fd.append("reference", refText);
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
      message: t("status.queued"),
      error: null,
      planSummary: null,
      videoUrl: null,
      thumbnailUrl: null,
    });
  }

  // Feature 4: analyze the reference URL/text -> brief card.
  async function handleAnalyze() {
    if (!reference.trim()) return;
    begin("analyze");
    try {
      const r = await fetch("/api/brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reference }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "analyze failed");
      setBriefCard(data.brief as Brief);
      if (!brief.trim() && data.brief?.name) setBrief(data.brief.name);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      end();
    }
  }

  async function handleGenerate() {
    if (!canGenerate()) return;
    begin("generate");
    setJob(null);
    setPlan(null);
    try {
      const r = await fetch("/api/generate", { method: "POST", body: briefForm() });
      if (!r.ok) throw new Error((await r.json()).error || "failed");
      startJob((await r.json()).id);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      end();
    }
  }

  async function handleReviewEdit() {
    if (!canGenerate()) return;
    begin("plan");
    setJob(null);
    setPlan(null);
    try {
      const r = await fetch("/api/plan", { method: "POST", body: briefForm() });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "plan failed");
      setPlan(data.plan as UIPlan);
      setPlanId(data.planId as string);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      end();
    }
  }

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
      if (!r.ok) throw new Error(data.error || "render failed");
      startJob(data.id);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      end();
    }
  }

  async function handleCancel() {
    if (job) {
      try {
        await fetch(`/api/jobs/${job.id}/cancel`, { method: "POST" });
      } catch {
        /* ignore */
      }
    }
    setJob(null);
    end();
  }

  function canGenerate() {
    return Boolean(brief.trim() || briefCard?.name);
  }

  const done = job?.status === "done" && job.videoUrl;
  const running = job !== null && job.status !== "done" && job.status !== "error";
  const loading = busy || running;

  // elapsed counter
  useEffect(() => {
    if (!loading || startedAt === null) return;
    const iv = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(iv);
  }, [loading, startedAt]);

  // weighted progress + current stage label
  const weightedProgress = (() => {
    if (!job) return 0;
    if (job.status === "done") return 100;
    if (job.status === "error") return job.progress;
    return job.progress; // backend already reports coarse %
  })();
  const eta = (() => {
    const avg = avgDuration();
    if (!avg || !loading) return null;
    const remain = Math.max(0, avg - elapsed);
    return remain;
  })();
  const currentSceneMatch = job?.message?.match(/(\d+)\s*\/\s*(\d+)/);

  const loadingText =
    busyAction === "analyze"
      ? t("input.analyzing")
      : job?.status === "queued"
        ? job.queuePosition
          ? t("status.queuedPosition", { n: job.queuePosition })
          : t("status.queued")
        : job?.message || t("preview.rendering");
  const boxClass = RATIOS.find((r) => r.value === ratio)?.box ?? "aspect-[9/16]";

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">🎬 {t("app.title")}</h1>
        <p className="mt-1 text-white/60">
          {t("app.subtitle")} <span className="text-emerald-400">{t("app.freeTag")}</span>
        </p>
      </header>

      <div className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr]">
        {/* ---- Left: inputs ---- */}
        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 space-y-5">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-white/70">{t("input.briefLabel")}</span>
            <input
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              placeholder={t("input.briefPlaceholder")}
              className="w-full rounded-xl border border-white/10 bg-black/25 px-3.5 py-2.5 text-sm outline-none focus:border-accent"
            />
          </label>

          {/* reference: URL or notes + analyze */}
          <div>
            <span className="mb-1.5 block text-sm font-medium text-white/70">
              {t("input.referenceLabel")} <span className="text-white/40">{t("input.referenceHint2")}</span>
            </span>
            <textarea
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              rows={3}
              placeholder={t("input.referencePlaceholder")}
              className="w-full resize-y rounded-xl border border-white/10 bg-black/25 px-3.5 py-2.5 text-sm outline-none focus:border-accent"
            />
            <div className="mt-1.5 flex items-center gap-2">
              <button
                onClick={handleAnalyze}
                disabled={busy || !reference.trim()}
                className="rounded-lg border border-accent/50 px-3 py-1.5 text-xs font-medium text-accent transition hover:bg-accent hover:text-white disabled:opacity-40"
              >
                {busyAction === "analyze" ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Spinner className="h-3 w-3" /> {t("input.analyzing")}
                  </span>
                ) : (
                  t("input.analyzeButton")
                )}
              </button>
              <span className="text-xs text-white/40">{t("input.referenceNote")}</span>
            </div>
          </div>

          {/* Brief card (feature 4) */}
          {briefCard && (
            <BriefCardEditor card={briefCard} onChange={setBriefCard} />
          )}

          {/* dropzone */}
          <div>
            <span className="mb-1.5 block text-sm font-medium text-white/70">
              {t("input.clipsLabel")} <span className="text-white/40">{t("input.optional")}</span>
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
                {t("input.dropHere")}{" "}
                <label className="cursor-pointer text-accent underline">
                  {t("input.browse")}
                  <input
                    type="file"
                    accept="video/*"
                    multiple
                    className="hidden"
                    onChange={(e) => e.target.files && addFiles(e.target.files)}
                  />
                </label>
              </p>
              <p className="mt-1 text-xs text-white/40">{t("input.clipsNote")}</p>
            </div>
            {clips.length > 0 && (
              <ul className="mt-3 space-y-1.5">
                {clips.map((f, i) => (
                  <li key={i} className="flex items-center justify-between rounded-lg bg-white/5 px-3 py-1.5 text-xs">
                    <span className="truncate">🎞️ {f.name}</span>
                    <button onClick={() => setClips((c) => c.filter((_, idx) => idx !== i))} className="ml-2 text-white/40 hover:text-white">
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* ratio */}
          <div>
            <span className="mb-1.5 block text-sm font-medium text-white/70">{t("input.ratioLabel")}</span>
            <div className="inline-flex rounded-xl border border-white/10 bg-black/20 p-1">
              {RATIOS.map((r) => (
                <button
                  key={r.value}
                  onClick={() => setRatio(r.value)}
                  className={`rounded-lg px-3 py-2 text-xs font-medium transition ${
                    ratio === r.value ? "bg-accent text-white" : "text-white/60 hover:text-white"
                  }`}
                >
                  {t(r.key)}
                </button>
              ))}
            </div>
          </div>

          {/* caption style */}
          <div>
            <span className="mb-1.5 block text-sm font-medium text-white/70">{t("input.captionLabel")}</span>
            <div className="inline-flex flex-wrap gap-1 rounded-xl border border-white/10 bg-black/20 p-1">
              {CAPTION_STYLES.map((c) => (
                <button
                  key={c.value}
                  onClick={() => setCaptionStyle(c.value)}
                  className={`rounded-lg px-3 py-2 text-xs font-medium transition ${
                    captionStyle === c.value ? "bg-accent text-white" : "text-white/60 hover:text-white"
                  }`}
                >
                  {t(c.key)}
                </button>
              ))}
            </div>
          </div>

          {/* duration */}
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-white/70">
              {t("input.durationLabel")}: <span translate="no" className="notranslate">{duration}{t("input.seconds")}</span>
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
              disabled={busy || !canGenerate() || running}
              className="rounded-xl bg-accent py-3 font-semibold transition hover:bg-accent-dark disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busyAction === "plan" ? (
                <span className="inline-flex items-center gap-2"><Spinner /> {t("buttons.preparing")}</span>
              ) : (
                t("buttons.reviewEdit")
              )}
            </button>
            <button
              onClick={handleGenerate}
              disabled={busy || !canGenerate() || running}
              className="rounded-xl border border-white/15 py-3 font-semibold transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busyAction === "generate" || (running && !plan) ? (
                <span className="inline-flex items-center gap-2"><Spinner /> {t("buttons.generating")}</span>
              ) : (
                t("buttons.quickGenerate")
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
                    <span className="inline-flex items-center justify-center gap-2"><Spinner /> {t("buttons.rendering")}</span>
                  ) : (
                    t("buttons.renderVideo")
                  )}
                </button>
                <button onClick={() => setPlan(null)} className="rounded-xl border border-white/10 px-4 py-2.5 text-sm text-white/60 transition hover:bg-white/5">
                  {t("buttons.discard")}
                </button>
              </div>
            </div>
          )}
        </section>

        {/* ---- Right: preview / progress ---- */}
        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
          <h2 className="mb-4 text-sm font-semibold tracking-wide text-white/50">{t("preview.title")}</h2>
          <div className={`mx-auto flex ${boxClass} w-full max-w-[300px] items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-black/40`}>
            {done ? (
              <video key={job!.videoUrl!} src={job!.videoUrl!} controls autoPlay loop className="h-full w-full object-contain" />
            ) : loading ? (
              <div className="flex flex-col items-center gap-3 px-6 text-center" role="status" aria-live="polite">
                <Spinner className="h-10 w-10 text-accent" />
                <p className="text-sm text-white/80">{loadingText}</p>
                {currentSceneMatch && (
                  <p className="text-xs text-accent">
                    <span translate="no" className="notranslate">{currentSceneMatch[1]}/{currentSceneMatch[2]}</span>{" "}
                    {t("preview.currentScene")}
                  </p>
                )}
                <p translate="no" className="notranslate text-xs tabular-nums text-white/40">
                  {fmtTime(elapsed)} {t("preview.elapsed")}
                  {eta !== null ? ` · ${t("preview.eta")} ~${fmtTime(eta)}` : ""}
                </p>
                {stalled && <p className="text-xs text-amber-400">{t("preview.stalled")}</p>}
                <p className="text-[11px] text-white/30">{t("preview.timeHint")}</p>
                <button onClick={handleCancel} className="mt-1 rounded-lg border border-white/15 px-3 py-1 text-xs text-white/60 hover:bg-white/10">
                  {t("buttons.cancel")}
                </button>
              </div>
            ) : (
              <div className="px-6 text-center text-sm text-white/40">{t("preview.empty")}</div>
            )}
          </div>

          {job && (
            <div className="mt-5 space-y-3">
              <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${job.status === "error" ? "bg-red-500" : "bg-accent"}`}
                  style={{ width: `${weightedProgress}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className={job.status === "error" ? "text-red-400" : "text-white/70"}>
                  {job.status === "error" ? job.error : job.message}
                </span>
                <span translate="no" className="notranslate text-white/40">{`${weightedProgress}%`}</span>
              </div>
              <div className="flex flex-wrap gap-1.5 text-xs text-white/50">
                {STAGES.map((s) => (
                  <span key={s.key} className={`rounded px-2 py-0.5 ${job.status === s.key ? "bg-accent text-white" : "bg-white/5"}`}>
                    {t(s.labelKey)}
                  </span>
                ))}
              </div>
              {stalled && (
                <button onClick={() => setShowLog((v) => !v)} className="text-xs text-amber-400 underline">
                  {t("buttons.viewLog")}
                </button>
              )}
              {showLog && (
                <pre className="max-h-32 overflow-auto rounded-lg bg-black/40 p-2 text-[10px] text-white/50">
                  {`job ${job.id}\nstatus ${job.status} ${job.progress}%\n${job.message}`}
                </pre>
              )}
              {job.planSummary && (
                <p className="text-xs text-white/40">
                  <span translate="no" className="notranslate">{job.planSummary.scenes}</span>{t("preview.planSummaryScenes")} ·{" "}
                  <span translate="no" className="notranslate">{job.planSummary.duration}{t("input.seconds")}</span>
                </p>
              )}
              {done && (
                <div className="space-y-2">
                  <a href={job!.videoUrl!} download className="block w-full rounded-xl border border-accent py-2.5 text-center font-medium text-accent transition hover:bg-accent hover:text-white">
                    {t("preview.downloadVideo")}
                  </a>
                  {job.thumbnailUrl && (
                    <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/20 p-2">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={job.thumbnailUrl} alt="썸네일" className="h-16 w-16 rounded-lg object-cover" />
                      <a href={job.thumbnailUrl} download className="flex-1 text-center text-sm font-medium text-white/70 hover:text-white">
                        {t("preview.downloadThumb")}
                      </a>
                    </div>
                  )}
                  <button
                    onClick={() => {
                      setJob(null);
                      setPlan(null);
                    }}
                    className="block w-full rounded-xl border border-white/10 py-2 text-sm text-white/60 transition hover:bg-white/5"
                  >
                    {t("buttons.makeAnother")}
                  </button>
                </div>
              )}
            </div>
          )}
        </section>
      </div>

      {/* developer credit (feature 2) */}
      <footer className="mt-10 border-t border-white/10 pt-5 text-center text-sm text-white/50">
        <p>
          {t("credit.prefix")}: <span className="font-medium text-white/70">{t("credit.name")}</span>
          <span className="mx-2 text-white/20">·</span>
          <a href="tel:1877-7323" className="text-accent hover:underline" translate="no">
            {t("credit.phone")}
          </a>
        </p>
      </footer>
    </main>
  );
}

// --- brief helpers ---------------------------------------------------------
function briefToText(b: Brief): string {
  return [
    b.name && `상호: ${b.name}`,
    b.services?.length && `서비스: ${b.services.filter(Boolean).join(", ")}`,
    b.tagline && `문구: ${b.tagline}`,
    b.contact && `연락처: ${b.contact}`,
  ]
    .filter(Boolean)
    .join(". ");
}

function BriefCardEditor({ card, onChange }: { card: Brief; onChange: (b: Brief) => void }) {
  const set = (patch: Partial<Brief>) => onChange({ ...card, ...patch });
  const setService = (i: number, v: string) => {
    const s = [...(card.services || ["", "", ""])];
    s[i] = v;
    set({ services: s });
  };
  return (
    <div className="rounded-xl border border-accent/30 bg-accent/5 p-4 space-y-2.5">
      <h3 className="text-sm font-semibold text-white/70">{t("brief.title")}</h3>
      {card.crawlFailed && <p className="text-xs text-amber-400">{t("brief.crawlFailed")}</p>}
      {card.sourceUrl && (
        <p className="text-xs text-white/40">
          {t("brief.sourceUrl")}: <span translate="no" className="notranslate">{card.sourceUrl}</span>
        </p>
      )}
      <Field label={t("brief.name")}>
        <input value={card.name} onChange={(e) => set({ name: e.target.value })} className="bc-input" />
      </Field>
      <Field label={t("brief.services")}>
        <div className="grid grid-cols-1 gap-1.5">
          {[0, 1, 2].map((i) => (
            <input
              key={i}
              value={card.services?.[i] || ""}
              onChange={(e) => setService(i, e.target.value)}
              placeholder={`${t("brief.servicePlaceholder")} ${i + 1}`}
              className="bc-input"
            />
          ))}
        </div>
      </Field>
      <Field label={t("brief.tagline")}>
        <input value={card.tagline} onChange={(e) => set({ tagline: e.target.value })} className="bc-input" />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label={t("brief.contact")}>
          <input value={card.contact} onChange={(e) => set({ contact: e.target.value })} className="bc-input" />
        </Field>
        <Field label={t("brief.color")}>
          <div className="flex items-center gap-2">
            <span className="h-6 w-6 rounded border border-white/20" style={{ background: card.color || "#ff5252" }} />
            <input value={card.color} onChange={(e) => set({ color: e.target.value })} className="bc-input" />
          </div>
        </Field>
      </div>
      {card.heroImage && (
        <Field label={t("brief.hero")}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={card.heroImage} alt="" className="h-20 rounded-lg border border-white/10 object-cover" />
        </Field>
      )}
      <style jsx>{`
        .bc-input {
          width: 100%;
          border-radius: 0.5rem;
          border: 1px solid rgba(255, 255, 255, 0.1);
          background: rgba(0, 0, 0, 0.3);
          padding: 0.4rem 0.6rem;
          font-size: 0.8rem;
          outline: none;
        }
        .bc-input:focus {
          border-color: #ff5252;
        }
      `}</style>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-white/50">{label}</span>
      {children}
    </label>
  );
}
