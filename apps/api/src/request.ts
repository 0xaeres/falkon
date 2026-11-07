import { HttpException } from "@nestjs/common";
import type { IncomingMessage } from "node:http";
import { z } from "zod";

export const MAX_BODY_BYTES = 64 * 1024;

export const error = (statusCode: number, errorCode: string, message: string) => new HttpException({ statusCode, errorCode, message }, statusCode);


/** JSON only, at most MAX_BODY_BYTES, validated by `schema`. */
export async function body<T>(req: IncomingMessage, schema: z.ZodType<T>): Promise<T> {
  if (!/^application\/json\s*(;|$)/i.test(req.headers["content-type"] ?? "")) throw error(415, "UNSUPPORTED_MEDIA_TYPE", "Content-Type must be application/json.");
  const tooLarge = () => error(413, "PAYLOAD_TOO_LARGE", `Body exceeds ${MAX_BODY_BYTES} bytes.`);
  if (Number(req.headers["content-length"] ?? 0) > MAX_BODY_BYTES) throw tooLarge();
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw tooLarge();
    chunks.push(chunk);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw error(400, "INVALID_REQUEST_BODY", "Body is not valid JSON.");
  }
  const r = schema.safeParse(parsed);
  if (!r.success) throw error(400, "INVALID_REQUEST_BODY", z.prettifyError(r.error));
  return r.data;
}

