import { useSyncExternalStore } from "react";

const MINUTE = 60_000;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;

// A local once-a-minute tick (no network). The snapshot is the current minute, so it is stable between ticks.
export function subscribeMinute(listener: () => void) {
  listeners.add(listener);
  timer ??= setInterval(() => listeners.forEach((l) => l()), MINUTE);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}
export const currentMinute = () => Math.floor(Date.now() / MINUTE) * MINUTE;
export const useMinute = () => useSyncExternalStore(subscribeMinute, currentMinute, currentMinute);
