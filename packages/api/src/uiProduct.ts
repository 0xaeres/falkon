// Pure mapping from engine rows to the UI contract (Product, Status). No I/O: callers load the rows.
import { createHash } from "node:crypto";
import type { Product, Status } from "@sbc/contracts";
import type { ScanStatus } from "@sbc/db";

export interface RepoFacts {
  name: string; // e.g. github.com/org/repo
  status: "PENDING" | "SYNCING" | "INDEXED" | "FAILED";
  defaultBranch: string | null;
  headCommit: string | null;
  metadata: unknown;
  pushedAt: Date | null;
  lastIndexedAt: Date | null;
  indexRequestedAt: Date | null;
  createdAt: Date;
  /** Knowledge base facts (D43), loaded with the repo: the commit last scanned, the exclusion flag, and the latest scan's status. */
  kbScannedCommit?: string | null;
  kbExcluded?: boolean;
  scan?: ScanStatus | null;
}
export interface ConnectionFacts {
  /** The id the UI knows the connection by (its Credential id). */
  credentialId: string | null;
  host: string;
  /** A config Product over plain git remotes (no GitHub connection). */
  genericGit?: boolean;
  syncError: string | null;
  syncRequestedAt: Date | null;
}
export interface ProductFacts {
  slug: string;
  name: string;
  source: "config" | "api";
  definition: unknown;
  repoNames: string[];
  createdAt: Date;
}

/** The names a Product shows: an api Product's exact `include` (visible before the first sync), else its resolved repoNames. */
export const memberNames = (p: Pick<ProductFacts, "source" | "definition" | "repoNames">) =>
  p.source === "api" ? ((p.definition as { include?: string[] } | null)?.include ?? []) : p.repoNames;

/** One RepoFacts per member name; a name with no Repo row yet is PENDING. */
export function withPlaceholders(names: string[], rows: RepoFacts[], createdAt: Date): RepoFacts[] {
  const byName = new Map(rows.map((r) => [r.name, r]));
  return names.map((name) => byName.get(name) ?? { name, status: "PENDING", defaultBranch: null, headCommit: null, metadata: {}, pushedAt: null, lastIndexedAt: null, indexRequestedAt: null, createdAt });
}

export const providerOf = (host: string, genericGit = false): Product["provider"] =>
  genericGit ? "git" : host === "" || host === "github.com" ? "github" : "github-enterprise";
const initialsOf = (name: string) => name.split(/\s+/).map((w) => w[0] ?? "").join("").slice(0, 2).toUpperCase();
const timeOf = (r: RepoFacts) => (r.pushedAt ?? r.lastIndexedAt ?? r.createdAt).toISOString();

function repositoryOf(r: RepoFacts): Product["repositories"][number] {
  const [, organization = "", ...rest] = r.name.split("/"); // host/org/repo
  const name = rest.join("/") || r.name;
  const branch = r.defaultBranch ?? "main";
  const language = (r.metadata as { codeHostMetadata?: { github?: { language?: unknown } } } | null)?.codeHostMetadata?.github?.language;
  return { id: r.name, name, organization, language: typeof language === "string" ? language : "", revision: r.headCommit?.slice(0, 7) ?? "", updated: timeOf(r), branches: [branch], branch };
}

/** Latest request marker (connection sync or repo retry) as epoch ms, or null. */
const queuedAt = (repos: RepoFacts[], c: ConnectionFacts | null) => {
  const marks = [c?.syncRequestedAt, ...repos.map((r) => r.indexRequestedAt)].filter((d): d is Date => !!d);
  return marks.length ? Math.max(...marks.map((d) => d.getTime())) : null;
};

export function toUiProduct(row: ProductFacts, repos: RepoFacts[], connection: ConnectionFacts | null, status: Status): Product {
  const host = connection?.host ?? "";
  return {
    id: row.slug,
    name: row.name,
    initials: initialsOf(row.name),
    provider: providerOf(host, connection?.genericGit),
    host,
    repositories: repos.map(repositoryOf),
    activeGeneration: status.generation,
    scenario: status.scenario,
    queuedAt: queuedAt(repos, connection),
    ...(connection?.credentialId ? { connectionId: connection.credentialId } : {}),
  };
}

// ---- status ------------------------------------------------------------------------------------------

const generationId = (repos: RepoFacts[]) => "g-" + createHash("sha256").update(repos.map((r) => `${r.name}@${r.headCommit ?? ""}`).sort().join("\n")).digest("hex").slice(0, 6);

function age(from: Date | null, now: Date) {
  if (!from) return "not yet";
  const min = Math.max(0, Math.floor((now.getTime() - from.getTime()) / 60_000));
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  if (min < 24 * 60) return `${Math.floor(min / 60)} h ago`;
  return `${Math.floor(min / (24 * 60))} d ago`;
}

/** The status table of ADR 4.5, a pure function of the Product's repos and its connection. */
export function deriveStatus(slug: string, repos: RepoFacts[], connection: ConnectionFacts | null, now = new Date()): Status {
  const indexed = repos.filter((r) => r.status === "INDEXED");
  const failed = repos.filter((r) => r.status === "FAILED");
  const behind = indexed.filter((r) => r.pushedAt && r.lastIndexedAt && r.pushedAt > r.lastIndexedAt);
  const total = repos.length;
  const inFlight = total - indexed.length - failed.length;
  const broken = failed.length > 0 || !!connection?.syncError;
  const scenario: Status["scenario"] = broken ? "failed" : indexed.length === 0 ? "building" : inFlight > 0 ? "updating" : behind.length ? "partly-behind" : "current";
  const build: Status["build"] = inFlight > 0 ? "building" : broken && indexed.length === 0 ? "failed" : "idle";
  const generation = indexed.length ? generationId(indexed) : null;
  const generationAge = age(indexed.reduce<Date | null>((m, r) => (r.lastIndexedAt && (!m || r.lastIndexedAt > m) ? r.lastIndexedAt : m), null), now);
  const next = build === "building" ? generationId(repos) : null;
  const count = (n: number) => `${n} ${n === 1 ? "repository" : "repositories"}`;
  const [verdict, sentence] = {
    building: ["Building", `Indexing ${indexed.length} of ${count(total)}.`],
    updating: ["Updating", `Answers use ${generation}. Indexing ${indexed.length} of ${count(total)}.`],
    // Repo names only, never provider error text.
    failed: ["Needs attention", failed.length ? `Sync failed for ${failed.slice(0, 3).map((r) => r.name).join(", ")}${failed.length > 3 ? ` and ${failed.length - 3} more` : ""}.` : "The connection could not sync."],
    "partly-behind": ["Partly behind", `${count(behind.length)} behind the latest push.`],
    current: ["Current", `Answers use ${generation}, published ${generationAge} from the latest revision of all ${count(total)}.`],
    behind: ["", ""],
  }[scenario] as [string, string];
  // stage: connect, clone, index, ready-check, ready
  const stage = total === 0 ? 0 : indexed.length === total ? 4 : indexed.length > 0 ? 3 : repos.some((r) => r.headCommit) ? 2 : 1;
  return {
    productId: slug,
    verdict,
    sentence,
    generation,
    generationAge,
    nextGeneration: next && next !== generation ? next : null,
    build,
    stage,
    progress: total ? Math.round((100 * indexed.length) / total) : 0,
    sync: broken ? "failed" : "current",
    gaps: failed.map((r) => ({ count: 1, title: "Repository failed to sync", detail: r.name })),
    scenario,
  };
}

/** D43: the knowledge base state over the Product's member code repos. Failure detail is fixed text, never the stored scan error. */
export function deriveKnowledge(enabled: boolean, modelConfigured: boolean, repos: RepoFacts[], selected: (name: string) => boolean = () => true): NonNullable<Status["knowledge"]> {
  if (!enabled) return { state: "off" };
  if (!modelConfigured) return { state: "no-model", detail: "No model configured" };
  const mine = repos.filter((r) => !r.kbExcluded && selected(r.name)); // the backend's kbSelected filter
  if (mine.some((r) => r.scan === "RUNNING")) return { state: "scanning" };
  if (mine.some((r) => r.scan === "FAILED")) return { state: "failed", detail: "Last scan failed" };
  if (mine.some((r) => r.scan === "BUDGET_EXHAUSTED")) return { state: "budget-exhausted" };
  if (mine.some((r) => r.status === "INDEXED" && !!r.headCommit && r.kbScannedCommit !== r.headCommit)) return { state: "pending" };
  return { state: "ready" };
}
