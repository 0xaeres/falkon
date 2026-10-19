// Only sets are sorted. Files tie-break nondeterministically in the live index, so `files` and the
// per-file blocks of grep text are canonicalized by repo and path; everything inside a file keeps its order. Ordered protocol content and arbitrary arrays retain their order.
const sets = new Set(["branches", "matchRanges", "fileNameRanges", "ranges"]);
const timings = new Set(["durationMs", "duration_ms", "elapsedMs", "elapsed_ms"]);
const canonical = (value: unknown) => JSON.stringify(value);

const fileKey = (f: unknown) => { const o = (f ?? {}) as { repo?: string; path?: string }; return `${o.repo ?? ""}\0${o.path ?? ""}`; };
const byKey = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function normalize(value: unknown, key = ""): unknown {
  if (typeof value === "string" && key === "text" && /^Found .*\n\n\[/.test(value)) {
    const [head, ...blocks] = value.split(/\n\n(?=\[)/);
    return [head, ...blocks.sort(byKey)].join("\n\n");
  }
  if (Array.isArray(value)) {
    const items = value.map((item) => normalize(item));
    if (key === "files") return items.sort((a, b) => byKey(fileKey(a), fileKey(b)));
    return sets.has(key) ? items.sort((a, b) => canonical(a).localeCompare(canonical(b), "en")) : items;
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).filter(([k]) => !timings.has(k)).sort(([a], [b]) => a.localeCompare(b, "en")).map(([k, v]) => [k, normalize(v, k)]));
  }
  return value;
}
