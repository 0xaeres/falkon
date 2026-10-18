import {
  qAnd, qBranch, qConst, qContent, qFileName, qLanguage, qNot, qOr, qRepo, qRepoSet, qSymbol,
  type Q, type RawFlag,
} from "./ir";

/**
 * Hand-written parser for the search syntax:
 *
 *   query  := and ("or" and)*
 *   and    := unary+                       (juxtaposition = AND)
 *   unary  := "-"? (group | prefix) | group | prefix | quoted | word
 *   group  := "(" query? ")"
 *   prefix := name ":" (quoted | word)
 *
 * `or` binds looser than AND. `-` only negates a prefix filter or a group;
 * elsewhere it is an ordinary character.
 */

export interface ParseOptions {
  regex?: boolean;
  caseSensitive?: boolean;
}

export class QuerySyntaxError extends Error {}

const PREFIXES: Record<string, string> = {
  archived: "archived",
  rev: "rev",
  content: "content", c: "content",
  context: "context",
  file: "file", f: "file",
  fork: "fork",
  visibility: "visibility",
  repo: "repo", r: "repo",
  lang: "lang",
  sym: "sym",
  reposet: "reposet",
};

type Tok =
  | { k: "lp"; neg: boolean }
  | { k: "rp" }
  | { k: "or" }
  | { k: "prefix"; name: string; value: string; neg: boolean }
  | { k: "term"; text: string };

const isSpace = (c: string | undefined) => c === " " || c === "\t" || c === "\n" || c === "\r";

function readQuoted(src: string, i: number): { value: string; end: number } {
  let out = "";
  let j = i + 1;
  while (j < src.length && src[j] !== '"') {
    if (src[j] === "\\" && src[j + 1] === '"') {
      out += '"';
      j += 2;
    } else if (src[j] === "\n") {
      throw new QuerySyntaxError("unterminated quoted string");
    } else out += src[j++];
  }
  if (src[j] !== '"') throw new QuerySyntaxError("unterminated quoted string");
  return { value: out, end: j + 1 };
}

/**
 * A bare word ends at whitespace, or at a `)` that closes a group rather than the word's own `(`.
 * A backslash escapes the next character, and in regex mode `[...]` is a character class, so
 * `foo\)` and `[)]` keep their parenthesis.
 */
function readWord(src: string, i: number, regex: boolean): { value: string; end: number } {
  let depth = 0;
  let inClass = false;
  let j = i;
  while (j < src.length && !isSpace(src[j])) {
    const c = src[j]!;
    if (c === "\\" && j + 1 < src.length && !isSpace(src[j + 1])) {
      j += 2;
      continue;
    }
    if (regex && inClass) {
      if (c === "]") inClass = false;
    } else if (regex && c === "[") {
      inClass = true;
    } else if (c === "(") depth++;
    else if (c === ")") {
      if (depth === 0) break;
      depth--;
    }
    j++;
  }
  return { value: src.slice(i, j), end: j };
}

/** In regex mode `(` at the start of a token is a group only if its contents look like query syntax. */
function looksLikeGroup(src: string, i: number): boolean {
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === "(") depth++;
    else if (src[j] === ")" && --depth === 0) {
      const inner = src.slice(i + 1, j);
      return /(^|\s)(or)(\s|$)/.test(inner) || /(^|[\s(-])[a-z]+:/.test(inner) && prefixIn(inner);
    }
  }
  return false;
}
const prefixIn = (s: string) => [...s.matchAll(/(?:^|[\s(-])([a-z]+):/g)].some((m) => m[1]! in PREFIXES);

function tokenize(src: string, regex: boolean): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    if (isSpace(src[i])) { i++; continue; }

    let neg = false;
    let start = i;
    if (src[i] === "-" && i + 1 < src.length) {
      const next = src[i + 1];
      const prefixAhead = /^[a-z]+:/.exec(src.slice(i + 1));
      const groupAhead = next === "(" && (!regex || looksLikeGroup(src, i + 1));
      if (groupAhead || (prefixAhead && prefixAhead[0].slice(0, -1) in PREFIXES)) {
        neg = true;
        start = i + 1;
      }
    }

    if (src[start] === "(" && (!regex || looksLikeGroup(src, start))) {
      toks.push({ k: "lp", neg });
      i = start + 1;
      continue;
    }
    if (neg) {
      // "-" was followed by a prefix; fall through to prefix handling below
    }
    if (src[start] === ")" && !neg) {
      toks.push({ k: "rp" });
      i = start + 1;
      continue;
    }

    const m = /^([a-z]+):/.exec(src.slice(start));
    if (m && m[1]! in PREFIXES) {
      let j = start + m[0].length;
      let value: string;
      if (src[j] === '"') {
        const q = readQuoted(src, j);
        value = q.value;
        j = q.end;
      } else {
        const w = readWord(src, j, regex);
        value = w.value;
        j = w.end;
      }
      if (value === "") throw new QuerySyntaxError(`missing value after "${m[1]}:"`);
      toks.push({ k: "prefix", name: PREFIXES[m[1]!]!, value, neg });
      i = j;
      continue;
    }

    if (src[start] === '"') {
      const q = readQuoted(src, start);
      toks.push({ k: "term", text: q.value });
      i = q.end;
      continue;
    }

    const w = readWord(src, start, regex);
    if (w.value === "or") toks.push({ k: "or" });
    else toks.push({ k: "term", text: w.value });
    i = w.end;
  }
  return toks;
}

const LANGUAGES = [
  "C", "C#", "C++", "CSS", "Dart", "Dockerfile", "Elixir", "Erlang", "Go", "GraphQL", "Groovy", "HCL", "HTML",
  "Haskell", "Java", "JavaScript", "JSON", "Julia", "Kotlin", "Lua", "Makefile", "Markdown", "Objective-C", "OCaml",
  "PHP", "Perl", "Protocol Buffer", "Python", "R", "Ruby", "Rust", "SCSS", "SQL", "Scala", "Shell", "Svelte", "Swift",
  "TOML", "TSX", "TypeScript", "Vue", "XML", "YAML", "Zig",
];
const languageByLower = new Map(LANGUAGES.map((l) => [l.toLowerCase(), l]));

/** Linguist names are case-sensitive in zoekt; accept any casing for the common ones. */
export const normalizeLanguage = (v: string) => languageByLower.get(v.toLowerCase()) ?? v;

const choice = (name: string, value: string, allowed: string[]) => {
  const v = value.toLowerCase();
  if (!allowed.includes(v)) throw new QuerySyntaxError(`invalid ${name} value "${value}", expected ${allowed.join(", ")}`);
  return v;
};

function prefixToQ(name: string, value: string, o: Required<ParseOptions>): Q {
  switch (name) {
    case "file": return qFileName(value, o.caseSensitive);
    case "repo": return qRepo(value);
    case "rev": return qBranch(value === "*" ? "" : value, false); // "" matches every branch
    case "content": return qContent(value, o);
    case "lang": return qLanguage(normalizeLanguage(value));
    case "sym": return qSymbol({ regexp: { regexp: value, file_name: false, content: true, case_sensitive: o.caseSensitive } });
    case "reposet": return qRepoSet(value.split(",").map((s) => s.trim()).filter(Boolean));
    case "context": throw new QuerySyntaxError("search contexts are not supported");
    case "visibility": {
      const v = choice("visibility", value, ["public", "private", "any"]);
      const flags: RawFlag[] = v === "public" ? ["FLAG_ONLY_PUBLIC"] : v === "private" ? ["FLAG_ONLY_PRIVATE"] : [];
      return { raw_config: { flags } };
    }
    case "archived": {
      const v = choice("archived", value, ["yes", "no", "only"]);
      return { raw_config: { flags: v === "no" ? ["FLAG_NO_ARCHIVED"] : v === "only" ? ["FLAG_ONLY_ARCHIVED"] : [] } };
    }
    case "fork": {
      const v = choice("fork", value, ["yes", "no", "only"]);
      return { raw_config: { flags: v === "no" ? ["FLAG_NO_FORKS"] : v === "only" ? ["FLAG_ONLY_FORKS"] : [] } };
    }
  }
  throw new QuerySyntaxError(`unknown filter "${name}:"`);
}

export function parseQuery(src: string, options: ParseOptions = {}): Q {
  const o = { regex: options.regex ?? false, caseSensitive: options.caseSensitive ?? false };
  const toks = tokenize(src, o.regex);
  let p = 0;

  const parseOr = (): Q => {
    const branches = [parseAnd()];
    while (toks[p]?.k === "or") {
      p++;
      branches.push(parseAnd());
    }
    return branches.length === 1 ? branches[0]! : qOr(...branches);
  };

  const parseAnd = (): Q => {
    const items: Q[] = [];
    for (;;) {
      const t = toks[p];
      if (!t || t.k === "rp" || t.k === "or") break;
      items.push(parseUnary());
    }
    if (items.length === 0) throw new QuerySyntaxError('expected an expression near "or" or ")"');
    return items.length === 1 ? items[0]! : qAnd(...items);
  };

  const parseUnary = (): Q => {
    const t = toks[p++]!;
    if (t.k === "lp") {
      const inner = toks[p]?.k === "rp" ? qConst(false) : parseOr();
      if (toks[p]?.k !== "rp") throw new QuerySyntaxError("missing closing parenthesis");
      p++;
      return t.neg ? qNot(inner) : inner;
    }
    if (t.k === "prefix") {
      const q = prefixToQ(t.name, t.value, o);
      return t.neg ? qNot(q) : q;
    }
    if (t.k === "term") return qContent(t.text, o);
    throw new QuerySyntaxError("unexpected token");
  };

  if (toks.length === 0) return qConst(false);
  const q = parseOr();
  if (p < toks.length) throw new QuerySyntaxError(toks[p]!.k === "rp" ? "unmatched closing parenthesis" : "unexpected token");
  return q;
}
