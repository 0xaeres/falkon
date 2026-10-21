import type { LanguageModel } from "ai";
import { env, getTokenFromConfig, loadConfig, type Token } from "@sbc/shared";

/** A config `models` entry (the providers wired here). */
export interface LanguageModelConfig {
  provider: string;
  model: string;
  displayName?: string;
  token?: Token;
  baseUrl?: string;
  headers?: Record<string, string | Token>;
  queryParams?: Record<string, string | Token>;
  reasoningTag?: string;
  temperature?: number;
}

/** What callers may pick a model by. */
export interface LanguageModelInfo {
  provider: string;
  model: string;
  displayName?: string;
}

/** Config `models`, or one openai-compatible model from LLM_* when the config has none. */
export async function configuredLanguageModels(): Promise<LanguageModelConfig[]> {
  const fromConfig = await loadConfig(env.configPath)
    .then((c) => (c.models ?? []) as LanguageModelConfig[])
    .catch(() => []);
  if (fromConfig.length) return fromConfig;
  const { LLM_BASE_URL: baseUrl, LLM_MODEL: model, LLM_API_KEY } = process.env;
  return baseUrl && model && LLM_API_KEY ? [{ provider: "openai-compatible", model, baseUrl, token: { env: "LLM_API_KEY" } }] : [];
}

export const toInfo = (m: LanguageModelConfig): LanguageModelInfo => ({ provider: m.provider, model: m.model, ...(m.displayName ? { displayName: m.displayName } : {}) });
/** Models are keyed by provider, model and display name. */
export const modelKey = (m: LanguageModelInfo) => `${m.provider}-${m.model}-${m.displayName}`;

async function resolveRecord(r?: Record<string, string | Token>) {
  if (!r) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(r)) out[k] = typeof v === "string" ? v : await getTokenFromConfig(v);
  return out;
}

// The `ai` SDK and providers load here, on first model use, so a server that only lists tools never pays for them.
export async function aiModel(m: LanguageModelConfig): Promise<{ model: LanguageModel; temperature?: number }> {
  const apiKey = m.token ? await getTokenFromConfig(m.token) : undefined;
  const headers = await resolveRecord(m.headers);
  const temperature = m.temperature ?? (process.env.FALKON_CHAT_MODEL_TEMPERATURE ? Number(process.env.FALKON_CHAT_MODEL_TEMPERATURE) : undefined);
  switch (m.provider) {
    case "openai-compatible": {
      if (!m.baseUrl) throw new Error(`openai-compatible model ${m.model} needs a baseUrl`);
      const [{ createOpenAICompatible }, { extractReasoningMiddleware, wrapLanguageModel }] = await Promise.all([import("@ai-sdk/openai-compatible"), import("ai")]);
      const p = createOpenAICompatible({ baseURL: m.baseUrl, name: m.displayName ?? m.model, apiKey, headers, queryParams: await resolveRecord(m.queryParams) });
      // Reasoning models that inline <think> blocks get them split out.
      return { model: wrapLanguageModel({ model: p.chatModel(m.model), middleware: [extractReasoningMiddleware({ tagName: m.reasoningTag ?? "think" })] }), temperature };
    }
    case "openai": {
      const { createOpenAI } = await import("@ai-sdk/openai");
      return { model: createOpenAI({ baseURL: m.baseUrl, apiKey: apiKey ?? process.env.OPENAI_API_KEY, headers })(m.model), temperature };
    }
    case "anthropic": {
      const { createAnthropic } = await import("@ai-sdk/anthropic");
      return { model: createAnthropic({ baseURL: m.baseUrl, apiKey: apiKey ?? process.env.ANTHROPIC_API_KEY, headers })(m.model), temperature };
    }
  }
  throw new Error(`language model provider "${m.provider}" is not supported here (supported: openai-compatible, openai, anthropic)`);
}

// ---- models.dev catalog: what input a model accepts, as reported to callers ----

type Catalog = Record<string, { models?: Record<string, { modalities?: { input?: string[] } }> }>;
const PROVIDER_IDS: Record<string, string> = { "google-generative-ai": "google" };
let catalog: Catalog | null = null;
let fetchedAt = 0;
let failedAt = 0;
let inflight: Promise<Catalog | null> | null = null;

async function fetchCatalog(): Promise<Catalog | null> {
  try {
    const r = await fetch("https://models.dev/api.json", { signal: AbortSignal.timeout(8000) });
    if (!r.ok) {
      console.warn(`Failed to fetch models.dev catalog: ${r.status} ${r.statusText}`);
      return null;
    }
    return (await r.json()) as Catalog;
  } catch (e) {
    console.warn(`Failed to fetch models.dev catalog: ${e}`);
    return null;
  }
}

/** The catalog, refreshed every 6h (1 min back-off after a failure); the first caller waits at most 2.5s. */
async function loadCatalog({ awaitWhenEmpty = false } = {}): Promise<Catalog | null> {
  const now = Date.now();
  const fresh = catalog !== null && now - fetchedAt <= 6 * 3600_000;
  const backingOff = now - failedAt < 60_000;
  if (!fresh && !backingOff && !inflight) {
    inflight = fetchCatalog().then((c) => {
      if (c) {
        catalog = c;
        fetchedAt = Date.now();
      } else failedAt = Date.now();
      inflight = null;
      return c;
    });
  }
  const attempted = fetchedAt > 0 || failedAt > 0;
  if (awaitWhenEmpty && catalog === null && inflight && !attempted) return Promise.race([inflight, new Promise<Catalog | null>((r) => setTimeout(() => r(catalog), 2500))]);
  return catalog;
}

const MODALITIES = ["text", "image", "audio", "video"];
const DOCUMENT_TYPES = ["pdf"];

/** Input modalities and document types from models.dev; text only when the model is not listed. */
export async function modelCapabilities(m: LanguageModelInfo): Promise<{ inputModalities: string[]; supportedDocumentTypes: string[] }> {
  const c = await loadCatalog({ awaitWhenEmpty: true });
  const input = c?.[PROVIDER_IDS[m.provider] ?? m.provider]?.models?.[m.model]?.modalities?.input;
  if (!input?.length) return { inputModalities: ["text"], supportedDocumentTypes: [] };
  const inputModalities = input.filter((x) => MODALITIES.includes(x));
  if (!inputModalities.includes("text")) inputModalities.unshift("text");
  return { inputModalities, supportedDocumentTypes: input.filter((x) => DOCUMENT_TYPES.includes(x)) };
}

/** A model as reported to callers: provider, model, display name and input capabilities. */
export const describeModel = async (m: LanguageModelConfig) => ({ ...toInfo(m), ...(await modelCapabilities(m)) });
export const languageModelsInfo = async () => Promise.all((await configuredLanguageModels()).map(describeModel));
