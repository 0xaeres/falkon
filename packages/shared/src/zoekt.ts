import fs from "node:fs";
import path from "node:path";
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import { env, KB_SUFFIX } from "./env";
import { isBranchQ, qAnd, qBranch, someQ, type Q } from "./ir";
import { parseQuery } from "./queryParser";

// ---- result shapes -------------------------------------------------------

export interface SourceLocation {
  byteOffset: number;
  lineNumber: number;
  column: number;
}
export interface SourceRange {
  start: SourceLocation;
  end: SourceLocation;
}
export interface SearchChunk {
  content: string;
  contentStart: SourceLocation;
  matchRanges: SourceRange[];
  symbols: { symbol: string; kind: string; parent?: { symbol: string; kind: string } }[];
}
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
  fileNameRanges: SourceRange[];
  chunks: SearchChunk[];
  /** Occurrences (ranges), as opposed to matched lines. */
  occurrences: number;
  /** One entry per matched line, derived from `chunks` (plus a file-name entry if the name matched). */
  matches: SearchMatch[];
}
export interface SearchResponse {
  files: SearchFile[];
  fileCount: number;
  matchCount: number;
  rawMatchCount: number;
  crashes: number;
  filesSkipped: number;
  durationMs: number;
  /** false when zoekt stopped at the match limit and more results exist */
  isSearchExhaustive: boolean;
}

/** Accumulate per-flush stats, counting only occurrences within the display limit. */
export function createStreamSummary(maxMatches = 5000) {
  let fileCount = 0;
  let matchCount = 0;
  let rawMatchCount = 0;
  let incomplete = false;
  return {
    add(chunk: SearchResponse) {
      fileCount += chunk.files.length;
      matchCount = Math.min(maxMatches, matchCount + chunk.files.reduce((n, f) => n + f.occurrences, 0));
      rawMatchCount += chunk.rawMatchCount;
      incomplete = incomplete || chunk.crashes > 0 || chunk.filesSkipped > 0;
    },
    result() {
      return { fileCount, matchCount, isSearchExhaustive: !incomplete && rawMatchCount <= matchCount };
    },
  };
}

// ---- wire shapes (subset of zoekt/webserver/v1/webserver.proto) -----------

interface WLocation { byte_offset?: number; line_number?: number; column?: number }
interface WRange { start?: WLocation; end?: WLocation }
interface WChunk {
  content: Buffer;
  content_start?: WLocation;
  file_name: boolean;
  ranges: WRange[];
  symbol_info: { sym: string; kind: string; parent?: string; parent_kind?: string }[];
}
interface WFile {
  file_name: Buffer;
  repository: string;
  branches: string[];
  language: string;
  chunk_matches: WChunk[];
}
export interface WSearchResponse {
  files: WFile[];
  stats?: { match_count?: number; file_count?: number; crashes?: number; files_skipped?: number };
}
export interface WSearchRequest {
  query: Q;
  opts: Record<string, unknown>;
}

export interface ZoektTransport {
  search(req: WSearchRequest): Promise<WSearchResponse>;
  stream(req: WSearchRequest): AsyncIterable<WSearchResponse>;
}

// ---- gRPC transport ------------------------------------------------------

function findProtoDir(): string {
  const candidates = [
    process.env.ZOEKT_PROTO_DIR,
    path.resolve(process.cwd(), "../shared/proto"),
    path.resolve(process.cwd(), "packages/shared/proto"),
    path.resolve(process.cwd(), "proto"),
  ].filter((p): p is string => !!p);
  const dir = candidates.find((d) => fs.existsSync(path.join(d, "zoekt/webserver/v1/webserver.proto")));
  if (!dir) throw new Error(`zoekt protos not found; set ZOEKT_PROTO_DIR (tried ${candidates.join(", ")})`);
  return dir;
}

let ctor: any;
function client(): any {
  if (!ctor) {
    const dir = findProtoDir();
    const def = protoLoader.loadSync(path.join(dir, "zoekt/webserver/v1/webserver.proto"), {
      keepCase: true,
      longs: Number,
      enums: String,
      defaults: true,
      oneofs: true,
      includeDirs: [dir],
    });
    ctor = (grpc.loadPackageDefinition(def) as any).zoekt.webserver.v1.WebserverService;
  }
  const url = new URL(env.zoektUrl);
  return new ctor(`${url.hostname}:${url.port || 80}`, grpc.credentials.createInsecure(), {
    "grpc.max_receive_message_length": 500 * 1024 * 1024,
    "grpc.max_send_message_length": 500 * 1024 * 1024,
  });
}

const deadline = () => new Date(Date.now() + 60_000);

const grpcTransport: ZoektTransport = {
  search(req) {
    const c = client();
    return new Promise((resolve, reject) => {
      c.Search(req, new grpc.Metadata(), { deadline: deadline() }, (err: grpc.ServiceError | null, res: WSearchResponse) => {
        c.close();
        if (err || !res) reject(new Error(err?.details || "no response from zoekt"));
        else resolve(res);
      });
    });
  },
  async *stream(req) {
    const c = client();
    const call = c.StreamSearch({ request: req }, new grpc.Metadata(), { deadline: deadline() });
    try {
      for await (const msg of call as AsyncIterable<{ response_chunk?: WSearchResponse }>) {
        if (msg.response_chunk) yield msg.response_chunk;
      }
    } catch (e) {
      throw new Error((e as grpc.ServiceError).details || (e as Error).message);
    } finally {
      call.cancel();
      c.close();
    }
  },
};

let transport: ZoektTransport = grpcTransport;
/** Tests inject a fake; pass undefined to restore gRPC. */
export const setZoektTransport = (t: ZoektTransport | undefined) => {
  transport = t ?? grpcTransport;
};

// ---- request -------------------------------------------------------------

export interface SearchOptions {
  /** Maximum matches returned. Default 5000. */
  matches?: number;
  contextLines?: number;
}

/**
 * Wrap a query for zoekt. Unless the query names a branch (`rev:`), restrict to HEAD, the
 * indexed default branch. `scope` is AND-ed on top as its own subtree.
 */
export function buildRequest(query: Q, opts: SearchOptions = {}, scope: Q[] = []): WSearchRequest {
  // Non-positive limits mean "unbounded" to zoekt, so clamp to a sane window.
  const matches = Math.min(Math.max(Math.trunc(Number(opts.matches ?? 5000)) || 5000, 1), 5000);
  const hasRev = someQ(query, isBranchQ);
  return {
    query: qAnd(query, ...(hasRev ? [] : [qBranch("HEAD", true)]), ...scope),
    opts: {
      chunk_matches: true,
      // Ask for one more than we display: if zoekt reports more than we show, the result was cut.
      max_match_display_count: matches,
      total_max_match_count: matches + 1,
      num_context_lines: opts.contextLines ?? 0,
      shard_max_match_count: -1,
      max_wall_time: { seconds: 0 },
    },
  };
}

// ---- response ------------------------------------------------------------

const loc = (l?: WLocation): SourceLocation => ({
  byteOffset: l?.byte_offset ?? 0,
  lineNumber: l?.line_number ?? 1,
  column: l?.column ?? 1,
});
const range = (r: WRange): SourceRange => ({ start: loc(r.start), end: loc(r.end) });

/** Convert a 1-based rune column into a UTF-16 offset within `text` (zoekt counts code points). */
function colToOffset(text: string, column: number): number {
  let units = 0;
  let runes = 0;
  for (const ch of text) {
    if (runes >= column - 1) break;
    units += ch.length;
    runes++;
  }
  return units;
}

function toMatches(chunks: SearchChunk[], nameRanges: SourceRange[], name: string): SearchMatch[] {
  const out: SearchMatch[] = [];
  if (nameRanges.length) {
    out.push({
      lineNumber: 0,
      text: name,
      ranges: nameRanges.map((r) => [colToOffset(name, r.start.column), colToOffset(name, r.end.column)]),
      fileNameMatch: true,
    });
  }
  for (const c of chunks) {
    const lines = c.content.replace(/\n$/, "").split("\n");
    const byLine = new Map<number, [number, number][]>();
    for (const r of c.matchRanges) {
      for (let n = r.start.lineNumber; n <= r.end.lineNumber; n++) {
        // The end location is exclusive: a range ending at column 1 of a later line stops at the end of the previous one.
        if (n > r.start.lineNumber && n === r.end.lineNumber && r.end.column === 1) continue;
        const text = lines[n - c.contentStart.lineNumber] ?? "";
        const from = n === r.start.lineNumber ? colToOffset(text, r.start.column) : 0;
        const to = n === r.end.lineNumber ? colToOffset(text, r.end.column) : text.length;
        byLine.set(n, [...(byLine.get(n) ?? []), [from, Math.max(from, to)]]);
      }
    }
    for (const [n, ranges] of [...byLine].sort((a, b) => a[0] - b[0])) {
      out.push({ lineNumber: n, text: lines[n - c.contentStart.lineNumber] ?? "", ranges, fileNameMatch: false });
    }
  }
  return out;
}

export function transformResponse(res: WSearchResponse, started: number): SearchResponse {
  const files = (res.files ?? []).map<SearchFile>((f) => {
    const name = Buffer.from(f.file_name).toString("utf8");
    const fileNameRanges = f.chunk_matches.filter((c) => c.file_name).flatMap((c) => c.ranges.map(range));
    const chunks = f.chunk_matches
      .filter((c) => !c.file_name)
      .map<SearchChunk>((c) => ({
        content: Buffer.from(c.content).toString("utf8"),
        contentStart: loc(c.content_start),
        matchRanges: c.ranges.map(range),
        symbols: (c.symbol_info ?? []).map((s) => ({
          symbol: s.sym,
          kind: s.kind,
          ...(s.parent ? { parent: { symbol: s.parent, kind: s.parent_kind ?? "" } } : {}),
        })),
      }));
    return {
      repo: f.repository,
      path: name,
      branches: f.branches ?? [],
      language: f.language ?? "",
      fileNameRanges,
      chunks,
      occurrences: chunks.reduce((n, c) => n + c.matchRanges.length, 0) + fileNameRanges.length,
      matches: toMatches(chunks, fileNameRanges, name),
    };
  });
  const actual = files.reduce((n, f) => n + f.chunks.reduce((m, c) => m + c.matchRanges.length, 0) + f.fileNameRanges.length, 0);
  const total = res.stats?.match_count ?? actual;
  return {
    files,
    fileCount: res.stats?.file_count ?? files.length,
    matchCount: total,
    rawMatchCount: total,
    crashes: res.stats?.crashes ?? 0,
    filesSkipped: res.stats?.files_skipped ?? 0,
    durationMs: Date.now() - started,
    // A crashed shard or skipped files means results may be missing even when the counts line up.
    isSearchExhaustive: total <= actual && !(res.stats?.crashes) && !(res.stats?.files_skipped),
  };
}

/** Run a query IR against zoekt. */
export async function searchIR(query: Q, opts: SearchOptions = {}, scope: Q[] = []): Promise<SearchResponse> {
  const started = Date.now();
  const req = buildRequest(query, opts, scope);
  return rankKnowledgeFirst(transformResponse(await transport.search(req), started));
}

/**
 * Generated knowledge documents answer "how does this work" better than raw code, so on the non-streaming
 * surfaces (API, tools, agents) they come first. The sort is stable: relative order within each group is zoekt's.
 */
export function rankKnowledgeFirst(r: SearchResponse): SearchResponse {
  const isKb = (f: SearchFile) => f.repo.endsWith(KB_SUFFIX);
  if (!r.files.some(isKb)) return r;
  return { ...r, files: [...r.files.filter(isKb), ...r.files.filter((f) => !isKb(f))] };
}

/** Streaming variant: yields one transformed chunk per zoekt flush. */
export async function* streamIR(query: Q, opts: SearchOptions = {}, scope: Q[] = []): AsyncGenerator<SearchResponse> {
  const started = Date.now();
  const req = buildRequest(query, opts, scope);
  for await (const chunk of transport.stream(req)) yield transformResponse(chunk, started);
}

/** Search syntax string in, results out. Throws QuerySyntaxError on bad syntax. */
export function search(
  q: string,
  opts: SearchOptions & { regex?: boolean; caseSensitive?: boolean; scope?: Q[] } = {},
): Promise<SearchResponse> {
  const ir = parseQuery(q, { regex: opts.regex, caseSensitive: opts.caseSensitive });
  if ("const" in ir && ir.const === false) return Promise.reject(new Error("empty query"));
  return searchIR(ir, opts, opts.scope);
}
