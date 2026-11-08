import { Check, Copy, FileText, Info, Slash } from "lucide-react";
import {
  Message,
  MessageAction,
  MessageActions,
  MessageContent,
} from "@/components/ai-elements/message";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/primitives";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import type { Answer } from "@falkon/contracts";
import { Markdown } from "../markdown";
import { answerLabel, isCapNote } from "../lib/answer";
import { Asked } from "./asked";
import { Prose } from "./prose";
import { ReplyBody } from "./reply-body";

/** One question and its answer. `activeSource` is the citation whose evidence is open, if it belongs to this answer. */
export function AnswerCard({
  answer,
  newIndex,
  copied,
  activeSource,
  onCopy,
  onCite,
}: {
  answer: Answer;
  newIndex: boolean;
  copied: boolean;
  activeSource: number | null;
  onCopy: () => void;
  onCite: (id: number) => void;
}) {
  const citation = (id: number) => (
    <button
      key={id}
      className={cn(
        "citation mx-px inline-grid h-[18px] min-w-[18px] place-items-center rounded-[4px] border border-input bg-secondary px-1 align-[1px] font-mono text-[0.6875rem] leading-none font-medium text-muted-foreground transition-colors hover:border-info hover:text-foreground",
        activeSource === id &&
          "border-info-strong bg-info-strong text-white hover:text-white",
      )}
      aria-label={`Read source ${id}`}
      onClick={() => onCite(id)}
    >
      {id}
    </button>
  );
  return (
    <article className="flex flex-col gap-5">
      {newIndex && (
        <div className="flex items-center gap-3 text-xs text-faint">
          <Separator className="flex-1" />
          <span>The index was updated before this answer</span>
          <Separator className="flex-1" />
        </div>
      )}
      <Asked text={answer.question} />
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
          {(answer.kind === "grounded" || answer.kind === "partial") && (
            <span>· {answer.evidence.length} sources</span>
          )}
          <span className="flex-1" />
          <MessageActions>
            <MessageAction
              size="icon-xs"
              label="Copy answer"
              aria-label="Copy answer"
              title={copied ? "Copied" : "Copy answer"}
              onClick={() => onCopy()}
            >
              {copied ? <Check /> : <Copy />}
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
                  onClick={() => onCite(answer.evidence[0].id)}
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
                  paragraph.citations.map((id) => [id, citation(id)]),
                );
                return (
                  <div key={index} className="answer-para">
                    <Markdown
                      text={paragraph.text}
                      citations={citations}
                      diagrams={answer.diagrams}
                    />
                    {paragraph.citations
                      .filter((id) => !paragraph.text.includes(`[${id}]`))
                      .map((id) => citations[id])}
                  </div>
                );
              })}
            </div>
          )}
          {answer.gaps.map((gap) => (
            <Notice key={gap} tone="warn" className="text-[0.8125rem]">
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
          {answer.partialReasons.filter(isCapNote).map((reason) => (
            <p
              key={reason}
              className="flex items-center gap-1.5 text-xs text-faint"
            >
              <Info className="size-3.5 shrink-0" aria-hidden="true" />
              {reason}
            </p>
          ))}
        </MessageContent>
      </Message>
    </article>
  );
}
