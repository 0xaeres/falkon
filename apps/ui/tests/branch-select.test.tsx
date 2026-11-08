import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SWRConfig } from "swr";
import {
  BranchSelect,
  branchKey,
  branchRows,
} from "../src/features/setup/components/branch-select";
import { api, keys } from "../src/lib/api/client";
import { branchList, repositories } from "./mock-fixtures";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});
const fakeFetch = (status: number, body: unknown) => {
  const calls: { url: string; init?: RequestInit }[] = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return Response.json(body, { status });
  }) as typeof fetch;
  return calls;
};
const repo = repositories[0];

test("api.branches reads the branches route once, default branch first", async () => {
  const calls = fakeFetch(200, branchList(repo));
  const list = await api.branches(
    keys.branches("c1", repo.organization, repo.name),
  );
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    `/api/connections/c1/repositories/${repo.organization}/${repo.name}/branches`,
  );
  assert.equal(list.branches[0], "main");
  assert.equal(list.truncated, false);
});

const loaded = { branches: ["main", "dev"], truncated: false };

test("branchKey is null until the first open, then the repository's branches URL", () => {
  assert.equal(branchKey(false, "c1", repo), null);
  assert.equal(branchKey(true, "c1", repo), keys.branches("c1", repo.organization, repo.name));
});

test("branchRows: not asked shows only the current value, no status line", () => {
  assert.deepEqual(branchRows({ value: "main", asked: false }), { branches: ["main"], loading: false, retry: false, cut: null });
});

test("branchRows: loading keeps the current value and shows the loading label", () => {
  assert.deepEqual(branchRows({ value: "dev", asked: true }), { branches: ["dev"], loading: true, retry: false, cut: null });
});

test("branchRows: loaded lists the host's order, default first, and notes a cut list", () => {
  assert.deepEqual(branchRows({ value: "main", data: loaded, asked: true }).branches, ["main", "dev"]);
  const cut = branchRows({ value: "main", data: { ...loaded, truncated: true }, asked: true });
  assert.equal(cut.cut, "List cut at 2 branches");
  assert.equal(cut.loading, false);
});

test("branchRows: failed keeps the current value selectable and offers retry", () => {
  assert.deepEqual(branchRows({ value: "dev", error: new Error("x"), asked: true }), { branches: ["dev"], loading: false, retry: true, cut: null });
});

test("branchRows: a current branch missing from the list is still present", () => {
  assert.deepEqual(branchRows({ value: "gone", data: loaded, asked: true }).branches, ["main", "dev", "gone"]);
});

test("a closed dropdown makes no branch request and shows the current branch", () => {
  const calls = fakeFetch(200, branchList(repo));
  const html = renderToStaticMarkup(
    <SWRConfig value={{ provider: () => new Map() }}>
      <BranchSelect
        connectionId="c1"
        repo={repo}
        value="release/2026.10"
        onChange={() => {}}
      />
    </SWRConfig>,
  );
  assert.equal(calls.length, 0);
  assert.match(html, /release\/2026\.10/);
});

test("api.setup and api.edit send the chosen branch per repository", async () => {
  const product = { ...(await import("./mock-fixtures")).seedProducts[0] };
  for (const [call, method] of [
    [
      () =>
        api.setup({
          id: "p",
          name: "P",
          provider: "github",
          host: "github.com",
          connectionId: "c1",
          repositories: [{ id: repo.id, branch: "develop" }],
        }),
      "POST",
    ],
    [
      () =>
        api.edit("p", {
          name: "P",
          repositories: [{ id: repo.id, branch: "develop" }],
        }),
      "PATCH",
    ],
  ] as const) {
    const calls = fakeFetch(200, product);
    await call();
    assert.equal(calls[0].init?.method, method);
    assert.deepEqual(JSON.parse(String(calls[0].init?.body)).repositories, [
      { id: repo.id, branch: "develop" },
    ]);
  }
});

test("a 409 BRANCH_CONFLICT message reaches the caller in words", async () => {
  const message =
    'acme/checkout-web is already tracked on branch "main" by another Product on this connection; Falkon tracks one branch per repository.';
  fakeFetch(409, { error: message });
  await assert.rejects(
    api.setup({
      id: "p",
      name: "P",
      provider: "github",
      host: "github.com",
      connectionId: "c1",
      repositories: [{ id: repo.id, branch: "develop" }],
    }),
    (error: Error) => error.message === message,
  );
});
