"use client";

import { useEffect, useState } from "react";
import { Check, Code2, Copy, Download, Maximize2, Workflow, X } from "lucide-react";
import type { Diagram } from "@falkon/contracts";
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
      className="archify-frame"
      title={title}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      srcDoc={html}
      // The viewer's own header and legend add a fixed band under the drawing.
      style={full ? { height: "100%" } : { aspectRatio: `${width} / ${height + 140}` }}
    />
  );
}

/** A rendered archify diagram with its source one toggle away; full screen, copy source and download the page. */
export function ArchifyBlock({ diagram }: { diagram: Diagram }) {
  const [source, setSource] = useState(false);
  const [full, setFull] = useState(false);
  const [copied, setCopied] = useState(false);
  const title = `${diagram.type} diagram`;
  useEffect(() => {
    if (!full) return;
    const close = (e: KeyboardEvent) => e.key === "Escape" && setFull(false);
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [full]);
  function download() {
    const url = URL.createObjectURL(new Blob([diagram.html], { type: "text/html" }));
    Object.assign(document.createElement("a"), { href: url, download: `${diagram.type}-diagram.html` }).click();
    URL.revokeObjectURL(url);
  }
  return (
    <div className="archify-diagram">
      <div className="archify-bar">
        <Workflow size={14} aria-hidden="true" />
        <span className="archify-title">{title}</span>
        <button className="icon-btn" aria-label={source ? "View diagram" : "View source"} title={source ? "View diagram" : "View source"} aria-pressed={source} onClick={() => setSource(!source)}>
          {source ? <Workflow size={14} /> : <Code2 size={14} />}
        </button>
        <button
          className="icon-btn"
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
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </button>
        <button className="icon-btn" aria-label="Download HTML" title="Download HTML" onClick={download}>
          <Download size={14} />
        </button>
        <button className="icon-btn" aria-label="Open full screen" title="Full screen" onClick={() => setFull(true)}>
          <Maximize2 size={14} />
        </button>
      </div>
      {source ? <CodeBlock lang="archify" code={diagram.source} /> : <ArchifyFrame html={diagram.html} title={title} />}
      {full && (
        <div className="archify-full" role="dialog" aria-modal="true" aria-label={title}>
          <button className="icon-btn archify-close" aria-label="Close full screen" onClick={() => setFull(false)}>
            <X size={16} />
          </button>
          <ArchifyFrame html={diagram.html} title={title} full />
        </div>
      )}
    </div>
  );
}
