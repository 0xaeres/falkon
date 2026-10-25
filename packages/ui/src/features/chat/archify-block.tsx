"use client";

import { useState } from "react";
import { Check, Code2, Copy, Download, Maximize2, Workflow } from "lucide-react";
import type { Diagram } from "@falkon/contracts";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { CodeBlock } from "./code-block";

/** The page's own drawing size from its first svg viewBox (a fallback ratio when absent). */
export const viewBoxOf = (html: string) => {
  const [, , width = 0, height = 0] = (/<svg[^>]*\sviewBox="([^"]+)"/.exec(html)?.[1] ?? "").split(/[\s,]+/).map(Number);
  return width > 0 && height > 0 ? { width, height } : { width: 16, height: 9 };
};

/**
 * The rendered page in a sandboxed iframe: scripts run (the viewer is interactive) but with an opaque origin, so
 * the page cannot touch the app's cookies, storage or DOM. Never add `allow-same-origin`.
 */
export function ArchifyFrame({ html, title, full = false }: { html: string; title: string; full?: boolean }) {
  const { width, height } = viewBoxOf(html);
  return (
    <iframe
      className="block max-h-[720px] min-h-[360px] w-full border-0 bg-[#0a0a0a]"
      title={title}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      srcDoc={html}
      // The viewer's own header and legend add a fixed band under the drawing.
      style={full ? { height: "100%", maxHeight: "none" } : { aspectRatio: `${width} / ${height + 140}` }}
    />
  );
}

/** A rendered archify diagram with its source one toggle away; full screen, copy source and download the page. */
export function ArchifyBlock({ diagram }: { diagram: Diagram }) {
  const [mode, setMode] = useState<"diagram" | "source">("diagram");
  const [full, setFull] = useState(false);
  const [copied, setCopied] = useState(false);
  const title = `${diagram.type} diagram`;
  function download() {
    const url = URL.createObjectURL(new Blob([diagram.html], { type: "text/html" }));
    Object.assign(document.createElement("a"), { href: url, download: `${diagram.type}-diagram.html` }).click();
    URL.revokeObjectURL(url);
  }
  return (
    <div className="archify-diagram max-w-full overflow-hidden rounded-xl border bg-card">
      <div className="flex items-center gap-1 border-b py-1 pr-1 pl-3">
        <Workflow className="size-3.5 text-muted-foreground" aria-hidden="true" />
        <span className="mr-auto text-xs text-muted-foreground">{title}</span>
        <ToggleGroup
          type="single"
          size="sm"
          value={mode}
          onValueChange={(value) => value && setMode(value as typeof mode)}
          aria-label="Diagram or source"
          className="h-7"
        >
          <ToggleGroupItem value="diagram" aria-label="View diagram" className="h-7 px-2 text-xs">
            <Workflow />
          </ToggleGroupItem>
          <ToggleGroupItem value="source" aria-label="View source" className="h-7 px-2 text-xs">
            <Code2 />
          </ToggleGroupItem>
        </ToggleGroup>
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
        <Button variant="ghost" size="icon-xs" aria-label="Download HTML" title="Download HTML" onClick={download}>
          <Download />
        </Button>
        <Button variant="ghost" size="icon-xs" aria-label="Open full screen" title="Full screen" onClick={() => setFull(true)}>
          <Maximize2 />
        </Button>
      </div>
      {mode === "diagram" ? (
        <ArchifyFrame html={diagram.html} title={title} />
      ) : (
        <CodeBlock lang="archify" code={diagram.source} />
      )}
      <Dialog open={full} onOpenChange={setFull}>
        <DialogContent className="flex h-[88vh] w-[94vw] max-w-[94vw] flex-col gap-0 overflow-hidden p-0 sm:max-w-[94vw]">
          <div className="flex h-11 shrink-0 items-center gap-2 border-b px-4 pr-12">
            <Workflow className="size-3.5 text-muted-foreground" aria-hidden="true" />
            <DialogTitle className="text-[0.8125rem] font-medium">{title}</DialogTitle>
            <DialogDescription className="sr-only">The diagram at full size.</DialogDescription>
          </div>
          <div className="min-h-0 flex-1">{full && <ArchifyFrame html={diagram.html} title={title} full />}</div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
