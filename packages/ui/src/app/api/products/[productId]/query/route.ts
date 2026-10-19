import { apiError, body, type ProductRoute } from "@/lib/api/server";
import { queryRequestSchema } from "@/lib/contracts";
import { makeAnswer, makeStatus } from "@/lib/mock/fixtures";
import { findProduct, findThread, MockError, transact } from "@/lib/mock/store";
import { setTimeout } from "node:timers/promises";

export async function POST(request: Request, context: ProductRoute) {
  try {
    const { productId } = await context.params;
    const input = await body(request, queryRequestSchema);
    const answer = await transact((db) => {
      const product = findProduct(db, productId);
      findThread(db, productId, input.threadId);
      const status = makeStatus(product);
      if (!status.generation)
        throw new MockError(
          "Chat opens when the first Evidence Generation publishes.",
          409,
        );
      if (/\[network-error\]/i.test(input.question))
        throw new MockError(
          "The connection to Falkon dropped. Your question is kept; try again.",
          503,
        );
      if (/\[access-error\]/i.test(input.question))
        throw new MockError(
          "Falkon couldn’t confirm your access. Nothing was searched. Try again in a minute.",
          403,
        );
      return makeAnswer(product, input.question, status.generation);
    });
    const encoder = new TextEncoder();
    let cancelled = false;
    const stream = new ReadableStream({
      async start(controller) {
        const emit = (event: unknown) =>
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        try {
          emit({ type: "start", answer });
          const text =
            answer.abstention ??
            answer.paragraphs.map((paragraph) => paragraph.text).join("\n\n");
          const words = text.match(/\S+\s*/g) ?? [];
          for (let index = 0; index < words.length; index += 3) {
            if (request.signal.aborted || cancelled) return;
            emit({
              type: "delta",
              text: words.slice(index, index + 3).join(""),
            });
            await setTimeout(30);
          }
          if (request.signal.aborted || cancelled) return;
          const thread = await transact((db) => {
            const thread = findThread(db, productId, input.threadId);
            thread.answers.push(answer);
            thread.updatedAt = Date.now();
            if (thread.title === "New thread")
              thread.title = input.question.slice(0, 60);
            return thread;
          }, true);
          emit({ type: "done", thread });
          controller.close();
        } catch {
          if (!cancelled) {
            emit({
              type: "error",
              message:
                "The answer could not be saved. Your question is kept; try again.",
            });
            controller.close();
          }
        }
      },
      cancel() {
        cancelled = true;
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
