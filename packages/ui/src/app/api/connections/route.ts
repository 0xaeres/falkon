import { apiError, body, endpoint } from "@/lib/api/server";
import { forward, useEngine } from "@/lib/api/engine";
import { connectionRequestSchema } from "@sbc/contracts";
import { MockError } from "@/lib/mock/store";
export async function POST(request: Request) {
  if (useEngine()) {
    try {
      return forward("/connections", {
        method: "POST",
        body: await body(request, connectionRequestSchema),
      });
    } catch (error) {
      return apiError(error);
    }
  }
  return endpoint(async () => {
    const input = await body(request, connectionRequestSchema);
    if (input.method === "token" && input.token !== "demo-readonly")
      throw new MockError(
        "The mock API accepts only the token demo-readonly. Set ENGINE_URL to connect a real code host.",
        422,
      );
    return {
      id: crypto.randomUUID(),
      host: new URL(input.host).host,
      provider: input.provider,
    };
  });
}
