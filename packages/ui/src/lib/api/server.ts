import "server-only";
import { z } from "zod";
import { MockError } from "../mock/store";

export function endpoint<T>(handler: () => Promise<T>): Promise<Response> {
  return handler()
    .then((data) =>
      Response.json(data, { headers: { "Cache-Control": "no-store" } }),
    )
    .catch(apiError);
}
export function apiError(error: unknown): Response {
  if (error instanceof MockError)
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
    "Mock API request failed",
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
  if (!reader) throw new MockError("Request must contain JSON.");
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
        throw new MockError("Request body is too large.", 413);
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  return schema.parse(JSON.parse(text));
}
export type ProductRoute = { params: Promise<{ productId: string }> };
export type ThreadRoute = {
  params: Promise<{ productId: string; threadId: string }>;
};
