"use client";

import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import useSWR, { useSWRConfig } from "swr";
import {
  ArrowUp,
  Check,
  Copy,
  FileText,
  Info,
  LoaderCircle,
  RefreshCw,
  Slash,
  Square,
} from "lucide-react";
import {
  ChainOfThought,
  ChainOfThoughtContent,
  ChainOfThoughtStep,
} from "@/components/ai-elements/chain-of-thought";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageAction,
  MessageActions,
  MessageContent,
} from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "@/components/ai-elements/prompt-input";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { useWorkspace } from "@/components/layout/workspace-shell";
import { Mark } from "@/components/ui/brand";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState, Notice, StateDot } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
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
} from "@falkon/contracts";
import { Markdown } from "./markdown";
import { EvidenceSkeleton } from "./evidence-panel";
const EvidencePanel = dynamic(() => import("./evidence-panel"), {
  loading: () => <EvidenceSkeleton />,
});
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
            <span key={index} className="font-mono text-[0.92em]">
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
/** A first message that failed leaves a thread nobody can use: discard it unless this session did not create it or the server already took the question (an assistant message exists). */
export const discardable = (createdHere: boolean, messages: UIMessage[]) =>
  createdHere && !messages.some((message) => message.role === "assistant");
const WIDE = "(min-width: 1280px)";
const isWide = () => window.matchMedia(WIDE).matches;
const subscribeWide = (listener: () => void) => {
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
/** A conversational reply: plain prose and a few things to ask. */
export function ReplyBody({ answer }: { answer: Answer }) {
  return (
    <>
      <div className="answer-prose">
        {answer.paragraphs.map((paragraph, index) => (
          <div key={index} className="answer-para">
            <Markdown text={paragraph.text} />
          </div>
        ))}
      </div>
      {answer.suggestions.length > 0 && (
        <div className="mt-3 text-[0.8125rem] text-muted-foreground">
          <p className="font-medium text-foreground">Try asking</p>
          <ul className="mt-1 list-disc pl-5">
            {answer.suggestions.map((suggestion) => (
              <li key={suggestion}>{suggestion}</li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
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
  if (!status || (threadId && !thread)) return <ChatSkeleton />;
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
  const created = useRef(false);
  const finished = useRef<(done: Finished) => void>(undefined);
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
      // A stopped turn keeps its question on the server: this thread is no longer disposable.
      if (isAbort) created.current = false;
      if (isError && discardable(created.current, messages)) {
        // Nothing was answered: drop the thread made for this message so no empty thread stays in the list.
        const id = target.current;
        target.current = undefined;
        created.current = false;
        if (id)
          void api
            .deleteThread(product.id, id)
            .catch(() => undefined)
            .finally(() => void mutate(keys.threads(product.id)));
      }
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
  // The side pane needs room for code; narrower screens open evidence in a sheet.
  const wide = useSyncExternalStore(subscribeWide, isWide, () => false);
  function cite(answer: Answer, id: number) {
    setSelection({ answerId: answer.id, sourceId: id });
    setClosed(false);
    if (!isWide()) setSheet(true);
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
        const made = await api.newThread(product.id);
        target.current = made.id;
        created.current = true;
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
      await navigator.clipboard.writeText(answerText(answer));
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
  const citation = (answer: Answer, id: number) => (
    <button
      key={id}
      className={cn(
        "citation mx-px inline-grid h-[18px] min-w-[18px] place-items-center rounded-[4px] border border-input bg-secondary px-1 align-[1px] font-mono text-[0.6875rem] leading-none font-medium text-muted-foreground transition-colors hover:border-info hover:text-foreground",
        showEvidence &&
          selectedAnswer?.id === answer.id &&
          selectedSource === id &&
          "border-info-strong bg-info-strong text-white hover:text-white",
      )}
      aria-label={`Read source ${id}`}
      onClick={() => cite(answer, id)}
    >
      {id}
    </button>
  );
  const asked = (text: string) => (
    <Message from="user" className="max-w-[min(560px,88%)]">
      <MessageContent className="rounded-xl rounded-br-sm border bg-secondary px-4 py-2.5 leading-relaxed [overflow-wrap:anywhere]">
        {text}
      </MessageContent>
    </Message>
  );
  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <ResizablePanelGroup orientation="horizontal" id="chat-layout">
        <ResizablePanel id="conversation" minSize="35" className="min-w-0">
          <section
            className="flex h-full min-h-0 min-w-0 flex-col"
            aria-label="Conversation"
          >
            <Conversation className="min-h-0">
              <ConversationContent className="mx-auto w-full max-w-[740px] gap-10 px-5 pt-8 pb-6 md:px-8">
                {!status.generation ? (
                  <ConversationEmptyState className="mt-10 gap-4">
                    <Mark size={36} />
                    <h1 className="text-lg font-semibold tracking-[-0.015em]">
                      {product.name} is still being indexed
                    </h1>
                    <p className="text-[0.8125rem] text-muted-foreground">
                      Chat opens when the first index is ready.
                    </p>
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/${product.id}/status`}>View status</Link>
                    </Button>
                  </ConversationEmptyState>
                ) : !answers.length && !pendingQuestion ? (
                  <ConversationEmptyState className="mt-10 gap-4">
                    <Mark size={36} />
                    <h1 className="text-lg font-semibold tracking-[-0.015em]">
                      Ask about {product.name}
                    </h1>
                    <p className="text-[0.8125rem] text-muted-foreground">
                      Answers cite exact source lines in{" "}
                      {product.repositories.length}{" "}
                      {product.repositories.length === 1
                        ? "repository"
                        : "repositories"}
                      .
                    </p>
                  </ConversationEmptyState>
                ) : null}
                {answers.map((answer, index) => (
                  <article key={answer.id} className="flex flex-col gap-5">
                    {index > 0 &&
                      answers[index - 1].generation !== answer.generation && (
                        <div className="flex items-center gap-3 text-xs text-faint">
                          <Separator className="flex-1" />
                          <span>The index was updated before this answer</span>
                          <Separator className="flex-1" />
                        </div>
                      )}
                    {asked(answer.question)}
                    <Message from="assistant" className="max-w-full">
                      <div className="flex items-center gap-2 text-xs text-faint">
                        <Badge
                          variant={
                            answer.kind === "grounded"
                              ? "success"
                              : answer.kind === "partial"
                                ? "warning"
                                : answer.kind === "abstention"
                                  ? "muted"
                                  : "outline"
                          }
                        >
                          {answerLabel(answer.kind)}
                        </Badge>
                        {(answer.kind === "grounded" ||
                          answer.kind === "partial") && (
                          <span>· {answer.evidence.length} sources</span>
                        )}
                        <span className="flex-1" />
                        <MessageActions>
                          <MessageAction
                            size="icon-xs"
                            label="Copy answer"
                            aria-label="Copy answer"
                            title={
                              copied === answer.id ? "Copied" : "Copy answer"
                            }
                            onClick={() => void copy(answer)}
                          >
                            {copied === answer.id ? <Check /> : <Copy />}
                          </MessageAction>
                        </MessageActions>
                      </div>
                      <MessageContent className="w-full gap-3 overflow-visible">
                        {answer.kind === "reply" ? (
                          <ReplyBody answer={answer} />
                        ) : answer.kind === "abstention" ? (
                          <div className="rounded-xl border bg-card p-4">
                            <h2 className="flex items-center gap-2 text-sm font-medium">
                              <Slash
                                className="size-4 text-muted-foreground"
                                aria-hidden="true"
                              />
                              Not enough evidence to answer
                            </h2>
                            <p className="mt-1.5 max-w-[62ch] text-[0.8125rem] text-muted-foreground">
                              {answer.abstention}
                            </p>
                            {answer.suggestions.length > 0 && (
                              <ul className="mt-2.5 list-disc pl-5 text-[0.8125rem] text-muted-foreground">
                                {answer.suggestions.map((suggestion) => (
                                  <li key={suggestion}>{suggestion}</li>
                                ))}
                              </ul>
                            )}
                            {answer.evidence.length > 0 && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="mt-2 -ml-2"
                                onClick={() =>
                                  cite(answer, answer.evidence[0].id)
                                }
                              >
                                <FileText data-icon="inline-start" />
                                View searched source
                              </Button>
                            )}
                          </div>
                        ) : (
                          <div className="answer-prose">
                            {answer.paragraphs.map((paragraph, index) => {
                              const citations = Object.fromEntries(
                                paragraph.citations.map((id) => [
                                  id,
                                  citation(answer, id),
                                ]),
                              );
                              return (
                                <div key={index} className="answer-para">
                                  <Markdown
                                    text={paragraph.text}
                                    citations={citations}
                                  />
                                  {paragraph.citations
                                    .filter(
                                      (id) =>
                                        !paragraph.text.includes(`[${id}]`),
                                    )
                                    .map((id) => citations[id])}
                                </div>
                              );
                            })}
                          </div>
                        )}
                        {answer.gaps.map((gap) => (
                          <Notice
                            key={gap}
                            tone="warn"
                            className="text-[0.8125rem]"
                          >
                            <Prose text={gap} />
                          </Notice>
                        ))}
                        {answer.partialReasons
                          .filter((reason) => !isCapNote(reason))
                          .map((reason) => (
                            <Notice
                              key={reason}
                              tone="warn"
                              title="Partial result."
                              className="text-[0.8125rem]"
                            >
                              {reason}
                            </Notice>
                          ))}
                        {answer.partialReasons
                          .filter(isCapNote)
                          .map((reason) => (
                            <p
                              key={reason}
                              className="flex items-center gap-1.5 text-xs text-faint"
                            >
                              <Info
                                className="size-3.5 shrink-0"
                                aria-hidden="true"
                              />
                              {reason}
                            </p>
                          ))}
                      </MessageContent>
                    </Message>
                  </article>
                ))}
                {pendingQuestion && (working || !!error) && (
                  <article className="flex flex-col gap-5">
                    {asked(pendingQuestion)}
                    {working && (
                      <Message from="assistant" className="max-w-full">
                        <MessageContent className="w-full gap-4 overflow-visible">
                          <ChainOfThought open>
                            <ChainOfThoughtContent className="mt-0 space-y-2.5">
                              <ChainOfThoughtStep
                                icon={Check}
                                className="text-xs [&_svg]:text-success"
                                label={
                                  <>
                                    Searched {product.repositories.length}{" "}
                                    {product.repositories.length === 1
                                      ? "repository"
                                      : "repositories"}
                                  </>
                                }
                              />
                              <ChainOfThoughtStep
                                icon={Check}
                                className="text-xs [&_svg]:text-success"
                                label={`Read ${filesRead} ${filesRead === 1 ? "file" : "files"}`}
                              />
                              <ChainOfThoughtStep
                                icon={LoaderCircle}
                                status="active"
                                className="text-xs [&_svg]:animate-spin [&_svg]:text-info"
                                label={
                                  <Shimmer as="span">
                                    Writing a grounded answer
                                  </Shimmer>
                                }
                              />
                            </ChainOfThoughtContent>
                          </ChainOfThought>
                          <div className="answer-prose whitespace-pre-wrap">
                            <Markdown text={streamText} final={false} />
                            <span className="ml-0.5 inline-block h-4 w-0.5 animate-blink bg-info align-[-2px]" />
                          </div>
                          <p className="sr-only" role="status">
                            Answer streaming. Stop to cancel.
                          </p>
                        </MessageContent>
                      </Message>
                    )}
                  </article>
                )}
                {error && (
                  <Notice tone="err" title="The answer didn’t arrive.">
                    <p>{error}</p>
                    {pendingQuestion && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-2"
                        disabled={busy}
                        onClick={() => void send(pendingQuestion)}
                      >
                        <RefreshCw data-icon="inline-start" />
                        Retry
                      </Button>
                    )}
                  </Notice>
                )}
              </ConversationContent>
              <ConversationScrollButton aria-label="Scroll to latest" />
            </Conversation>
            <div className="mx-auto w-full max-w-[740px] shrink-0 px-5 pt-2 pb-5 md:px-8">
              <PromptInput
                onSubmit={() => void send()}
                className={cn(
                  "[&_[data-slot=input-group]]:rounded-xl [&_[data-slot=input-group]]:bg-card",
                  !status.generation &&
                    "[&_[data-slot=input-group]]:bg-background",
                )}
              >
                <PromptInputBody>
                  <PromptInputTextarea
                    ref={composer}
                    aria-label={`Ask about ${product.name}`}
                    placeholder={
                      status.generation
                        ? `Ask about ${product.name}`
                        : "Chat opens when indexing finishes"
                    }
                    value={question}
                    maxLength={4000}
                    disabled={!status.generation || busy}
                    className="max-h-36 min-h-[52px] px-4 pt-3.5 text-sm"
                    onChange={(event) => setQuestion(event.target.value)}
                  />
                </PromptInputBody>
                <PromptInputFooter className="px-3 pb-3">
                  <PromptInputTools>
                    <Badge
                      variant="outline"
                      className="gap-1.5 font-normal text-muted-foreground"
                    >
                      <StateDot tone={status.generation ? "green" : "blue"} />
                      {status.generation
                        ? `Index ${status.verdict.toLowerCase()}`
                        : "Indexing"}
                    </Badge>
                    {!status.generation && (
                      <Link
                        href={`/${product.id}/status`}
                        className="text-xs text-muted-foreground hover:text-foreground"
                      >
                        View status
                      </Link>
                    )}
                  </PromptInputTools>
                  <PromptInputSubmit
                    className="rounded-lg"
                    status={busy ? "streaming" : undefined}
                    onStop={() => {
                      setStopped(true);
                      void chat.stop();
                    }}
                    aria-label={busy ? "Stop answer" : "Send question"}
                    disabled={!busy && (!question.trim() || !status.generation)}
                  >
                    {busy ? <Square className="fill-current" /> : <ArrowUp />}
                  </PromptInputSubmit>
                </PromptInputFooter>
              </PromptInput>
            </div>
          </section>
        </ResizablePanel>
        {showEvidence && wide && (
          <>
            <ResizableHandle
              withHandle
              className="w-px bg-border transition-colors hover:bg-info data-[separator=active]:bg-info"
            />
            <ResizablePanel
              id="evidence"
              defaultSize="34"
              minSize={340}
              maxSize="65"
            >
              <aside
                className="h-full min-h-0 min-w-0 overflow-hidden"
                aria-label="Source evidence"
              >
                {evidence}
              </aside>
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>
      <Sheet open={sheet && showEvidence} onOpenChange={setSheet}>
        <SheetContent
          side="right"
          showCloseButton={false}
          className="w-full gap-0 p-0 sm:max-w-[480px] xl:hidden"
        >
          <SheetTitle className="sr-only">Source evidence</SheetTitle>
          <SheetDescription className="sr-only">
            Source excerpts and pinned revisions for this answer.
          </SheetDescription>
          {evidence}
        </SheetContent>
      </Sheet>
    </div>
  );
}

/** Conversation-shaped placeholder: a question, an answer's lines, the composer. */
export function ChatSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading chat"
      className="flex min-h-0 flex-1 flex-col"
    >
      <div className="mx-auto flex w-full max-w-[740px] flex-1 flex-col gap-6 px-5 pt-8 md:px-8">
        <Skeleton className="h-10 w-64 self-end rounded-xl" />
        <div className="flex flex-col gap-2.5">
          <Skeleton className="h-5 w-40 rounded-full" />
          <Skeleton className="h-3.5 w-full" />
          <Skeleton className="h-3.5 w-[92%]" />
          <Skeleton className="h-3.5 w-[78%]" />
          <Skeleton className="h-3.5 w-[60%]" />
        </div>
      </div>
      <div className="mx-auto w-full max-w-[740px] px-5 pb-5 md:px-8">
        <Skeleton className="h-[104px] w-full rounded-xl" />
      </div>
    </div>
  );
}
