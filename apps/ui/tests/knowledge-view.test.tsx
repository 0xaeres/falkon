import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SWRConfig } from "swr";
import {
  AppRouterContext,
  type AppRouterInstance,
} from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PathnameContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import type { Status } from "@falkon/contracts";
import { WorkspaceShell } from "../src/components/layout/workspace-shell";
import { press, SettingsView } from "../src/features/status/settings-view";
import { keys } from "../src/lib/api/client";
import { currentMinute } from "../src/lib/use-minute";
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
const product = seedProducts[0];
const base: Status = {
  productId: product.id,
  verdict: "Current",
  sentence: "",
  generation: "g-1",
  generationAt: currentMinute() - 6 * 60_000,
  nextGeneration: null,
  build: "idle",
  stage: 4,
  progress: 100,
  sync: "current",
  gaps: [],
  scenario: "current",
};
const render = (knowledge?: Status["knowledge"]) =>
  renderToStaticMarkup(
    <AppRouterContext.Provider value={router}>
      <PathnameContext.Provider value={`/${product.id}/settings`}>
        <SWRConfig
          value={{
            provider: () => new Map(),
            fallback: { [keys.status(product.id)]: { ...base, knowledge } },
          }}
        >
          <WorkspaceShell productId={product.id} initialProduct={product}>
            <SettingsView />
          </WorkspaceShell>
        </SWRConfig>
      </PathnameContext.Provider>
    </AppRouterContext.Provider>,
  );
const main = (html: string) => html.match(/<main[\s\S]*<\/main>/)![0];
const count = (html: string, label: string) =>
  (html.match(new RegExp(`>${label}</button>`, "g")) ?? []).length;

test("settings: scan, delete and include buttons for every repository of the Product", () => {
  const html = main(render({ state: "ready" }));
  const n = product.repositories.length;
  assert.match(html, /Knowledge base: ready/);
  for (const label of ["Scan", "Delete", "Include"])
    assert.equal(count(html, label), n, label);
});

test("settings: the pending state the engine reports is shown", () => {
  assert.match(main(render({ state: "pending" })), /waiting for first scan/);
});

test("settings: knowledge base off in config says so and shows no buttons", () => {
  const html = main(render({ state: "off" }));
  assert.match(html, /turned off in the config/);
  for (const label of ["Scan", "Delete", "Include"])
    assert.equal(count(html, label), 0, label);
});

test("settings: no knowledge facts (not loaded) shows no controls", () => {
  assert.equal(count(main(render(undefined)), "Scan"), 0);
});

test("Delete sends nothing until confirmed; Scan and Include send at once", () => {
  assert.deepEqual(press("", "r", "delete"), { armed: "r", send: false });
  assert.deepEqual(press("r", "r", "delete"), { armed: "", send: true });
  assert.deepEqual(press("other", "r", "delete"), { armed: "r", send: false });
  assert.deepEqual(press("", "r", "scan"), { armed: "", send: true });
  assert.deepEqual(press("", "r", "include"), { armed: "", send: true });
  assert.ok(!main(render({ state: "ready" })).includes("Confirm"));
});
