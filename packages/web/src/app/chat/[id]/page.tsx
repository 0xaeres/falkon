import { cookies, headers } from "next/headers";
import { notFound } from "next/navigation";
import { NextRequest } from "next/server";
import type { UIMessage } from "ai";
import { prisma } from "@sbc/db";
import { scopeOf } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** A stored Ask chat, read-only: the target of the chatUrl the blocking Ask and MCP return. Own or public chats only, like GET /api/ee/chats?id=. */
export default async function ChatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const h = new Headers(await headers());
  h.set("cookie", (await cookies()).toString());
  const scope = scopeOf(new NextRequest("http://localhost/", { headers: h }));
  if (!scope) return <p className="err">Unauthorized.</p>;
  const chat = await prisma.chat.findUnique({ where: { id } });
  if (!chat || (chat.visibility !== "PUBLIC" && chat.createdBy !== scope.principal)) notFound();
  const messages = chat.messages as unknown as UIMessage[];
  return (
    <>
      <h2>{chat.name ?? "Untitled chat"}</h2>
      <p className="muted">
        {chat.visibility} · {chat.createdAt.toISOString()}
      </p>
      {messages.length === 0 && <p className="muted">No messages.</p>}
      {messages.map((m) => (
        <section key={m.id}>
          <h3>{m.role === "user" ? "Question" : "Answer"}</h3>
          {m.parts.map((p, i) =>
            p.type === "text" ? (
              <pre key={i} style={{ whiteSpace: "pre-wrap" }}>
                {p.text}
              </pre>
            ) : p.type === "reasoning" ? (
              <details key={i}>
                <summary className="muted">Reasoning</summary>
                <pre style={{ whiteSpace: "pre-wrap" }}>{p.text}</pre>
              </details>
            ) : p.type.startsWith("tool-") && "input" in p ? (
              <details key={i}>
                <summary className="muted">{p.type.slice(5)}</summary>
                <pre style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(p.input, null, 2)}</pre>
              </details>
            ) : null,
          )}
        </section>
      ))}
    </>
  );
}
