import "server-only";

/** True when the UI talks to the engine; unset, the routes keep serving the local mock. */
export const useEngine = () => !!process.env.ENGINE_URL;

/**
 * Forwards one call to the engine's admin listener. ENGINE_ADMIN_TOKEN is read here, in server code only, and never
 * reaches the browser. Engine errors become the UI's `{ error: string }` using the engine's fixed message.
 */
export async function forward(
  path: string,
  init: { method?: string; body?: unknown } = {},
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
      signal: AbortSignal.timeout(15_000),
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
        "content-type": "application/json",
        "cache-control": "no-store",
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
