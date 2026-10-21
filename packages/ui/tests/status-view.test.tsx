import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SWRConfig } from "swr";
import {
  AppRouterContext,
  type AppRouterInstance,
} from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PathnameContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import type { Product, Repository, Status } from "@falkon/contracts";
import { WorkspaceShell } from "../src/components/layout/workspace-shell";
import { StatusView } from "../src/features/status/status-view";
import { repoState } from "../src/features/status/repo-state";
import { keys } from "../src/lib/api/client";
import { seedProducts } from "./mock-fixtures";

const router: AppRouterInstance = {
  back() {},
  forward() {},
  refresh() {},
  push() {},
  replace() {},
  prefetch() {},
  bfcacheId: "test",
};
const base: Status = {
  productId: "payments-platform",
  verdict: "Current",
  sentence: "Answers use g-1, published 6 min ago.",
  generation: "g-1",
  generationAge: "6 min ago",
  nextGeneration: null,
  build: "idle",
  stage: 4,
  progress: 100,
  sync: "current",
  gaps: [],
  scenario: "current",
};
const render = (status: Status, product: Product = seedProducts[0]) =>
  renderToStaticMarkup(
    <AppRouterContext.Provider value={router}>
      <PathnameContext.Provider value={`/${product.id}/status`}>
        <SWRConfig
          value={{
            provider: () => new Map(),
            fallback: { [keys.status(product.id)]: status },
          }}
        >
          <WorkspaceShell productId={product.id} initialProduct={product}>
            <StatusView />
          </WorkspaceShell>
        </SWRConfig>
      </PathnameContext.Provider>
    </AppRouterContext.Provider>,
  );
const main = (html: string) => html.match(/<main[\s\S]*<\/main>/)![0];

test("current Product: one verdict line with generation and age, Sync now, the repositories table", () => {
  const html = main(render({ ...base, knowledge: { state: "ready" } }));
  assert.match(html, /<h1[^>]*>Current<\/h1>/);
  assert.match(html, /g-1/);
  assert.match(html, /6 min ago/);
  assert.match(html, />Sync now</);
  for (const head of ["Repository", "Branch", "State"])
    assert.match(html, new RegExp(`<th[^>]*>${head}<`));
  assert.equal(
    (html.match(/<tbody>[\s\S]*<\/tbody>/)![0].match(/<tr/g) ?? []).length,
    seedProducts[0].repositories.length,
  );
  assert.match(html, /Knowledge base: ready/);
  // Removed in D70: no section nav, layer cards, stage bar, progress, gaps heading.
  for (const gone of [
    "status-nav",
    "Evidence Generation",
    "Freshness target",
    "Acquire",
    "<progress",
    "Coverage gaps",
    "Open chat",
    "Edit repositories",
  ])
    assert.ok(!html.includes(gone), gone);
});

test("building shows a progress line; gaps and errors appear only when present", () => {
  const building = render({
    ...base,
    verdict: "Updating",
    sentence: "Indexing 1 of 4 repositories.",
    build: "building",
    progress: 25,
    scenario: "updating",
  });
  assert.match(building, /<progress/);
  const failed = render({
    ...base,
    verdict: "Needs attention",
    scenario: "failed",
    sync: "failed",
    gaps: [
      {
        count: 1,
        title: "Repository failed to sync",
        detail: seedProducts[0].repositories[1].id,
      },
    ],
  });
  assert.match(failed, /Repository failed to sync/);
  assert.match(failed, />Failed</);
  assert.ok(!render(base).includes("Repository failed to sync"));
});

test("repoState: each typed state maps to its label; an absent state is derived", () => {
  const repo = seedProducts[0].repositories[0];
  const label = (state: Repository["state"], status: Status = base) =>
    repoState({ ...repo, state }, status);
  assert.deepEqual(label("pending"), { label: "Pending", tone: "" });
  assert.deepEqual(label("indexing"), { label: "Indexing", tone: "blue" });
  assert.deepEqual(label("indexed"), { label: "Indexed", tone: "green" });
  assert.deepEqual(label("failed"), { label: "Failed", tone: "red" });
  assert.deepEqual(label("skipped"), { label: "Skipped", tone: "" });
  assert.equal(label(undefined).label, "Indexed");
  assert.equal(
    repoState({ ...repo, state: undefined, revision: "" }, base).label,
    "Pending",
  );
  assert.equal(
    label(undefined, {
      ...base,
      gaps: [{ count: 1, title: "x", detail: repo.id }],
    }).label,
    "Failed",
  );
  const html = render(base, {
    ...seedProducts[0],
    repositories: [{ ...repo, state: "skipped" }],
  });
  assert.match(html, />Skipped</);
});
