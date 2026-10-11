"use client";
import { useState } from "react";
import { Check, Copy, ExternalLink, PanelRightClose } from "lucide-react";
import type { Answer, Evidence } from "@/lib/contracts";
import { Button } from "@/components/ui/primitives";

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
    <div className="ev">
      <header className="evh">
        <h2>Evidence</h2>
        <span className="muted evidence-generation mono">
          {answer.kind === "abstention" ? "searched" : answer.generation}
        </span>
        <span className="sp" />
        <button
          className="icon-btn"
          aria-label="Close evidence"
          onClick={onClose}
        >
          <PanelRightClose size={16} />
        </button>
      </header>
      <div className="evidence-scroll">
        <div className="etabs" role="group" aria-label="Evidence sources">
          {answer.evidence.map((source) => (
            <button
              key={source.id}
              className={source.id === evidence.id ? "on" : ""}
              aria-label={`Source ${source.id}: ${source.repository}`}
              aria-pressed={source.id === evidence.id}
              onClick={() => {
                setCopied(false);
                onSelect(source.id);
              }}
            >
              {source.id}
            </button>
          ))}
        </div>
        <section className="exc" aria-label={`Source ${evidence.id}`}>
          <div className="exh">
            <strong>{evidence.repository}</strong>
            <span className="sp" />
            {evidence.sourceUrl ? (
              <a
                href={evidence.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                <ExternalLink size={13} />
                Open in code host
              </a>
            ) : (
              <span
                className="synthetic-source"
                title="These synthetic source files are not hosted on GitHub."
              >
                <ExternalLink size={13} />
                Demo source
              </span>
            )}
          </div>
          <div className="path">
            {evidence.path} · L{evidence.startLine}–
            {evidence.startLine + evidence.code.length - 1} ·{" "}
            {evidence.revision}
          </div>
          <div className="source-code" tabIndex={0} aria-label="Source code">
            <pre>
              {evidence.code.map((line, index) => (
                <span
                  key={index}
                  className={`ln ${evidence.highlightedLines.includes(evidence.startLine + index) ? "hl" : ""}`}
                >
                  <span className="line-number" aria-hidden="true">
                    {evidence.startLine + index}
                  </span>
                  <code>
                    <CodeLine line={line} />
                  </code>
                  {"\n"}
                </span>
              ))}
            </pre>
          </div>
          <Button
            variant="ghost"
            className="sm copy-source"
            onClick={() => void copy(evidence)}
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
            {copied ? "Copied" : "Copy source"}
          </Button>
          {copyError && (
            <p className="help" role="status">
              {copyError}
            </p>
          )}
        </section>
        <section className="evsum">
          <h3>
            {answer.kind === "abstention"
              ? "Searched, not cited"
              : "All sources in this answer"}
          </h3>
          {answer.evidence.map((source) => (
            <button
              key={source.id}
              onClick={() => onSelect(source.id)}
              className="evidence-row"
            >
              <span
                className={`citation ${source.id === evidence.id ? "on" : ""}`}
              >
                {source.id}
              </span>
              <span className="evidence-row-path">
                {source.repository} · {source.path.split("/").pop()}
              </span>
              <span className="mono">{source.revision}</span>
            </button>
          ))}
        </section>
      </div>
    </div>
  );
}
