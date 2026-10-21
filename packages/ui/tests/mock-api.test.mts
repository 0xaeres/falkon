import assert from "node:assert/strict";
import { test, after } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  answerSchema,
  paragraphSchema,
  statusSchema,
  threadSchema,
} from "@sbc/contracts";
import { makeAnswer, makeStatus, seedProducts } from "../src/lib/mock/fixtures";

const directory = await mkdtemp(path.join(tmpdir(), "falkon-ui-test-"));
process.env.MOCK_DATA_DIR = directory;
const products = await import("../src/app/api/products/route");
const productRoute = await import("../src/app/api/products/[productId]/route");
const connections = await import("../src/app/api/connections/route");
const threads =
  await import("../src/app/api/products/[productId]/threads/route");
const threadRoute =
  await import("../src/app/api/products/[productId]/threads/[threadId]/route");
const messages =
  await import("../src/app/api/products/[productId]/threads/[threadId]/messages/route");
const sync = await import("../src/app/api/products/[productId]/sync/route");
after(() => rm(directory, { recursive: true, force: true }));
const request = (value: unknown) =>
  new Request("http://localhost/api", {
    method: "POST",
    body: JSON.stringify(value),
  });
const context = (productId: string) => ({
  params: Promise.resolve({ productId }),
});
const input = {
  id: "api-test-product",
  name: "API test Product",
  provider: "github" as const,
  host: "github.com",
  connectionId: "conn-1",
  repositories: [{ id: "payments-api", branch: "main" }],
};

test("fixtures keep every citation attached to its generation; unknown and other-Product questions abstain", () => {
  const answer = answerSchema.parse(
    makeAnswer(seedProducts[0], "What calls POST /v1/refunds?", "g-0042"),
  );
  const ids = new Set(answer.evidence.map((source) => source.id));
  assert.equal(answer.kind, "grounded");
  assert(answer.paragraphs[0].text.includes("refund dialog [1] and"));
  assert(answer.paragraphs[1].text.includes("RefundService.create [2]."));
  assert(
    !paragraphSchema.safeParse({ text: "Claim [9]", citations: [1] }).success,
  );
  for (const paragraph of answer.paragraphs)
    for (const id of paragraph.citations) assert(ids.has(id));
  assert(
    answer.evidence.every(
      (source) =>
        source.productId === answer.productId &&
        source.generation === answer.generation,
    ),
  );
  assert.equal(
    makeAnswer(seedProducts[0], "An unknown question", "g-0042").kind,
    "abstention",
  );
  const other = makeAnswer(
    seedProducts[1],
    "What calls POST /v1/refunds?",
    "g-0042",
  );
  assert.equal(other.kind, "abstention");
  assert.deepEqual(other.evidence, []);
  const missingRepository = {
    ...seedProducts[0],
    repositories: seedProducts[0].repositories.slice(0, 1),
  };
  assert.equal(
    makeAnswer(missingRepository, "refund", "g-0042").kind,
    "abstention",
  );
  const partial = answerSchema.parse(
    makeAnswer(
      seedProducts[0],
      "Does the support console send the same payload?",
      "g-0043",
    ),
  );
  assert.equal(partial.kind, "partial");
  assert.equal(partial.partialReasons.length, 1);
});

test("publication waits for the first build; a failed replacement preserves active evidence", () => {
  const queued = {
    ...seedProducts[0],
    activeGeneration: null,
    scenario: "building" as const,
    queuedAt: Date.now(),
  };
  assert.equal(statusSchema.parse(makeStatus(queued)).generation, null);
  const published = makeStatus({ ...queued, queuedAt: Date.now() - 16000 });
  assert.equal(published.generation, "g-0001");
  assert.equal(published.verdict, "Current");
  const failed = makeStatus({ ...seedProducts[0], scenario: "failed" });
  const replacement = makeStatus({
    ...seedProducts[0],
    scenario: "updating",
    queuedAt: Date.now() - 16000,
  });
  assert.equal(replacement.generation, "g-0043");
  assert.equal(failed.generation, "g-0042");
  assert.equal(failed.nextGeneration, "g-0043");
  assert.equal(failed.verdict, "Behind");
});

test("setup validates branches, duplicate IDs, immutable identity, and concurrent writes", async () => {
  assert.equal(
    (
      await products.POST(
        request({
          ...input,
          repositories: [{ id: "payments-api", branch: "not-a-branch" }],
        }),
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await products.POST(
        request({
          ...input,
          repositories: [input.repositories[0], input.repositories[0]],
        }),
      )
    ).status,
    400,
  );
  const responses = await Promise.all([
    products.POST(request(input)),
    products.POST(request({ ...input, id: "api-test-product-two" })),
  ]);
  assert(responses.every((response) => response.status === 200));
  assert.equal((await products.POST(request(input))).status, 409);
  assert.equal(
    (
      await productRoute.PATCH(
        request({
          name: input.name,
          repositories: [{ id: "payments-api", branch: "not-a-branch" }],
        }),
        context(input.id),
      )
    ).status,
    400,
  );
  const list = await (await products.GET()).json();
  assert(list.some((product: { id: string }) => product.id === input.id));
  assert(
    list.some(
      (product: { id: string }) => product.id === "api-test-product-two",
    ),
  );
});

test("credential simulation rejects missing scopes without storing tokens", async () => {
  const input = {
    provider: "github-enterprise",
    method: "token",
    host: "https://github.acme.internal",
    token: "rejected",
  };
  assert.equal((await connections.POST(request(input))).status, 422);
  const response = await connections.POST(
    request({ ...input, token: "demo-readonly" }),
  );
  const connection = await response.json();
  assert.equal(response.status, 200);
  assert.equal(connection.host, "github.acme.internal");
  assert(!("token" in connection));
});

test("threads cannot be read through another Product, and chat needs the engine", async () => {
  const response = await threadRoute.GET(request({}), {
    params: Promise.resolve({
      productId: "identity-services",
      threadId: "refund-write-path",
    }),
  });
  assert.equal(response.status, 404);
  assert.equal(
    (await threads.GET(request({}), context("missing-product"))).status,
    404,
  );
  const ask = await messages.POST(request({ text: "refund" }), {
    params: Promise.resolve({
      productId: "payments-platform",
      threadId: "refund-write-path",
    }),
  });
  assert.deepEqual(
    [ask.status, await ask.json()],
    [503, { error: "Chat needs the Falkon engine." }],
  );
});

test("a new thread starts empty and is listed first", async () => {
  await sync.POST(request({ action: "retry" }), context("payments-platform"));
  const created = threadSchema.parse(
    await (
      await threads.POST(request({}), context("payments-platform"))
    ).json(),
  );
  assert.deepEqual([created.title, created.answers], ["New thread", []]);
  const listed = await (
    await threads.GET(request({}), context("payments-platform"))
  ).json();
  assert.equal(listed[0].id, created.id);
});

test("DELETE removes an empty thread and keeps one that has answers", async () => {
  const created = threadSchema.parse(
    await (await threads.POST(request({}), context("payments-platform"))).json(),
  );
  const ctx = (threadId: string) => ({
    params: Promise.resolve({ productId: "payments-platform", threadId }),
  });
  assert.equal((await threadRoute.DELETE(request({}), ctx(created.id))).status, 200);
  assert.equal((await threadRoute.GET(request({}), ctx(created.id))).status, 404);
  assert.equal((await threadRoute.DELETE(request({}), ctx(created.id))).status, 404);
  assert.equal((await threadRoute.DELETE(request({}), ctx("refund-write-path"))).status, 409);
  assert.equal((await threadRoute.GET(request({}), ctx("refund-write-path"))).status, 200);
});

test("sync accepts retry only and the mock keeps no dismissed state", async () => {
  for (const action of ["dismiss", "scenario"])
    assert.equal(
      (await sync.POST(request({ action }), context("payments-platform")))
        .status,
      400,
    );
  const status = statusSchema.parse(
    await (
      await sync.POST(
        request({ action: "retry" }),
        context("payments-platform"),
      )
    ).json(),
  );
  assert.equal(status.scenario, "current");
});

test("malformed, empty, and oversized requests fail at the API boundary", async () => {
  assert.equal(
    (
      await products.POST(
        new Request("http://localhost", { method: "POST", body: "{" }),
      )
    ).status,
    400,
  );
  assert.equal(
    (await products.POST(request({ ...input, id: "unsafe/../../id" }))).status,
    400,
  );
  assert.equal(
    (await products.POST(request({ name: "x".repeat(16001) }))).status,
    413,
  );
});
