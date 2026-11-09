import type { UIMessage } from "ai";
import { rewriteFileRefs, type Answer } from "@falkon/contracts";
import { ApiError, api } from "@/lib/api/client";

const ANSWER_TAG = "<!--answer-->";
export const hasAnswer = (message?: UIMessage) =>
  !!message?.parts.some((part) => part.type === "data-answer");
/** The streaming preview: the text after the answer tag, references as [n], a half-written reference hidden. */
export const preview = (message?: UIMessage) => {
  const text =
    message?.role === "assistant"
      ? message.parts.findLast((part) => part.type === "text")
      : undefined;
  const raw = text?.type === "text" ? text.text : "";
  const tag = raw.indexOf(ANSWER_TAG);
  return rewriteFileRefs(
    (tag === -1 ? raw : raw.slice(tag + ANSWER_TAG.length)).replace(
      /@file:\{[^}]*$/,
      "",
    ),
  ).trimStart();
};
/** A first message that failed leaves a thread nobody can use: discard it unless this session did not create it or the server already took the question (an assistant message exists). */
export const discardable = (createdHere: boolean, messages: UIMessage[]) =>
  createdHere && !messages.some((message) => message.role === "assistant");
/** The composer text after an error: the typed text stays; else the sent text returns when this send was refused (model unavailable) and no watchdog owns the turn. */
export const restoreText = (
  error: unknown,
  watchActive: boolean,
  current: string,
  sent: string,
) =>
  current ||
  (error instanceof ApiError &&
  error.code === "MODEL_UNAVAILABLE" &&
  !watchActive
    ? sent
    : current);
const WIDE = "(min-width: 1280px)";
export const isWide = () => window.matchMedia(WIDE).matches;
export const subscribeWide = (listener: () => void) => {
  const query = window.matchMedia(WIDE);
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
};
/** The engine's display cap: every claim is still in the prose, only the source chips past the cap are not shown. A note, not a warning. */
export const isCapNote = (reason: string) =>
  /not shown \(limit \d+\)/.test(reason);
export const answerLabel = (kind: Answer["kind"]) =>
  ({
    grounded: "Grounded answer",
    partial: "Partial answer",
    abstention: "Abstained",
    reply: "Reply",
  })[kind];
export const answerText = (answer: Answer) =>
  answer.abstention ??
  answer.paragraphs
    .map(
      (paragraph) =>
        paragraph.text +
        paragraph.citations
          .filter((id) => !paragraph.text.includes(`[${id}]`))
          .map((id) => ` [${id}]`)
          .join(""),
    )
    .join("\n\n");
/** Asks the server to end the answer, once more if the first call fails; false when it could not. */
export const stopOnServer = async (productId: string, threadId: string) => {
  for (let attempt = 0; attempt < 2; attempt++)
    try {
      await api.stopThread(productId, threadId);
      return true;
    } catch {}
  return false;
};
/** A stopped or failed turn leaves a half-written assistant message; it is not an answer. */
export const dropIncomplete = (messages: UIMessage[]) => {
  const last = messages.at(-1);
  return last?.role === "assistant" && !hasAnswer(last)
    ? messages.slice(0, -1)
    : messages;
};
