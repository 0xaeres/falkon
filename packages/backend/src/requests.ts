// Worker side of the change and request signals (cycle 18, D156/D160).
import type { Signals } from "@falkon/shared";

/**
 * Wraps `fn` so signals and ticks can both trigger it: a trigger while a run is in flight starts no second run, it only
 * schedules one more pass afterwards (so a request written mid-run is still seen). The updateMany claims keep each request exactly-once.
 */
export function coalesce(fn: () => Promise<void>, onError: (e: unknown) => void): () => void {
  let running = false;
  let again = false;
  return () => {
    if (running) {
      again = true;
      return;
    }
    running = true;
    void (async () => {
      do {
        again = false;
        try {
          await fn();
        } catch (e) {
          onError(e);
        }
      } while (again);
      running = false;
    })();
  };
}

/** Publishes `changed` when any job of these workers starts, finishes or fails. */
export function announceJobs(workers: { on(event: "active" | "completed" | "failed", cb: () => void): unknown }[], signals: Signals) {
  for (const w of workers) for (const ev of ["active", "completed", "failed"] as const) w.on(ev, () => signals.changed());
}
