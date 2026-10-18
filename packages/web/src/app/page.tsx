"use client";
import { useState, type FormEvent } from "react";
import type { SearchResponse } from "@sbc/shared";

function Highlighted({ text, ranges }: { text: string; ranges: [number, number][] }) {
  const out: React.ReactNode[] = [];
  let at = 0;
  ranges.forEach(([s, e], i) => {
    if (s > at) out.push(text.slice(at, s));
    out.push(<mark key={i}>{text.slice(s, e)}</mark>);
    at = e;
  });
  out.push(text.slice(at));
  return <>{out}</>;
}

export default function SearchPage() {
  const [q, setQ] = useState("");
  const [regex, setRegex] = useState(false);
  const [res, setRes] = useState<SearchResponse | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    const r = await fetch(`/api/search?q=${encodeURIComponent(q)}&regex=${regex ? 1 : 0}`);
    const j = await r.json();
    if (!r.ok) {
      setErr(j.error ?? "search failed");
      setRes(null);
    } else setRes(j);
    setBusy(false);
  }

  return (
    <>
      <form onSubmit={submit}>
        <input type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder='foo (bar or baz) file:src lang:ts -repo:test rev:main sym:Handler' autoFocus />
        <label>
          <input type="checkbox" checked={regex} onChange={(e) => setRegex(e.target.checked)} /> regex
        </label>
        <button disabled={busy || !q.trim()}>Search</button>
      </form>
      {err && <p className="err">{err}</p>}
      {res && (
        <p className="muted">
          {res.matchCount} matches in {res.fileCount} files · {res.durationMs} ms
        </p>
      )}
      {res?.files.map((f) => (
        <div className="file" key={f.repo + f.path}>
          <h3>
            {f.repo} / {f.path} <span className="muted">{f.branches.join(", ")}</span>
          </h3>
          {f.matches.map((m, i) => (
            <div className="line" key={i}>
              <span className="n">{m.fileNameMatch ? "" : m.lineNumber}</span>
              <span>{m.fileNameMatch ? "(file name match)" : <Highlighted text={m.text} ranges={m.ranges} />}</span>
            </div>
          ))}
        </div>
      ))}
    </>
  );
}
