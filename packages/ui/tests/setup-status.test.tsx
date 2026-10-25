import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { repositorySchema, type Repository } from "@falkon/contracts";
import RepositoryPicker, {
  countLine,
  privateOnly,
} from "../src/features/setup/repository-picker";
import { repositories } from "./mock-fixtures";

const many = (
  n: number,
  isPrivate?: (i: number) => boolean | undefined,
): Repository[] =>
  Array.from({ length: n }, (_, i) => ({
    ...repositories[0],
    id: `acme/r${i}`,
    name: `r${i}`,
    private: isPrivate?.(i),
  }));
const render = (repos: Repository[]) =>
  renderToStaticMarkup(
    <RepositoryPicker repositories={repos} selected={{}} onChange={() => {}} />,
  );

test("fixtures and payloads without `private` still parse; with it they keep it", () => {
  const { private: _p, ...bare } = { ...repositories[0], private: true };
  assert.equal(repositorySchema.parse(bare).private, undefined);
  assert.equal(
    repositorySchema.parse({ ...bare, private: true }).private,
    true,
  );
});

test("picker rows show a Private or Public chip, and none when unknown", () => {
  const html = render(many(3, (i) => (i === 2 ? undefined : i === 0)));
  assert.equal((html.match(/>Private</g) ?? []).length, 1);
  assert.equal((html.match(/>Public</g) ?? []).length, 1);
});

test("picker count line sits above the list, for 0, 1 and 300 repositories", () => {
  assert.match(render([]), /0 repositories visible to this token/);
  assert.match(render(many(1)), /1 repository visible to this token/);
  assert.match(render(many(300)), /300 repositories visible to this token/);
  assert.match(
    render(many(2)),
    /role="switch"[^>]*aria-label="Private only"|aria-label="Private only"[^>]*role="switch"/,
  );
});

test("countLine adds the private count of the rows currently visible only with the toggle on", () => {
  const repos = many(300, (i) => i < 40);
  assert.equal(
    countLine(repos, null),
    "300 repositories visible to this token",
  );
  assert.equal(
    countLine(repos, 12),
    "300 repositories visible to this token · 12 private",
  );
  assert.equal(
    countLine([], 0),
    "0 repositories visible to this token · 0 private",
  );
});

test("privateOnly keeps only repositories marked private", () => {
  const repos = many(4, (i) => (i === 3 ? undefined : i % 2 === 0));
  assert.deepEqual(
    privateOnly(repos, true).map((r) => r.name),
    ["r0", "r2"],
  );
  assert.equal(privateOnly(repos, false), repos);
});
