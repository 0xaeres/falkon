import { Check, LoaderCircle } from "lucide-react";
import {
  ChainOfThought,
  ChainOfThoughtContent,
  ChainOfThoughtStep,
} from "@/components/ai-elements/chain-of-thought";
import { Message, MessageContent } from "@/components/ai-elements/message";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { Markdown } from "../markdown";
import { Asked } from "./asked";

/** The question just sent, with the live progress steps and the streaming preview while the answer is written. */
export function PendingTurn({
  question,
  working,
  repositoryCount,
  filesRead,
  streamText,
}: {
  question: string;
  working: boolean;
  repositoryCount: number;
  filesRead: number;
  streamText: string;
}) {
  return (
    <article className="flex flex-col gap-5">
      {question && <Asked text={question} />}
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
                      Searched {repositoryCount}{" "}
                      {repositoryCount === 1 ? "repository" : "repositories"}
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
                  label={<Shimmer as="span">Writing a grounded answer</Shimmer>}
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
  );
}
