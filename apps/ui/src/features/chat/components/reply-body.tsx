import type { Answer } from "@falkon/contracts";
import { Markdown } from "../markdown";

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
