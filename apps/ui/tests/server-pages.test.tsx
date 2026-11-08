import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import type { ReactElement } from "react";
import { SWRConfig } from "swr";
import {
  AppRouterContext,
  type AppRouterInstance,
} from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PathnameContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import type { Product, Status } from "@falkon/contracts";
import { WorkspaceShell } from "../src/components/layout/workspace-shell";
import { keys } from "../src/lib/api/client";
import { makeStatus, seedProducts } from "./mock-fixtures";

// The pages import server-only modules; outside Next's react-server condition that guard throws, so stub it here.
const require = createRequire(import.meta.url);
const guard = require.resolve("server-only");
require.cache[guard] = { id: guard, filename: guard, loaded: true, exports: {} } as never;

const router: AppRouterInstance = {
  back() {},
  forward() {},
  refresh() {},
  push() {},
  replace() {},
  prefetch() {},
  bfcacheId: "test",
};
async function html(page: ReactElement) {
  const { prerender } = await import("react-dom/static");
  return new Response((await prerender(page)).prelude).text();
}
const inShell = (product: Product, page: ReactElement, page2 = "status", fallback = {}) => (
  <AppRouterContext.Provider value={router}>
    <PathnameContext.Provider value={`/${product.id}/${page2}`}>
      <SWRConfig value={{ provider: () => new Map(), fallback }}>
        <WorkspaceShell productId={product.id} initialProduct={product}>
          {page}
        </WorkspaceShell>
      </SWRConfig>
    </PathnameContext.Provider>
  </AppRouterContext.Provider>
);

let answer: unknown;
async function withEngine(run: () => Promise<void>) {
  const server: Server = createServer((_req, res) =>
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(answer)),
  );
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  process.env.ENGINE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.ENGINE_ADMIN_TOKEN = "t0ken";
  try {
    await run();
  } finally {
    server.closeAllConnections();
    await new Promise((ok) => server.close(ok));
  }
}
const product = seedProducts[0];
const params = (id = product.id) => ({ params: Promise.resolve({ productId: id }) });
const statusPage = async (p: Product = product) => {
  const { default: StatusPage } = await import("../src/app/(workspace)/[productId]/status/page");
  return html(inShell(p, <StatusPage {...params(p.id)} />));
};

test("status page: the engine's verdict is in the first HTML, with no client fetch", () => {
  answer = { ...makeStatus(product), verdict: "Verdict from the engine" };
  return withEngine(async () => {
    const h = await statusPage();
    assert.ok(h.includes("Verdict from the engine"));
    assert.ok(h.includes("Sync now"));
  });
});

test("status page: stale data after navigation, each render asks the engine again", () =>
  withEngine(async () => {
    answer = { ...makeStatus(product), verdict: "First verdict" };
    assert.ok((await statusPage()).includes("First verdict"));
    answer = { ...makeStatus(product), verdict: "Second verdict" };
    const h = await statusPage();
    assert.ok(h.includes("Second verdict") && !h.includes("First verdict"));
  }));

test("status page: live data from the shell wins over the server's initial data", () => {
  answer = { ...makeStatus(product), verdict: "Server verdict" };
  return withEngine(async () => {
    const { default: StatusPage } = await import("../src/app/(workspace)/[productId]/status/page");
    const live: Status = { ...makeStatus(product), verdict: "Live verdict" };
    const h = await html(
      inShell(product, <StatusPage {...params()} />, "status", { [keys.status(product.id)]: live }),
    );
    assert.ok(h.includes("Live verdict") && !h.includes("Server verdict"));
  });
});

test("status page: engine down renders the skeleton for the client to fill, not a 500", async () => {
  process.env.ENGINE_URL = "http://127.0.0.1:1";
  const h = await statusPage();
  assert.ok(!h.includes("Sync now"));
  assert.ok(h.includes("Loading status"));
});

test("status page: a Product with no repositories and no index renders its empty state", () => {
  const empty: Product = { ...product, repositories: [], activeGeneration: null, scenario: "building" };
  answer = { ...makeStatus(empty), verdict: "Empty verdict from the engine", generation: null, generationAt: null };
  return withEngine(async () => {
    const h = await statusPage(empty);
    assert.ok(h.includes("Empty verdict from the engine"));
    assert.ok(h.includes("No index is published yet"));
  });
});

test("status page: a server snapshot does not hide a failed live fetch; the error state with retry shows", async () => {
  const { StatusView } = await import("../src/features/status/status-view");
  const failed = new Map([[keys.status(product.id), { error: new Error("Falkon is unavailable. Try again.") }]]);
  const h = await html(
    <AppRouterContext.Provider value={router}>
      <PathnameContext.Provider value={`/${product.id}/status`}>
        <SWRConfig value={{ provider: () => failed as never }}>
          <WorkspaceShell productId={product.id} initialProduct={product}>
            <StatusView initialStatus={{ ...makeStatus(product), verdict: "Snapshot verdict" }} />
          </WorkspaceShell>
        </SWRConfig>
      </PathnameContext.Provider>
    </AppRouterContext.Provider>,
  );
  assert.ok(h.includes("Falkon is unavailable. Try again."));
  assert.ok(!h.includes("Snapshot verdict"));
});

test("connect page: URL and snippets for the Product are in the first HTML", async () => {
  process.env.FALKON_MCP_URL = "https://mcp.example.test/";
  process.env.AUTH_MODE = "apiKey";
  const { default: ConnectPage } = await import("../src/app/(workspace)/[productId]/connect/page");
  const h = await html(inShell(product, <ConnectPage {...params()} />, "connect"));
  assert.ok(h.includes(`https://mcp.example.test/mcp/${product.id}`));
  assert.ok(h.includes("FALKON_API_KEY"));
  delete process.env.FALKON_MCP_URL;
  delete process.env.AUTH_MODE;
});

test("the engine token never reaches client code: no client file imports the server modules", () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
    );
  const offenders = walk(new URL("../src", import.meta.url).pathname).filter((f) => {
    const src = readFileSync(f, "utf8");
    return /^["']use client["']/.test(src) && /lib\/api\/(server|engine)|\.\/(server|engine)["']|ENGINE_ADMIN_TOKEN/.test(src);
  });
  assert.deepEqual(offenders, []);
  assert.match(readFileSync(new URL("../src/lib/api/server.ts", import.meta.url), "utf8"), /^import "server-only"/);
});
