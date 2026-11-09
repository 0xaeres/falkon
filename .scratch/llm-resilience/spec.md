# Chat resilience: watchdog fixes and a model circuit breaker

Goal: (1) the chat resume watchdog gives up on permanent errors and spreads its retries out in time; (2) when the model provider is failing, new chat turns are refused at once instead of piling onto it, and when it recovers only one probe turn goes first, so the clients do not all arrive together. Source: the read-only check of 2026-11-09 in this session (probes confirmed: a 404 or 401 on a resume or on the thread reload is retried every 30 s forever; 500 clients dropped together retry in lockstep at 1, 3, 7, 15 and 30 s; no limiter or breaker exists on model calls; the AI SDK retries a failed call twice with 2 s then 4 s and no jitter).

Base: `main`. Cycle branch `loop/llm-resilience`.

## Decisions (grill, 2026-11-09)

- R1. The breaker covers the api process only: chat turns (UI chat, `ask_codebase`, MCP, all of which go through `createMessageStream` in `apps/api/src/engine/ask/agent.ts`) and chat-title naming (`chat.ts`). One breaker per configured model, keyed by provider and model name. Knowledge-base scans in the backend process keep their own retry and only get jitter (human choice).
- R2. An open breaker refuses at once (human choice): the send is rejected before the question is stored with 503 `MODEL_UNAVAILABLE`, a `retry-after` header in seconds, and a plain message ("The model is temporarily unavailable. Try again in N seconds."). The refusal is raised at the seam where an unconfigured model already throws an `AskError` before any byte is produced, which is before `onAccepted` stores the question. No queueing.
- R3. Thresholds are constants in one place, not settings (human choice): trip after 5 consecutive failures; stay open 30 s with a random spread of 20 percent; then half-open and let exactly one probe turn through; a probe success closes the breaker, a probe failure reopens it for a fresh 30 s; a cap of 8 concurrent turns per model, the ninth refused like an open breaker (same 503, retry-after 5).
- R4. What counts as a failure: a model call that ends in a timeout, a network error, a 5xx or a 429 after the SDK's own retries. A 4xx other than 408 and 429 (bad key, bad request) does not count and does not trip the breaker. A turn stopped by the user (abort) counts as neither success nor failure. A tool error is not a model failure. A success is a turn whose model run finishes without a model error; any success resets the consecutive count.
- R5. Chat-title naming uses the same breaker: its failures count; while the breaker is open it is skipped and the chat keeps its fallback name (it never refuses the chat and never holds a concurrency slot).
- R6. Watchdog (defaults, not asked): inside the loop, a resume or thread-reload error that is an `ApiError` with a 4xx status other than 408 and 429 ends the watchdog and takes the existing give-up path once; a 5xx, 408, 429 or a network error keeps retrying. Every retry delay gets a random spread of plus or minus 50 percent of its base (1, 2, 4, 8, 15, then 30 s), and an `online` resume is delayed by a random 0 to 1 s. The retry never stops on its own for network errors (unchanged: D148).
- R7. The scan client `openAiClient` in `packages/shared/src/kb/llm.ts` gets the same plus or minus 50 percent spread on its backoff, nothing else.
- R8. Agents: Claude only (Codex is dropped for this project). Sonnet builds and reviews. No slice is `hard`.

## Verify commands (all slices)

`pnpm typecheck` and `pnpm test` from the repository root, plus the slice's own focused tests. The opsSmoke tests in `packages/shared` time out under load: rerun the file alone once if only they fail. Builders commit nothing; run git only inside the worktree you were given.

## Slices

### W1. Watchdog gives up on permanent errors and jitters its retries
- Goal: R6 in `apps/ui/src/features/chat/resume-watchdog.ts`. `retryDelay` stays a pure function of the attempt; the random spread is applied where the timer is set, with an injectable random source so tests are exact.
- Done: tests in `apps/ui/tests/resume-watchdog.test.tsx` show: a 404 and a 401 from a resume inside the loop end the watchdog after that attempt and call give-up once (no further timers); the same for a 4xx thrown by the thread reload after a 204; a 500, a 408, a 429 and a network error still retry; with the random source at its minimum and maximum every delay stays within plus or minus 50 percent of 1, 2, 4, 8, 15, 30 s; 500 simulated clients dropped at the same instant no longer all resume in the same second; the `online` resume happens within 1 s and not at the same instant for all clients; the existing watchdog tests still pass (the exact-delay test is adjusted to use the fixed random source).
- Scope: `apps/ui/src/features/chat/resume-watchdog.ts`, `apps/ui/tests/resume-watchdog.test.tsx`, and `chat-view.tsx` only if its wiring must change.
- Adversarial cases: a 4xx that arrives while an earlier attempt is still busy; a thread deleted in another tab (404 on the reload) ends cleanly and shows the failure state once; cancel (Stop) during a jittered wait leaves no timer; the `online` event during a jittered wait does not double-fire.
- Blocked by: none. Tier: standard. Agent: claude.

### L1. Model circuit breaker and concurrency cap in the api
- Goal: R1 to R5. A small module (`apps/api/src/engine/ask/breaker.ts`) holds per-model state with an injectable clock and random source: closed, open until a time, half-open with one probe. It is consulted at the seam where `aiModel` resolves in `agent.ts` (and the naming call in `chat.ts`), refuses with `AskError(503, "MODEL_UNAVAILABLE", ...)` plus a `retry-after` the controller layer sends as a header, records the outcome of the turn (success, failure by R4, or abort), and counts concurrent turns, releasing the slot on every way a turn can end.
- Done: unit tests of the breaker with a fake clock show: 4 failures then a success leaves it closed with the count reset; 5 consecutive failures open it; while open every call is refused with a retry-after between about 24 and 36 s that shrinks as time passes; after the open time exactly one probe is admitted and concurrent callers are refused; probe success closes, probe failure reopens for a fresh 30 s; a 4xx other than 408 and 429 never counts; an abort counts as neither; the ninth concurrent turn on one model is refused with retry-after 5 and a second model is not affected. Integration tests with the fake OpenAI server show a turn against a failing model returns 503 `MODEL_UNAVAILABLE` with a `retry-after` header before the question is stored (the thread's messages are unchanged), and a recovering model lets one probe turn through. The existing chat, ask and MCP tests pass.
- Scope: `apps/api/src/engine/ask/{breaker,agent,chat,uiChat,errors,http}.ts` and the thread and MCP routes only as far as sending the `retry-after` header; their tests; `apps/api/src/engine/ask/fakeOpenAi.ts` for a failure mode if needed.
- Adversarial cases (each needs a test or a stated reason): a probe turn that never finishes must not wedge the breaker (the slot is released when the turn ends or is stopped, and an abandoned probe times out with the model's own timeout); the slot is released on a thrown error, on an abort, on a cancelled stream and on a thread deleted mid-turn; two simultaneous half-open callers; the clock going backwards (use a monotonic clock); a model name that is not configured still returns the existing 400, not a breaker error; the naming call during an open breaker returns the fallback name without a model call; state does not leak between models or grow without bound (keys come only from configured models).
- Blocked by: none. Tier: standard. Agent: claude.

### K1. Jitter in the scan client's backoff
- Goal: R7. `openAiClient` waits `min(30000, 1000 * 2^attempt)` scaled by a random factor between 0.5 and 1.5, with the random source injectable.
- Done: a test with fake timers or an injected `sleep` shows each wait lies within 50 percent of the old value at both ends of the random range and still caps near 30 s times 1.5; existing `kb` tests pass; no other behaviour changes (still 4 retries, non-retryable 4xx unchanged).
- Scope: `packages/shared/src/kb/llm.ts` and its test.
- Adversarial cases: the abort signal still wins during the wait; a 4xx still throws at once.
- Blocked by: none. Tier: mechanical. Agent: claude.

### L2. Chat shows the refusal; docs
- Goal: when a send is refused with 503 `MODEL_UNAVAILABLE`, the chat shows the server's message including the seconds, keeps the user's text in the composer, and the watchdog does not start (it is an `ApiError`). The ADR is amended in place (dated) in three places: the chat-transport paragraph's watchdog schedule (give up on permanent 4xx, jitter), a new short statement of the model breaker with its constants and what counts as a failure, and the error codes. No new ADR file. `CONTEXT.md` only if a definition needs it.
- Done: a UI test shows a 503 `MODEL_UNAVAILABLE` response produces the message with the seconds, the composer text is kept and no watchdog start is recorded; ADR amended with the date; `pnpm test` and `pnpm typecheck` green.
- Scope: `apps/ui/src/features/chat/**`, `apps/ui/src/lib/api/**` only if the error body is dropped, ui tests, `docs/adr/0001-falkon-architecture.md`, `CONTEXT.md`.
- Blocked by: L1 (the error code and header) and W1 (the ADR describes the final watchdog). Tier: standard. Agent: claude.

## Autonomy limits

- The loop may decide alone: test structure, naming, message wording, where inside the named files the code goes, how the slot release is wired.
- It must stop for: any new dependency, any schema change, any change to the R3 constants or to what counts as a failure (R4), a breaker shared across processes, any change to eval data, any push or pull request, any live call to a real model provider.
- Budget: about 700,000 subagent tokens and 100 minutes wall-clock (four slices, one of them mechanical; the last cycle used about 600,000 for three). Running total checked after each merge.

## Analyze pass

Every slice has a scope, runnable verify commands and an observable done condition. Blocked-by edges: W1, L1 and K1 are free; L2 waits for L1 and W1. No cycle. Together they cover R1 to R7. W1 (`apps/ui` watchdog), L1 (`apps/api/src/engine/ask`) and K1 (`packages/shared/src/kb`) touch disjoint files and may run in parallel; the ADR is touched only by L2.

## Gate 1

Approved: 2026-11-09, all four slices, no changes.
