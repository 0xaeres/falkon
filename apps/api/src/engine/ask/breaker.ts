import { APICallError, RetryError } from "ai";
import { AskError } from "./errors";

/** The thresholds (R3), in one place. */
export const TRIP_AFTER = 5;
export const OPEN_MS = 30_000;
export const OPEN_SPREAD = 0.2;
export const MAX_CONCURRENT = 8;
export const CAP_RETRY_SECONDS = 5;

type ModelId = { provider: string; model: string };
type State = { failures: number; openUntil?: number; probing: boolean; inflight: number };

/** One admitted turn. The first of success, failure and release settles it and frees its slot; later calls do nothing. `release` records no outcome (abort, thrown error, a 4xx). */
export interface Permit {
  success(): void;
  failure(): void;
  release(): void;
}

const NETWORK_CODES = /^(ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|UND_ERR_\w+)$/;

/**
 * Whether a model error counts against the model (R4). A whitelist: 5xx, 408 and 429 (or no status, a connection failure) from an
 * APICallError (the last one inside a RetryError), a timeout, and a network failure. Everything else is not classified and is
 * neither success nor failure: other 4xx, a missing key, a bad prompt, an unknown tool, any plain Error (an app bug must never open
 * the breaker). An error event inside the stream arrives as plain error text, so it is not classified either (fail-safe).
 * A user Stop is an AbortError, which does not count; the caller also checks its signal.
 */
export function countsAsFailure(error: unknown): boolean {
  const e = RetryError.isInstance(error) ? error.lastError : error;
  if (APICallError.isInstance(e)) {
    const s = e.statusCode;
    return s === undefined || s >= 500 || s === 408 || s === 429;
  }
  if (!(e instanceof Error)) return false;
  if (e.name === "TimeoutError") return true;
  if (e instanceof TypeError && e.message === "fetch failed") return true;
  const code = (e.cause as { code?: unknown } | undefined)?.code ?? (e as { code?: unknown }).code;
  return typeof code === "string" && NETWORK_CODES.test(code);
}

const refuse = (seconds: number) => new AskError(503, "MODEL_UNAVAILABLE", `The model is temporarily unavailable. Try again in ${seconds} seconds.`, seconds);

/** Per-model circuit breaker and concurrency cap. `now` must be monotonic (milliseconds). */
export function createBreaker(now: () => number = () => performance.now(), random: () => number = Math.random) {
  const states = new Map<string, State>();
  const key = (m: ModelId) => `${m.provider}/${m.model}`;
  const stateOf = (m: ModelId) => {
    const s = states.get(key(m)) ?? { failures: 0, probing: false, inflight: 0 };
    states.set(key(m), s);
    return s;
  };
  const openMs = () => OPEN_MS * (1 + (random() * 2 - 1) * OPEN_SPREAD);
  const longest = Math.ceil((OPEN_MS * (1 + OPEN_SPREAD)) / 1000);

  const fail = (s: State, probe: boolean) => {
    s.failures++;
    if (probe) s.probing = false;
    // A straggler failing while open does not move the window; a probe failure or the fifth failure opens it.
    if (probe || (s.openUntil === undefined && s.failures >= TRIP_AFTER)) s.openUntil = now() + openMs();
  };
  const succeed = (s: State, probe: boolean) => {
    s.failures = 0;
    if (probe) (s.openUntil = undefined), (s.probing = false);
  };

  return {
    /** Takes a slot for one turn, or throws the 503 refusal. */
    admit(m: ModelId): Permit {
      const s = stateOf(m);
      let probe = false;
      if (s.openUntil !== undefined) {
        const wait = s.openUntil - now();
        if (wait > 0) throw refuse(Math.min(longest, Math.ceil(wait / 1000)));
        if (s.probing) throw refuse(CAP_RETRY_SECONDS);
        probe = true;
      }
      if (s.inflight >= MAX_CONCURRENT) throw refuse(CAP_RETRY_SECONDS);
      if (probe) s.probing = true;
      s.inflight++;
      let settled = false;
      const settle = (apply?: () => void) => {
        if (settled) return;
        settled = true;
        s.inflight--;
        if (apply) apply();
        else if (probe) s.probing = false;
      };
      return { success: () => settle(() => succeed(s, probe)), failure: () => settle(() => fail(s, probe)), release: () => settle() };
    },
    /** Chat-title naming may run: the breaker is closed. It runs beside its own turn, which already holds a slot, so the cap never stops it. A probe turn (half-open) skips it. It never takes a slot. */
    allowsNaming(m: ModelId): boolean {
      const s = states.get(key(m));
      return !s || s.openUntil === undefined;
    },
    /** A naming call's outcome, counted like a turn's. */
    noted(m: ModelId, ok: boolean) {
      const s = stateOf(m);
      if (ok) succeed(s, false);
      else fail(s, false);
    },
    get size() {
      return states.size;
    },
    /** Test support: forgets every model. */
    reset: () => states.clear(),
  };
}

export const breaker = createBreaker();
