import { atRequestTime, forward } from "@/lib/api/engine";
import { repositoriesQuery } from "@falkon/contracts";
import { z } from "zod";

// ?connection=<id>&q=&page= ; the engine searches the code host through that connection's stored token.
export async function GET(request: Request) {
  await atRequestTime();
  const { connection, ...rest } = Object.fromEntries(
    new URL(request.url).searchParams,
  );
  const query = repositoriesQuery.safeParse(rest);
  const id = z.string().min(1).max(100).safeParse(connection);
  if (!id.success || !query.success)
    return Response.json(
      { error: "Invalid repository search." },
      { status: 400 },
    );
  return forward(
    `/connections/${encodeURIComponent(id.data)}/repositories?${new URLSearchParams(rest)}`,
  );
}
