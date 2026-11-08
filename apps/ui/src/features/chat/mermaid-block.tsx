"use client";

import { useEffect, useState } from "react";
import {
  Check,
  Code2,
  Copy,
  Download,
  Maximize2,
  Workflow,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { CodeBlock } from "./code-block";
import { Canvas } from "./components/mermaid-canvas";
import { drawMermaid } from "./lib/mermaid";

/** The diagram on a canvas with its source one toggle away, or the code block when there is no svg. */
export function MermaidView({
  source,
  svg,
}: {
  source: string;
  svg: string | null;
}) {
  const [mode, setMode] = useState<"diagram" | "source">("diagram");
  const [full, setFull] = useState(false);
  const [copied, setCopied] = useState(false);
  if (!svg) return <CodeBlock lang="mermaid" code={source} />;
  function download() {
    const url = URL.createObjectURL(
      new Blob([svg!], { type: "image/svg+xml" }),
    );
    const link = Object.assign(document.createElement("a"), {
      href: url,
      download: "diagram.svg",
    });
    link.click();
    URL.revokeObjectURL(url);
  }
  return (
    <div className="mermaid-diagram max-w-full overflow-hidden rounded-xl border bg-card">
      <div className="flex items-center gap-1 border-b py-1 pr-1 pl-3">
        <Workflow
          className="size-3.5 text-muted-foreground"
          aria-hidden="true"
        />
        <span className="mr-auto text-xs text-muted-foreground">Diagram</span>
        <ToggleGroup
          type="single"
          size="sm"
          value={mode}
          onValueChange={(value) => value && setMode(value as typeof mode)}
          aria-label="Diagram or source"
          className="h-7"
        >
          <ToggleGroupItem
            value="diagram"
            aria-label="View diagram"
            className="h-7 px-2 text-xs"
          >
            <Workflow />
          </ToggleGroupItem>
          <ToggleGroupItem
            value="source"
            aria-label="View source"
            className="h-7 px-2 text-xs"
          >
            <Code2 />
          </ToggleGroupItem>
        </ToggleGroup>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Copy source"
          title="Copy source"
          onClick={() =>
            void navigator.clipboard?.writeText(source).then(
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
          aria-label="Download SVG"
          title="Download SVG"
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
      {mode === "diagram" ? (
        <Canvas svg={svg} />
      ) : (
        <pre className="max-h-[520px] overflow-auto px-4 py-3 font-mono text-[0.78rem] leading-relaxed">
          <code>{source}</code>
        </pre>
      )}
      <Dialog open={full} onOpenChange={setFull}>
        <DialogContent className="flex h-[88vh] w-[94vw] max-w-[94vw] flex-col gap-0 overflow-hidden p-0 sm:max-w-[94vw]">
          <div className="flex h-11 shrink-0 items-center gap-2 border-b px-4 pr-12">
            <Workflow
              className="size-3.5 text-muted-foreground"
              aria-hidden="true"
            />
            <DialogTitle className="text-[0.8125rem] font-medium">
              Diagram
            </DialogTitle>
            <DialogDescription className="sr-only">
              Drag to pan; ⌘ or Ctrl with the wheel, or the buttons, to zoom.
            </DialogDescription>
          </div>
          <div className="min-h-0 flex-1">
            {full && <Canvas svg={svg} tall />}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** A finished answer's ```mermaid fence: drawn after mount, the code block until then or on failure. */
export function MermaidBlock({ source }: { source: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void drawMermaid(source).then((s) => live && setSvg(s));
    return () => {
      live = false;
    };
  }, [source]);
  return <MermaidView source={source} svg={svg} />;
}
