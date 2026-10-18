// Writes tests/parity/.gen/v6.config.json and tests/parity/.gen/clone.config.json for the same corpus.
// Inside both containers the corpus is mounted read-only at /corpus.
import fs from "node:fs";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname);
const corpus = JSON.parse(fs.readFileSync(path.join(here, "corpus.json"), "utf8"));
const rel = (url) => url.replace(/^https?:\/\//, "").replace(/\.git$/, "");
const repos = [
  ...corpus.repos.map((r) => ({ name: rel(r.url), revisions: undefined })),
  { name: "example.test/fixtures/edge", revisions: { branches: ["**"], tags: ["*"] } },
];

const v6 = {
  $schema: "https://raw.githubusercontent.com/sourcebot-dev/sourcebot/main/schemas/v3/index.json",
  // v6 reindexes only on this schedule (default 1h); keep the oracle in step with corpus changes.
  settings: { reindexIntervalMs: 60_000, resyncConnectionIntervalMs: 60_000 },
  connections: Object.fromEntries(
    repos.map((r) => [
      r.name.replace(/[^a-zA-Z0-9]+/g, "-"),
      { type: "git", url: `file:///corpus/${r.name}`, ...(r.revisions ? { revisions: r.revisions } : {}) },
    ]),
  ),
};
// The clone reads the same v3 format; only the knowledge-base key is its own.
const clone = v6;

fs.mkdirSync(path.join(here, ".gen"), { recursive: true });
fs.writeFileSync(path.join(here, ".gen/v6.config.json"), JSON.stringify(v6, null, 2));
fs.writeFileSync(path.join(here, ".gen/clone.config.json"), JSON.stringify(clone, null, 2));
console.log(`wrote configs for ${repos.length} repos`);
