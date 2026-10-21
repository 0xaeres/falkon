import { z } from "zod";
import { MAX_ABSORBS, MAX_CREATES, MAX_DOCS_PER_SYSTEM, MAX_SYSTEMS } from "./limits";
import { CONCEPT_PATH_RULE, isConceptPath, isSystemSlug } from "./paths";

// ---- what each agent submits ----------------------------------------------

export const candidateSchema = z.object({
  systems: z.array(z.object({ name: z.string(), thesis: z.string(), evidenceAnchors: z.array(z.string()) })),
  territoryTooBig: z.boolean().optional(),
});
export type Candidates = z.infer<typeof candidateSchema>;

export const systemListSchema = z.object({
  systems: z.array(
    z.object({
      slug: z.string(),
      name: z.string(),
      thesis: z.string(),
      evidenceAnchors: z.array(z.string()),
      assignedDocPaths: z.array(z.string()),
    }),
  ),
});
export type SystemList = z.infer<typeof systemListSchema>;
export type System = SystemList["systems"][number];

export const reportSchema = z.object({
  proposedNewDocs: z.array(
    z.object({
      path: z.string(),
      rationale: z.string(),
      keyClaims: z.array(z.string()).describe("3-8 claims, each naming a repository file that proves it"),
      keyFiles: z.array(z.string()),
    }),
  ),
  dispositions: z.array(
    z.object({
      path: z.string(),
      disposition: z.enum(["keep", "merge", "delete"]),
      mergeInto: z.string().optional(),
      keyClaims: z.array(z.string()).optional(),
      keyFiles: z.array(z.string()).optional(),
    }),
  ),
  systemSummary: z.string(),
});
export type Report = z.infer<typeof reportSchema>;
export type SurveyReport = { system: System; report: Report };

export const workListSchema = z.object({
  items: z.array(
    z.object({
      path: z.string(),
      action: z.enum(["keep", "create", "merge"]),
      absorbs: z.array(z.string()).optional(),
      sources: z.array(z.object({ system: z.string(), path: z.string() })).optional(),
    }),
  ),
  deletes: z.array(z.string()),
});
export type WorkList = z.infer<typeof workListSchema>;
export type WorkItem = WorkList["items"][number];

// ---- validation ------------------------------------------------------------

export type Check<T> = { ok: true; value: T } | { ok: false; reason: string; message: string; [k: string]: unknown };
const fail = (reason: string, message: string, extra: Record<string, unknown> = {}): Check<never> => ({ ok: false, reason, message, ...extra });

const dupes = (xs: string[]) => {
  const seen = new Set<string>();
  const d = new Set<string>();
  for (const x of xs) (seen.has(x) ? d : seen).add(x);
  return [...d].sort();
};
const blank = (s: string) => s.trim().length === 0;

export function checkCandidates(c: Candidates): Check<Candidates> {
  if (!c.systems.length && !c.territoryTooBig) return fail("empty", "Submit one or more candidate systems, or else set territoryTooBig.");
  if (c.systems.some((s) => blank(s.name) || blank(s.thesis) || !s.evidenceAnchors.length))
    return fail("incomplete", "Each candidate must carry a name, a thesis, and one or more evidence anchors (repository file paths).");
  return { ok: true, value: c };
}

export function checkSystemList(input: SystemList, existing: string[], required: string[]): Check<SystemList> {
  const { systems } = input;
  if (!systems.length) return fail("empty", "At least one system is required.");
  const badSlugs = systems.filter((s) => !isSystemSlug(s.slug)).map((s) => s.slug);
  if (badSlugs.length) return fail("bad_slugs", "System slugs must be lowercase kebab-case, at most 64 characters, and not generic.", { badSlugs });
  const dupSlugs = dupes(systems.map((s) => s.slug));
  if (dupSlugs.length) return fail("duplicate_slugs", "System slugs must be unique.", { dupSlugs });
  if (systems.some((s) => blank(s.name) || blank(s.thesis) || !s.evidenceAnchors.length))
    return fail("incomplete", "Each system must carry a name, a thesis, and one or more evidence anchors.");
  const assigned = systems.flatMap((s) => s.assignedDocPaths);
  if (assigned.includes("README.md")) return fail("readme", "README.md is generated separately and cannot be assigned.");
  const have = new Set(existing);
  const unknown = [...new Set(assigned.filter((p) => !have.has(p)))].sort();
  if (unknown.length) return fail("unknown_docs", "Assigned paths must be existing documents.", { unknown });
  const twice = dupes(assigned);
  if (twice.length) return fail("assigned_twice", "Each existing document belongs to exactly one system.", { twice });
  const got = new Set(assigned);
  const missing = required.filter((p) => !got.has(p));
  if (missing.length) return fail("unassigned", "Every existing document must be assigned to a system.", { missing });
  if (systems.length > MAX_SYSTEMS)
    return fail("too_many", `No more than ${MAX_SYSTEMS} systems are allowed. Fold satellites into the systems they serve; only systems that hold the architecture up should remain.`);
  return { ok: true, value: input };
}

/**
 * Models often "propose" a document that already exists when they mean to improve it. Rather than
 * fail the whole survey, fold such a proposal into that document's keep disposition (its claims and
 * files become the findings the rewrite should carry).
 */
export function normalizeReport(r: Report, assigned: string[]): Report {
  const have = new Set(assigned);
  const clashing = r.proposedNewDocs.filter((p) => have.has(p.path));
  if (!clashing.length) return r;
  const dispositions = r.dispositions.map((d) => {
    const p = clashing.find((c) => c.path === d.path);
    return p && d.disposition === "keep" ? { ...d, keyClaims: [...(d.keyClaims ?? []), ...p.keyClaims], keyFiles: [...(d.keyFiles ?? []), ...p.keyFiles] } : d;
  });
  const covered = new Set(dispositions.map((d) => d.path));
  for (const p of clashing) if (!covered.has(p.path)) dispositions.push({ path: p.path, disposition: "keep", keyClaims: p.keyClaims, keyFiles: p.keyFiles } as (typeof dispositions)[number]);
  return { ...r, proposedNewDocs: r.proposedNewDocs.filter((p) => !have.has(p.path)), dispositions };
}

export function checkReport(input: Report, assigned: string[]): Check<Report> {
  const paths = input.dispositions.map((d) => d.path);
  const twice = dupes(paths);
  if (twice.length) return fail("duplicate_dispositions", "Each assigned document needs exactly one disposition.", { twice });
  const want = new Set(assigned);
  const got = new Set(paths);
  const missing = assigned.filter((p) => !got.has(p));
  const extra = paths.filter((p) => !want.has(p));
  if (missing.length || extra.length) return fail("coverage", "Dispositions must exactly cover the assigned documents.", { missing, extra });
  for (const d of input.dispositions) {
    if ((d.disposition === "merge") !== (d.mergeInto !== undefined))
      return fail("merge_target", "mergeInto is required if and only if the disposition is merge.", { path: d.path });
  }
  const proposed = input.proposedNewDocs.map((p) => p.path);
  const badPaths = proposed.filter((p) => !isConceptPath(p));
  if (badPaths.length) return fail("bad_paths", CONCEPT_PATH_RULE, { badPaths });
  const clash = proposed.filter((p) => want.has(p));
  if (clash.length) return fail("not_new", "proposedNewDocs may only hold paths that do not exist yet. To improve an existing document, give it a keep disposition and put its claims on that disposition.", { clash });
  const dup = dupes(proposed);
  if (dup.length) return fail("duplicate_proposals", "Each proposal path may appear once.", { dup });
  const noClaims = input.proposedNewDocs.filter((p) => !p.keyClaims.length).map((p) => p.path);
  if (noClaims.length) return fail("no_claims", "Every proposed document needs claims, each naming the repository file that proves it.", { noClaims });
  if (input.proposedNewDocs.length > MAX_DOCS_PER_SYSTEM)
    return fail("too_many", `Propose no more than ${MAX_DOCS_PER_SYSTEM} documents for a system. Keep the concepts that matter most.`);
  return { ok: true, value: input };
}

const srcKey = (s: { system: string; path: string }) => `${s.system}\0${s.path}`;

export function checkWorkList(
  input: WorkList,
  existing: string[],
  required: string[],
  mode: "full" | "delta",
  survey: { systems: System[]; reports: SurveyReport[] },
): Check<WorkList> {
  const have = new Set(existing);
  const need = new Set(required);
  const absorbs = input.items.flatMap((i) => i.absorbs ?? []);
  if ([...input.items.map((i) => i.path), ...absorbs, ...input.deletes].includes("README.md"))
    return fail("readme", "README.md is generated separately and cannot appear in the work list.");

  const isNew = (i: WorkItem) => i.action === "create" || (i.action === "merge" && !have.has(i.path));
  const badNew = input.items.filter((i) => isNew(i) && !isConceptPath(i.path)).map((i) => i.path);
  if (badNew.length) return fail("bad_paths", CONCEPT_PATH_RULE, { badNew });
  const createExists = input.items.filter((i) => i.action === "create" && have.has(i.path)).map((i) => i.path);
  if (createExists.length) return fail("create_exists", "Create items must use new paths.", { createExists });

  const folders = new Set([
    ...survey.systems.map((s) => s.slug),
    ...[...existing, ...survey.reports.flatMap((r) => r.report.proposedNewDocs.map((p) => p.path))].filter((p) => p.includes("/")).map((p) => p.split("/")[0]!),
  ]);
  const badFolder = input.items.find((i) => isNew(i) && !folders.has(i.path.split("/")[0]!));
  if (badFolder) return fail("bad_folder", "New documents must live in a folder named by the survey or by an existing document.", { path: badFolder.path, folders: [...folders].sort() });

  const keepMissing = input.items.filter((i) => i.action === "keep" && !have.has(i.path)).map((i) => i.path);
  if (keepMissing.length) return fail("keep_missing", "A keep item must be an existing document. Use create for a new one.", { keepMissing });
  const createAbsorb = input.items.filter((i) => i.action === "create" && i.absorbs?.length).map((i) => i.path);
  if (createAbsorb.length) return fail("create_absorbs", "Use a merge item to absorb existing documents.", { createAbsorb });
  const mergeNone = input.items.filter((i) => i.action === "merge" && !i.absorbs?.length).map((i) => i.path);
  if (mergeNone.length) return fail("merge_without_absorbs", "A merge item has to absorb one or more existing documents.", { mergeNone });
  const tooMany = input.items.filter((i) => (i.absorbs?.length ?? 0) > MAX_ABSORBS).map((i) => i.path);
  if (tooMany.length) return fail("too_many_absorbs", `Absorb at most ${MAX_ABSORBS} documents per item; leave the rest as keep items.`, { tooMany });

  const badAbsorb = absorbs.filter((p) => (mode === "delta" ? !need.has(p) : !have.has(p)));
  if (badAbsorb.length) return fail("bad_absorbs", mode === "delta" ? "Absorbed paths must be affected documents." : "Absorbed paths must be existing documents.", { badAbsorb });

  if (mode === "delta") {
    const badDel = input.deletes.filter((p) => !need.has(p));
    if (badDel.length) return fail("bad_deletes", "Deleted paths must be affected documents.", { badDel });
    const untouchable = input.items.filter((i) => have.has(i.path) && !need.has(i.path) && !i.absorbs?.length).map((i) => i.path);
    if (untouchable.length) return fail("untouchable", "An unaffected document may only appear as an absorb target.", { untouchable });
  }

  // every required document is accounted for exactly once: kept/merged as an item, absorbed, or deleted
  const covered =
    mode === "full"
      ? [
          ...input.items.filter((i) => i.action === "keep" || (i.action === "merge" && have.has(i.path))).map((i) => i.path),
          ...absorbs,
          ...input.deletes,
        ]
      : [
          ...input.items.filter((i) => (i.action === "keep" || i.action === "merge") && need.has(i.path)).map((i) => i.path),
          ...absorbs,
          ...input.deletes,
        ];
  const twice = dupes(covered);
  const dupItems = dupes(input.items.map((i) => i.path));
  if (twice.length || dupItems.length) return fail("duplicate_paths", "A path may appear once in the work list.", { twice: [...new Set([...twice, ...dupItems])].sort() });
  const gotSet = new Set(covered);
  const missing = required.filter((p) => !gotSet.has(p));
  const extra = covered.filter((p) => (mode === "full" ? !have.has(p) : !need.has(p)));
  if (missing.length || extra.length) return fail("coverage", "Every required document must be dispositioned exactly once.", { missing, extra });

  const creates = input.items.filter(isNew);
  if (creates.length > MAX_CREATES) return fail("too_many_creates", `At most ${MAX_CREATES} new documents per scan.`);
  const proposals = survey.reports.flatMap(({ system, report }) => report.proposedNewDocs.map((p) => ({ system: system.slug, path: p.path })));
  const known = new Set(proposals.map(srcKey));
  for (const i of input.items) {
    const src = i.sources ?? [];
    if (isNew(i) && !src.length) return fail("no_sources", "New documents (create items, or merge items at a new path) must name the survey proposals they draw on.", { path: i.path });
    const d = dupes(src.map(srcKey));
    if (d.length) return fail("duplicate_sources", "Each source pair may appear once per item.", { path: i.path });
    const unknown = src.filter((s) => !known.has(srcKey(s)));
    if (unknown.length) return fail("unknown_sources", "Every source must match a (system slug, proposal path) from the reports.", { path: i.path, unknown });
    const have2 = new Set(src.map(srcKey));
    const omitted = proposals.filter((p) => p.path === i.path && !have2.has(srcKey(p)));
    if (omitted.length) return fail("incomplete_sources", "The sources must list each survey proposal made for the item's own path.", { path: i.path, omitted });
  }
  return { ok: true, value: input };
}
