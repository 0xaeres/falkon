import { existsSync, globSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { Span } from "./score.js";

export const EVAL_DIR = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(EVAL_DIR, "../..");
export const FLOOR_DIR = join(REPO_ROOT, ".scratch/falkon-mvp/eval-floor");
/** Both O3 question sets, scored and reported together. */
export const DATASETS = ["openmrs-xrepo", "openmrs-xrepo-unnamed"] as const;
export type Arm = "clone-tools" | "clone-research";
export const ARMS: Arm[] = ["clone-tools", "clone-research"];
export const SEED = 20261017;

const span = z.strictObject({ path: z.string().min(1), startLine: z.int().positive(), endLine: z.int().positive() });
const question = z.strictObject({
  id: z.string().min(1), question: z.string().min(1), vocab: z.enum(["code", "natural"]), split: z.enum(["dev", "hidden"]), author: z.string().min(1),
  relation: z.string().optional(), required: z.array(span).min(1), declarations: z.array(span).min(1).optional(),
});
const dataset = z.strictObject({
  id: z.string().min(1),
  repo: z.strictObject({ url: z.url(), ref: z.string().min(1), commit: z.string().regex(/^[0-9a-f]{40}$/) }),
  corpus: z.strictObject({ include: z.array(z.string()), exclude: z.array(z.string()), product: z.unknown().optional() }),
  questions: z.array(question).min(1),
});
export type Dataset = z.infer<typeof dataset>;
export type Question = Dataset["questions"][number];

export const loadDataset = (id: string): Dataset => dataset.parse(JSON.parse(readFileSync(join(EVAL_DIR, "datasets", `${id}.json`), "utf8")));
/** Extra spans that count towards precision only, by question id. */
export const loadAccepted = (): Record<string, Span[]> => JSON.parse(readFileSync(join(EVAL_DIR, "datasets/accepted.json"), "utf8"));
export const product = z.object({ id: z.string(), repositories: z.array(z.object({ name: z.string(), commit: z.string(), checkout: z.string() })) });
export const loadProduct = () => product.parse(JSON.parse(readFileSync(join(EVAL_DIR, "datasets/o3.json"), "utf8")));
/** The names the stack gives the repositories, taken from their origin URLs. */
export const stackRepoName = (name: string) => `github.com/openmrs/${name}`;

export type Raw = {
  taskId: string; repository: string; split?: "dev" | "hidden"; arm: string; answer: Span[]; malformed: boolean; is_error: boolean;
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
