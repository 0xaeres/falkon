import { browsePath, type ToolSource } from "@falkon/shared";
import type { UIMessage } from "ai";
import { ANSWER_TAG, FILE_REFERENCE_REGEX } from "./prompt";

type TextPart = { type: "text"; text: string };

/** The answer is the last text part from the answer tag on; without the tag, the whole last text (unless still streaming). */
export function answerPart(message: UIMessage, inProgress: boolean): TextPart | undefined {
  const last = message.parts.findLast((p): p is TextPart => p.type === "text");
  if (last?.text.includes(ANSWER_TAG)) return { ...last, text: last.text.substring(last.text.indexOf(ANSWER_TAG) + ANSWER_TAG.length) };
  if (!inProgress && last) return last;
  return undefined;
}

/** The highlightRange query that browse links carry. */
const highlight = (start: string, end?: string) => `?${new URLSearchParams({ highlightRange: `${start},${end || start}` }).toString()}`;

/**
 * Answer text for outside the UI: drops the answer tag and turns each @file:{repo::path:a-b} into a
 * markdown link to the web UI, resolved against the files tools returned; unknown files become their path.
 */
export function toPortableMarkdown(text: string, baseUrl: string, sources: ToolSource[]): string {
  return text
    .replace(ANSWER_TAG, "")
    .replace(FILE_REFERENCE_REGEX, (_m, repo: string, _port, path: string, start?: string, end?: string) => {
      const src = sources.find((s) => s.repo.endsWith(repo) && s.path.endsWith(path));
      if (!src) return path;
      let label = src.name;
      if (start) label += end && start !== end ? `:${start}-${end}` : `:${start}`;
      return `[${label}](${baseUrl}${browsePath(repo, path, "blob", src.revision)}${start ? highlight(start, end) : ""})`;
    })
    .trim();
}

/** Every file source the tools wrote into the chat (data-source parts). */
export const sourcesOf = (messages: UIMessage[]): ToolSource[] =>
  messages.flatMap((m) => m.parts.filter((p) => p.type === "data-source").map((p) => (p as { data: ToolSource }).data).filter((s) => s.type === "file"));
