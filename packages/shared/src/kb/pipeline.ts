import { z } from "zod";
import { demoteCitations } from "./citations";
import { docTools, verifyCitations, type DocContext, type DocStore, type ItemScope } from "./docTools";
import { BudgetExceededError, estimateTokens, mapLimit, runAgent, tool, type LlmClient, type TokenBudget, type ToolDef } from "./llm";
import { MAX_README_CHARS, README_NARRATIVE_WORDS } from "./limits";
import { carveTerritories, effectiveBudget, filesUnder, isNoise, type Territory, type TerritoryOptions } from "./territories";
import type { RepoSource } from "./source";
import type { DocRecord, Triage } from "./triage";
import {
  candidateSchema, checkCandidates, checkReport, normalizeReport, checkSystemList, checkWorkList,
  reportSchema, systemListSchema, workListSchema,
  type Candidates, type Report, type System, type SurveyReport, type WorkItem, type WorkList,
} from "./validate";

export interface StageModels {
  discovery: string;
  survey: string;
  document: string;
  overview: string;
}

export interface ScanDeps {
  llm: LlmClient;
  models: StageModels;
  budget: TokenBudget;
  owner: RepoSource;
  resolveRepo: (name: string) => Promise<RepoSource | undefined>;
  store: DocStore;
  scanId: number;
  parallelism: number;
  signal?: AbortSignal;
  log?: (msg: string) => void;
  territory?: TerritoryOptions;
  maxSteps?: number;
  /** No scan has ever completed for this repo: log a cost estimate before the first model call. */
  firstScan?: boolean;
}

export interface ScanOutcome {
  mode: "full" | "delta";
  escalated?: string;
  skipped?: boolean;
  territories: number;
  systems: number;
  docsWritten: number;
  docsRemoved: number;
  docsFailed: number;
}

// ---- read tools -------------------------------------------------------------

const MAX_READ_LINES = 250;

/** Read-only tools over repos frozen at their scan commits. `repo` defaults to the owner. */
export function readTools(d: Pick<ScanDeps, "owner" | "resolveRepo">): ToolDef[] {
  const pick = async (repo?: string) => (!repo || repo === d.owner.name ? d.owner : await d.resolveRepo(repo));
  const gone = (repo?: string) => ({ ok: false, reason: "unknown_repo", message: `Repository ${repo} is not available.` });
  const repoArg = z.string().optional().describe("Repository name; defaults to the repository being documented");
  return [
    tool("list_tree", "List files at the pinned commit, optionally under a directory prefix.", z.object({ repo: repoArg, prefix: z.string().optional() }), async ({ repo, prefix }) => {
      const s = await pick(repo);
      if (!s) return gone(repo);
      const files = (await s.listTree(prefix)).filter((p) => !isNoise(p));
      return files.slice(0, 600).join("\n") + (files.length > 600 ? `\n…(${files.length - 600} more; narrow the prefix)` : "") || "No files.";
    }),
    tool(
      "read_file",
      `Read a file at the pinned commit (line-numbered, ${MAX_READ_LINES} lines per call).`,
      z.object({ repo: repoArg, path: z.string(), offset: z.number().int().positive().optional() }),
      async ({ repo, path, offset }) => {
        const s = await pick(repo);
        if (!s) return gone(repo);
        const text = await s.readFile(path);
        if (text === undefined) return { ok: false, reason: "not_found", message: `${path} is missing, binary or too large.` };
        const lines = text.split("\n");
        const start = (offset ?? 1) - 1;
        const slice = lines.slice(start, start + MAX_READ_LINES);
        const more = start + MAX_READ_LINES < lines.length ? `\n…(${lines.length} lines total; continue with offset=${start + MAX_READ_LINES + 1})` : "";
        return slice.map((l, i) => `${start + i + 1}| ${l}`).join("\n") + more;
      },
    ),
    tool("grep", "Search files with an extended regular expression. Optional directory prefix.", z.object({ repo: repoArg, pattern: z.string(), prefix: z.string().optional() }), async ({ repo, pattern, prefix }) => {
      const s = await pick(repo);
      return s ? s.grep(pattern, prefix) : gone(repo);
    }),
    tool("log_history", "Recent commits touching a path.", z.object({ repo: repoArg, path: z.string() }), async ({ repo, path }) => {
      const s = await pick(repo);
      return s ? s.log(path) : gone(repo);
    }),
  ];
}

// ---- prompts ---------------------------------------------------------------

const GOAL =
  "The knowledge base is a short engineer's handbook, not an encyclopedia. It exists to preserve understanding that is expensive to " +
  "rebuild from source: architectural invariants, cross-cutting flows, tricky contracts, and the reasons behind decisions. " +
  "Prefer a few dense, load-bearing documents over broad coverage of every feature or folder.";

const P = {
  scout:
    `${GOAL}\n\nYou are a scout. Explore only your assigned territory with the read tools and identify the load-bearing systems and ideas whose code lives there ` +
    "(a system may reach beyond the territory; cite anchors anywhere). Skip folder-shaped or shallow non-systems. " +
    "If the territory is too large to survey honestly, submit with territoryTooBig set. Finish by calling submit_candidate_systems.",
  reconcile:
    `${GOAL}\n\nYou are the reconciler. Merge the scouts' candidates into one canonical system list: fuse duplicates seen from different territories, fold satellites into parents, ` +
    "split genuine grab-bags, drop low-value non-systems. Aim for the fewest coherent systems that carry the architecture. Give each a stable kebab-case slug and assign every " +
    "existing document to exactly one system. Do not explore. Finish by calling submit_system_list.",
  survey:
    `${GOAL}\n\nYou are a surveyor for one system. Use its evidence anchors as starting points, read deeply, and give every assigned existing document a disposition (keep, merge, delete). ` +
    "Propose the concept documents this system truly deserves, typically one to four. Each proposed path is system-slug/concept-slug.md where the file name names the concept, and must be a path that does not exist yet: improve an existing document through its disposition (keep, with keyClaims and keyFiles), never by proposing it again. " +
    "For each proposal state in the rationale what understanding it preserves, then list 3-8 claims, each naming the file that proves it. Finish by calling submit_system_report.",
  merge:
    `${GOAL}\n\nYou are the merge agent. Turn the surveyors' reports into one complete document work list. Do not explore. Every required path appears exactly once (as a keep or merge item, an absorb target, or a delete). ` +
    "New documents are create items (or merge items with a new path) at system-slug/concept-slug.md, each naming its sources as (system slug, proposal path) pairs. A merge item must absorb at least one existing document. " +
    "When reports overlap or overreach, prefer fewer, denser documents. Finish by calling submit_work_list.",
  doc:
    "You are writing one document for engineers and coding agents who are about to change this repository. Start from BRIEF: verify each claim by reading the cited file at the pinned commit, keep what holds, " +
    "correct or drop what does not, and add only what you find while verifying.\n\n" +
    "Preserve understanding that takes real work to reconstruct from source: architecture, contracts, domain concepts, algorithms, relationships between parts, invariants, and why decisions were made. " +
    "Explain concepts and make implicit connections explicit. Do not transcribe what a file already says; enumerations, schemas and config tables become one sentence plus a citation.\n\n" +
    "Aim for 4,000 to 8,000 characters (20,000 is a hard cap). No frontmatter: begin with a single H1 and a one-sentence first paragraph saying when to read the document. " +
    "Write about the system, not about this task or the knowledge base. Cite evidence as @file:{<repo>::<path>} using exact repository names and paths you have read.\n\n" +
    "Work efficiently: read only the handful of files you need to verify the main claims (roughly ten reads), then write the COMPLETE document in a single write_doc call and call finish_doc. " +
    "Use edit_doc only to repair what finish_doc refuses; do not polish in many small edits. You MUST call finish_doc for your own path with a one-sentence summary. " +
    "If the item absorbs other documents, their bodies are in BRIEF: fold their content in before finishing, then call delete_absorbed_doc for each.",
  readme:
    `Write a concise narrative overview (at most ${README_NARRATIVE_WORDS} words) of this repository's knowledge base from the document list you are given. ` +
    "Return the narrative text only; the document index and dependency list are added by code. You may use the read tools to check a detail.",
};

// ---- helpers ---------------------------------------------------------------

const json = (v: unknown) => JSON.stringify(v);
const settle = <T>(rs: PromiseSettledResult<T>[], what: string): T[] => {
  const errs = rs.flatMap((r) => (r.status === "rejected" ? [r.reason] : []));
  const budget = errs.find((e) => e instanceof BudgetExceededError);
  if (budget) throw budget;
  if (errs.length) throw new AggregateError(errs, `${what}: ${errs.length} failed (${errs.map((e) => (e as Error).message).join("; ").slice(0, 600)})`);
  return rs.map((r) => (r as PromiseFulfilledResult<T>).value);
};

/** An agent whose only way to finish is a validated submission. */
async function submitAgent<I, V>(
  d: ScanDeps,
  a: { label: string; model: string; system: string; user: unknown; tools?: ToolDef[]; name: string; description: string; schema: z.ZodObject<any>; check: (i: I) => { ok: true; value: V } | { ok: false; [k: string]: unknown } },
): Promise<V> {
  let accepted: V | undefined;
  const submit = tool(a.name, a.description, a.schema, (input) => {
    const r = a.check(input as I);
    if (!r.ok) return r;
    accepted = r.value;
    return { ok: true };
  });
  await runAgent({
    llm: d.llm, model: a.model, label: a.label, system: a.system, user: json(a.user),
    tools: [...(a.tools ?? []), submit], finishTool: a.name, done: () => accepted !== undefined,
    budget: d.budget, signal: d.signal, maxSteps: d.maxSteps,
    onStep: ({ label, tool: t }) => d.log?.(`${label}: ${t}`),
  });
  if (accepted === undefined) throw new Error(`${a.label} produced no submission`);
  return accepted;
}

// ---- stages ----------------------------------------------------------------

async function discover(d: ScanDeps, tools: ToolDef[]) {
  const all = (await d.owner.listFiles()).filter((f) => !isNoise(f.path));
  const territories = carveTerritories(all, d.territory);
  d.log?.(`discovery: ${all.length} files, ${territories.length} territories`);

  const scout = async (t: Territory) =>
    ({
      territory: t,
      cand: await submitAgent<Candidates, Candidates>(d, {
        label: `scout ${t.id}`, model: d.models.discovery, system: P.scout, tools,
        user: { repository: d.owner.name, commit: d.owner.commit, territory: t },
        name: "submit_candidate_systems", description: "Submit every candidate system found in this territory.", schema: candidateSchema, check: checkCandidates,
      }),
    });

  const first = settle(await mapLimit(territories, d.parallelism, scout), "scouts");
  const half = Math.ceil(effectiveBudget(all, d.territory) / 2);
  const recarved = first.flatMap((s) =>
    s.cand.territoryTooBig
      ? carveTerritories(filesUnder(all, s.territory.prefixes), { ...d.territory, weight: half }).map((t) => ({ ...t, id: `${s.territory.id}-${t.id}` }))
      : [],
  );
  const second = recarved.length ? settle(await mapLimit(recarved, d.parallelism, scout), "sub-scouts") : [];
  return { territories: territories.length + recarved.length, candidates: [...first, ...second] };
}

async function reconcile(d: ScanDeps, candidates: { territory: Territory; cand: Candidates }[], existing: string[]) {
  return submitAgent<z.infer<typeof systemListSchema>, z.infer<typeof systemListSchema>>(d, {
    label: "reconciler", model: d.models.discovery, system: P.reconcile,
    user: {
      repository: d.owner.name,
      existingDocs: existing,
      candidates: candidates.map(({ territory, cand }) => ({ territory: territory.id, systems: cand.systems })),
    },
    name: "submit_system_list", description: "Submit the canonical system list.", schema: systemListSchema,
    check: (i) => checkSystemList(i, existing, existing),
  }).then((l) => l.systems);
}

async function survey(d: ScanDeps, systems: System[], tools: ToolDef[], extra: (s: System) => Record<string, unknown>): Promise<SurveyReport[]> {
  const rs = await mapLimit(systems, d.parallelism, async (system) => ({
    system,
    report: await submitAgent<Report, Report>(d, {
      label: `surveyor ${system.slug}`, model: d.models.survey, system: P.survey, tools,
      user: { repository: d.owner.name, commit: d.owner.commit, system, ...extra(system) },
      name: "submit_system_report", description: "Submit the complete system report.", schema: reportSchema,
      check: (i) => checkReport(normalizeReport(i, system.assignedDocPaths), system.assignedDocPaths),
    }),
  }));
  return settle(rs, "surveyors");
}

async function merge(d: ScanDeps, reports: SurveyReport[], systems: System[], existing: string[], required: string[], mode: "full" | "delta", extra: Record<string, unknown>) {
  return submitAgent<WorkList, WorkList>(d, {
    label: "merge", model: d.models.survey, system: P.merge,
    user: { existingDocs: existing, requiredPaths: required, mode, reports, ...extra },
    name: "submit_work_list", description: "Submit the complete document work list.", schema: workListSchema,
    check: (i) => checkWorkList(i, existing, required, mode, { systems, reports }),
  });
}

/** Everything a doc agent needs to know about its item, assembled from the survey. */
async function briefFor(item: WorkItem, reports: SurveyReport[], store: DocStore) {
  const sources = (item.sources ?? []).flatMap((s) => {
    const r = reports.find((x) => x.system.slug === s.system);
    const p = r?.report.proposedNewDocs.find((x) => x.path === s.path);
    return r && p ? [{ system: { slug: r.system.slug, name: r.system.name, thesis: r.system.thesis, anchors: r.system.evidenceAnchors }, summary: r.report.systemSummary, rationale: p.rationale, keyClaims: p.keyClaims, keyFiles: p.keyFiles }] : [];
  });
  const disposition = (path: string) => reports.flatMap((r) => r.report.dispositions.filter((x) => x.path === path).map((x) => ({ ...x, system: r.system.slug })))[0];
  const absorbed = await Promise.all((item.absorbs ?? []).map(async (path) => ({ path, body: await store.read(path), disposition: disposition(path) })));
  return { sources, disposition: disposition(item.path), absorbed };
}

async function writeDocs(
  d: ScanDeps, list: WorkList, reports: SurveyReport[], reasons: Map<string, string[]>, existing: Set<string>, tools: ToolDef[],
): Promise<{ written: number; failed: number }> {
  const ctx: DocContext = { store: d.store, owner: d.owner, resolveRepo: d.resolveRepo, scanId: d.scanId, model: d.models.document };
  let failed = 0;
  const rs = await mapLimit(list.items, d.parallelism, async (item) => {
    d.budget.check();
    const scope: ItemScope = {
      path: item.path, absorbs: item.absorbs ?? [], isNew: !existing.has(item.path),
      reasons: [...(reasons.get(item.path) ?? []), ...(item.absorbs ?? []).flatMap((a) => reasons.get(a) ?? [])],
    };
    const state = { finished: false, written: existing.has(item.path) };
    await runAgent({
      llm: d.llm, model: d.models.document, label: `doc ${item.path}`, system: P.doc,
      user: json({
        repository: d.owner.name, commit: d.owner.commit, item,
        currentBody: existing.has(item.path) ? await d.store.read(item.path) : undefined,
        BRIEF: await briefFor(item, reports, d.store),
        ...(scope.reasons.length ? { WHY_NOW: scope.reasons } : {}),
      }),
      tools: [...tools, ...docTools(ctx, scope, state)], finishTool: "finish_doc", done: () => state.finished,
      // out of steps: first make sure a body exists, then finish it
      forcePlan: (left) => (state.finished ? undefined : !state.written ? "write_doc" : left === 1 ? "finish_doc" : undefined),
      budget: d.budget, signal: d.signal, maxSteps: d.maxSteps ?? 30,
      onStep: ({ label, tool: t }) => d.log?.(`${label}: ${t}`),
    });
    // an agent that finished but left absorbed docs behind: remove them so the work list holds
    for (const a of item.absorbs ?? []) {
      if ((await d.store.read(a)) !== undefined) {
        await d.store.remove(a, `kb: merge into ${item.path}: ${a}\n\nScan: ${d.scanId}`);
        await d.store.records.drop(a);
      }
    }
    return item.path;
  });
  for (const r of rs) if (r.status === "rejected") failed++;
  settle(rs, "document agents");
  return { written: list.items.length - failed, failed };
}

/** README = LLM narrative + a code-built index, so it can never mis-cite or drift from the real document list. */
export function composeReadme(owner: string, narrative: string, docs: { path: string; summary: string }[], dependsOn: string[]): string {
  const head = [`# ${owner} knowledge base`, "", ...(narrative.trim() ? [narrative.trim(), ""] : []), "## Documents", ""];
  const tail = ["", "## Depends on", "", ...(dependsOn.length ? dependsOn.map((n) => `- ${n}`) : ["_None_"])];
  const line = (p: string, s: string) => `- [${p}](${p}): ${s}`;
  let body = [...head, ...docs.map((x) => line(x.path, x.summary)), ...tail].join("\n");
  if (body.length > MAX_README_CHARS) {
    const per = Math.max(24, Math.floor((MAX_README_CHARS - [...head, ...tail].join("\n").length) / Math.max(1, docs.length)) - 4 - 30);
    const clip = (s: string) => (s.length > per ? s.slice(0, per - 1) + "…" : s);
    body = [...head, ...docs.map((x) => line(x.path, clip(x.summary))), ...tail].join("\n");
  }
  return body;
}

async function writeReadme(d: ScanDeps, tools: ToolDef[]) {
  const recs = (await d.store.records.all()).filter((r) => r.path !== "README.md").sort((a, b) => a.path.localeCompare(b.path));
  const dependsOn = [...new Set(recs.flatMap((r) => r.citations.map((c) => c.repo)).filter((n) => n !== d.owner.name))].sort();
  let narrative = "";
  let done = false;
  const finish = tool("submit_narrative", "Submit the narrative overview text.", z.object({ narrative: z.string() }), ({ narrative: n }) => {
    narrative = n;
    done = true;
    return { ok: true };
  });
  await runAgent({
    llm: d.llm, model: d.models.overview, label: "readme", system: P.readme, user: json({ repository: d.owner.name, docs: recs.map((r) => ({ path: r.path, title: r.title, summary: r.summary })) }),
    tools: [...tools, finish], finishTool: "submit_narrative", done: () => done, budget: d.budget, signal: d.signal, maxSteps: 12,
  });
  let body = composeReadme(d.owner.name, narrative, recs, dependsOn);
  // README citations are not agent-verified one by one; keep any that do not resolve as plain code.
  const v = await verifyCitations(body, d);
  if (!v.ok) body = demoteCitations(body, v.dangling);
  await d.store.write("README.md", body);
  await d.store.commit("README.md", `kb: update README.md\n\nScan: ${d.scanId}`);
}

// ---- entry point ---------------------------------------------------------------

export async function runScan(d: ScanDeps, triage: Triage): Promise<ScanOutcome> {
  const tools = readTools(d);
  const existing = triage.existing.map((r) => r.path);
  const existingSet = new Set(existing);
  d.signal?.throwIfAborted();

  let systems: System[];
  let territories = 0;
  let required: string[];
  let reasons = new Map<string, string[]>();
  let extra: (s: System) => Record<string, unknown> = () => ({});
  let mergeExtra: Record<string, unknown> = {};

  if (d.firstScan) d.log?.(`kb ${d.owner.name} first scan estimate ~${estimateTokens(await d.owner.listFiles(), d.budget.limit).toLocaleString()} tokens (cap ${d.budget.limit.toLocaleString()})`);

  if (triage.mode === "full") {
    const found = await discover(d, tools);
    territories = found.territories;
    systems = await reconcile(d, found.candidates, existing);
    required = existing;
    d.log?.(`reconciled ${systems.length} systems`);
  } else {
    required = triage.affected.map((a) => a.path);
    reasons = new Map(triage.affected.map((a) => [a.path, a.reasons]));
    if (!required.length && !triage.uncovered.length) {
      return { mode: "delta", skipped: true, territories: 0, systems: 0, docsWritten: 0, docsRemoved: 0, docsFailed: 0 };
    }
    const groups = new Map<string, string[]>();
    for (const p of required) groups.set(p.includes("/") ? p.split("/")[0]! : "legacy-root", [...(groups.get(p.includes("/") ? p.split("/")[0]! : "legacy-root") ?? []), p]);
    systems = [...groups].map(([slug, assignedDocPaths]) => ({ slug, name: slug, thesis: "Existing documents in this folder that the latest changes touch.", evidenceAnchors: [], assignedDocPaths }));
    if (!systems.length) systems.push({ slug: "delta-uncovered", name: "delta-uncovered", thesis: "Changes no document cites.", evidenceAnchors: [], assignedDocPaths: [] });
    extra = (s) => ({
      affected: triage.affected.filter((a) => s.assignedDocPaths.includes(a.path)),
      uncoveredPaths: triage.uncovered,
      uncoveredNote: "These changed files are cited by no document. Propose a new document only if one reveals a doc-worthy change.",
      recentCommits: triage.commitLog.slice(0, 50).map((c) => `${c.sha.slice(0, 7)} ${c.subject}`),
    });
    mergeExtra = { affected: triage.affected, note: "A delete plus an add may be a move; an uncovered new path may be an affected document's moved citation target." };
  }

  const tick = (stage: string) => d.log?.(`${stage} done; tokens used: ${d.budget.used.toLocaleString()} of ${d.budget.limit.toLocaleString()}`);
  tick("discovery");
  const reports = await survey(d, systems, tools, extra);
  tick("survey");
  const list = await merge(d, reports, systems, existing, required, triage.mode, mergeExtra);
  tick("merge");
  d.log?.(`work list: ${list.items.length} items, ${list.deletes.length} deletes`);

  // deletions first: they are final decisions and cost nothing
  for (const p of list.deletes) {
    await d.store.remove(p, `kb: remove ${p}\n\n${(reasons.get(p) ?? ["removed by survey"]).map((r) => `- ${r}`).join("\n")}\n\nScan: ${d.scanId}`);
    await d.store.records.drop(p);
  }

  const { failed } = await writeDocs(d, list, reports, reasons, existingSet, tools);
  tick("documents");

  // disposition contract: every required path is gone or was rewritten by this scan, and every item is stamped
  const stamped = new Map((await d.store.records.all()).map((r: DocRecord) => [r.path, r.scanId]));
  const present = new Set(await d.store.listPaths());
  const bad = [
    ...required.filter((p) => present.has(p) && stamped.get(p) !== d.scanId),
    ...list.items.map((i) => i.path).filter((p) => !present.has(p) || stamped.get(p) !== d.scanId),
  ];
  if (bad.length) throw new Error(`disposition contract violated for: ${[...new Set(bad)].sort().join(", ")}`);

  await writeReadme(d, tools);
  return {
    mode: triage.mode,
    ...(triage.mode === "full" && triage.escalated ? { escalated: triage.escalated } : {}),
    territories,
    systems: systems.length,
    docsWritten: list.items.length,
    docsRemoved: list.deletes.length + list.items.reduce((n, i) => n + (i.absorbs?.length ?? 0), 0),
    docsFailed: failed,
  };
}
