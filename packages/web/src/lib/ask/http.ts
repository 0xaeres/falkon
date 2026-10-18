import { NextResponse } from "next/server";
import { z } from "zod";
import { AskError } from "./chat";

const PROVIDERS = ["amazon-bedrock", "anthropic", "azure", "deepseek", "google-generative-ai", "google-vertex-anthropic", "google-vertex", "mistral", "openai", "openai-compatible", "openrouter", "xai"] as const;

/** Sourcebot's languageModelInfo schema, field descriptions included (MCP clients see them). */
export const languageModelInfo = z.object({
  provider: z.enum(PROVIDERS).describe("The model provider (e.g., 'anthropic', 'openai')"),
  model: z.string().describe("The model ID"),
  displayName: z.string().optional().describe("Optional display name for the model"),
  inputModalities: z
    .array(z.enum(["text", "image", "audio", "video"]))
    .default(["text"])
    .describe("The input modalities the model can accept (images, audio, video, text). Single-medium attachments are gated by these. Defaults to text-only."),
  supportedDocumentTypes: z
    .array(z.enum(["pdf"]))
    .default([])
    .describe("Rich compound document formats (e.g. PDF) the model can ingest natively, distinct from single-medium attachments gated by inputModalities. Defaults to none."),
});

/** Errors as Sourcebot's `{ statusCode, errorCode, message }`. */
export function askErrorResponse(e: unknown) {
  if (e instanceof AskError) return NextResponse.json({ statusCode: e.statusCode, errorCode: e.errorCode, message: e.message }, { status: e.statusCode });
  const message = e instanceof Error ? e.message : String(e);
  return NextResponse.json({ statusCode: 500, errorCode: "UNEXPECTED_ERROR", message }, { status: 500 });
}

export const schemaError = (e: z.ZodError) =>
  NextResponse.json({ statusCode: 400, errorCode: "INVALID_REQUEST_BODY", message: `Schema validation failed with: ${e.message}` }, { status: 400 });
