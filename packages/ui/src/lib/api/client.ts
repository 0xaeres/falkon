import { z } from "zod";
import {
  answerSchema,
  connectionSchema,
  productSchema,
  repositorySchema,
  statusSchema,
  streamEventSchema,
  threadSchema,
  threadSummarySchema,
  type EditRequest,
  type SetupRequest,
  type StreamEvent,
} from "@sbc/contracts";

// Set this to a compatible gateway when real endpoints replace the local mock handlers.
const base = process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api";
export const keys = {
  products: `${base}/products`,
  repositories: (connectionId: string, q = "") =>
    `${base}/repositories?connection=${encodeURIComponent(connectionId)}&q=${encodeURIComponent(q)}`,
  product: (id: string) => `${base}/products/${encodeURIComponent(id)}`,
  status: (id: string) => `${base}/products/${encodeURIComponent(id)}/status`,
  threads: (id: string) => `${base}/products/${encodeURIComponent(id)}/threads`,
  thread: (productId: string, threadId: string) =>
    `${base}/products/${encodeURIComponent(productId)}/threads/${encodeURIComponent(threadId)}`,
};
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
async function check(response: Response): Promise<Response> {
  if (!response.ok) {
    const value: unknown = await response.json().catch(() => null);
    const parsed = z.object({ error: z.string() }).safeParse(value);
    throw new ApiError(
      parsed.success ? parsed.data.error : "Falkon is unavailable. Try again.",
      response.status,
    );
  }
  return response;
}
async function request<T>(
  url: string,
  schema: z.ZodType<T>,
  method = "GET",
  payload?: unknown,
): Promise<T> {
  const response = await check(
    await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
      signal: AbortSignal.timeout(15000),
    }),
  );
  return schema.parse(await response.json());
}
export const api = {
  products: (url = keys.products) => request(url, z.array(productSchema)),
  product: (url: string) => request(url, productSchema),
  // The engine returns 100 matches per page (at most 3); the mock returns one short page.
  async repositories(url: string) {
    const all: z.infer<typeof repositorySchema>[] = [];
    for (let page = 1; page <= 3; page++) {
      const rows = await request(
        `${url}&page=${page}`,
        z.array(repositorySchema),
      );
      all.push(...rows);
      if (rows.length < 100) break;
    }
    return all;
  },
  status: (url: string) => request(url, statusSchema),
  threads: (url: string) => request(url, z.array(threadSummarySchema)),
  thread: (url: string) => request(url, threadSchema),
  connect: (input: unknown) =>
    request(`${base}/connections`, connectionSchema, "POST", input),
  setup: (input: SetupRequest) =>
    request(keys.products, productSchema, "POST", input),
  edit: (id: string, input: EditRequest) =>
    request(keys.product(id), productSchema, "PATCH", input),
  sync: (id: string, input: unknown) =>
    request(`${keys.product(id)}/sync`, statusSchema, "POST", input),
  newThread: (id: string) => request(keys.threads(id), threadSchema, "POST"),
  async stream(
    id: string,
    input: { threadId: string; question: string },
    signal: AbortSignal,
    onEvent: (event: StreamEvent) => void,
  ) {
    const response = await check(
      await fetch(`${keys.product(id)}/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
        signal,
      }),
    );
    if (!response.body)
      throw new Error("The answer stream did not arrive. Try again.");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = "";
    let complete = false;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        pending += decoder.decode(value, { stream: !done });
        const lines = pending.split("\n");
        pending = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = streamEventSchema.parse(JSON.parse(line));
          if (event.type === "error") throw new Error(event.message);
          if (event.type === "done") complete = true;
          onEvent(event);
        }
        if (done) break;
      }
      if (!complete)
        throw new Error(
          "The connection ended before the answer was saved. Try again.",
        );
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
  },
};
export { answerSchema };
