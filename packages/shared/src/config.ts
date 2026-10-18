import fs from "node:fs/promises";
import { createRequire } from "node:module";
import { Ajv } from "ajv";
import stripJsonComments from "strip-json-comments";
import { z } from "zod";

/**
 * config.json in Sourcebot's v3 format, validated against its published JSON Schema
 * (schemas/v3/index.json, the file `$schema` points at), so a config one accepts the other does.
 * Comments are allowed and CONFIG_PATH may be an http(s) URL, as in Sourcebot.
 *
 * One clone-only key sits beside the schema: `knowledgeBase` (Sourcebot keeps that in the database).
 */

export type Token = { env: string } | { googleCloudSecret: string };

export interface GitRevisions {
  branches?: string[];
  tags?: string[];
}

interface ConnectionBase {
  revisions?: GitRevisions;
  enforcePermissions?: boolean;
  enforcePermissionsForPublicRepos?: boolean;
}

export interface GithubConnectionConfig extends ConnectionBase {
  type: "github";
  token?: Token;
  url?: string;
  users?: string[];
  orgs?: string[];
  repos?: string[];
  topics?: string[];
  exclude?: {
    forks?: boolean;
    archived?: boolean;
    private?: boolean;
    repos?: string[];
    topics?: string[];
    size?: { min?: number; max?: number };
  };
}

export interface GitlabConnectionConfig extends ConnectionBase {
  type: "gitlab";
  token?: Token;
  url?: string;
  webUrl?: string;
  all?: boolean;
  users?: string[];
  groups?: string[];
  projects?: string[];
  topics?: string[];
  exclude?: {
    forks?: boolean;
    archived?: boolean;
    userOwnedProjects?: boolean;
    projects?: string[];
    topics?: string[];
  };
}

export interface GiteaConnectionConfig extends ConnectionBase {
  type: "gitea";
  token?: Token;
  url?: string;
  orgs?: string[];
  repos?: string[];
  users?: string[];
  exclude?: { forks?: boolean; archived?: boolean; repos?: string[] };
}

export interface GerritConnectionConfig extends ConnectionBase {
  type: "gerrit";
  url: string;
  projects?: string[];
  exclude?: { projects?: string[]; readOnly?: boolean; hidden?: boolean };
}

export interface BitbucketConnectionConfig extends ConnectionBase {
  type: "bitbucket";
  user?: string;
  gitUser?: string;
  token?: Token;
  url?: string;
  deploymentType?: "cloud" | "server";
  all?: boolean;
  workspaces?: string[];
  projects?: string[];
  repos?: string[];
  exclude?: { archived?: boolean; forks?: boolean; repos?: string[] };
}

export interface AzureDevOpsConnectionConfig extends ConnectionBase {
  type: "azuredevops";
  token: Token;
  url?: string;
  deploymentType: "cloud" | "server";
  useTfsPath?: boolean;
  orgs?: string[];
  projects?: string[];
  repos?: string[];
  exclude?: {
    disabled?: boolean;
    repos?: string[];
    projects?: string[];
    size?: { min?: number; max?: number };
  };
}

export interface GenericGitHostConnectionConfig extends ConnectionBase {
  type: "git";
  /** http(s):// remote, or file:// path (globs allowed) to local repos indexed in place. */
  url: string;
}

export type ConnectionConfig =
  | GithubConnectionConfig
  | GitlabConnectionConfig
  | GiteaConnectionConfig
  | GerritConnectionConfig
  | BitbucketConnectionConfig
  | AzureDevOpsConnectionConfig
  | GenericGitHostConnectionConfig;

export interface SearchContextConfig {
  include?: string[];
  includeConnections?: string[];
  exclude?: string[];
  excludeConnections?: string[];
  includeTopics?: string[];
  excludeTopics?: string[];
  description?: string;
}

export interface Settings {
  maxFileSize: number;
  maxTrigramCount: number;
  reindexIntervalMs: number;
  resyncConnectionIntervalMs: number;
  resyncConnectionPollingIntervalMs: number;
  reindexRepoPollingIntervalMs: number;
  maxConnectionSyncJobConcurrency: number;
  maxRepoIndexingJobConcurrency: number;
  maxRepoGarbageCollectionJobConcurrency: number;
  repoGarbageCollectionGracePeriodMs: number;
  repoIndexTimeoutMs: number;
}

/** Sourcebot's defaults for `settings`. */
export const DEFAULT_SETTINGS: Settings = {
  maxFileSize: 2 * 1024 * 1024,
  maxTrigramCount: 20_000,
  reindexIntervalMs: 60 * 60 * 1000,
  resyncConnectionIntervalMs: 24 * 60 * 60 * 1000,
  resyncConnectionPollingIntervalMs: 1000,
  reindexRepoPollingIntervalMs: 1000,
  maxConnectionSyncJobConcurrency: 8,
  maxRepoIndexingJobConcurrency: 8,
  maxRepoGarbageCollectionJobConcurrency: 2,
  repoGarbageCollectionGracePeriodMs: 10 * 1000,
  repoIndexTimeoutMs: 2 * 60 * 60 * 1000,
};

export type EnvironmentOverride =
  | { type: "token"; value: Token }
  | { type: "string"; value: string }
  | { type: "number"; value: number }
  | { type: "boolean"; value: boolean };

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

export interface Config {
  settings: Settings;
  contexts: Record<string, SearchContextConfig>;
  connections: Record<string, ConnectionConfig>;
  environmentOverrides: Record<string, EnvironmentOverride>;
  /** `models`, `apps`, `identityProviders`: passed through untouched. */
  models?: unknown[];
  knowledgeBase: KnowledgeBaseConfig;
}

const CLONE_ONLY_KEYS = ["knowledgeBase"] as const;

const require = createRequire(import.meta.url);
const indexSchema = require("../schemas/v3/index.json");
const ajv = new Ajv({ validateFormats: false });
const validate = ajv.compile(indexSchema);

export const isRemotePath = (p: string) => p.startsWith("https://") || p.startsWith("http://");

/** Parses and validates config text. Throws with the schema errors when invalid. */
export function parseConfig(text: string, source = "config"): Config {
  const raw = JSON.parse(stripJsonComments(text)) as Record<string, unknown>;
  const sourcebot = { ...raw };
  for (const k of CLONE_ONLY_KEYS) delete sourcebot[k];
  if (!validate(sourcebot)) throw new Error(`Config file '${source}' is invalid: ${ajv.errorsText(validate.errors)}`);
  return {
    settings: { ...DEFAULT_SETTINGS, ...((raw.settings as Partial<Settings>) ?? {}) },
    contexts: (raw.contexts as Config["contexts"]) ?? {},
    connections: (raw.connections as Config["connections"]) ?? {},
    environmentOverrides: (raw.environmentOverrides as Config["environmentOverrides"]) ?? {},
    models: raw.models as unknown[] | undefined,
    knowledgeBase: knowledgeBaseSchema.parse(raw.knowledgeBase ?? {}),
  };
}

export async function loadConfig(configPath: string): Promise<Config> {
  if (isRemotePath(configPath)) {
    const res = await fetch(configPath);
    if (!res.ok) throw new Error(`Failed to fetch config file ${configPath}: ${res.statusText}`);
    return parseConfig(await res.text(), configPath);
  }
  return parseConfig(await fs.readFile(configPath, "utf8"), configPath);
}

/** Resolves a `{ env }` or `{ googleCloudSecret }` token to its value. */
export async function getTokenFromConfig(token: Token): Promise<string> {
  if ("env" in token) {
    const v = process.env[token.env];
    if (!v) throw new Error(`Environment variable ${token.env} not found.`);
    return v.trim();
  }
  if ("googleCloudSecret" in token) {
    const { SecretManagerServiceClient } = await import("@google-cloud/secret-manager");
    try {
      const [res] = await new SecretManagerServiceClient().accessSecretVersion({ name: token.googleCloudSecret });
      if (!res.payload?.data) throw new Error(`Secret ${token.googleCloudSecret} not found.`);
      return res.payload.data.toString().trim();
    } catch (e) {
      throw new Error(`Failed to access Google Cloud secret ${token.googleCloudSecret}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  throw new Error("Invalid token configuration");
}

/** `environmentOverrides` resolved to env var values (tokens are fetched). */
export async function resolveEnvironmentOverrides(cfg: Config): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const [key, o] of Object.entries(cfg.environmentOverrides)) {
    out[key] = o.type === "token" ? await getTokenFromConfig(o.value) : String(o.value);
  }
  return out;
}
