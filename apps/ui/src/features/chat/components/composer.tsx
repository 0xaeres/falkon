import type { Ref } from "react";
import Link from "next/link";
import { ArrowUp, Square } from "lucide-react";
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "@/components/ai-elements/prompt-input";
import { Badge } from "@/components/ui/badge";
import { StateDot } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import type { Status } from "@falkon/contracts";

/** The question box under the conversation: disabled until the first index exists, Stop while an answer is written. */
export function Composer({
  productId,
  productName,
  status,
  question,
  busy,
  composerRef,
  onQuestion,
  onSend,
  onStop,
}: {
  productId: string;
  productName: string;
  status: Status;
  question: string;
  busy: boolean;
  composerRef: Ref<HTMLTextAreaElement>;
  onQuestion: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
}) {
  return (
    <div className="mx-auto w-full max-w-[1080px] shrink-0 px-5 pt-2 pb-5 md:px-8">
      <PromptInput
        onSubmit={() => onSend()}
        className={cn(
          "[&_[data-slot=input-group]]:rounded-xl [&_[data-slot=input-group]]:bg-card",
          !status.generation && "[&_[data-slot=input-group]]:bg-background",
        )}
      >
        <PromptInputBody>
          <PromptInputTextarea
            ref={composerRef}
            aria-label={`Ask about ${productName}`}
            placeholder={
              status.generation
                ? `Ask about ${productName}`
                : "Chat opens when indexing finishes"
            }
            value={question}
            maxLength={4000}
            disabled={!status.generation || busy}
            className="max-h-36 min-h-[52px] px-4 pt-3.5 text-sm"
            onChange={(event) => onQuestion(event.target.value)}
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
                href={`/${productId}/status`}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                View status
              </Link>
            )}
          </PromptInputTools>
          <PromptInputSubmit
            className="rounded-lg"
            status={busy ? "streaming" : undefined}
            onStop={onStop}
            aria-label={busy ? "Stop answer" : "Send question"}
            disabled={!busy && (!question.trim() || !status.generation)}
          >
            {busy ? <Square className="fill-current" /> : <ArrowUp />}
          </PromptInputSubmit>
        </PromptInputFooter>
      </PromptInput>
    </div>
  );
}
