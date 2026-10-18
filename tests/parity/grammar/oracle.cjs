// v6 oracle for the query language: v6's compiled Lezer parser (from tests/parity/.oracle) plus a
// transcription of v6's parse-tree -> IR transform (web: parseQuerySyntaxIntoIR), with the DB
// lookups stubbed: repo: regexes expand to no knowledge repos, reposet: passes names through,
// and context:<name> resolves through a fixed map.
const path = require("node:path");
const ql = require(path.join(__dirname, "../.oracle/packages/queryLanguage/dist/index.js"));
const languages = require("../../../packages/shared/src/linguistLanguages.json");

const LANG = new Map(languages.map((l) => [l.toLowerCase(), l]));
const strict = ql.parser.configure({ strict: true });
const strictRegex = ql.parser.configure({ strict: true, dialect: "regex" });
const T = ql; // term ids are exported as named constants (Program, AndExpr, ...)

function children(node) {
  const out = [];
  for (let c = node.firstChild; c; c = c.nextSibling) out.push(c);
  return out;
}

/** Returns { ir } or { error } (a SyntaxError message from the strict parser, or a transform error). */
function parse(input, { regex = false, caseSensitive = false, contexts = {} } = {}) {
  let tree;
  try {
    tree = (regex ? strictRegex : strict).parse(input);
  } catch (e) {
    return { error: `syntax: ${e.message}` };
  }
  const leaf = (pattern) =>
    regex
      ? { regexp: { regexp: pattern, case_sensitive: caseSensitive, file_name: false, content: true } }
      : { substring: { pattern, case_sensitive: caseSensitive, file_name: false, content: true } };
  const flags = (v, ok, map) => {
    const value = v.toLowerCase();
    if (!ok.includes(value)) throw new Error(`invalid value ${value}`);
    return { raw_config: { flags: map[value] ? [map[value]] : [] } };
  };
  const prefix = (node) => {
    const kw = node.firstChild;
    if (!kw) throw new Error("PrefixExpr has no child");
    const text = input.substring(kw.from, kw.to);
    const colon = text.indexOf(":");
    const v = text.substring(colon + 1).replace(/^"|"$/g, "");
    switch (kw.type.id) {
      case T.FileExpr:
        return { regexp: { regexp: v, case_sensitive: caseSensitive, file_name: true, content: false } };
      case T.RepoExpr:
        return { repo: { regexp: v } };
      case T.RevisionExpr:
        return { branch: { pattern: v === "*" ? "" : v, exact: false } };
      case T.ContentExpr:
        return leaf(v);
      case T.LangExpr:
        return { language: { language: LANG.get(v.toLowerCase()) ?? v } };
      case T.SymExpr:
        return { symbol: { expr: { regexp: { regexp: v, case_sensitive: caseSensitive, file_name: false, content: true } } } };
      case T.VisibilityExpr:
        return flags(v, ["public", "private", "any"], { public: "FLAG_ONLY_PUBLIC", private: "FLAG_ONLY_PRIVATE" });
      case T.ArchivedExpr:
        return flags(v, ["yes", "no", "only"], { no: "FLAG_NO_ARCHIVED", only: "FLAG_ONLY_ARCHIVED" });
      case T.ForkExpr:
        return flags(v, ["yes", "no", "only"], { no: "FLAG_NO_FORKS", only: "FLAG_ONLY_FORKS" });
      case T.ContextExpr: {
        if (!(v in contexts)) throw new Error(`context not found: ${v}`);
        return { repo_set: { set: Object.fromEntries(contexts[v].map((r) => [r.trim(), true])) } };
      }
      case T.RepoSetExpr:
        return { repo_set: { set: Object.fromEntries(v.split(",").map((r) => [r.trim(), true])) } };
      default:
        throw new Error(`unknown prefix ${kw.type.name}`);
    }
  };
  const walk = (node) => {
    switch (node.type.id) {
      case T.Program: {
        const c = node.firstChild;
        return c ? walk(c) : { const: false };
      }
      case T.AndExpr:
        return { and: { children: children(node).map(walk) } };
      case T.OrExpr:
        return { or: { children: children(node).map(walk) } };
      case T.NegateExpr: {
        const c = node.getChild("PrefixExpr") || node.getChild("ParenExpr");
        if (!c) throw new Error("NegateExpr missing child");
        return { not: { child: walk(c) } };
      }
      case T.ParenExpr: {
        const c = node.getChild("query") || node.firstChild;
        return c ? walk(c) : { const: false };
      }
      case T.PrefixExpr:
        return prefix(node);
      case T.QuotedTerm:
      case T.Term: {
        const text = input.substring(node.from, node.to);
        return leaf(node.type.id === T.QuotedTerm ? text.replace(/^"|"$/g, "") : text);
      }
      default:
        // v6 logs and returns a match-all const for node types it does not handle.
        return { const: true };
    }
  };
  try {
    return { ir: walk(tree.topNode), tree: tree.toString() };
  } catch (e) {
    return { error: `transform: ${e.message}` };
  }
}

module.exports = { parse };
