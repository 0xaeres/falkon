import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent,
} from "react";
import { Minus, Plus, Scan } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

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
export function Canvas({ svg, tall = false }: { svg: string; tall?: boolean }) {
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
