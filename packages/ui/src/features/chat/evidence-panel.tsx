"use client";
import { useState } from "react";
import {
  Check,
  Copy,
  ExternalLink,
  FileCode2,
  PanelRightClose,
} from "lucide-react";
import type { Answer, Evidence } from "@falkon/contracts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

function CodeLine({ line }: { line: string }) {
  const parts = line.split(
    /("[^"\n]*"|'[^'\n]*'|\/\/.*$|\b(?:async|await|const|return|this|export|function|public|void|true|false)\b)/g,
  );
  return (
    <>
      {parts.map((part, index) => (
        <span
          key={index}
          className={
            part.startsWith("//")
              ? "syntax-comment"
              : /^["']/.test(part)
                ? "syntax-string"
                : /^(async|await|const|return|this|export|function|public|void|true|false)$/.test(
                      part,
                    )
                  ? "syntax-keyword"
                  : undefined
          }
        >
          {part}
        </span>
      ))}
    </>
  );
}

/** Pane-shaped placeholder while the evidence code loads. */
export function EvidenceSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading evidence"
      className="flex h-full flex-col border-l bg-card"
    >
      <div className="flex h-12 items-center gap-3 border-b px-4">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-3 w-14" />
      </div>
      <div className="flex flex-col gap-3 p-4">
        <div className="flex gap-1.5">
          {[0, 1, 2].map((tab) => (
            <Skeleton key={tab} className="size-7" />
          ))}
        </div>
        <Skeleton className="h-4 w-44" />
        <Skeleton className="h-3 w-64" />
        <Skeleton className="h-56 w-full rounded-lg" />
      </div>
    </div>
  );
}

export default function EvidencePanel({
  answer,
  selected,
  onSelect,
  onClose,
}: {
  answer: Answer;
  selected: number;
  onSelect: (id: number) => void;
  onClose: () => void;
}) {
  const evidence =
    answer.evidence.find((source) => source.id === selected) ??
    answer.evidence[0];
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  if (!evidence) return null;
  async function copy(source: Evidence) {
    try {
      await navigator.clipboard.writeText(source.code.join("\n"));
      setCopied(true);
      setCopyError("");
    } catch {
      setCopyError("Clipboard unavailable. Select the source text to copy it.");
    }
  }
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-card">
      <header className="flex h-12 shrink-0 items-center gap-2.5 border-b pr-2 pl-4">
        <h2 className="text-[0.8125rem] font-medium">Evidence</h2>
        {answer.kind === "abstention" && (
          <Badge variant="muted">Searched, not cited</Badge>
        )}
        <span className="flex-1" />
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Close evidence"
          onClick={onClose}
        >
          <PanelRightClose />
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col gap-4 p-4">
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={String(evidence.id)}
            onValueChange={(value) => {
              if (!value) return;
              setCopied(false);
              onSelect(Number(value));
            }}
            aria-label="Evidence sources"
            className="flex-wrap"
          >
            {answer.evidence.map((source) => (
              <ToggleGroupItem
                key={source.id}
                value={String(source.id)}
                aria-label={`Source ${source.id}: ${source.repository}`}
                className="min-w-8 font-mono text-xs data-[state=on]:border-info-strong data-[state=on]:bg-info-strong data-[state=on]:text-white"
              >
                {source.id}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <section
            aria-label={`Source ${evidence.id}`}
            className="flex min-w-0 flex-col gap-2"
          >
            <div className="flex items-center gap-2">
              <FileCode2
                className="size-3.5 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
              <strong className="min-w-0 flex-1 truncate text-[0.8125rem] font-medium">
                {evidence.repository}
              </strong>
              {evidence.sourceUrl ? (
                <Button
                  asChild
                  variant="ghost"
                  size="xs"
                  className="text-muted-foreground"
                >
                  <a
                    href={evidence.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ExternalLink />
                    Open in code host
                  </a>
                </Button>
              ) : (
                <span
                  className="flex items-center gap-1 text-xs text-faint"
                  title="These synthetic source files are not hosted on GitHub."
                >
                  <ExternalLink className="size-3" aria-hidden="true" />
                  Demo source
                </span>
              )}
            </div>
            <div className="font-mono text-[0.6875rem] break-all text-faint">
              {evidence.path} · L{evidence.startLine}–
              {evidence.startLine + evidence.code.length - 1} ·{" "}
              {evidence.revision}
            </div>
            <div
              className="overflow-auto rounded-lg border bg-background py-2 font-mono text-[0.75rem] leading-[1.7]"
              tabIndex={0}
              aria-label="Source code"
            >
              <pre className="m-0 min-w-max font-[inherit]">
                {evidence.code.map((line, index) => (
                  <span
                    key={index}
                    className={cn(
                      "source-line flex whitespace-pre",
                      evidence.highlightedLines.includes(
                        evidence.startLine + index,
                      ) && "hl",
                    )}
                  >
                    <span
                      className="w-11 shrink-0 pr-3.5 text-right text-faint select-none"
                      aria-hidden="true"
                    >
                      {evidence.startLine + index}
                    </span>
                    <code className="pr-3">
                      <CodeLine line={line} />
                    </code>
                    {"\n"}
                  </span>
                ))}
              </pre>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void copy(evidence)}
              >
                {copied ? (
                  <Check data-icon="inline-start" />
                ) : (
                  <Copy data-icon="inline-start" />
                )}
                {copied ? "Copied" : "Copy source"}
              </Button>
              {copyError && (
                <p className="text-xs text-muted-foreground" role="status">
                  {copyError}
                </p>
              )}
            </div>
          </section>
        </div>
        <section className="border-t px-4 py-4">
          <h3 className="mb-2 text-xs text-muted-foreground">
            {answer.kind === "abstention"
              ? "Searched, not cited"
              : "All sources in this answer"}
          </h3>
          <div className="flex flex-col">
            {answer.evidence.map((source) => (
              <button
                key={source.id}
                onClick={() => onSelect(source.id)}
                className="flex w-full min-w-0 items-center gap-2.5 rounded-md px-1.5 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
              >
                <span
                  className={cn(
                    "grid h-[18px] min-w-[18px] place-items-center rounded-[4px] border border-input bg-secondary px-1 font-mono text-[0.6875rem]",
                    source.id === evidence.id &&
                      "border-info-strong bg-info-strong text-white",
                  )}
                >
                  {source.id}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {source.repository} · {source.path.split("/").pop()}
                </span>
                <span className="font-mono text-[0.6875rem] text-faint">
                  {source.revision}
                </span>
              </button>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
