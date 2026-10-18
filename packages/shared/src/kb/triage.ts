import { DELTA_MAX_CHANGED_FILES, DELTA_MAX_CITED_SHARE, DELTA_MAX_FULL_SCAN_AGE_MS } from "./limits";
import type { DiffRecord, RepoSource } from "./source";

export interface CitationRef {
  repo: string;
  path: string;
  /** commit of `repo` the citation was last verified at */
  commit: string;
}

/** What the citation index remembers about one generated document. */
export interface DocRecord {
  path: string;
  title: string;
  summary: string;
  citations: CitationRef[];
  /** owner commit the document was written against */
  generatedAtCommit: string;
  model: string;
  scanId: number;
}

export type EscalationReason = "never_full_scanned" | "full_scan_too_old" | "no_last_scan" | "base_missing" | "too_many_files" | "too_many_cited_files";

export interface AffectedDoc {
  path: string;
  reasons: string[];
  renames: { repo: string; from: string; to: string }[];
}

export type Triage =
  | { mode: "full"; existing: DocRecord[]; escalated?: EscalationReason }
  | {
      mode: "delta";
      existing: DocRecord[];
      affected: AffectedDoc[];
      /** changed owner files no document cites */
      uncovered: string[];
      commitLog: { sha: string; subject: string }[];
      changedFiles: number;
    };

export interface TriageInput {
  requested: "full" | "delta";
  owner: RepoSource;
  existing: DocRecord[];
  lastScanCommit: string | null;
  lastFullScanAt: Date | null;
  now: Date;
  /** Source for any other repo a document cites, at its current commit; undefined if not available. */
  resolveRepo: (name: string) => Promise<RepoSource | undefined>;
  maxChangedFiles?: number;
  maxCitedShare?: number;
  maxFullScanAgeMs?: number;
}

/** How a diff record relates to a cited path. A deleted file counts as changed: the doc must be revisited. */
export function touches(rec: DiffRecord, cited: string): "changed" | "renamed" | undefined {
  const kind = rec.status[0];
  if (kind === "R") return rec.oldPath === cited ? "renamed" : rec.path === cited ? "changed" : undefined;
  return rec.path === cited ? "changed" : undefined;
}

export async function computeTriage(i: TriageInput): Promise<Triage> {
  const full = (escalated?: EscalationReason): Triage => ({ mode: "full", existing: i.existing, ...(escalated ? { escalated } : {}) });
  if (i.requested === "full") return full();

  const maxAge = i.maxFullScanAgeMs ?? DELTA_MAX_FULL_SCAN_AGE_MS;
  if (i.lastFullScanAt === null) return full("never_full_scanned");
  if (i.now.getTime() - i.lastFullScanAt.getTime() > maxAge) return full("full_scan_too_old");
  if (i.lastScanCommit === null) return full("no_last_scan");

  const ownerDiff = await i.owner.diff(i.lastScanCommit);
  if (ownerDiff === "missing-base") return full("base_missing");
  if (ownerDiff.length > (i.maxChangedFiles ?? DELTA_MAX_CHANGED_FILES)) return full("too_many_files");
  const log = await i.owner.commitsSince(i.lastScanCommit);
  if (log === "missing-base") return full("base_missing");

  const affected = new Map<string, AffectedDoc>();
  const entry = (path: string) => {
    let e = affected.get(path);
    if (!e) affected.set(path, (e = { path, reasons: [], renames: [] }));
    return e;
  };

  // A document on disk with no citation record (e.g. a crash between commit and index) cannot be tracked: redo it.
  for (const doc of i.existing) if (!doc.generatedAtCommit) entry(doc.path).reasons.push("no verified citation record: regenerate");

  // Group citations by (repo, base commit) so each pair is diffed once.
  type Group = { repo: string; base: string; cites: { doc: string; path: string }[] };
  const groups = new Map<string, Group>();
  const allPairs = new Set<string>();
  for (const doc of i.existing) {
    for (const c of doc.citations) {
      allPairs.add(`${c.repo}\0${c.path}`);
      const base = c.repo === i.owner.name ? doc.generatedAtCommit : c.commit;
      const key = `${c.repo}\0${base}`;
      const g = groups.get(key) ?? { repo: c.repo, base, cites: [] };
      g.cites.push({ doc: doc.path, path: c.path });
      groups.set(key, g);
    }
  }

  const touched = new Set<string>();
  for (const g of groups.values()) {
    const src = g.repo === i.owner.name ? i.owner : await i.resolveRepo(g.repo);
    if (!src) {
      for (const c of g.cites) entry(c.doc).reasons.push(`cited repo ${g.repo} is unavailable: remove or replace its citations`);
      continue;
    }
    const diff = src === i.owner && g.base === i.lastScanCommit ? ownerDiff : await src.diff(g.base);
    if (diff === "missing-base") return full("base_missing");
    for (const c of g.cites) {
      for (const rec of diff) {
        const t = touches(rec, c.path);
        if (!t) continue;
        touched.add(`${g.repo}\0${c.path}`);
        const e = entry(c.doc);
        if (t === "renamed") {
          e.reasons.push(`cited file renamed: ${g.repo}::${rec.oldPath} -> ${rec.path}`);
          e.renames.push({ repo: g.repo, from: rec.oldPath!, to: rec.path });
        } else e.reasons.push(`cited file changed: ${g.repo}::${c.path}`);
        break;
      }
    }
  }

  const citedOwner = new Set(i.existing.flatMap((d) => d.citations.filter((c) => c.repo === i.owner.name).map((c) => c.path)));
  const uncovered = [
    ...new Set(
      ownerDiff
        .filter((r) => r.status[0] !== "D" && !citedOwner.has(r.path) && !(r.oldPath && citedOwner.has(r.oldPath)))
        .map((r) => r.path),
    ),
  ];

  const share = allPairs.size === 0 ? 0 : touched.size / allPairs.size;
  if (share > (i.maxCitedShare ?? DELTA_MAX_CITED_SHARE)) return full("too_many_cited_files");

  return {
    mode: "delta",
    existing: i.existing,
    affected: i.existing.filter((d) => affected.has(d.path)).map((d) => affected.get(d.path)!),
    uncovered,
    commitLog: log,
    changedFiles: ownerDiff.length,
  };
}
