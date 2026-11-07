"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent,
} from "react";
import {
  Check,
  Code2,
  Copy,
  Download,
  Maximize2,
  Minus,
  Plus,
  Scan,
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
import { cn } from "@/lib/utils";
import { CodeBlock } from "./code-block";

/** Diagram sources above this fall back to the plain code block (a real diagram is a few hundred characters; mermaid's own limit is 50k). */
export const MERMAID_MAX_CHARS = 20_000;

type MermaidApi = Pick<
  typeof import("mermaid").default,
  "initialize" | "parse" | "render"
>;
const loadMermaid = async (): Promise<MermaidApi> =>
  (await import("mermaid")).default;

// Only mermaid's `base` theme takes custom variables; these are the Falkon dark tokens, hex only.
const THEME = {
  darkMode: true,
  background: "#0a0a0a",
  fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif",
  fontSize: "13px",
  primaryColor: "#0f172a",
  primaryTextColor: "#fafafa",
  primaryBorderColor: "#3b82f6",
  secondaryColor: "#1e293b",
  secondaryTextColor: "#e2e8f0",
  secondaryBorderColor: "#3b82f6",
  tertiaryColor: "#111113",
  tertiaryTextColor: "#d4d4d8",
  tertiaryBorderColor: "#334155",
  lineColor: "#64748b",
  textColor: "#d4d4d8",
  titleColor: "#fafafa",
  nodeTextColor: "#fafafa",
  mainBkg: "#0f172a",
  clusterBkg: "#0d1117",
  clusterBorder: "#334155",
  edgeLabelBackground: "#111113",
  noteBkgColor: "#27272a",
  noteTextColor: "#fafafa",
  noteBorderColor: "#52525b",
  actorBkg: "#0f172a",
  actorBorder: "#3b82f6",
  actorTextColor: "#fafafa",
  actorLineColor: "#52525b",
  signalColor: "#a1a1aa",
  signalTextColor: "#fafafa",
  labelBoxBkgColor: "#18181b",
  labelBoxBorderColor: "#52525b",
  labelTextColor: "#fafafa",
  loopTextColor: "#d4d4d8",
  activationBkgColor: "#27272a",
  activationBorderColor: "#71717a",
  sequenceNumberColor: "#0a0a0a",
};

let counter = 0;
/** The SVG for a mermaid source, or null when it is too big or does not parse (the caller shows the code). `load` is a seam for tests. */
export async function drawMermaid(
  source: string,
  load: () => Promise<MermaidApi> = loadMermaid,
): Promise<string | null> {
  if (source.length > MERMAID_MAX_CHARS) return null;
  const id = `mermaid-${++counter}`;
  try {
    const mermaid = await load();
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "base",
      look: "classic",
      themeVariables: THEME,
      flowchart: {
        curve: "basis",
        padding: 14,
        nodeSpacing: 36,
        rankSpacing: 44,
      },
      sequence: { mirrorActors: false },
    });
    await mermaid.parse(source);
    return (await mermaid.render(id, source)).svg;
  } catch {
    // A failed render can leave its scratch node in the body.
    if (typeof document !== "undefined")
      document.getElementById(`d${id}`)?.remove();
    return null;
  }
}

const MIN = 0.1;
const MAX = 4;
const clamp = (scale: number) => Math.min(MAX, Math.max(MIN, scale));

/** The width and height in a rendered diagram's viewBox (zero when absent). */
export const viewBoxOf = (svg: string) => {
  const [, , width = 0, height = 0] = (/viewBox="([^"]+)"/.exec(svg)?.[1] ?? "")
    .split(/[\s,]+/)
    .map(Number);
  return { width, height };
};

/** A pannable, zoomable view of one diagram: drag to pan, ⌘/Ctrl + wheel or the buttons to zoom, double-click to fit. */
function Canvas({ svg, tall = false }: { svg: string; tall?: boolean }) {
  const [view, setView] = useState({ x: 0, y: 0, scale: 1 });
  const [height, setHeight] = useState<number | null>(null);
  const content = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  // The scale at which the whole diagram fits the viewport (never enlarged past 1).
  // From the diagram's own viewBox and the viewport's layout size, so an opening animation's transform cannot skew it.
  const natural = viewBoxOf(svg);
  const fitScale = (width: number, height: number) =>
    !natural.width || !natural.height
      ? 1
      : clamp(
          Math.min(
            1,
            (width - 48) / natural.width,
            (height - 48) / natural.height,
          ),
        );
  // The whole diagram shows first. Inline, the canvas takes the diagram's height at the fitted width, capped so a tall graph shrinks instead of pushing the answer away.
  useLayoutEffect(() => {
    const v = viewport.current;
    if (!v || !natural.width) return;
    const width = v.offsetWidth;
    const height = tall
      ? v.offsetHeight
      : Math.min(
          520,
          Math.max(
            160,
            natural.height * Math.min(1, (width - 48) / natural.width) + 48,
          ),
        );
    if (!tall) setHeight(height);
    setView({ x: 0, y: 0, scale: fitScale(width, height) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [svg, tall]);
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    // A plain wheel scrolls the conversation; only a pinch or ⌘/Ctrl + wheel zooms.
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      setView((v) => ({
        ...v,
        scale: clamp(v.scale * (event.deltaY < 0 ? 1.1 : 0.9)),
      }));
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, []);
  const zoom = (factor: number) =>
    setView((v) => ({ ...v, scale: clamp(v.scale * factor) }));
  const fit = () =>
    setView({
      x: 0,
      y: 0,
      scale: fitScale(
        viewport.current?.offsetWidth ?? 0,
        viewport.current?.offsetHeight ?? 0,
      ),
    });
  function down(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX - view.x, y: event.clientY - view.y };
  }
  function move(event: PointerEvent<HTMLDivElement>) {
    if (!drag.current) return;
    const start = drag.current;
    setView((v) => ({
      ...v,
      x: event.clientX - start.x,
      y: event.clientY - start.y,
    }));
  }
  return (
    <div
      ref={viewport}
      className="diagram-canvas relative cursor-grab touch-none overflow-hidden bg-background bg-[radial-gradient(circle,#27272a_1px,transparent_1px)] [background-size:16px_16px] select-none active:cursor-grabbing"
      style={{ height: tall ? "100%" : (height ?? 280) }}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={() => (drag.current = null)}
      onPointerCancel={() => (drag.current = null)}
      onDoubleClick={fit}
    >
      {/* Centred on the canvas whatever its size, then panned and scaled about its centre. */}
      <div
        ref={content}
        className={cn(
          "absolute top-1/2 left-1/2 origin-center transition-transform duration-75 ease-out [&_svg]:h-auto [&_svg]:w-full [&_svg]:max-w-none",
        )}
        style={{
          width: natural.width || undefined,
          transform: `translate(-50%, -50%) translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
        }}
        // strict securityLevel sanitises the SVG
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      <div
        className="absolute right-2 bottom-2 flex items-center gap-0.5 rounded-lg border bg-card/90 p-0.5 shadow-[0_8px_24px_-12px_rgba(0,0,0,0.8)] backdrop-blur"
        onPointerDown={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
      >
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Zoom out"
          title="Zoom out"
          onClick={() => zoom(0.8)}
        >
          <Minus />
        </Button>
        <span className="w-10 text-center font-mono text-[0.6875rem] text-muted-foreground tabular-nums">
          {Math.round(view.scale * 100)}%
        </span>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Zoom in"
          title="Zoom in"
          onClick={() => zoom(1.25)}
        >
          <Plus />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Fit diagram"
          title="Fit (double-click)"
          onClick={fit}
        >
          <Scan />
        </Button>
      </div>
    </div>
  );
}

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
