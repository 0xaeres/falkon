"use client";

import { useEffect, useRef, useState } from "react";
import type { UIMessage } from "ai";
import { answersToMessages, type Thread } from "@falkon/contracts";
import { ApiError } from "@/lib/api/client";

/** Seconds before each retry: 1, 2, 4, 8, 15, then every 30. */
export const retryDelay = (attempt: number) =>
  ([1, 2, 4, 8, 15][attempt] ?? 30) * 1000;

export type WatchdogDeps = {
  /** One resume attempt (`chat.resumeStream`). */
  resume: () => Promise<void>;
  /** Removes the partial assistant message a resume would otherwise duplicate. */
  drop: () => void;
  /** Answers the chat holds without the partial one. */
  answers: () => number;
  /** After a 204: reloads the thread and shows it; true when it holds more answers than `before`. Throws while offline. */
  settle: (before: number) => Promise<boolean>;
  /** Nothing was stored: today's failure path. */
  giveUp: () => void;
  onChange: (reconnecting: boolean) => void;
  events?: Pick<EventTarget, "addEventListener" | "removeEventListener">;
};

/** After a 204: reloads the thread and shows it when it holds more answers than before (the answer finished while the page was away). */
export async function settleThread(
  load: () => Promise<Thread>,
  before: number,
  show: (messages: UIMessage[]) => void,
) {
  const { answers } = await load();
  if (answers.length <= before) return false;
  show(answersToMessages(answers) as UIMessage[]);
  return true;
}

/**
 * Keeps an answer alive across a lost connection (D148). `error` starts it on any stream error that is not a refusal from
 * the server; it resumes at once on `online`, else after `retryDelay`, with no limit, and stops on success, on a 204 that
 * settles, or on `cancel`. An attempt is told apart by what the chat reported meanwhile: `finish` is a success, `error` a
 * failure, neither a 204 (nothing running).
 */
export function createWatchdog(d: WatchdogDeps) {
  let errors = 0;
  let finishes = 0;
  let stop: (() => void) | undefined;

  function start() {
    const events = d.events ?? window;
    d.drop();
    const before = d.answers();
    let attempt = 0;
    let busy = false;
    let done = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const end = () => {
      done = true;
      clearTimeout(timer);
      events.removeEventListener("online", now);
      stop = undefined;
      d.onChange(false);
    };
    const later = () => void (timer = setTimeout(run, retryDelay(attempt++)));
    const now = () => {
      clearTimeout(timer);
      void run();
    };
    async function run() {
      if (done || busy) return;
      busy = true;
      d.drop();
      const [e, f] = [errors, finishes];
      try {
        await d.resume();
      } catch {
        errors++;
      }
      let settled: boolean | undefined;
      if (!done && errors === e && finishes === f) {
        try {
          settled = await d.settle(before);
        } catch {
          /* offline: try again */
        }
      }
      busy = false;
      if (done) return;
      if (errors === e && (finishes > f || settled !== undefined)) {
        end();
        if (settled === false) d.giveUp();
      } else later();
    }
    stop = end;
    events.addEventListener("online", now);
    d.onChange(true);
    later();
  }

  return {
    error(e: unknown) {
      errors++;
      if (!stop && !(e instanceof ApiError)) start();
    },
    finish: () => void finishes++,
    /** True while the watchdog owns the turn: the caller's failure path stays off. */
    active: () => !!stop,
    cancel: () => stop?.(),
  };
}

/** The watchdog for one chat session; `reconnecting` is true while it is resuming. */
export function useResumeWatchdog(deps: Omit<WatchdogDeps, "onChange">) {
  const [reconnecting, setReconnecting] = useState(false);
  const latest = useRef(deps);
  useEffect(() => {
    latest.current = deps;
  });
  const [dog] = useState(() =>
    createWatchdog({
      resume: () => latest.current.resume(),
      drop: () => latest.current.drop(),
      answers: () => latest.current.answers(),
      settle: (before) => latest.current.settle(before),
      giveUp: () => latest.current.giveUp(),
      onChange: setReconnecting,
    }),
  );
  useEffect(() => dog.cancel, [dog]);
  return { ...dog, reconnecting };
}
