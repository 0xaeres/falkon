import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SWRConfig } from "swr";
import {
  AppRouterContext,
  type AppRouterInstance,
} from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PathnameContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import {
  WorkspaceShell,
  useWorkspace,
} from "../src/components/layout/workspace-shell";
import { keys } from "../src/lib/api/client";
import { ChatView } from "../src/features/chat/chat-view";
import { makeAnswer, makeStatus, seedProducts } from "../src/lib/mock/fixtures";

const router: AppRouterInstance = {
  back() {},
  forward() {},
  refresh() {},
  push() {},
  replace() {},
  prefetch() {},
  bfcacheId: "test",
};
function RouteContent() {
  const { product } = useWorkspace();
  return <p>Rendered route for {product.id}</p>;
}
test("workspace renders route children on the server before SWR fetches", () => {
  const product = seedProducts[0];
  const html = renderToStaticMarkup(
    <AppRouterContext.Provider value={router}>
      <PathnameContext.Provider value={`/${product.id}/chat`}>
        <SWRConfig value={{ provider: () => new Map() }}>
          <WorkspaceShell productId={product.id} initialProduct={product}>
            <RouteContent />
          </WorkspaceShell>
        </SWRConfig>
      </PathnameContext.Provider>
    </AppRouterContext.Provider>,
  );
  assert.ok(
    html.includes(`Rendered route for ${product.id}`),
    "The server render must include route children, not only the loading skeleton",
  );
});

test("saved conversations render outside the main page navigation", () => {
  const product = seedProducts[0];
  const html = renderToStaticMarkup(
    <AppRouterContext.Provider value={router}>
      <PathnameContext.Provider value={`/${product.id}/chat/saved`}>
        <SWRConfig
          value={{
            provider: () => new Map(),
            fallback: {
              [keys.threads(product.id)]: [
                {
                  id: "saved",
                  productId: product.id,
                  title: "Saved conversation",
                  updatedAt: Date.now(),
                },
              ],
            },
          }}
        >
          <WorkspaceShell productId={product.id} initialProduct={product}>
            <RouteContent />
          </WorkspaceShell>
        </SWRConfig>
      </PathnameContext.Provider>
    </AppRouterContext.Provider>,
  );
  const navigation = html.match(
    /<nav[^>]*aria-label="Main"[^>]*>[\s\S]*?<\/nav>/,
  )?.[0];
  const history = html.match(
    /<aside[^>]*aria-label="Chat history"[^>]*>[\s\S]*?<\/aside>/,
  )?.[0];
  assert.ok(navigation);
  assert.ok(navigation.includes("Settings"));
  assert.ok(!navigation.includes("Saved conversation"));
  assert.ok(!navigation.includes("New thread"));
  assert.ok(history);
  assert.ok(history.includes("Saved conversation"));
  assert.ok(history.includes("New thread"));
  assert.ok(history.includes('aria-current="page"'));
});

test("a saved thread seeds useChat and renders its answers with citations", () => {
  const product = seedProducts[0];
  const answer = makeAnswer(product, "What calls POST /v1/refunds?", "g-0042");
  const html = renderToStaticMarkup(
    <AppRouterContext.Provider value={router}>
      <PathnameContext.Provider value={`/${product.id}/chat/saved`}>
        <SWRConfig
          value={{
            provider: () => new Map(),
            fallback: {
              [keys.status(product.id)]: makeStatus(product),
              [keys.thread(product.id, "saved")]: {
                id: "saved",
                productId: product.id,
                title: "Saved conversation",
                updatedAt: Date.now(),
                answers: [answer],
              },
            },
          }}
        >
          <WorkspaceShell productId={product.id} initialProduct={product}>
            <ChatView threadId="saved" />
          </WorkspaceShell>
        </SWRConfig>
      </PathnameContext.Provider>
    </AppRouterContext.Provider>,
  );
  assert.ok(html.includes("What calls POST /v1/refunds?"));
  assert.ok(html.includes("Grounded answer"));
  assert.ok(html.includes(`${answer.evidence.length} sources`));
  assert.ok(html.includes('aria-label="Read source 1"'));
});
