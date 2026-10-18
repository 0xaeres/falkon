import path from "node:path";

/** File names that say nothing about the concept a document covers. */
export const GENERIC_NAMES = new Set([
  "overview", "readme", "index", "doc", "docs", "documentation", "about", "misc", "general",
  "summary", "notes", "info", "main", "other", "todo", "claude", "agents",
]);

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export const CONCEPT_PATH_RULE =
  "New document paths must be exactly system-slug/concept-slug.md: two segments, each lowercase kebab-case " +
  "(a-z, 0-9, hyphens) of at most 64 characters. The file name names a specific concept: not a generic word " +
  "like overview, index or notes, and not a repeat of the folder name.";

/** Any path a document may live at: relative, normalized, markdown, no glob or escape characters. */
export function isDocPath(p: string): boolean {
  if (!p || p.includes("\0") || p.includes("\\") || p.startsWith(":") || !p.endsWith(".md")) return false;
  if (/[*?[\]]/.test(p) || path.posix.isAbsolute(p) || path.win32.isAbsolute(p)) return false;
  if (path.posix.normalize(p) !== p) return false;
  return p.split("/").every((seg) => seg !== "" && seg !== "." && seg !== "..");
}

export function isSystemSlug(s: string): boolean {
  return s.length <= 64 && SLUG.test(s) && !GENERIC_NAMES.has(squash(s));
}

/** The shape every newly created document must have. Existing documents are grandfathered. */
export function isConceptPath(p: string): boolean {
  if (!isDocPath(p)) return false;
  const parts = p.split("/");
  if (parts.length !== 2) return false;
  const system = parts[0]!;
  const concept = parts[1]!.slice(0, -3);
  return (
    system.length <= 64 &&
    concept.length <= 64 &&
    SLUG.test(system) &&
    SLUG.test(concept) &&
    !GENERIC_NAMES.has(squash(concept)) &&
    squash(concept) !== squash(system)
  );
}

/** The system folder of a document path, or "root" for a top-level file. */
export const systemOf = (p: string) => (p.includes("/") ? p.split("/")[0]! : "root");
