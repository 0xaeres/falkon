// Points v6 (an external compose stack) and the clone's external stack at mock-llm.mjs:
//   node parity/ask/setup.mjs <v6 compose dir>      writes parity/.gen/ask/{v6.config.json,v6.override.yml}
// and adds the same model to parity/.gen/external/clone.config.json. The v6 stack's own files are untouched;
// apply with: docker compose -f <dir>/compose.yml -f parity/.gen/ask/v6.override.yml up -d
import fs from "node:fs";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname);
const dir = path.resolve(process.argv[2]);
const gen = path.join(here, "../.gen/ask");
fs.mkdirSync(gen, { recursive: true });
const model = (prefix) => ({ provider: "openai-compatible", model: "mock-model", displayName: "Mock Model", baseUrl: `http://host.docker.internal:9100/${prefix}`, token: { env: "MOCK_LLM_TOKEN" } });

const v6cfg = JSON.parse(fs.readFileSync(path.join(dir, "config.json"), "utf8"));
v6cfg.models = [model("v6")];
fs.writeFileSync(path.join(gen, "v6.config.json"), JSON.stringify(v6cfg, null, 2));
fs.writeFileSync(
  path.join(gen, "v6.override.yml"),
  `services:\n  sourcebot:\n    environment:\n      MOCK_LLM_TOKEN: mock-token\n    extra_hosts: ["host.docker.internal:host-gateway"]\n    volumes:\n      - ${path.join(gen, "v6.config.json")}:/data/config.json:ro\n`,
);

const clonePath = path.join(here, "../.gen/external/clone.config.json");
const clone = JSON.parse(fs.readFileSync(clonePath, "utf8"));
clone.models = [model("clone")];
fs.writeFileSync(clonePath, JSON.stringify(clone, null, 2));
const composePath = path.join(here, "../.gen/external/compose.yml");
let compose = fs.readFileSync(composePath, "utf8");
if (!compose.includes("MOCK_LLM_TOKEN")) {
  compose = compose.replace("      AUTH_URL: http://localhost:3200\n", "      AUTH_URL: http://localhost:3200\n      MOCK_LLM_TOKEN: mock-token\n");
  compose = compose.replace("  sbc-backend: &sbc\n", "  sbc-backend: &sbc\n    extra_hosts: [\"host.docker.internal:host-gateway\"]\n");
  fs.writeFileSync(composePath, compose);
}
console.log("configured mock model for v6 and clone");
