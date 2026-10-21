import "server-only";
import { z } from "zod";
import { forward } from "./engine";

/** A request the UI refuses before it reaches the engine (bad JSON, too large). */
class RequestError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export function apiError(error: unknown): Response {
  if (error instanceof RequestError)
    return Response.json({ error: error.message }, { status: error.status });
  if (error instanceof z.ZodError)
    return Response.json(
      { error: error.issues[0]?.message ?? "Invalid request." },
      { status: 400 },
    );
  if (error instanceof SyntaxError)
    return Response.json(
      { error: "Request must contain valid JSON." },
      { status: 400 },
    );
  console.error(
    "UI request failed",
    error instanceof Error ? error.message : "Unknown error",
  );
  return Response.json(
    { error: "Falkon could not complete this request. Try again." },
    { status: 500 },
  );
}
export async function body<T>(
  request: Request,
  schema: z.ZodType<T>,
): Promise<T> {
  const reader = request.body?.getReader();
  if (!reader) throw new RequestError("Request must contain JSON.");
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 16000) {
        await reader.cancel();
        throw new RequestError("Request body is too large.", 413);
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  return schema.parse(JSON.parse(text));
}
/** Engine mode: validates the body (when a schema is given) and forwards one call to the engine's `/ui/products...` routes. */
export async function proxy<T>(
  path: string,
  method: string,
  request?: Request,
  schema?: z.ZodType<T>,
) {
  try {
    return await forward(path, {
      method,
      body: request && schema ? await body(request, schema) : undefined,
    });
  } catch (error) {
    return apiError(error);
  }
}
export type ProductRoute = { params: Promise<{ productId: string }> };
export type ThreadRoute = {
  params: Promise<{ productId: string; threadId: string }>;
};
