/**
 * In-process render queue with a concurrency limit.
 *
 * Rendering is CPU/Chromium-heavy, so we cap how many run at once
 * (RENDER_CONCURRENCY, default 2). Tasks are enqueued and a pool of workers
 * pulls them FIFO. Each task reports its queue position while waiting so the
 * UI can show "3rd in line".
 *
 * Global singleton so all Next route modules share one queue.
 */
type Task = () => Promise<void>;

interface Entry {
  id: string;
  run: Task;
  onQueued?: (position: number) => void; // called with 1-based position while waiting
}

class RenderQueue {
  private readonly concurrency: number;
  private active = 0;
  private waiting: Entry[] = [];

  constructor(concurrency: number) {
    this.concurrency = Math.max(1, concurrency);
  }

  /** Enqueue a render task. Returns immediately; the task runs when a slot frees. */
  enqueue(entry: Entry): void {
    this.waiting.push(entry);
    this.notifyPositions();
    this.pump();
  }

  /** 1-based position of a waiting job, or 0 if running/unknown. */
  positionOf(id: string): number {
    const idx = this.waiting.findIndex((e) => e.id === id);
    return idx < 0 ? 0 : idx + 1;
  }

  get stats() {
    return { active: this.active, waiting: this.waiting.length, concurrency: this.concurrency };
  }

  private notifyPositions() {
    this.waiting.forEach((e, i) => e.onQueued?.(i + 1));
  }

  private pump() {
    while (this.active < this.concurrency && this.waiting.length > 0) {
      const entry = this.waiting.shift()!;
      this.active++;
      this.notifyPositions(); // remaining jobs move up
      // Run without blocking the loop; free the slot on completion.
      void entry
        .run()
        .catch(() => {
          /* task is responsible for recording its own error */
        })
        .finally(() => {
          this.active--;
          this.pump();
        });
    }
  }
}

const g = globalThis as unknown as { __sd_queue?: RenderQueue };
export const renderQueue =
  g.__sd_queue ?? (g.__sd_queue = new RenderQueue(Number(process.env.RENDER_CONCURRENCY) || 2));
