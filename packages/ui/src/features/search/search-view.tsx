"use client";

import { Fragment, useState, type FormEvent } from "react";
import { CaseSensitive, FileCode2, Regex, Search } from "lucide-react";
import type { SearchResponse } from "@falkon/contracts";
import { useWorkspace } from "@/components/layout/workspace-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Kbd } from "@/components/ui/kbd";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Notice, Page, PageHeader } from "@/components/ui/primitives";
import { api, keys } from "@/lib/api/client";

function Highlighted({
  text,
  ranges,
}: {
  text: string;
  ranges: [number, number][];
}) {
  let at = 0;
  // Sorted, clamped to the text and to the end of the previous mark, so no character is shown twice.
  const marks = [...ranges]
    .sort((x, y) => x[0] - y[0])
    .flatMap(([from, to]) => {
      const start = Math.max(from, at, 0);
      const end = Math.min(to, text.length);
      if (end <= start) return [];
      const mark = (
        <Fragment key={start}>
          {text.slice(at, start)}
          <mark>{text.slice(start, end)}</mark>
        </Fragment>
      );
      at = end;
      return [mark];
    });
  return (
    <>
      {marks}
      {text.slice(at)}
    </>
  );
}

export function SearchResults({ result }: { result: SearchResponse }) {
  const { fileCount, matchCount, isSearchExhaustive, durationMs } = result;
  return (
    <>
      <p className="col-span-12 text-xs text-muted-foreground" role="status">
        {matchCount === 0
          ? "No matches"
          : `${matchCount}${isSearchExhaustive ? "" : "+"} matches in ${fileCount} ${fileCount === 1 ? "file" : "files"}`}{" "}
        · {durationMs} ms
      </p>
      {result.files.map((file) => (
        <Card className="col-span-12" key={`${file.repo}\0${file.path}`}>
          <h2 className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 border-b bg-secondary/30 px-4 py-2.5 text-[0.8125rem]">
            <FileCode2
              className="size-3.5 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
            <span className="text-muted-foreground">{file.repo} /</span>
            <span className="font-mono text-xs font-medium break-all">
              {file.path}
            </span>{" "}
            {file.branches.map((branch) => (
              <Badge key={branch} variant="muted" className="font-mono">
                {branch}
              </Badge>
            ))}
          </h2>
          <div className="search-hit overflow-x-auto py-1.5 font-mono text-xs leading-6">
            {file.matches.map((match, i) => (
              <div
                className="search-line flex min-w-max hover:bg-accent/40"
                key={i}
              >
                <span className="w-14 shrink-0 pr-4 text-right text-faint select-none">
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
          </div>
        </Card>
      ))}
    </>
  );
}

const HINTS = ["file:src", "lang:ts", "-repo:test", "sym:Handler"];

export function SearchView() {
  const { product } = useWorkspace();
  const [q, setQ] = useState("");
  const [flags, setFlags] = useState<string[]>([]);
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
              regex: flags.includes("regex") ? "1" : "0",
              case: flags.includes("case") ? "1" : "0",
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
    <Page>
      <PageHeader
        title="Search"
        description={
          <>
            Code in {product.name}, across {product.repositories.length}{" "}
            {product.repositories.length === 1 ? "repository" : "repositories"}.
          </>
        }
      />
      <form
        className="col-span-12 flex flex-col gap-3 sm:flex-row"
        onSubmit={(e) => void submit(e)}
      >
        <InputGroup className="h-10 flex-1">
          <InputGroupInput
            type="text"
            aria-label="Search query"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="foo (bar or baz) file:src lang:ts -repo:test sym:Handler"
            className="font-mono text-[0.8125rem]"
            autoFocus
          />
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupAddon align="inline-end" className="hidden sm:flex">
            <Kbd>↵</Kbd>
          </InputGroupAddon>
        </InputGroup>
        <div className="flex gap-3">
          <ToggleGroup
            type="multiple"
            variant="outline"
            value={flags}
            onValueChange={setFlags}
            className="h-10"
          >
            <ToggleGroupItem
              value="regex"
              aria-label="Regex"
              className="h-10 px-3"
            >
              <Regex />
              <span className="hidden md:inline">Regex</span>
            </ToggleGroupItem>
            <ToggleGroupItem
              value="case"
              aria-label="Match case"
              className="h-10 px-3"
            >
              <CaseSensitive />
              <span className="hidden md:inline">Match case</span>
            </ToggleGroupItem>
          </ToggleGroup>
          <Button
            type="submit"
            className="h-10 flex-1 sm:flex-none"
            disabled={!q.trim() || busy}
            aria-busy={busy || undefined}
          >
            {busy && <Spinner data-icon="inline-start" />}
            Search
          </Button>
        </div>
      </form>
      {error && (
        <Notice tone="err" className="col-span-12">
          {error}
        </Notice>
      )}
      {busy && !result ? (
        <div
          role="status"
          aria-label="Searching"
          className="col-span-12 flex flex-col gap-4"
        >
          {[0, 1].map((card) => (
            <div
              key={card}
              className="overflow-hidden rounded-xl border bg-card"
            >
              <div className="border-b px-4 py-3">
                <Skeleton className="h-3.5 w-72" />
              </div>
              <div className="flex flex-col gap-2.5 p-4">
                {[90, 70, 80].map((width) => (
                  <div key={width} className="flex gap-4">
                    <Skeleton className="h-3 w-8" />
                    <Skeleton
                      className="h-3"
                      style={{ width: `${width * 4}px` }}
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : result ? (
        <SearchResults result={result} />
      ) : (
        !error && (
          <Empty className="col-span-12 border border-dashed py-14">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Search />
              </EmptyMedia>
              <EmptyTitle>
                Search every repository at its indexed revision
              </EmptyTitle>
              <EmptyDescription>Narrow results with filters:</EmptyDescription>
            </EmptyHeader>
            <div className="flex flex-wrap justify-center gap-1.5">
              {HINTS.map((hint) => (
                <Badge
                  key={hint}
                  variant="outline"
                  className="font-mono font-normal text-muted-foreground"
                >
                  {hint}
                </Badge>
              ))}
            </div>
          </Empty>
        )
      )}
    </Page>
  );
}
