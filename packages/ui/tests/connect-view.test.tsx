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
import { ConnectView } from "../src/features/connect/connect-view";
import { tryCopy } from "../src/features/connect/copy";
import { connectSnippets } from "../src/lib/connect";
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
const render = (apiKey: boolean, isDefault = true) => {
  const product = seedProducts[0];
  const url = `http://127.0.0.1:3001/mcp/${product.id}`;
  return renderToStaticMarkup(
    <AppRouterContext.Provider value={router}>
      <PathnameContext.Provider value={`/${product.id}/connect`}>
        <SWRConfig value={{ provider: () => new Map() }}>
          <WorkspaceShell productId={product.id} initialProduct={product}>
            <ConnectView
              isDefault={isDefault}
              apiKey={apiKey}
              snippets={connectSnippets(
                product.id,
                url,
                apiKey ? "apiKey" : "none",
              )}
            />
          </WorkspaceShell>
        </SWRConfig>
      </PathnameContext.Provider>
    </AppRouterContext.Provider>,
  );
};
const main = (html: string) => html.match(/<main[\s\S]*<\/main>/)![0];

test("Connect: three stacked snippets, each with its own copy button; tool names in one line", () => {
  const html = main(render(false));
  for (const title of ["Claude Code", "Codex", "Copilot (VS Code)"])
    assert.match(
      html,
      new RegExp(`<h2>${title.replace(/[()]/g, "\\$&")}</h2>`),
    );
  assert.equal(
    (html.match(/aria-label="Copy [^"]+ command"/g) ?? []).length,
    3,
  );
  assert.equal(
    (html.match(/<pre[^>]*tabindex="0"[^>]*aria-label="[^"]+ command"/g) ?? [])
      .length,
    3,
  );
  assert.match(
    html,
    /claude mcp add --transport http falkon-payments-platform http:\/\/127\.0\.0\.1:3001\/mcp\/payments-platform/,
  );
  assert.match(
    html,
    /Tools: <span class="mono">grep, glob,[^<]*research_codebase<\/span>/,
  );
  assert.ok(
    !html.includes("Reading an answer") &&
      !html.includes("FALKON_API_KEY before"),
  );
  assert.ok(!/<code class="mono">http/.test(html));
});

test("Connect: auth notes only in apiKey mode; the default-address line only when FALKON_MCP_URL is unset", () => {
  const key = main(render(true, false));
  assert.match(key, /Export FALKON_API_KEY before running\./);
  assert.match(
    key,
    /Export FALKON_API_KEY, and keep it set when you run Codex\./,
  );
  assert.match(key, /VS Code asks for the key when the server starts\./);
  assert.ok(!key.includes("local default address"));
  assert.match(
    main(render(false, true)),
    /Using the local default address\. Set FALKON_MCP_URL if agents connect from another machine\./,
  );
});

test("copy: failure is reported when the Clipboard API is missing or rejects", async () => {
  const set = (value: unknown) =>
    Object.defineProperty(globalThis, "navigator", {
      value,
      configurable: true,
    });
  const saved = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  try {
    set({});
    assert.equal(await tryCopy("x"), "failed");
    set({
      clipboard: { writeText: () => Promise.reject(new Error("denied")) },
    });
    assert.equal(await tryCopy("x"), "failed");
    set({ clipboard: { writeText: async () => {} } });
    assert.equal(await tryCopy("x"), "copied");
  } finally {
    if (saved) Object.defineProperty(globalThis, "navigator", saved);
    else delete (globalThis as { navigator?: unknown }).navigator;
  }
});
