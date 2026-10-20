import { prisma, RepoKind, RepoStatus, ScanMode, ScanStatus, type Repo } from "@sbc/db";
import { env, gitDirOf, kb, knowledgeRepoName, loadConfig, repoGitDir, repoPath, scopeFor, type KnowledgeBaseConfig } from "@sbc/shared";
import { GitDocStore } from "./gitStore";

/** Whether the config selects this repo for a knowledge base. */
export function kbSelected(cfg: KnowledgeBaseConfig, repo: Pick<Repo, "name" | "kind" | "kbExcluded">): boolean {
  if (!cfg.enabled || repo.kind !== RepoKind.CODE || repo.kbExcluded) return false;
  return cfg.repos === "all" || scopeFor(cfg.repos).allows(repo.name);
}

export async function ensureKnowledgeRepo(owner: Repo): Promise<Repo> {
  const name = knowledgeRepoName(owner.name);
  // never adopt a row that is not this owner's knowledge repo (e.g. a configured code repo with a clashing name)
  const clash = await prisma.repo.findUnique({ where: { name } });
  if (clash && (clash.kind !== RepoKind.KNOWLEDGE || clash.ownerRepoId !== owner.id)) throw new Error(`name ${name} is already used by another repository`);
  return prisma.repo.upsert({
    where: { name },
    create: {
      name,
      cloneUrl: "",
      kind: RepoKind.KNOWLEDGE,
      ownerRepoId: owner.id,
      isPublic: owner.isPublic,
      status: RepoStatus.PENDING,
      // Generated locally, so its identity is the owner's, not a code host's.
      external_id: `knowledge:${owner.id}`,
      external_codeHostType: "genericGitHost",
      external_codeHostUrl: "sourcebot-clone://knowledge",
    },
    update: { isPublic: owner.isPublic },
  });
}

let skipLogged = false;
/** Whether a model is configured. Without one the knowledge base is skipped; that is logged once per process, not per tick. */
export function kbModelReady(env: NodeJS.ProcessEnv = process.env, log: (m: string) => void = console.log): boolean {
  if (kb.llmConfigured(env)) return true;
  if (!skipLogged) {
    skipLogged = true;
    log("knowledge base skipped: no model configured");
  }
  return false;
}

export interface ScanResult {
  scanId: number;
  status: ScanStatus;
  /** the knowledge repo has new commits and must be (re)indexed */
  needsIndex: boolean;
  knowledgeRepoId: number;
}

/** Run one knowledge scan for a code repo. Returns undefined when the repo does not qualify right now. */
export async function runKnowledgeScan(repoId: number, opts: { manual: boolean; log?: (m: string) => void }): Promise<ScanResult | undefined> {
  const log = opts.log ?? (() => {});
  // nothing is spent and no row is created without a model; the scheduler logs the skip once
  if (!kb.llmConfigured()) return undefined;
  const cfg = (await loadConfig(env.configPath)).knowledgeBase;
  const owner = await prisma.repo.findUnique({ where: { id: repoId } });
  if (!owner || !kbSelected(cfg, owner) || owner.status !== RepoStatus.INDEXED || !owner.headCommit) return undefined;
  if (!opts.manual && owner.kbScannedCommit === owner.headCommit) return undefined;
  // one scan per repo at a time: they share one git index and one citation table
  if (await prisma.knowledgeScan.findFirst({ where: { repoId, status: ScanStatus.RUNNING }, select: { id: true } })) return undefined;

  const llmCfg = kb.llmConfigFromEnv();
  const knowledgeRepo = await ensureKnowledgeRepo(owner);
  const store = new GitDocStore(repoGitDir(knowledgeRepo.name), owner.id);
  await store.open();

  const now = new Date();
  const requested: "full" | "delta" = cfg.scanMode === "full" || owner.kbLastFullScanAt === null ? "full" : "delta";
  const scan = await prisma.knowledgeScan.create({
    data: { repoId: owner.id, mode: requested === "full" ? ScanMode.FULL : ScanMode.DELTA, baseCommit: owner.kbScannedCommit, headCommit: owner.headCommit },
  });
  const budget = new kb.TokenBudget(cfg.tokenBudget);
  let status: ScanStatus = ScanStatus.SUCCEEDED;
  let error: string | null = null;
  let outcome: kb.ScanOutcome | undefined;
  let effective = requested;

  try {
    // Reconcile the citation index with what is really in the repo.
    const onDisk = new Set(await store.listPaths());
    const rows = await store.records.all();
    for (const r of rows) if (!onDisk.has(r.path)) await store.records.drop(r.path);
    const known = new Set(rows.map((r) => r.path));
    const existing: kb.DocRecord[] = [
      ...rows.filter((r) => onDisk.has(r.path)),
      // documents with no metadata (e.g. written by hand): they still need a disposition
      ...[...onDisk].filter((p) => !known.has(p)).map<kb.DocRecord>((path) => ({ path, title: path, summary: "", citations: [], generatedAtCommit: "", model: "", scanId: 0 })),
    ];

    // Agents may only read repos the config explicitly lets them cite; see KnowledgeBaseConfig.citeRepos.
    const mayCite = cfg.citeRepos.length ? scopeFor(cfg.citeRepos).allows : () => false;
    const sources = new Map<string, kb.RepoSource | undefined>();
    const resolveRepo = async (name: string) => {
      if (!mayCite(name)) return undefined;
      if (!sources.has(name)) {
        const r = await prisma.repo.findFirst({ where: { name, kind: RepoKind.CODE } });
        sources.set(name, r?.headCommit ? kb.gitSource(r.name, gitDirOf(repoPath(r).path), r.headCommit) : undefined);
      }
      return sources.get(name);
    };
    const ownerSrc = kb.gitSource(owner.name, gitDirOf(repoPath(owner).path), owner.headCommit);

    const triage = await kb.computeTriage({
      requested, owner: ownerSrc, existing, lastScanCommit: owner.kbScannedCommit, lastFullScanAt: owner.kbLastFullScanAt, now, resolveRepo,
    });
    effective = triage.mode;
    if (triage.mode === "full" && triage.escalated) log(`delta escalated to full: ${triage.escalated}`);

    const m = cfg.models;
    outcome = await kb.runScan(
      {
        llm: kb.openAiClient(llmCfg), budget, owner: ownerSrc, firstScan: owner.kbScannedCommit === null, resolveRepo, store, scanId: scan.id, parallelism: cfg.parallelism,
        models: { discovery: m.discovery ?? llmCfg.model, survey: m.survey ?? m.discovery ?? llmCfg.model, document: m.document ?? llmCfg.model, overview: m.overview ?? m.survey ?? llmCfg.model },
        log,
      },
      triage,
    );
  } catch (e) {
    status = e instanceof kb.BudgetExceededError ? ScanStatus.BUDGET_EXHAUSTED : ScanStatus.FAILED;
    error = e instanceof Error ? e.message.slice(0, 2000) : String(e);
  } finally {
    store.close();
  }

  if (outcome?.skipped) status = ScanStatus.SKIPPED;
  await prisma.knowledgeScan.update({
    where: { id: scan.id },
    data: {
      status, error, finishedAt: new Date(), tokensUsed: budget.used, mode: effective === "full" ? ScanMode.FULL : ScanMode.DELTA,
      docsWritten: outcome?.docsWritten ?? 0, docsRemoved: outcome?.docsRemoved ?? 0,
    },
  });
  // The knowledge base may have been deleted while we ran; do not record progress for docs that are gone.
  const stillWanted = await prisma.repo.findUnique({ where: { id: owner.id }, select: { kbExcluded: true } });
  if (store.committed) {
    // PENDING is the durable "needs indexing" mark: the scheduler re-enqueues it if the hand-off below is lost
    await prisma.repo.update({ where: { id: knowledgeRepo.id }, data: { status: RepoStatus.PENDING } }).catch(() => undefined);
  }
  if ((status === ScanStatus.SUCCEEDED || status === ScanStatus.SKIPPED) && stillWanted && !stillWanted.kbExcluded) {
    await prisma.repo.update({
      where: { id: owner.id },
      data: { kbScannedCommit: owner.headCommit, ...(effective === "full" && status === ScanStatus.SUCCEEDED ? { kbLastFullScanAt: now } : {}) },
    });
  }
  return { scanId: scan.id, status, needsIndex: store.committed, knowledgeRepoId: knowledgeRepo.id };
}
