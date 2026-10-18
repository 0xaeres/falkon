import { env } from "./env";
import { translateQuery } from "./query";

export interface SearchMatch {
  lineNumber: number;
  text: string;
  /** [start, end) character offsets within `text` */
  ranges: [number, number][];
  /** true when the match is on the file name, not content */
  fileNameMatch: boolean;
}

export interface SearchFile {
  repo: string;
  path: string;
  branches: string[];
  language: string;
  matches: SearchMatch[];
}

export interface SearchResponse {
  files: SearchFile[];
  fileCount: number;
  matchCount: number;
  durationMs: number;
  zoektQuery: string;
}

interface ZoektLineFragment {
  LineOffset: number;
  MatchLength: number;
}
interface ZoektLineMatch {
  Line: string | null; // base64
  LineNumber: number;
  FileName: boolean;
  LineFragments?: ZoektLineFragment[] | null;
}
interface ZoektFile {
  FileName: string;
  Repository: string;
  Branches?: string[] | null;
  Language?: string;
  LineMatches?: ZoektLineMatch[] | null;
}
interface ZoektResponse {
  Result?: {
    Files?: ZoektFile[] | null;
    MatchCount?: number;
    FileCount?: number;
    Duration?: number;
  };
  Error?: string;
}

function convertMatch(m: ZoektLineMatch): SearchMatch {
  const buf = Buffer.from(m.Line ?? "", "base64");
  const text = buf.toString("utf8").replace(/\r?\n$/, "");
  const ranges: [number, number][] = [];
  for (const f of m.LineFragments ?? []) {
    // zoekt offsets are bytes; convert to UTF-16 offsets for the UI
    const start = buf.subarray(0, f.LineOffset).toString("utf8").length;
    const end = buf.subarray(0, f.LineOffset + f.MatchLength).toString("utf8").length;
    ranges.push([start, Math.min(end, text.length)]);
  }
  return { lineNumber: m.LineNumber, text, ranges, fileNameMatch: m.FileName };
}

/** Run a raw zoekt query string. */
export async function zoektSearch(
  zoektQuery: string,
  opts: { maxMatches?: number; maxFiles?: number } = {},
): Promise<SearchResponse> {
  const started = Date.now();
  const res = await fetch(`${env.zoektUrl}/api/search`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      Q: zoektQuery,
      Opts: {
        TotalMaxMatchCount: opts.maxMatches ?? 5000,
        MaxDocDisplayCount: opts.maxFiles ?? 200,
        NumContextLines: 0,
      },
    }),
  });
  if (!res.ok) throw new Error(`zoekt ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as ZoektResponse;
  if (json.Error) throw new Error(json.Error);
  const files = (json.Result?.Files ?? []).map<SearchFile>((f) => ({
    repo: f.Repository,
    path: f.FileName,
    branches: f.Branches ?? [],
    language: f.Language ?? "",
    matches: (f.LineMatches ?? []).map(convertMatch),
  }));
  return {
    files,
    fileCount: json.Result?.FileCount ?? files.length,
    matchCount: json.Result?.MatchCount ?? files.reduce((n, f) => n + f.matches.length, 0),
    durationMs: Date.now() - started,
    zoektQuery,
  };
}

/** Sourcebot-syntax search. */
export function search(q: string, opts: { regex?: boolean; maxMatches?: number; maxFiles?: number; filter?: string } = {}) {
  const zq = translateQuery(q, { regex: opts.regex });
  if (!zq.trim()) throw new Error("empty query");
  return zoektSearch(opts.filter ? `${zq} ${opts.filter}` : zq, opts);
}

export const reAnchored = (s: string) => `^${s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`;
