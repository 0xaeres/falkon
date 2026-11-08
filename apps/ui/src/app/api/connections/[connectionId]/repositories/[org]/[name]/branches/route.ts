import { atRequestTime, forward } from "@/lib/api/engine";
import { z } from "zod";

type Route = {
  params: Promise<{ connectionId: string; org: string; name: string }>;
};
const segment = z
  .string()
  .min(1)
  .max(100)
  .refine((value) => value !== "." && value !== "..");
// The engine lists one repository's branches through the connection's stored token, live, so nothing is cached here.
export async function GET(_request: Request, context: Route) {
  await atRequestTime();
  const params = z
    .object({ connectionId: segment, org: segment, name: segment })
    .safeParse(await context.params);
  if (!params.success)
    return Response.json({ error: "Invalid branch request." }, { status: 400 });
  const { connectionId, org, name } = params.data;
  return forward(
    `/connections/${encodeURIComponent(connectionId)}/repositories/${encodeURIComponent(org)}/${encodeURIComponent(name)}/branches`,
  );
}
