import { useEffect, useState } from "react";
import { useSWRConfig } from "swr";
import { productEventSchemas, type ProductEventName } from "@falkon/contracts";
import { keys } from "@/lib/api/client";

const RETRY_MS = [1000, 2000, 4000, 8000, 15000, 30000];
const CLOSED = 2; // EventSource.CLOSED

type Source = {
  readyState: number;
  onopen: (() => void) | null;
  onerror: (() => void) | null;
  addEventListener(name: string, listener: (event: { data: string }) => void): void;
  close(): void;
};
type Deps = { EventSource: new (url: string) => Source; setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout };

/**
 * One Product event stream. The browser's EventSource reconnects by itself after a dropped connection, and every connection
 * starts with the full state. One case it does not cover: a refused reconnect (the engine restarting answers 502) closes the
 * source for good, so that one is reopened here with a backoff, also when the very first connect was refused (nothing else
 * refreshes a page now that nothing polls). `onState(true)` is an open stream, `onState(false)` one that failed.
 * Without an engine the proxy answers a quiet open stream (see the events route), so this never loops in mock mode.
 */
export function connectProductEvents(
  url: string,
  onEvent: <K extends ProductEventName>(name: K, data: ReturnType<(typeof productEventSchemas)[K]["parse"]>) => void,
  onState: (connected: boolean) => void,
  deps: Deps = { EventSource: EventSource as never, setTimeout, clearTimeout },
) {
  let source: Source | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let attempt = 0;
  let stopped = false;
  const open = () => {
    const s = (source = new deps.EventSource(url));
    for (const name of Object.keys(productEventSchemas) as ProductEventName[])
      s.addEventListener(name, (event) => {
        // An event that does not parse is dropped; the next one carries the state anyway.
        const parsed = productEventSchemas[name].safeParse(safeJson(event.data));
        if (parsed.success) onEvent(name, parsed.data as never);
      });
    s.onopen = () => {
      attempt = 0;
      onState(true);
    };
    s.onerror = () => {
      onState(false);
      if (s.readyState !== CLOSED || stopped) return;
      s.close();
      timer = deps.setTimeout(open, RETRY_MS[Math.min(attempt++, RETRY_MS.length - 1)]);
    };
  };
  open();
  return () => {
    stopped = true;
    deps.clearTimeout(timer);
    source?.close();
  };
}
const safeJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

/** The status page and thread list stay in the SWR cache; the stream writes into it. `reconnecting` is true from the first failure until the stream is open again; the shell shows its notice only once a status has loaded. */
export function useProductEvents(productId: string) {
  const { mutate } = useSWRConfig();
  const [state, setState] = useState({ connected: false, failed: false });
  useEffect(() => {
    setState({ connected: false, failed: false });
    if (typeof EventSource === "undefined") return;
    return connectProductEvents(
      keys.events(productId),
      (name, data) => void mutate(name === "status" ? keys.status(productId) : keys.threads(productId), data, { revalidate: false }),
      (connected) => setState((was) => ({ connected, failed: was.failed || !connected })),
    );
  }, [productId, mutate]);
  return { connected: state.connected, reconnecting: state.failed && !state.connected };
}

/** A lost status connection is an error only for a page that never loaded a status (D151). */
export const visibleStatusError = (status: unknown, error: unknown) => (status ? undefined : error);
