"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
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
  Skeleton,
} from "@/components/ui/primitives";
import { api, keys } from "@/lib/api/client";
import type { Answer } from "@/lib/contracts";
const EvidencePanel = dynamic(() => import("./evidence-panel"), {
  loading: () => <Skeleton label="Loading evidence" />,
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
            citations[Number(part.slice(1, -1))]
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

export function ChatView({ threadId }: { threadId?: string }) {
  const { product, status, statusError, refreshStatus } = useWorkspace();
  const {
    data: thread,
    error: threadError,
    mutate: refreshThread,
  } = useSWR(threadId ? keys.thread(product.id, threadId) : null, api.thread);
  const { mutate } = useSWRConfig();
  const router = useRouter();
  const [question, setQuestion] = useState("");
  const [pendingQuestion, setPendingQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState<Answer | null>(null);
  const [streamText, setStreamText] = useState("");
  const [error, setError] = useState("");
  const [selection, setSelection] = useState<{
    answerId: string;
    sourceId: number;
  } | null>(null);
  const [closed, setClosed] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [copied, setCopied] = useState("");
  const controller = useRef<AbortController | null>(null);
  const threadArea = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  useEffect(
    () => () => {
      controller.current?.abort();
    },
    [],
  );
  useEffect(() => {
    if (busy && threadArea.current)
      threadArea.current.scrollTop = threadArea.current.scrollHeight;
  }, [streamText, busy]);
  const answers = thread?.answers ?? [];
  const latest =
    live ?? [...answers].reverse().find((answer) => answer.evidence.length);
  const selectedAnswer =
    (selection &&
      [...answers, ...(live ? [live] : [])].find(
        (answer) => answer.id === selection.answerId,
      )) ||
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
    if (window.innerWidth < 768) setSheet(true);
  }
  async function send(value = question) {
    const text = value.trim();
    if (!text || busy || !status?.generation) return;
    setBusy(true);
    setError("");
    setPendingQuestion(text);
    setQuestion("");
    setStreamText("");
    setLive(null);
    const abort = new AbortController();
    controller.current = abort;
    try {
      let targetId = threadId;
      if (!targetId) {
        const created = await api.newThread(product.id);
        await mutate(keys.threads(product.id));
        targetId = created.id;
      }
      await api.stream(
        product.id,
        { threadId: targetId, question: text },
        AbortSignal.any([abort.signal, AbortSignal.timeout(30000)]),
        (event) => {
          if (event.type === "start") {
            setLive(event.answer);
            setClosed(false);
            setSelection(null);
          }
          if (event.type === "delta")
            setStreamText((previous) => previous + event.text);
          if (event.type === "done") {
            void refreshThread(event.thread, { revalidate: false });
            setLive(null);
            setPendingQuestion("");
            void mutate(keys.threads(product.id));
          }
        },
      );
      if (!threadId) router.replace(`/${product.id}/chat/${targetId}`);
    } catch (error) {
      setLive(null);
      setError(
        abort.signal.aborted
          ? "Answer stopped. Your question is kept; retry when ready."
          : error instanceof Error
            ? error.message
            : "The answer didn’t arrive. Your question is kept; try again.",
      );
    } finally {
      setBusy(false);
      controller.current = null;
      composer.current?.focus();
    }
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
      setError("Clipboard unavailable. Select the answer text to copy it.");
    }
  }
  if (statusError)
    return (
      <ErrorState error={statusError} retry={() => void refreshStatus()} />
    );
  if (threadError)
    return (
      <ErrorState error={threadError} retry={() => void refreshThread()} />
    );
  if (!status || (threadId && !thread))
    return <Skeleton label="Loading chat" />;
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
          {pendingQuestion && (
            <article className="answer-turn">
              <div className="q">{pendingQuestion}</div>
              {busy && (
                <>
                  <div className="working">
                    <div>
                      <Check size={14} />
                      Searched {product.repositories.length} repositories in{" "}
                      {live?.generation ?? status.generation}
                    </div>
                    <div>
                      <Check size={14} />
                      Read {live?.evidence.length ?? 0} declaration units
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
                onClick={() => controller.current?.abort()}
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
