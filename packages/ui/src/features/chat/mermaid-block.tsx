"use client";

import { useEffect, useState } from "react";
import { CodeBlock } from "./code-block";

/** Diagram sources above this fall back to the plain code block (a real diagram is a few hundred characters; mermaid's own limit is 50k). */
export const MERMAID_MAX_CHARS = 20_000;

type MermaidApi = Pick<
  typeof import("mermaid").default,
  "initialize" | "parse" | "render"
>;
const loadMermaid = async (): Promise<MermaidApi> =>
  (await import("mermaid")).default;

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
    mermaid.initialize({ startOnLoad: false, securityLevel: "strict" });
    await mermaid.parse(source);
    return (await mermaid.render(id, source)).svg;
  } catch {
    // A failed render can leave its scratch node in the body.
    if (typeof document !== "undefined")
      document.getElementById(`d${id}`)?.remove();
    return null;
  }
}

/** The diagram with the source one click away, or the code block when there is no svg. */
export function MermaidView({
  source,
  svg,
}: {
  source: string;
  svg: string | null;
}) {
  const [showSource, setShowSource] = useState(false);
  if (!svg || showSource)
    return (
      <>
        <CodeBlock lang="mermaid" code={source} />
        {svg && (
          <button className="btn ghost sm" onClick={() => setShowSource(false)}>
            View diagram
          </button>
        )}
      </>
    );
  return (
    <div className="mermaid-diagram">
      {/* strict securityLevel sanitises the SVG */}
      <div dangerouslySetInnerHTML={{ __html: svg }} />
      <button className="btn ghost sm" onClick={() => setShowSource(true)}>
        View source
      </button>
      <button
        className="btn ghost sm"
        onClick={() =>
          void navigator.clipboard?.writeText(source).catch(() => {})
        }
      >
        Copy source
      </button>
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
