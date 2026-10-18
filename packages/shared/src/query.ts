/**
 * Translates the Sourcebot-style query language into Zoekt syntax.
 *
 * Supported: bare terms (AND), "quoted phrases", file: repo: rev: lang: sym:,
 * `or`, parentheses, `-` negation of terms/filters/groups.
 * Bare terms are literal unless `regex` is true.
 */

type Tok =
  | { k: "lp"; neg: boolean }
  | { k: "rp" }
  | { k: "or" }
  | { k: "term"; neg: boolean; filter?: string; value: string; quoted: boolean };

const FILTERS: Record<string, string> = {
  file: "file",
  repo: "repo",
  rev: "branch",
  lang: "lang",
  sym: "sym",
  case: "case",
};

/** Escape for RE2 using \xHH so no whitespace, quote or paren survives. */
export function escapeLiteral(s: string): string {
  let out = "";
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (c > 127 || /[A-Za-z0-9_]/.test(ch)) out += ch;
    else out += "\\x" + c.toString(16).padStart(2, "0");
  }
  return out;
}

export function protectRegex(s: string): string {
  return s.replace(/[\s"]/g, (ch) => "\\x" + ch.charCodeAt(0).toString(16).padStart(2, "0"));
}

function tokenize(q: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < q.length) {
    const c = q[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    let neg = false;
    if (c === "-" && i + 1 < q.length && !/\s/.test(q[i + 1])) {
      neg = true;
      i++;
    }
    if (q[i] === "(") {
      toks.push({ k: "lp", neg });
      i++;
      continue;
    }
    if (q[i] === ")" && !neg) {
      toks.push({ k: "rp" });
      i++;
      continue;
    }
    // filter prefix?
    let filter: string | undefined;
    const m = /^([a-z]+):/.exec(q.slice(i));
    if (m && FILTERS[m[1]]) {
      filter = m[1];
      i += m[0].length;
    }
    let value = "";
    let quoted = false;
    if (q[i] === '"') {
      quoted = true;
      i++;
      while (i < q.length && q[i] !== '"') {
        if (q[i] === "\\" && q[i + 1] === '"') {
          value += '"';
          i += 2;
        } else value += q[i++];
      }
      i++; // closing quote
    } else {
      while (i < q.length && !/\s/.test(q[i]) && q[i] !== ")") value += q[i++];
    }
    if (!filter && !quoted && value === "or" && !neg) toks.push({ k: "or" });
    else toks.push({ k: "term", neg, filter, value, quoted });
  }
  return toks;
}

export function translateQuery(q: string, opts: { regex?: boolean } = {}): string {
  const parts: string[] = [];
  for (const t of tokenize(q)) {
    if (t.k === "lp") parts.push(t.neg ? "-(" : "(");
    else if (t.k === "rp") parts.push(")");
    else if (t.k === "or") parts.push("or");
    else {
      const prefix = t.neg ? "-" : "";
      if (t.filter) {
        const name = FILTERS[t.filter];
        // filter values are regexes in zoekt; protect whitespace/quotes only
        parts.push(`${prefix}${name}:${protectRegex(t.value)}`);
      } else {
        const body = opts.regex ? protectRegex(t.value) : escapeLiteral(t.value);
        if (body.length > 0) parts.push(prefix + body);
      }
    }
  }
  return parts.join(" ");
}
