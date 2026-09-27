/**
 * In-memory job store shared across API routes. Tracks pipeline progress and
 * the output path for each generation job.
 *
 * (Uses a global singleton so Next's route modules share one instance in dev.)
 */
import path from "node:path";
import os from "node:os";

export type JobStatus = "queued" | "ingest" | "plan" | "validate" | "render" | "composite" | "done" | "error";

export interface Job {
  id: string;
  status: JobStatus;
  progress: number; // 0-100
  message: string;
  outPath: string | null;
  thumbnailPath: string | null;
  error: string | null;
  planSummary: { scenes: number; duration: number } | null;
  createdAt: number;
}

// Map a pipeline stage name -> (status, coarse progress %).
const STAGE_PROGRESS: Record<string, { status: JobStatus; progress: number }> = {
  ingest: { status: "ingest", progress: 10 },
  transcribe: { status: "ingest", progress: 20 },
  plan: { status: "plan", progress: 35 },
  validate: { status: "validate", progress: 50 },
  tts: { status: "validate", progress: 55 },
  render: { status: "render", progress: 70 },
  composite: { status: "composite", progress: 88 },
  thumbnail: { status: "composite", progress: 95 },
  done: { status: "done", progress: 100 },
};

class JobStore {
  private jobs = new Map<string, Job>();

  create(id: string): Job {
    const job: Job = {
      id,
      status: "queued",
      progress: 0,
      message: "Queued",
      outPath: null,
      thumbnailPath: null,
      error: null,
      planSummary: null,
      createdAt: Date.now(),
    };
    this.jobs.set(id, job);
    return job;
  }

  get(id: string): Job | undefined {
    return this.jobs.get(id);
  }

  markStage(id: string, stage: string, detail?: string) {
    const job = this.jobs.get(id);
    if (!job) return;
    const mapped = STAGE_PROGRESS[stage];
    if (mapped) {
      job.status = mapped.status;
      job.progress = mapped.progress;
    }
    job.message = detail ? `${stage}: ${detail}` : stage;
  }

  markDone(id: string, outPath: string, planSummary: Job["planSummary"], thumbnailPath?: string | null) {
    const job = this.jobs.get(id);
    if (!job) return;
    job.status = "done";
    job.progress = 100;
    job.message = "Done";
    job.outPath = outPath;
    job.thumbnailPath = thumbnailPath ?? null;
    job.planSummary = planSummary;
  }

  markError(id: string, error: string) {
    const job = this.jobs.get(id);
    if (!job) return;
    job.status = "error";
    job.error = error;
    job.message = "Failed";
  }
}

// Persist across hot-reloads / route modules in dev.
const g = globalThis as unknown as { __sd_jobs?: JobStore };
export const jobStore = g.__sd_jobs ?? (g.__sd_jobs = new JobStore());

/** Where a job's working files + output live. */
export function jobDir(id: string): string {
  return path.join(process.env.SD_WORK_DIR || path.join(os.tmpdir(), "shorts-director"), id);
}
