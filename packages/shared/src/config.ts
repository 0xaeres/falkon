import fs from "node:fs";
import { z } from "zod";

// Globs (micromatch) over branch and tag names, indexed in addition to the default branch.
const revisions = z
  .object({ branches: z.array(z.string()).default([]), tags: z.array(z.string()).default([]) })
  .default({});

const gitConn = z.object({
  type: z.literal("git"),
  name: z.string(),
  url: z.string(),
  tokenEnv: z.string().optional(),
  revisions,
});

const localConn = z.object({
  type: z.literal("local"),
  name: z.string(),
  path: z.string(),
  revisions,
});

const githubConn = z.object({
  type: z.literal("github"),
  tokenEnv: z.string().optional(),
  apiUrl: z.string().default("https://api.github.com"),
  orgs: z.array(z.string()).default([]),
  users: z.array(z.string()).default([]),
  repos: z.array(z.string()).default([]),
  exclude: z
    .object({
      forks: z.boolean().default(false),
      archived: z.boolean().default(false),
    })
    .default({}),
  revisions,
});

export const knowledgeBaseSchema = z.object({
  enabled: z.boolean().default(false),
  /** "all" = every code repo, or a list of exact names / trailing-* prefixes. */
  repos: z.union([z.literal("all"), z.array(z.string())]).default("all"),
  refreshIntervalHours: z.number().positive().default(24),
  scanMode: z.enum(["delta", "full"]).default("delta"),
  /** Hard stop: total tokens (prompt + completion) one scan may spend. */
  tokenBudget: z.number().int().positive().default(2_000_000),
  parallelism: z.number().int().min(1).max(16).default(4),
  /**
   * Other repos an agent may read and cite while documenting a repo (exact names or trailing-* prefixes).
   * Default: none. A knowledge base is readable by anyone who can read its owner repo, so letting agents read
   * more than that, steered by text inside the repo, would leak the extra repos into it.
   */
  citeRepos: z.array(z.string()).default([]),
  /** Per-stage model overrides; unset stages use LLM_MODEL. */
  models: z
    .object({
      discovery: z.string().optional(),
      survey: z.string().optional(),
      document: z.string().optional(),
      overview: z.string().optional(),
    })
    .default({}),
});
export type KnowledgeBaseConfig = z.infer<typeof knowledgeBaseSchema>;

export const configSchema = z.object({
  resyncIntervalMinutes: z.number().positive().default(60),
  knowledgeBase: knowledgeBaseSchema.default({}),
  connections: z.array(z.discriminatedUnion("type", [gitConn, localConn, githubConn])),
});

export type Config = z.infer<typeof configSchema>;
export type Connection = Config["connections"][number];

export function loadConfig(path: string): Config {
  const raw = JSON.parse(fs.readFileSync(path, "utf8"));
  return configSchema.parse(raw);
}
