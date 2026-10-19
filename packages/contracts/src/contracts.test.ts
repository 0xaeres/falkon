import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import {
  answerPartSchema,
  connectionRequestSchema,
  evidencePartSchema,
  evidenceSchema,
  productIdSchema,
  repositorySchema,
  scenarioSchema,
  setupRequestSchema,
  statusSchema,
  syncRequestSchema,
} from "./index";

// The engine rule lives in a module with heavy imports, so read its regex out of the source.
const engineSource = readFileSync(
  new URL("../../backend/src/productResolve.ts", import.meta.url),
  "utf8",
);
const engineRule = engineSource.match(/isProductSlug = .*?(\/\^.*?\$\/)\.test/)?.[1];
const isProductSlug = (name: string) =>
  new RegExp(engineRule!.slice(1, -1)).test(name);

test("productIdSchema accepts and rejects exactly what the engine slug rule does", () => {
  const samples = [
    "a",
    "0",
    "payments-platform",
    "a-",
    "a--b",
    "9lives",
    "x".repeat(63),
    "x".repeat(64),
    "",
    "-a",
    "A",
    "a_b",
    "a b",
    "a/b",
    "é",
  ];
  for (const sample of samples)
    assert.equal(
      productIdSchema.safeParse(sample).success,
      isProductSlug(sample),
      JSON.stringify(sample),
    );
});

test("status and repository carry no overlay or structural fields, and the overlay scenario is gone", () => {
  assert(!("overlay" in statusSchema.shape));
  assert(!("overlayPercent" in statusSchema.shape));
  assert(!("structural" in repositorySchema.shape));
  assert(!scenarioSchema.safeParse("overlay-unavailable").success);
  assert(scenarioSchema.safeParse("partly-behind").success);
});

test("sync accepts retry only", () => {
  assert(syncRequestSchema.safeParse({ action: "retry" }).success);
  for (const body of [{ action: "dismiss" }, { action: "scenario" }, {}])
    assert(!syncRequestSchema.safeParse(body).success);
});

test("connection requests are token-only for github and github-enterprise", () => {
  const ok = {
    provider: "github",
    method: "token",
    host: "https://github.com",
    token: "ghp_x",
  };
  assert(connectionRequestSchema.safeParse(ok).success);
  assert(
    connectionRequestSchema.safeParse({ ...ok, provider: "github-enterprise" })
      .success,
  );
  for (const bad of [
    { ...ok, method: "app" },
    { ...ok, provider: "gitlab" },
    { ...ok, token: undefined },
    { ...ok, token: "" },
    { ...ok, token: "t".repeat(201) },
    { ...ok, host: "http://github.com" },
  ])
    assert(!connectionRequestSchema.safeParse(bad).success);
});

test("setup requests name the stored connection", () => {
  const ok = {
    id: "pay",
    name: "Pay",
    provider: "github",
    host: "github.com",
    connectionId: "c1",
    repositories: [{ id: "github.com/o/r", branch: "main" }],
  };
  assert(setupRequestSchema.safeParse(ok).success);
  assert(!setupRequestSchema.safeParse({ ...ok, connectionId: "" }).success);
  assert(
    !setupRequestSchema.safeParse({ ...ok, connectionId: undefined }).success,
  );
});

test("repository.updated is an ISO timestamp; revision and language may be empty", () => {
  const ok = {
    id: "r",
    name: "r",
    organization: "o",
    language: "",
    revision: "",
    updated: "2026-10-20T10:00:00.000Z",
    branches: ["main"],
    branch: "main",
  };
  assert(repositorySchema.safeParse(ok).success);
  assert(!repositorySchema.safeParse({ ...ok, updated: "12 min ago" }).success);
});

test("evidence and answer parts validate the persisted data-parts", () => {
  const evidence = {
    id: 1,
    productId: "pay",
    generation: "g1",
    repository: "github.com/o/r",
    path: "a.ts",
    revision: "abc1234",
    startLine: 3,
    code: ["x"],
    highlightedLines: [3],
  };
  assert.equal(evidencePartSchema, evidenceSchema);
  assert(evidencePartSchema.safeParse(evidence).success);
  const answer = {
    kind: "grounded",
    generation: "g1",
    paragraphs: [{ text: "Uses it [1].", citations: [1] }],
    gaps: [],
    partialReasons: [],
    abstention: null,
    suggestions: [],
  };
  assert(answerPartSchema.safeParse(answer).success);
  assert(
    !answerPartSchema.safeParse({
      ...answer,
      paragraphs: [{ text: "Claim [2]", citations: [1] }],
    }).success,
  );
  assert(!answerPartSchema.safeParse({ ...answer, kind: "other" }).success);
});
