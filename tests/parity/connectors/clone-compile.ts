// Runs inside the clone image: compiles each scenario with the clone's connectors and prints JSON.
import fs from "node:fs";
import { compileConnection } from "../../../packages/backend/src/connectors";
const scenarios = JSON.parse(fs.readFileSync("/m/scenarios.json", "utf8"));
const out: Record<string, unknown> = {};
for (const [name, cfg] of Object.entries<any>(scenarios)) {
  if (name.startsWith("_")) continue;
  try {
    out[name] = { repos: (await compileConnection(cfg)).map((r) => ({
      externalId: r.externalId, codeHostType: r.codeHostType, codeHostUrl: r.codeHostUrl, name: r.name, displayName: r.displayName,
      cloneUrl: r.cloneUrl, webUrl: r.webUrl ?? null, imageUrl: r.imageUrl ?? null, defaultBranch: r.defaultBranch ?? null,
      isFork: r.isFork, isArchived: r.isArchived, isPublic: r.isPublic ?? false, metadata: JSON.parse(JSON.stringify(r.metadata)) })) };
  } catch (e: any) {
    out[name] = { error: String(e?.message ?? e) };
  }
}
fs.writeFileSync("/out/clone.json", JSON.stringify(out, null, 2));
process.exit(0);
