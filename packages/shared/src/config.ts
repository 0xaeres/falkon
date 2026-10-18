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

export const configSchema = z.object({
  resyncIntervalMinutes: z.number().positive().default(60),
  connections: z.array(z.discriminatedUnion("type", [gitConn, localConn, githubConn])),
});

export type Config = z.infer<typeof configSchema>;
export type Connection = Config["connections"][number];

export function loadConfig(path: string): Config {
  const raw = JSON.parse(fs.readFileSync(path, "utf8"));
  return configSchema.parse(raw);
}
