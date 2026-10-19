"use client";
import { useSyncExternalStore } from "react";

// Dismissing a failure highlight is a per-viewer convenience, so it lives in localStorage, not on the server.
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};
const keyOf = (productId: string) => `falkon:dismissed:${productId}`;

export function useDismissed(productId: string) {
  const dismissed = useSyncExternalStore(
    subscribe,
    () => {
      try {
        return localStorage.getItem(keyOf(productId)) === "1";
      } catch {
        return false;
      }
    },
    () => false,
  );
  function set(value: boolean) {
    try {
      if (value) localStorage.setItem(keyOf(productId), "1");
      else localStorage.removeItem(keyOf(productId));
    } catch {}
    listeners.forEach((listener) => listener());
  }
  return [dismissed, set] as const;
}
