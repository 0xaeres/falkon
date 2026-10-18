"use client";
import { useState, type FormEvent } from "react";

interface Result {
  id: string;
  answer: string;
  steps: { tool: string; args: unknown; output: string }[];
}

export default function AskPage() {
  const [q, setQ] = useState("");
  const [res, setRes] = useState<Result | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    setRes(null);
    const r = await fetch("/api/ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: q }) });
    const j = await r.json();
    if (!r.ok) setErr(j.error ?? "ask failed");
    else setRes(j);
    setBusy(false);
  }

  return (
    <>
      <form onSubmit={submit}>
        <input type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="How does repo sync work?" autoFocus />
        <button disabled={busy || !q.trim()}>{busy ? "Thinking…" : "Ask"}</button>
      </form>
      {err && <p className="err">{err}</p>}
      {res && (
        <>
          <pre style={{ whiteSpace: "pre-wrap" }}>{res.answer}</pre>
          <details>
            <summary className="muted">{res.steps.length} tool calls</summary>
            {res.steps.map((s, i) => (
              <details key={i}>
                <summary>
                  {s.tool}({JSON.stringify(s.args)})
                </summary>
                <pre>{s.output}</pre>
              </details>
            ))}
          </details>
        </>
      )}
    </>
  );
}
