"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import useSWR, { useSWRConfig } from "swr";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { useWorkspace } from "@/components/layout/workspace-shell";
import { ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { ErrorState, Notice } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import { useChat } from "@ai-sdk/react";
import type { UIMessage } from "ai";
import { ApiError, api, keys } from "@/lib/api/client";
import { chatTransport } from "@/lib/api/chat-transport";
import {
  answersToMessages,
  messagesToAnswers,
  type Answer,
  type Status,
  type Thread,
} from "@falkon/contracts";
import { EvidenceSkeleton } from "./evidence-panel";
import { settleThread, useResumeWatchdog } from "./resume-watchdog";
import {
  answerText,
  discardable,
  dropIncomplete,
  hasAnswer,
  isWide,
  preview,
  restoreText,
  stopOnServer,
  subscribeWide,
} from "./lib/answer";
import { AnswerCard } from "./components/answer-card";
import { ChatSkeleton } from "./components/chat-skeleton";
import { Composer } from "./components/composer";
import { EvidenceAside, EvidenceSheet } from "./components/evidence-slots";
import { EmptyStates } from "./components/empty-states";
import { PendingTurn } from "./components/pending-turn";
const EvidencePanel = dynamic(() => import("./evidence-panel"), {
  loading: () => <EvidenceSkeleton />,
});

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
  refreshThread: () => Promise<Thread | undefined>;
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
  const sent = useRef("");
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
  const onError = useRef<(error: Error) => void>(undefined);
  const chat = useChat({
    id: threadId ?? "new-thread",
    messages: initial,
    transport,
    // A page opened on a thread whose answer is still being written picks it up.
    resume: !!threadId,
    onError: (error) => onError.current?.(error),
    onFinish: (done) => finished.current?.(done),
  });
  // A dropped connection does not end the answer: the watchdog resumes it until it ends or Stop.
  const watch = useResumeWatchdog({
    resume: () => chat.resumeStream({ body: { threadId: target.current } }),
    drop: () => chat.setMessages(dropIncomplete(chat.messages)),
    answers: () =>
      messagesToAnswers(product.id, dropIncomplete(chat.messages)).length,
    settle: (before) =>
      settleThread(
        () => api.thread(keys.thread(product.id, target.current!)),
        before,
        (messages) => {
          chat.setMessages(messages);
          chat.clearError();
          finished.current?.({ messages, isAbort: false, isError: false });
        },
      ),
    giveUp: () =>
      finished.current?.({
        messages: dropIncomplete(chat.messages),
        isAbort: false,
        isError: true,
      }),
  });
  useEffect(() => {
    onError.current = (error) => {
      // A refused send (model unavailable) stored nothing: the text goes back to the composer.
      const active = watch.active();
      setQuestion((q) => restoreText(error, active, q, sent.current));
      watch.error(error);
    };
    finished.current = ({ messages, isAbort, isError }) => {
      if (!isError && !isAbort) {
        watch.finish();
        sent.current = "";
      }
      if (isError && !isAbort && watch.active()) return;
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
      const reloaded = refreshThread();
      // A resumed page holds the answer without its question: show the stored thread.
      if (messages.at(-2)?.role !== "user")
        void reloaded.then(
          (t) =>
            t && chat.setMessages(answersToMessages(t.answers) as UIMessage[]),
        );
      if (!threadId && target.current)
        router.replace(`/${product.id}/chat/${target.current}`);
    };
  });
  const lastMessage = chat.messages.at(-1);
  const inFlight = chat.status === "submitted" || chat.status === "streaming";
  const arrived = hasAnswer(lastMessage);
  // Working: asking, or waiting for the answer parts, which arrive just before the stream ends.
  const working = (creating || inFlight || watch.reconnecting) && !arrived;
  const busy = creating || inFlight || watch.reconnecting;
  const settled =
    inFlight && !arrived
      ? chat.messages.slice(
          0,
          lastMessage?.role === "assistant" &&
            chat.messages.at(-2)?.role === "user"
            ? -2
            : -1,
        )
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
  const error = watch.reconnecting
    ? ""
    : stopped
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
    sent.current = text;
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

  function stop() {
    setStopped(true);
    watch.cancel();
    // The server keeps writing unless told: Stop ends it, keeping the question only.
    created.current = false;
    if (target.current)
      void stopOnServer(product.id, target.current).then((ok) => {
        if (ok) return;
        setStopped(false);
        setNotice(
          "Couldn’t stop the answer; it may still finish in this thread.",
        );
      });
    void chat.stop();
  }

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <ResizablePanelGroup orientation="horizontal" id="chat-layout">
        <ResizablePanel id="conversation" minSize="35" className="min-w-0">
          <section
            className="flex h-full min-h-0 min-w-0 flex-col"
            aria-label="Conversation"
          >
            <Conversation className="min-h-0">
              <ConversationContent className="mx-auto w-full max-w-[1080px] gap-10 px-5 pt-8 pb-6 md:px-8">
                {(!status.generation ||
                  (!answers.length && !pendingQuestion)) && (
                  <EmptyStates
                    productId={product.id}
                    productName={product.name}
                    repositoryCount={product.repositories.length}
                    indexed={!!status.generation}
                  />
                )}
                {answers.map((answer, index) => (
                  <AnswerCard
                    key={answer.id}
                    answer={answer}
                    newIndex={
                      index > 0 &&
                      answers[index - 1].generation !== answer.generation
                    }
                    copied={copied === answer.id}
                    activeSource={
                      showEvidence && selectedAnswer?.id === answer.id
                        ? selectedSource
                        : null
                    }
                    onCopy={() => void copy(answer)}
                    onCite={(id) => cite(answer, id)}
                  />
                ))}
                {(working || (!!pendingQuestion && !!error)) && (
                  <PendingTurn
                    question={pendingQuestion}
                    working={working}
                    repositoryCount={product.repositories.length}
                    filesRead={filesRead}
                    streamText={streamText}
                  />
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
            <Composer
              productId={product.id}
              productName={product.name}
              status={status}
              question={question}
              busy={busy}
              composerRef={composer}
              onQuestion={setQuestion}
              onSend={() => void send()}
              onStop={stop}
            />
          </section>
        </ResizablePanel>
        {showEvidence && wide && <EvidenceAside>{evidence}</EvidenceAside>}
      </ResizablePanelGroup>
      <EvidenceSheet open={sheet && showEvidence} onOpenChange={setSheet}>
        {evidence}
      </EvidenceSheet>
    </div>
  );
}
