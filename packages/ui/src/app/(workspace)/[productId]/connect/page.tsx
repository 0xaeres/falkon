import { Suspense } from "react";
import { connection } from "next/server";
import type { Metadata } from "next";
import { ConnectView } from "@/features/connect/connect-view";
import { LoadingMark } from "@/components/ui/primitives";
import { connectSnippets, mcpUrl, type AuthMode } from "@/lib/connect";
export const metadata: Metadata = { title: "Connect" };

// FALKON_MCP_URL and AUTH_MODE are runtime config of the UI server: read per request, never at build time.
async function Connect({ params }: { params: Promise<{ productId: string }> }) {
  await connection();
  const { productId } = await params;
  const mode: AuthMode = process.env.AUTH_MODE === "apiKey" ? "apiKey" : "none";
  const url = mcpUrl(process.env.FALKON_MCP_URL, productId);
  return (
    <ConnectView
      isDefault={!process.env.FALKON_MCP_URL}
      apiKey={mode === "apiKey"}
      snippets={connectSnippets(productId, url, mode)}
    />
  );
}
export default function ConnectPage(props: {
  params: Promise<{ productId: string }>;
}) {
  return (
    <Suspense fallback={<LoadingMark />}>
      <Connect {...props} />
    </Suspense>
  );
}
