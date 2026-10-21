import fs from "node:fs/promises";
import { createRequire } from "node:module";
import { Ajv } from "ajv";
import stripJsonComments from "strip-json-comments";
import { z } from "zod";

/**
 * Falkon's config.json, validated against its JSON Schema (schemas/falkon/config.json). Supported:
 * `github` and `git` connections, `settings`, `contexts`, `environmentOverrides`, `knowledgeBase`.
 * `$schema` is an editor hint and is ignored. Comments and trailing commas are allowed and
 * CONFIG_PATH may be an http(s) URL. `scripts/convert-config.ts` converts an older file.
 */

/** `{ stored }` names a Credential row; only `source=api` connections carry it (the config file schema rejects it). */
export type Token = { env: string } | { googleCloudSecret: string } | { stored: string };

let credentialResolver: ((id: string) => Promise<string>) | undefined;
/** Injected by the process that has a database handle (backend): opens the Credential row with this id. */
export const setCredentialResolver = (fn: (id: string) => Promise<string>) => void (credentialResolver = fn);

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

export interface GenericGitHostConnectionConfig extends ConnectionBase {
  type: "git";
  /** http(s):// remote, or file:// path (globs allowed) to local repos indexed in place. */
  url: string;
}

export type ConnectionConfig = GithubConnectionConfig | GenericGitHostConnectionConfig;

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

/** Defaults for `settings`. */
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
  enabled: z.boolean().default(true),
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
    .strict()
    .default({}),
}).strict();
export type KnowledgeBaseConfig = z.infer<typeof knowledgeBaseSchema>;

export interface Config {
  settings: Settings;
  contexts: Record<string, SearchContextConfig>;
  connections: Record<string, ConnectionConfig>;
  environmentOverrides: Record<string, EnvironmentOverride>;
  /** Language models for Ask; entries are validated by the schema and typed by the consumer. */
  models?: unknown[];
  knowledgeBase: KnowledgeBaseConfig;
}

const require = createRequire(import.meta.url);
const configSchema = require("../schemas/falkon/config.json");
/** The schema's `$id`: the `$schema` value the converter writes. */
export const SCHEMA_ID: string = configSchema.$id;
const ajv = new Ajv({ validateFormats: false });
const validate = ajv.compile(configSchema);

export const isRemotePath = (p: string) => p.startsWith("https://") || p.startsWith("http://");

/** Parses JSON with comments and trailing commas. */
export const parseJsonc = (text: string): unknown => JSON.parse(stripJsonComments(text, { trailingCommas: true }));

/** Schema errors as text; an unknown key is named. */
const errorsText = (errors: NonNullable<typeof validate.errors>) =>
  errors
    .map((e) => `${e.instancePath || "/"} ${e.keyword === "additionalProperties" ? `has unknown key '${e.params.additionalProperty}'` : e.message}`)
    .join(", ");

export const CONNECTION_TYPES = ["github", "git"];
export const MODEL_PROVIDERS = ["openai-compatible", "openai", "anthropic"];
const CONVERT_HINT = "convert old files with pnpm convert-config old.json > new.json";

/** A clear message for a connection type or model provider the schema does not list (else `oneOf` errors are noise). */
function unsupportedEntry(raw: Record<string, unknown>): string | undefined {
  for (const [name, c] of Object.entries(isObject(raw.connections) ? raw.connections : {})) {
    const type = isObject(c) ? c.type : undefined;
    if (typeof type === "string" && !CONNECTION_TYPES.includes(type)) return `connection '${name}': type '${type}' is not supported (supported: ${CONNECTION_TYPES.join(", ")}); ${CONVERT_HINT}`;
  }
  for (const [i, m] of (Array.isArray(raw.models) ? raw.models : []).entries()) {
    const provider = isObject(m) ? m.provider : undefined;
    if (typeof provider === "string" && !MODEL_PROVIDERS.includes(provider)) return `models[${i}]: provider '${provider}' is not supported (supported: ${MODEL_PROVIDERS.join(", ")}); ${CONVERT_HINT}`;
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Parses and validates config text. Throws with the schema errors when invalid. */
export function parseConfig(text: string, source = "config"): Config {
  const invalid = (why: string) => new Error(`Config file '${source}' is invalid: ${why}`);
  const raw = parseJsonc(text);
  if (!isObject(raw)) throw invalid("must be a JSON object");
  const unsupported = unsupportedEntry(raw);
  if (unsupported) throw invalid(unsupported);
  // `$schema` is an editor hint. `knowledgeBase` is in the schema for editors; Zod below validates it (and names an unknown key).
  const { $schema: _hint, knowledgeBase: _kb, ...rest } = raw;
  if (!validate(rest)) throw invalid(errorsText(validate.errors!));
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

/** Resolves a `{ env }`, `{ googleCloudSecret }` or `{ stored }` token to its value. */
export async function getTokenFromConfig(token: Token): Promise<string> {
  if ("stored" in token) {
    if (!credentialResolver) throw new Error("No credential resolver is set.");
    return credentialResolver(token.stored);
  }
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
