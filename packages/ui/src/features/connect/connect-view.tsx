"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { useWorkspace } from "@/components/layout/workspace-shell";
import { Button } from "@/components/ui/primitives";
import type { Snippets } from "@/lib/connect";
import { TOOLS } from "@/lib/tools";
import { tryCopy } from "./copy";

const CLIENTS = [
  {
    id: "claude",
    label: "Claude Code",
    wrap: true,
    note: "Export FALKON_API_KEY before running.",
  },
  {
    id: "codex",
    label: "Codex",
    wrap: true,
    note: "Export FALKON_API_KEY, and keep it set when you run Codex.",
  },
  {
    id: "vscode",
    label: "Copilot (VS Code)",
    wrap: false,
    note: "VS Code asks for the key when the server starts.",
  },
] as const;

type Copy = "idle" | "copied" | "failed";

function CopyButton({ text, label }: { text: string; label: string }) {
  const [state, setState] = useState<Copy>("idle");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  async function copy() {
    const next = await tryCopy(text);
    setState(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 2000);
  }
  return (
    <>
      <Button
        className="sm"
        aria-label={`Copy ${label} command`}
        onClick={() => void copy()}
      >
        {state === "copied" ? <Check size={14} /> : <Copy size={14} />}
        {state === "copied"
          ? "Copied"
          : state === "failed"
            ? "Copy failed"
            : "Copy"}
      </Button>
      <span className="sr-only" role="status">
        {state === "copied"
          ? "Copied"
          : state === "failed"
            ? "Copy failed, select the text"
            : ""}
      </span>
    </>
  );
}

export function ConnectView({
  apiKey,
  isDefault,
  snippets,
}: {
  apiKey: boolean;
  isDefault: boolean;
  snippets: Snippets;
}) {
  const { product } = useWorkspace();
  return (
    <div className="page">
      <h1>Connect</h1>
      <p className="muted">Add {product.name} to your coding agent.</p>
      {isDefault && (
        <p className="muted">
          Using the local default address. Set FALKON_MCP_URL if agents connect
          from another machine.
        </p>
      )}
      {CLIENTS.map((client) => (
        <section className="page-section" key={client.id}>
          <div className="snippet-head">
            <h2>{client.label}</h2>
            <CopyButton text={snippets[client.id]} label={client.label} />
          </div>
          {apiKey && <p className="muted snippet-note">{client.note}</p>}
          <pre
            className={`snippet ${client.wrap ? "wrap" : ""}`}
            tabIndex={0}
            aria-label={`${client.label} command`}
          >
            <code>{snippets[client.id]}</code>
          </pre>
        </section>
      ))}
      <p className="muted">
        Tools: <span className="mono">{TOOLS.join(", ")}</span>
      </p>
    </div>
  );
}
