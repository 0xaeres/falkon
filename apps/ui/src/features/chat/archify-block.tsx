"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Code2, Copy, Download, Maximize2 } from "lucide-react";
import { ARCHIFY_HEIGHT, archifyPage, type Diagram } from "@falkon/contracts";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { CodeBlock } from "./code-block";

/** The page's own drawing size from its first svg viewBox (a fallback ratio when absent). */
export const viewBoxOf = (html: string) => {
  const [, , width = 0, height = 0] = (
    /<svg[^>]*\sviewBox="([^"]+)"/.exec(html)?.[1] ?? ""
  )
    .split(/[\s,]+/)
    .map(Number);
  return width > 0 && height > 0 ? { width, height } : { width: 16, height: 9 };
};

/** The diagram's own title from its source, else its kind. */
const titleOf = (diagram: Diagram) => {
  try {
    const title = (JSON.parse(diagram.source) as { meta?: { title?: unknown } })
      .meta?.title;
    if (typeof title === "string" && title.trim()) return title.trim();
  } catch {}
  return `${diagram.type[0]!.toUpperCase()}${diagram.type.slice(1)} diagram`;
};

/**
 * The compact diagram page (archify's drawing with hover focus and the trace animation; pages stored before it was
 * compact are cut down here) in a sandboxed iframe: its script runs with an opaque origin, so it cannot touch the app's
 * cookies, storage or DOM. Never add `allow-same-origin`. Inline, the frame takes the height the page reports; full
 * screen, the drawing fits the dialog.
 */
export function ArchifyFrame({
  html,
  title,
  full = false,
}: {
  html: string;
  title: string;
  full?: boolean;
}) {
  const ref = useRef<HTMLIFrameElement>(null);
  const srcDoc = useMemo(() => {
    const page = archifyPage(html) ?? "";
    return full ? page.replace("</style>", "svg{height:100vh}</style>") : page;
  }, [html, full]);
  const { width, height: vbHeight } = viewBoxOf(html);
  const [height, setHeight] = useState<number>();
  useEffect(() => {
    if (full) return;
    const onMessage = (e: MessageEvent) => {
      const data = e.data as { type?: string; height?: unknown } | null;
      if (
        e.source === ref.current?.contentWindow &&
        data?.type === ARCHIFY_HEIGHT &&
        typeof data.height === "number" &&
        data.height > 0
      )
        setHeight(data.height);
    };
    addEventListener("message", onMessage);
    return () => removeEventListener("message", onMessage);
  }, [full]);
  return (
    <iframe
      ref={ref}
      className="block w-full border-0 bg-transparent"
      title={title}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      srcDoc={srcDoc}
      style={
        full
          ? { height: "100%" }
          : height
            ? { height }
            : { aspectRatio: `${width} / ${vbHeight}` }
      }
    />
  );
}

/** An archify diagram on the answer canvas (hover a node to focus it), with source, copy, download and full screen. */
export function ArchifyBlock({ diagram }: { diagram: Diagram }) {
  const [source, setSource] = useState(false);
  const [full, setFull] = useState(false);
  const [copied, setCopied] = useState(false);
  const title = titleOf(diagram);
  function download() {
    const url = URL.createObjectURL(
      new Blob([archifyPage(diagram.html) ?? diagram.html], {
        type: "text/html",
      }),
    );
    Object.assign(document.createElement("a"), {
      href: url,
      download: `${diagram.type}-diagram.html`,
    }).click();
    URL.revokeObjectURL(url);
  }
  return (
    <figure className="archify-diagram group/diagram my-2 flex max-w-full flex-col gap-1">
      <figcaption className="flex items-center gap-1">
        <span className="mr-auto truncate text-[0.8125rem] font-medium text-muted-foreground">
          {title}
        </span>
        <div className="flex items-center gap-0.5 opacity-60 transition-opacity group-focus-within/diagram:opacity-100 group-hover/diagram:opacity-100">
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={source ? "View diagram" : "View source"}
            title={source ? "View diagram" : "View source"}
            aria-pressed={source}
            onClick={() => setSource((s) => !s)}
          >
            <Code2 />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Copy source"
            title="Copy source"
            onClick={() =>
              void navigator.clipboard?.writeText(diagram.source).then(
                () => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                },
                () => {},
              )
            }
          >
            {copied ? <Check /> : <Copy />}
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Download HTML"
            title="Download HTML"
            onClick={download}
          >
            <Download />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Open full screen"
            title="Full screen"
            onClick={() => setFull(true)}
          >
            <Maximize2 />
          </Button>
        </div>
      </figcaption>
      {source ? (
        <CodeBlock
          lang="json"
          code={JSON.stringify(JSON.parse(diagram.source), null, 2)}
        />
      ) : (
        <ArchifyFrame html={diagram.html} title={title} />
      )}
      <Dialog open={full} onOpenChange={setFull}>
        <DialogContent className="flex h-[92vh] w-[96vw] max-w-[96vw] flex-col gap-0 overflow-hidden bg-background p-0 sm:max-w-[96vw]">
          <div className="flex h-11 shrink-0 items-center gap-2 border-b px-4 pr-12">
            <DialogTitle className="text-[0.8125rem] font-medium">
              {title}
            </DialogTitle>
            <DialogDescription className="sr-only">
              The interactive diagram at full size.
            </DialogDescription>
          </div>
          <div className="min-h-0 flex-1">
            {full && <ArchifyFrame html={diagram.html} title={title} full />}
          </div>
        </DialogContent>
      </Dialog>
    </figure>
  );
}
