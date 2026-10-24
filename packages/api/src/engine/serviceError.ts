import { QuerySyntaxError, SearchContextNotFoundError } from "@falkon/shared";

/** The error body: `{ statusCode, errorCode, message }`. */
export const serviceError = (statusCode: number, errorCode: string, message: string) =>
  Response.json({ statusCode, errorCode, message }, { status: statusCode });

/** Maps a search failure to the status, code and message it maps to. */
export function searchError(e: unknown) {
  const message = e instanceof Error ? e.message : String(e);
  if (e instanceof QuerySyntaxError) return serviceError(400, "FAILED_TO_PARSE_QUERY", message);
  if (e instanceof SearchContextNotFoundError) return serviceError(404, "SEARCH_CONTEXT_NOT_FOUND", message);
  return serviceError(500, "UNEXPECTED_ERROR", `Unexpected error: ${message}`);
}
