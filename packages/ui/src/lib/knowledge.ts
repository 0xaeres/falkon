import type { Status } from "@sbc/contracts";

const LINES = {
  "no-model": "Knowledge base skipped: no model configured",
  pending: "Knowledge base: waiting for first scan",
  scanning: "Knowledge base: scanning",
  ready: "Knowledge base: ready",
  "budget-exhausted": "Knowledge base: stopped at its token limit",
  failed: "Knowledge base: last scan failed",
} as const;

/** The one status line for a Product's knowledge base; null when off or when the api sent none (mock path). */
export const knowledgeLine = (k: Status["knowledge"]): string | null => (!k || k.state === "off" ? null : LINES[k.state]);
