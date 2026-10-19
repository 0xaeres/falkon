import "server-only";

/** True when the UI talks to the engine; unset, the routes keep serving the local mock. */
export const useEngine = () => !!process.env.ENGINE_URL;

/**
 * Forwards one call to the engine's admin listener. ENGINE_ADMIN_TOKEN is read here, in server code only, and never
 * reaches the browser. Engine errors become the UI's `{ error: string }` using the engine's fixed message.
 */
export async function forward(
  path: string,
  init: { method?: string; body?: unknown; stream?: AbortSignal } = {},
): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${process.env.ENGINE_URL}${path}`, {
      method: init.method ?? "GET",
      headers: {
        authorization: `Bearer ${process.env.ENGINE_ADMIN_TOKEN ?? ""}`,
        "content-type": "application/json",
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      // A streamed answer runs as long as the client stays; the client going away aborts the engine call too.
      signal: init.stream ?? AbortSignal.timeout(15_000),
      cache: "no-store",
    });
  } catch {
    return Response.json(
      { error: "Falkon is unavailable. Try again." },
      { status: 502 },
    );
  }
  if (res.ok)
    return new Response(res.status === 204 ? null : res.body, {
      status: res.status,
      headers: {
        // The AI SDK UI message stream passes through unchanged (no buffering).
        "content-type": init.stream
          ? (res.headers.get("content-type") ?? "text/event-stream")
          : "application/json",
        "cache-control": "no-store",
        ...(init.stream
          ? { "x-vercel-ai-ui-message-stream": "v1", "x-accel-buffering": "no" }
          : {}),
      },
    });
  const failure: unknown = await res.json().catch(() => null);
  const message = (failure as { message?: unknown } | null)?.message;
  return Response.json(
    {
      error:
        typeof message === "string"
          ? message
          : "Falkon could not complete this request. Try again.",
    },
    { status: res.status },
  );
}
