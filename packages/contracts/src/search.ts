import { z } from "zod";

export const SEARCH_DEFAULT_LIMIT = 500;
export const SEARCH_MAX_LIMIT = 5000;

// Query of GET /ui/products/:slug/search. `q` uses the full query syntax; `limit` is capped, not rejected, past the maximum.
export const searchQuerySchema = z.strictObject({
  q: z.string().max(2000),
  regex: z.enum(["0", "1"]).optional(),
  case: z.enum(["0", "1"]).optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .transform((n) => Math.min(n, SEARCH_MAX_LIMIT))
    .default(SEARCH_DEFAULT_LIMIT),
});
// The part of the engine's search result the page shows: matches grouped by file.
export const searchResponseSchema = z.object({
  files: z.array(
    z.object({
      repo: z.string(),
      path: z.string(),
      branches: z.array(z.string()),
      matches: z.array(
        z.object({
          lineNumber: z.number(),
          text: z.string(),
          ranges: z.array(z.tuple([z.number(), z.number()])),
          fileNameMatch: z.boolean(),
        }),
      ),
    }),
  ),
  fileCount: z.number(),
  matchCount: z.number(),
  durationMs: z.number(),
  isSearchExhaustive: z.boolean(),
});
export type SearchResponse = z.infer<typeof searchResponseSchema>;
