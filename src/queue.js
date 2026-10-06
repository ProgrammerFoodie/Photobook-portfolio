/** Single-worker FIFO queue: keeps CPU/RAM bounded on a small machine. */
const pending = [];
let running = false;
let current = null;
const recentErrors = [];

async function pump() {
  if (running) return;
  running = true;
  while (pending.length) {
    const job = pending.shift();
    current = job.label;
    try {
      await job.fn();
    } catch (err) {
      console.error(`[queue] ${job.label} failed:`, err);
      recentErrors.unshift({ label: job.label, message: String(err?.message || err), at: new Date().toISOString() });
      recentErrors.length = Math.min(recentErrors.length, 10);
    }
  }
  current = null;
  running = false;
}

export function enqueue(label, fn) {
  pending.push({ label, fn });
  setImmediate(pump);
}

export const queueStatus = () => ({ pending: pending.length, current, recentErrors });

/** Resolves when the queue is idle (used by tests). */
export async function idle() {
  while (running || pending.length) await new Promise((r) => setTimeout(r, 25));
}
