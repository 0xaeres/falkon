import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SWRConfig } from "swr";
import {
  AppRouterContext,
  type AppRouterInstance,
} from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PathnameContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { WorkspaceShell } from "../src/components/layout/workspace-shell";
import {
  DeleteForm,
  removeProduct,
  SettingsView,
} from "../src/features/status/settings-view";
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
const product = seedProducts[0];
const render = (p: typeof product & { connectionId?: string }) =>
  renderToStaticMarkup(
    <AppRouterContext.Provider value={router}>
      <PathnameContext.Provider value={`/${p.id}/settings`}>
        <SWRConfig value={{ provider: () => new Map() }}>
          <WorkspaceShell productId={p.id} initialProduct={p}>
            <SettingsView />
          </WorkspaceShell>
        </SWRConfig>
      </PathnameContext.Provider>
    </AppRouterContext.Provider>,
  );
const form = (typed: string, error = "", busy = false) =>
  renderToStaticMarkup(
    <DeleteForm
      slug="alpha"
      typed={typed}
      busy={busy}
      error={error}
      onType={() => {}}
      onConfirm={() => {}}
    />,
  );
const deleteButton = (html: string) =>
  html.match(/<button[^>]*>Delete Product<\/button>/)![0];

test("danger zone: an api Product shows the Delete Product button; a Product without a connection shows a note instead", () => {
  const api = render(product);
  assert.match(api, /Danger zone/);
  assert.match(api, />Delete Product<\/button>/);
  const config = render({ ...product, connectionId: undefined });
  assert.match(config, /Danger zone/);
  assert.match(config, /has no connection/);
  assert.match(config, /config\.json/);
  assert.match(config, /DELETE \/products\/:slug/);
  assert.doesNotMatch(config, />Delete Product<\/button>/);
});

test("delete form: the button stays disabled until the exact slug is typed", () => {
  for (const typed of ["", "alph", "Alpha", "alpha "])
    assert.match(deleteButton(form(typed)), / disabled=""/, typed);
  assert.doesNotMatch(deleteButton(form("alpha")), / disabled=""/);
});

test("delete form: an error is shown and a busy request disables the button", () => {
  assert.match(
    form("alpha", "Product comes from config."),
    /Product comes from config\./,
  );
  assert.match(deleteButton(form("alpha", "", true)), / disabled=""/);
});

test("removeProduct: success clears the Product caches and goes to /setup", async () => {
  const calls: unknown[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push([url, init.method]);
    return new Response(null, { status: 204 });
  }) as typeof fetch;
  const cleared: unknown[] = [];
  const pushed: string[] = [];
  const mutate = (async (filter: (k: unknown) => boolean) => {
    assert.deepEqual(pushed, ["/setup"], "navigates before clearing");
    cleared.push(
      [
        keys.products,
        keys.product("alpha"),
        keys.status("alpha"),
        keys.threads("alpha"),
        keys.product("alphabet"),
        keys.status("beta"),
      ].filter(filter),
    );
  }) as never;
  try {
    const error = await removeProduct("alpha", mutate, (p) => pushed.push(p));
    assert.equal(error, "");
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.deepEqual(calls, [[keys.product("alpha"), "DELETE"]]);
  assert.deepEqual(cleared, [
    [
      keys.products,
      keys.product("alpha"),
      keys.status("alpha"),
      keys.threads("alpha"),
    ],
  ]);
  assert.deepEqual(pushed, ["/setup"]);
});

test("removeProduct: failure returns the error and neither clears nor navigates", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    Response.json(
      { error: "Product comes from config and is read-only through this API." },
      { status: 409 },
    )) as typeof fetch;
  let touched = false;
  try {
    const error = await removeProduct(
      "alpha",
      (async () => void (touched = true)) as never,
      () => void (touched = true),
    );
    assert.match(error, /read-only/);
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(touched, false);
});
