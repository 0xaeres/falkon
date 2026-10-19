"use client";

import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import useSWR, { useSWRConfig } from "swr";
import * as Dialog from "@radix-ui/react-dialog";
import {
  ArrowUp,
  Check,
  Copy,
  FileText,
  RefreshCw,
  Slash,
  Square,
} from "lucide-react";
import { useWorkspace } from "@/components/layout/workspace-shell";
import { Mark } from "@/components/ui/brand";
import {
  Alert,
  Button,
  ErrorState,
  LoadingMark,
} from "@/components/ui/primitives";
import { useChat } from "@ai-sdk/react";
import type { UIMessage } from "ai";
import { ApiError, api, keys } from "@/lib/api/client";
import { chatTransport } from "@/lib/api/chat-transport";
import {
  answersToMessages,
  messagesToAnswers,
  rewriteFileRefs,
  type Answer,
  type Status,
  type Thread,
} from "@sbc/contracts";
const EvidencePanel = dynamic(() => import("./evidence-panel"), {
  loading: () => <LoadingMark label="Loading evidence" />,
});
const examples = [
  ["What calls POST /v1/refunds?", "Trace callers across repositories"],
  ["Where are ledger entries written?", "Find every write path"],
  ["How is the webhook signature checked?", "Read the verification code"],
  ["What depends on CurrencyRounding?", "See potential impact of a change"],
];

function Prose({
  text,
  citations = {},
}: {
  text: string;
  citations?: Record<number, ReactNode>;
}) {
  return (
    <>
      {text
        .split(
          /(\[\d+\]|POST \/v1\/refunds|RefundService\.create|RefundPostingService|CreateRefundDto|operatorId|@acme\/fraud-check)/g,
        )
        .map((part, index) =>
          /^\[\d+\]$/.test(part) && citations[Number(part.slice(1, -1))] ? (
            <Fragment key={index}>
              {citations[Number(part.slice(1, -1))]}
            </Fragment>
          ) : /^(POST |RefundService|RefundPostingService|CreateRefundDto|operatorId|@acme)/.test(
              part,
            ) ? (
            <span key={index} className="mono">
              {part}
            </span>
          ) : (
            part
          ),
        )}
    </>
  );
}

const ANSWER_TAG = "<!--answer-->";
const hasAnswer = (message?: UIMessage) =>
  !!message?.parts.some((part) => part.type === "data-answer");
/** The streaming preview: the text after the answer tag, references as [n], a half-written reference hidden. */
const preview = (message?: UIMessage) => {
  const text = message?.parts.findLast((part) => part.type === "text");
  const raw = text?.type === "text" ? text.text : "";
  const tag = raw.indexOf(ANSWER_TAG);
  return rewriteFileRefs(
    (tag === -1 ? raw : raw.slice(tag + ANSWER_TAG.length)).replace(
      /@file:\{[^}]*$/,
      "",
    ),
  ).trimStart();
};
/** A stopped or failed turn leaves a half-written assistant message; it is not an answer. */
const dropIncomplete = (messages: UIMessage[]) => {
  const last = messages.at(-1);
  return last?.role === "assistant" && !hasAnswer(last)
    ? messages.slice(0, -1)
    : messages;
};

export function ChatView({ threadId }: { threadId?: string }) {
  const { product, status, statusError, refreshStatus } = useWorkspace();
  const {
    data: thread,
    error: threadError,
    mutate: refreshThread,
  } = useSWR(threadId ? keys.thread(product.id, threadId) : null, api.thread);
  if (statusError)
    return (
      <ErrorState error={statusError} retry={() => void refreshStatus()} />
    );
  if (threadError)
    return (
      <ErrorState error={threadError} retry={() => void refreshThread()} />
    );
  if (!status || (threadId && !thread))
    return <LoadingMark label="Loading chat" />;
  return (
    <ChatSession
      key={threadId ?? "new"}
      threadId={threadId}
      thread={thread}
      status={status}
      refreshThread={() => refreshThread()}
    />
  );
}

type Finished = { messages: UIMessage[]; isAbort: boolean; isError: boolean };

/** One conversation. The stored answers seed `useChat` once; from then on its messages are what is shown. */
function ChatSession({
  threadId,
  thread,
  status,
  refreshThread,
}: {
  threadId?: string;
  thread?: Thread;
  status: Status;
  refreshThread: () => Promise<unknown>;
}) {
  const { product } = useWorkspace();
  const { mutate } = useSWRConfig();
  const router = useRouter();
  const [question, setQuestion] = useState("");
  const [pendingQuestion, setPendingQuestion] = useState("");
  const [creating, setCreating] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [notice, setNotice] = useState("");
  const [selection, setSelection] = useState<{
    answerId: string;
    sourceId: number;
  } | null>(null);
  const [closed, setClosed] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [copied, setCopied] = useState("");
  const target = useRef(threadId);
  const finished = useRef<(done: Finished) => void>(undefined);
  const threadArea = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  // Seeds the first render only.
  const initial = useMemo(
    () => answersToMessages(thread?.answers ?? []) as UIMessage[],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const transport = useMemo(() => chatTransport(product.id), [product.id]);
  const chat = useChat({
    id: threadId ?? "new-thread",
    messages: initial,
    transport,
    onFinish: (done) => finished.current?.(done),
  });
  useEffect(() => {
    finished.current = ({ messages, isAbort, isError }) => {
      if (isAbort || isError) return chat.setMessages(dropIncomplete(messages));
      setPendingQuestion("");
      void mutate(keys.threads(product.id));
      void refreshThread();
      if (!threadId && target.current)
        router.replace(`/${product.id}/chat/${target.current}`);
    };
  });
  const lastMessage = chat.messages.at(-1);
  const inFlight = chat.status === "submitted" || chat.status === "streaming";
  const arrived = hasAnswer(lastMessage);
  // Working: asking, or waiting for the answer parts, which arrive just before the stream ends.
  const working = (creating || inFlight) && !arrived;
  const busy = creating || inFlight;
  const settled =
    inFlight && !arrived
      ? chat.messages.slice(0, lastMessage?.role === "assistant" ? -2 : -1)
      : chat.messages;
  const answers = useMemo(
    () => messagesToAnswers(product.id, settled),
    [product.id, settled],
  );
  const streamText = working ? preview(lastMessage) : "";
  const filesRead =
    working && lastMessage?.role === "assistant"
      ? lastMessage.parts.filter((part) => part.type === "data-source").length
      : 0;
  const error = stopped
    ? "Answer stopped. Your question is kept; retry when ready."
    : notice ||
      (chat.error
        ? chat.error instanceof ApiError
          ? chat.error.message
          : "The answer didn’t arrive. Your question is kept; try again."
        : "");
  useEffect(() => {
    if (working && threadArea.current)
      threadArea.current.scrollTop = threadArea.current.scrollHeight;
  }, [streamText, working]);
  const latest = [...answers]
    .reverse()
    .find((answer) => answer.evidence.length);
  const selectedAnswer =
    (selection && answers.find((answer) => answer.id === selection.answerId)) ||
    latest;
  const selectedSource =
    selection?.sourceId ??
    (selectedAnswer?.evidence.some((source) => source.id === 2)
      ? 2
      : (selectedAnswer?.evidence[0]?.id ?? 1));
  const showEvidence = !!selectedAnswer?.evidence.length && !closed;
  function cite(answer: Answer, id: number) {
    setSelection({ answerId: answer.id, sourceId: id });
    setClosed(false);
    if (window.innerWidth < 1280) setSheet(true);
  }
  async function send(value = question) {
    const text = value.trim();
    if (!text || busy || !status.generation) return;
    setNotice("");
    setStopped(false);
    setPendingQuestion(text);
    setQuestion("");
    setSelection(null);
    setClosed(false);
    if (!target.current) {
      setCreating(true);
      try {
        const created = await api.newThread(product.id);
        target.current = created.id;
        void mutate(keys.threads(product.id));
      } catch (failure) {
        setNotice(
          failure instanceof Error
            ? failure.message
            : "The answer didn’t arrive. Your question is kept; try again.",
        );
        return;
      } finally {
        setCreating(false);
      }
    }
    await chat.sendMessage({ text }, { body: { threadId: target.current } });
    composer.current?.focus();
  }
  async function copy(answer: Answer) {
    try {
      await navigator.clipboard.writeText(
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
            .join("\n\n"),
      );
      setCopied(answer.id);
    } catch {
      setNotice("Clipboard unavailable. Select the answer text to copy it.");
    }
  }
  const evidence = selectedAnswer && (
    <EvidencePanel
      answer={selectedAnswer}
      selected={selectedSource}
      onSelect={(id) => cite(selectedAnswer, id)}
      onClose={() => {
        setClosed(true);
        setSheet(false);
      }}
    />
  );
  return (
    <div className={`chat-layout ${showEvidence ? "" : "no-evidence"}`}>
      <section className="chat-middle" aria-label="Conversation">
        <div className="thread-area" ref={threadArea}>
          {!status.generation ? (
            <div className="hello">
              <Mark size={40} />
              <h1>{product.name} is still being built</h1>
              <p>
                The first Evidence Generation,{" "}
                <span className="mono">g-0001</span>, is in the extract stage.
                Chat opens when it publishes.
              </p>
              <Link className="btn" href={`/${product.id}/status`}>
                View status
              </Link>
            </div>
          ) : !answers.length && !pendingQuestion ? (
            <>
              <div className="hello">
                <Mark size={40} />
                <h1>Ask about {product.name}</h1>
                <p>
                  Answers cite the exact source in {product.repositories.length}{" "}
                  repositories, pinned to{" "}
                  <span className="mono">{status.generation}</span>.
                </p>
              </div>
              {product.id === "payments-platform" ? (
                <div className="examples">
                  {examples.map(([prompt, description]) => (
                    <button
                      key={prompt}
                      onClick={() => {
                        setQuestion(prompt);
                        composer.current?.focus();
                      }}
                    >
                      <strong>{prompt}</strong>
                      <span>{description}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <Alert>
                  No example questions are available for this Product’s mock
                  dataset. Ask a question to see an honest abstention.
                </Alert>
              )}
            </>
          ) : null}
          {answers.map((answer, index) => (
            <article key={answer.id} className="answer-turn">
              {index > 0 &&
                answers[index - 1].generation !== answer.generation && (
                  <div className="generation-divider">
                    Context updated to{" "}
                    <span className="mono">{answer.generation}</span>
                  </div>
                )}
              <div className="q">{answer.question}</div>
              <div className="answer-meta">
                <span>
                  {answer.kind === "grounded"
                    ? "Grounded answer"
                    : answer.kind === "partial"
                      ? "Partial answer"
                      : "Abstained"}
                </span>
                <span>·</span>
                <span className="mono">{answer.generation}</span>
                {answer.kind !== "abstention" && (
                  <span>· {answer.evidence.length} sources</span>
                )}
                <span className="sp" />
                <button
                  className="icon-btn"
                  aria-label="Copy answer"
                  title={copied === answer.id ? "Copied" : "Copy answer"}
                  onClick={() => void copy(answer)}
                >
                  {copied === answer.id ? (
                    <Check size={14} />
                  ) : (
                    <Copy size={14} />
                  )}
                </button>
              </div>
              {answer.kind === "abstention" ? (
                <div className="abstention">
                  <h2>
                    <Slash size={16} />
                    Not enough evidence to answer
                  </h2>
                  <p>{answer.abstention}</p>
                  <ul>
                    {answer.suggestions.map((suggestion) => (
                      <li key={suggestion}>{suggestion}</li>
                    ))}
                  </ul>
                  {answer.evidence.length > 0 && (
                    <button
                      className="btn ghost sm"
                      onClick={() => cite(answer, answer.evidence[0].id)}
                    >
                      <FileText size={14} />
                      View searched source
                    </button>
                  )}
                </div>
              ) : (
                <div className="answer-prose">
                  {answer.paragraphs.map((paragraph, index) => {
                    const citations = Object.fromEntries(
                      paragraph.citations.map((id) => [
                        id,
                        <button
                          key={id}
                          className={`citation ${showEvidence && selectedAnswer?.id === answer.id && selectedSource === id ? "on" : ""}`}
                          aria-label={`Read source ${id}`}
                          onClick={() => cite(answer, id)}
                        >
                          {id}
                        </button>,
                      ]),
                    );
                    return (
                      <p key={index}>
                        <Prose text={paragraph.text} citations={citations} />{" "}
                        {paragraph.citations
                          .filter((id) => !paragraph.text.includes(`[${id}]`))
                          .map((id) => citations[id])}
                      </p>
                    );
                  })}
                </div>
              )}
              {answer.gaps.map((gap) => (
                <Alert key={gap} tone="warn" className="answer-callout">
                  <Prose text={gap} />
                </Alert>
              ))}
              {answer.partialReasons.map((reason) => (
                <Alert key={reason} tone="warn" className="answer-callout">
                  <strong>Partial result.</strong> {reason}
                </Alert>
              ))}
            </article>
          ))}
          {pendingQuestion && (working || !!error) && (
            <article className="answer-turn">
              <div className="q">{pendingQuestion}</div>
              {working && (
                <>
                  <div className="working">
                    <div>
                      <Check size={14} />
                      Searched {product.repositories.length} repositories in{" "}
                      {status.generation}
                    </div>
                    <div>
                      <Check size={14} />
                      Read {filesRead} {filesRead === 1 ? "file" : "files"}
                    </div>
                    <div>
                      <span className="stream-dot" />
                      Writing a grounded answer
                    </div>
                  </div>
                  <div className="answer-prose streaming">
                    <p>
                      {streamText}
                      <span className="cursor" />
                    </p>
                  </div>
                  <p className="sr-only" role="status">
                    Answer streaming. Stop to cancel.
                  </p>
                </>
              )}
            </article>
          )}
          {error && (
            <Alert tone="err" className="answer-callout">
              <strong>The answer didn’t arrive.</strong>
              <p>{error}</p>
              {pendingQuestion && (
                <Button
                  className="sm"
                  disabled={busy}
                  onClick={() => void send(pendingQuestion)}
                >
                  <RefreshCw size={14} />
                  Retry
                </Button>
              )}
            </Alert>
          )}
        </div>
        <form
          className={`composer ${!status.generation ? "disabled" : ""}`}
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <textarea
            ref={composer}
            aria-label={`Ask about ${product.name}`}
            placeholder={
              status.generation
                ? `Ask about ${product.name}`
                : "Chat opens when the first Evidence Generation is published"
            }
            value={question}
            maxLength={4000}
            disabled={!status.generation || busy}
            rows={2}
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                void send();
              }
            }}
          />
          <div className="composer-footer">
            <span className="scope">
              <span
                className={`pdot ${status.generation ? "green" : "blue"}`}
              />
              {status.generation
                ? `${status.generation} · ${status.verdict.toLowerCase()}`
                : "g-0001 building"}
            </span>
            {!status.generation && (
              <Link href={`/${product.id}/status`}>View status</Link>
            )}
            <span className="sp" />
            {busy ? (
              <button
                type="button"
                className="send"
                aria-label="Stop answer"
                onClick={() => {
                  setStopped(true);
                  void chat.stop();
                }}
              >
                <Square size={14} />
              </button>
            ) : (
              <button
                className="send"
                type="submit"
                aria-label="Send question"
                disabled={!question.trim() || !status.generation}
              >
                <ArrowUp size={17} />
              </button>
            )}
          </div>
        </form>
      </section>
      {showEvidence && (
        <aside className="desktop-evidence" aria-label="Source evidence">
          {evidence}
        </aside>
      )}
      <Dialog.Root open={sheet && showEvidence} onOpenChange={setSheet}>
        <Dialog.Portal>
          <Dialog.Overlay className="evidence-overlay" />
          <Dialog.Content className="evidence-sheet">
            <Dialog.Title className="sr-only">Source evidence</Dialog.Title>
            <Dialog.Description className="sr-only">
              Source excerpts and pinned revisions for this answer.
            </Dialog.Description>
            {evidence}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
