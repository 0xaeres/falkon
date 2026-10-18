"use client";
import { useEffect, useState } from "react";

interface Row {
  repo: string;
  selected: boolean;
  excluded: boolean;
  pending: string | null;
  lastScan: { id: number; mode: string; status: string; tokensUsed: number; docsWritten: number; error: string | null; startedAt: string } | null;
  docs: { path: string; title: string; summary: string }[];
}

export default function KnowledgePage() {
  const [data, setData] = useState<{ enabled: boolean; repos: Row[] } | null>(null);
  const [err, setErr] = useState("");

  const load = () => fetch("/api/knowledge").then((r) => r.json()).then(setData, () => setErr("failed to load"));
  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  async function act(repo: string, action: "scan" | "delete" | "include") {
    if (action === "delete" && !confirm(`Delete the generated knowledge base for ${repo}?`)) return;
    const r = await fetch("/api/knowledge", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ repo, action }) });
    if (!r.ok) setErr((await r.json()).error ?? "request failed");
    else setErr("");
    load();
  }

  if (!data) return <p className="muted">{err || "Loading…"}</p>;
  return (
    <>
      {!data.enabled && <p className="muted">Knowledge base is off. Set <code>knowledgeBase.enabled</code> in config.json.</p>}
      {err && <p className="err">{err}</p>}
      {data.repos.map((r) => (
        <div className="file" key={r.repo}>
          <h3>
            {r.repo}{" "}
            <span className="muted">
              {r.excluded ? "excluded" : r.selected ? "selected" : "not selected"}
              {r.pending ? ` · ${r.pending} requested` : ""}
              {r.lastScan ? ` · scan #${r.lastScan.id} ${r.lastScan.status.toLowerCase()} (${r.lastScan.mode.toLowerCase()}, ${r.lastScan.tokensUsed.toLocaleString()} tokens)` : ""}
            </span>
          </h3>
          <div className="line">
            <button disabled={!r.selected || !!r.pending} onClick={() => act(r.repo, "scan")}>Generate now</button>
            {r.docs.length > 0 && <button onClick={() => act(r.repo, "delete")}>Delete docs</button>}
            {r.excluded && <button onClick={() => act(r.repo, "include")}>Re-include</button>}
          </div>
          {r.lastScan?.error && <div className="line err">{r.lastScan.error}</div>}
          {r.docs.map((d) => (
            <div className="line" key={d.path}>
              <span className="n">{d.path.split("/")[0]}</span>
              <span>
                <strong>{d.title}</strong> <span className="muted">{d.path}</span>
                <br />
                {d.summary}
              </span>
            </div>
          ))}
        </div>
      ))}
    </>
  );
}
