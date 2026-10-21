import { z } from "zod";

export const productIdSchema = z
  .string()
  .min(1)
  .regex(/^[a-z0-9][a-z0-9-]{0,62}$/); // engine slug rule: isProductSlug in packages/backend/src/productResolve.ts
export const providerSchema = z.enum(["github", "github-enterprise"]);
// A Product may also come from config over plain git remotes; connections are never "git".
export const productProviderSchema = z.enum(["github", "github-enterprise", "git"]);
export const scenarioSchema = z.enum([
  "partly-behind",
  "current",
  "updating",
  "building",
  "behind",
  "failed",
]);
export const repositorySchema = z.object({
  id: z.string(),
  name: z.string(),
  organization: z.string(),
  language: z.string(),
  revision: z.string(),
  updated: z.iso.datetime(),
  branches: z.array(z.string()),
  branch: z.string(),
  // Code host private flag; absent when unknown (older payloads, mock data).
  private: z.boolean().optional(),
  // Absent in older payloads and the mock. "skipped": the connection's last sync did not return this repository.
  state: z.enum(["pending", "indexing", "indexed", "failed", "skipped"]).optional(),
});
export const productSchema = z.object({
  id: productIdSchema,
  name: z.string().min(1).max(80),
  initials: z.string(),
  provider: productProviderSchema,
  host: z.string(),
  repositories: z.array(repositorySchema),
  activeGeneration: z.string().nullable(),
  scenario: scenarioSchema,
  queuedAt: z.number().nullable(),
  // The connection (Credential id) an engine Product draws from; absent for config Products and the mock.
  connectionId: z.string().optional(),
});
export const gapSchema = z.object({
  count: z.number(),
  title: z.string(),
  detail: z.string(),
});
export const knowledgeStatusSchema = z.object({
  state: z.enum(["off", "no-model", "pending", "scanning", "ready", "budget-exhausted", "failed"]),
  detail: z.string().optional(),
});
export const statusSchema = z.object({
  productId: productIdSchema,
  verdict: z.string(),
  sentence: z.string(),
  generation: z.string().nullable(),
  generationAge: z.string(),
  nextGeneration: z.string().nullable(),
  build: z.enum(["idle", "building", "failed"]),
  stage: z.number().min(0).max(4),
  progress: z.number(),
  sync: z.enum(["current", "failed", "pinned"]),
  gaps: z.array(gapSchema),
  scenario: scenarioSchema,
  knowledge: knowledgeStatusSchema.optional(),
});
export const evidenceSchema = z.object({
  id: z.number().int().positive(),
  productId: productIdSchema,
  generation: z.string(),
  repository: z.string(),
  path: z.string(),
  revision: z.string(),
  startLine: z.number(),
  sourceUrl: z
    .string()
    .url()
    .refine((url) => new URL(url).protocol === "https:")
    .optional(),
  code: z.array(z.string()),
  highlightedLines: z.array(z.number()),
});
// Inline [N] markers attach claims to sources; citations lists the permitted IDs.
export const paragraphSchema = z
  .object({
    text: z.string(),
    citations: z.array(z.number().int().positive()),
  })
  .superRefine((paragraph, context) => {
    for (const marker of paragraph.text.matchAll(/\[(\d+)\]/g)) {
      if (!paragraph.citations.includes(Number(marker[1]))) {
        context.addIssue({
          code: "custom",
          message: "Inline citation is not declared in this paragraph",
          path: ["text"],
        });
      }
    }
  });
export const answerSchema = z.object({
  id: z.string(),
  productId: productIdSchema,
  question: z.string(),
  generation: z.string(),
  kind: z.enum(["grounded", "partial", "abstention", "reply"]),
  paragraphs: z.array(paragraphSchema),
  evidence: z.array(evidenceSchema),
  gaps: z.array(z.string()),
  partialReasons: z.array(z.string()),
  abstention: z.string().nullable(),
  suggestions: z.array(z.string()),
});
export const threadSchema = z.object({
  id: z.string(),
  productId: productIdSchema,
  title: z.string(),
  updatedAt: z.number(),
  answers: z.array(answerSchema),
});
export const threadSummarySchema = threadSchema.omit({ answers: true });
export const connectionRequestSchema = z.object({
  provider: providerSchema,
  method: z.literal("token"),
  host: z
    .string()
    .url()
    .max(200)
    .refine(
      (value) => new URL(value).protocol === "https:",
      "Use an HTTPS server URL.",
    ),
  token: z.string().min(1).max(200),
});
export const connectionSchema = z.object({
  id: z.string(),
  host: z.string(),
  provider: providerSchema,
});
// What GET /connections returns: metadata only, never a token. `status` is "failed" while the last check recorded an error.
export const connectionDtoSchema = z.strictObject({
  id: z.string(),
  host: z.string(),
  provider: providerSchema,
  createdAt: z.iso.datetime(),
  lastCheckedAt: z.iso.datetime().nullable(),
  status: z.enum(["ok", "failed"]),
  scopes: z.array(z.string()),
});
// Query of GET /connections/:id/repositories; `page` indexes the matches in pages of 100 (the search is capped at 300 repositories).
export const repositoriesQuery = z.strictObject({
  q: z.string().max(200).optional(),
  page: z.coerce.number().int().min(1).max(3).optional(),
});
export const setupRequestSchema = z.object({
  id: productIdSchema,
  name: z.string().trim().min(1).max(80),
  provider: providerSchema,
  host: z.string().min(1).max(200),
  connectionId: z.string().min(1).max(100),
  repositories: z
    .array(z.object({ id: z.string(), branch: z.string().min(1).max(100) }))
    .min(1)
    .max(100),
});
// PATCH /products/:id: the Product keeps its id, connection, provider and host; only the name and repositories change.
export const editRequestSchema = setupRequestSchema.pick({ name: true, repositories: true });
// Persisted chat parts (CONTEXT.md Evidence): data-evidence is one Evidence, data-answer the answer shape without ids or evidence.
export const evidencePartSchema = evidenceSchema;
export const answerPartSchema = answerSchema.pick({
  kind: true,
  generation: true,
  paragraphs: true,
  gaps: true,
  partialReasons: true,
  abstention: true,
  suggestions: true,
});
export const syncRequestSchema = z.object({ action: z.literal("retry") });
export type Provider = z.infer<typeof providerSchema>;
export type Repository = z.infer<typeof repositorySchema>;
export type Product = z.infer<typeof productSchema>;
export type Status = z.infer<typeof statusSchema>;
export type Scenario = z.infer<typeof scenarioSchema>;
export type Evidence = z.infer<typeof evidenceSchema>;
export type Answer = z.infer<typeof answerSchema>;
export type Thread = z.infer<typeof threadSchema>;
export type ThreadSummary = z.infer<typeof threadSummarySchema>;
export type SetupRequest = z.infer<typeof setupRequestSchema>;
export type EditRequest = z.infer<typeof editRequestSchema>;
export * from "./chat";
