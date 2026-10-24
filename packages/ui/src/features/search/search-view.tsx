"use client";

import { Fragment, useState, type FormEvent } from "react";
import type { SearchResponse } from "@falkon/contracts";
import { useWorkspace } from "@/components/layout/workspace-shell";
import { Alert, Button } from "@/components/ui/primitives";
import { api, keys } from "@/lib/api/client";

function Highlighted({
  text,
  ranges,
}: {
  text: string;
  ranges: [number, number][];
}) {
  let at = 0;
  return (
    <>
      {ranges.map(([start, end], i) => {
        const before = text.slice(at, start);
        at = end;
        return (
          <Fragment key={i}>
            {before}
            <mark>{text.slice(start, end)}</mark>
          </Fragment>
        );
      })}
      {text.slice(at)}
    </>
  );
}

export function SearchResults({ result }: { result: SearchResponse }) {
  const { fileCount, matchCount, isSearchExhaustive, durationMs } = result;
  return (
    <>
      <p className="muted" role="status">
        {matchCount === 0
          ? "No matches"
          : `${matchCount}${isSearchExhaustive ? "" : "+"} matches in ${fileCount} ${fileCount === 1 ? "file" : "files"}`}{" "}
        · {durationMs} ms
      </p>
      {result.files.map((file) => (
        <section className="search-file" key={file.repo + file.path}>
          <h2>
            {file.repo} / {file.path}{" "}
            <span className="muted">{file.branches.join(", ")}</span>
          </h2>
          {file.matches.map((match, i) => (
            <div className="search-line mono" key={i}>
              <span className="search-n">
                {match.fileNameMatch ? "" : match.lineNumber}
              </span>
              <span>
                {match.fileNameMatch ? (
                  "(file name match)"
                ) : (
                  <Highlighted text={match.text} ranges={match.ranges} />
                )}
              </span>
            </div>
          ))}
        </section>
      ))}
    </>
  );
}

export function SearchView() {
  const { product } = useWorkspace();
  const [q, setQ] = useState("");
  const [regex, setRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [result, setResult] = useState<SearchResponse | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      setResult(
        await api.search(
          keys.search(
            product.id,
            new URLSearchParams({
              q,
              regex: regex ? "1" : "0",
              case: caseSensitive ? "1" : "0",
            }),
          ),
        ),
      );
    } catch (e) {
      setResult(null);
      setError(e instanceof Error ? e.message : "Search failed. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <h1>Search</h1>
      <p className="muted">Code in {product.name}.</p>
      <form className="search-form" onSubmit={(e) => void submit(e)}>
        <input
          className="input"
          type="text"
          aria-label="Search query"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="foo (bar or baz) file:src lang:ts -repo:test sym:Handler"
          autoFocus
        />
        <label>
          <input
            type="checkbox"
            checked={regex}
            onChange={(e) => setRegex(e.target.checked)}
          />{" "}
          Regex
        </label>
        <label>
          <input
            type="checkbox"
            checked={caseSensitive}
            onChange={(e) => setCaseSensitive(e.target.checked)}
          />{" "}
          Match case
        </label>
        <Button variant="primary" busy={busy} disabled={!q.trim()}>
          Search
        </Button>
      </form>
      {error && <Alert tone="err">{error}</Alert>}
      {result && <SearchResults result={result} />}
    </div>
  );
}
