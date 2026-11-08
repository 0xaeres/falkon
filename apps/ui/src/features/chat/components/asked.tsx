import { Message, MessageContent } from "@/components/ai-elements/message";

/** The question as the person's own bubble. */
export function Asked({ text }: { text: string }) {
  return (
    <Message from="user" className="max-w-[min(720px,80%)]">
      <MessageContent className="rounded-xl rounded-br-sm border bg-secondary px-4 py-2.5 leading-relaxed [overflow-wrap:anywhere]">
        {text}
      </MessageContent>
    </Message>
  );
}
