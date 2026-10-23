import { existsSync, globSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { Evidence, Gold } from "./score.js";

export const EVAL_DIR = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(EVAL_DIR, "../..");
export const FLOOR_DIR = join(REPO_ROOT, ".scratch/falkon-mvp/eval-floor");
/** Both O3 question sets, scored and reported together. */
export const DATASETS = ["openmrs-xrepo", "openmrs-xrepo-unnamed"] as const;
/** The impact-and-change question set (S25), selected with --dataset impact; separate from the two sets above. */
export const IMPACT_DATASETS = ["o3-impact"] as const;
/** The commit-history question set (S43), selected with --dataset history; its answers carry commits, pull requests and tickets. */
export const HISTORY_DATASETS = ["o3-history"] as const;
export const ALL_ARMS = ["clone-tools", "clone-research", "v6-tools", "clone-tools-noinstr", "clone-tools-recipe", "clone-tools-git", "clone-tools-git-prs"] as const;
export type Arm = typeof ALL_ARMS[number];
/** The arms run when --arms is not given. */
export const ARMS: Arm[] = ["clone-tools", "clone-research"];
export const MODELS = { sonnet: "claude-sonnet-5-5", haiku: "claude-haiku-5-5" } as const;
export type ModelAlias = keyof typeof MODELS;
/** Accepts an alias or its full id; the default is Sonnet. */
export function resolveModel(flag = "sonnet"): { alias: ModelAlias; id: string } {
  const alias = (Object.keys(MODELS) as ModelAlias[]).find((a) => a === flag || MODELS[a] === flag);
  if (!alias) throw new Error(`--model must be one of ${Object.entries(MODELS).map(([a, id]) => `${a} (${id})`).join(", ")}`);
  return { alias, id: MODELS[alias] };
}
/** Runs live in <runs root>/<model alias>/; Sonnet runs stored in the cycle 3 layout (datasets directly under the root) are still read and extended there. */
export const modelDir = (runsRoot: string, alias: ModelAlias): string =>
  alias === "sonnet" && !existsSync(join(runsRoot, alias)) && DATASETS.some((d) => existsSync(join(runsRoot, d))) ? runsRoot : join(runsRoot, alias);
export const SEED = 20261017;

const span = z.strictObject({ path: z.string().min(1), startLine: z.int().positive(), endLine: z.int().positive() });
const change = z.strictObject({ repo: z.string().min(1), commit: z.string().regex(/^[0-9a-f]{40}$/), pr: z.int().positive() });
const ticket = z.strictObject({ ticket: z.string().min(1) });
const question = z.strictObject({
  id: z.string().min(1), question: z.string().min(1), vocab: z.enum(["code", "natural"]), split: z.enum(["dev", "hidden"]), author: z.string().min(1),
  relation: z.string().optional(), required: z.array(z.union([span, change, ticket])).min(1), declarations: z.array(span).min(1).optional(),
});
export const datasetSchema = z.strictObject({
  id: z.string().min(1),
  repo: z.strictObject({ url: z.url(), ref: z.string().min(1), commit: z.string().regex(/^[0-9a-f]{40}$/) }),
  corpus: z.strictObject({ include: z.array(z.string()), exclude: z.array(z.string()), product: z.unknown().optional() }),
  questions: z.array(question).min(1),
});
export type Dataset = z.infer<typeof datasetSchema>;
export type Question = Dataset["questions"][number];

/** The gold units a question is scored against: its declarations, or for the history set its typed `required` list. */
export const goldOf = (q: Question): Gold[] => q.declarations ?? q.required;
export const loadDataset = (id: string): Dataset => datasetSchema.parse(JSON.parse(readFileSync(join(EVAL_DIR, "datasets", `${id}.json`), "utf8")));
/** Extra spans, commits, pull requests or tickets that count towards precision only, by question id. */
export const loadAccepted = (): Record<string, Gold[]> => JSON.parse(readFileSync(join(EVAL_DIR, "datasets/accepted.json"), "utf8"));
export const product = z.object({ id: z.string(), repositories: z.array(z.object({ name: z.string(), commit: z.string(), checkout: z.string() })) });
export const loadProduct = () => product.parse(JSON.parse(readFileSync(join(EVAL_DIR, "datasets/o3.json"), "utf8")));
/** The names the stack gives the repositories, taken from their origin URLs. */
export const stackRepoName = (name: string) => `github.com/openmrs/${name}`;

export type Raw = {
  taskId: string; repository: string; split?: "dev" | "hidden"; arm: string; answer: Evidence[]; malformed: boolean; is_error: boolean;
  total_cost_usd: number; usage: Record<string, unknown>; num_turns: number; wallClockMs: number; leak?: boolean;
  toolCalls?: Record<string, number>; firstTool?: string; deniedAttempts?: number; result?: string; stdout?: string; stderr?: string;
};
const rawPath = (dir: string, arm: string, id: string) => join(dir, "raw", arm, encodeURIComponent(id) + ".json");
export const hasRaw = (dir: string, arm: string, id: string) => existsSync(rawPath(dir, arm, id));
export const readRaw = (dir: string): Raw[] => existsSync(dir) ? globSync("raw/*/*.json", { cwd: dir }).sort().map((p) => JSON.parse(readFileSync(join(dir, p), "utf8")) as Raw) : [];
/** Publish a complete file without exposing a partial write to report readers. */
export function writeAtomic(file: string, text: string): void {
  mkdirSync(dirname(file), { recursive: true });
  const staging = mkdtempSync(join(dirname(file), ".write-"));
  try { writeFileSync(join(staging, "content"), text); renameSync(join(staging, "content"), file); } finally { rmSync(staging, { recursive: true, force: true }); }
}
export const writeRaw = (dir: string, run: Raw) => writeAtomic(rawPath(dir, run.arm, run.taskId), JSON.stringify(run, null, 2) + "\n");
