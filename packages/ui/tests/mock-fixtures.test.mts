import assert from "node:assert/strict";
import { test } from "node:test";
import { answerSchema, paragraphSchema, statusSchema } from "@sbc/contracts";
import { makeAnswer, makeStatus, seedProducts } from "./mock-fixtures";

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
