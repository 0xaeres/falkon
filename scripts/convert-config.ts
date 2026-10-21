// One-time converter: tsx scripts/convert-config.ts old.json > new.json
// Warnings go to stderr, the converted config to stdout. Comments in the input are not kept.
import fs from "node:fs";
import { CONNECTION_TYPES, MODEL_PROVIDERS, SCHEMA_ID, parseJsonc } from "../packages/shared/src/config";

/** Keys an older format allowed that Falkon does not support. */
const UNSUPPORTED_KEYS = ["apps", "identityProviders"];

export function convertConfig(text: string): { output: string; warnings: string[] } {
  let raw: unknown;
  try {
    raw = parseJsonc(text);
  } catch (e) {
    throw new Error(`invalid JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new Error("config must be a JSON object");
  const { $schema: _ignored, connections, models, ...rest } = raw as Record<string, unknown>;
  const warnings: string[] = [];
  for (const k of UNSUPPORTED_KEYS) {
    if (k in rest) {
      delete rest[k];
      warnings.push(`dropped unsupported key '${k}'`);
    }
  }
  if (connections !== undefined && (typeof connections !== "object" || connections === null || Array.isArray(connections))) throw new Error("'connections' must be an object");
  if (models !== undefined && !Array.isArray(models)) throw new Error("'models' must be an array");
  const keptModels = ((models ?? []) as { provider?: unknown }[]).filter((m, i) => {
    const ok = MODEL_PROVIDERS.includes(m?.provider as string);
    if (!ok) warnings.push(`dropped models[${i}]: unsupported provider '${String(m?.provider)}'`);
    return ok;
  });
  const kept: Record<string, unknown> = {};
  for (const [name, c] of Object.entries((connections ?? {}) as Record<string, { type?: unknown }>)) {
    if (CONNECTION_TYPES.includes(c?.type as string)) kept[name] = c;
    else warnings.push(`dropped connection '${name}': unsupported type '${String(c?.type)}'`);
  }
  const out = { $schema: SCHEMA_ID, ...(connections === undefined ? {} : { connections: kept }), ...(models === undefined ? {} : { models: keptModels }), ...rest };
  return { output: JSON.stringify(out, null, 2) + "\n", warnings };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  try {
    const { output, warnings } = convertConfig(fs.readFileSync(process.argv[2] ?? "/dev/stdin", "utf8"));
    for (const w of warnings) console.error(`convert-config: ${w}`);
    process.stdout.write(output);
  } catch (e) {
    console.error(`convert-config: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}
