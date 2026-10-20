import { apiError, body } from "@/lib/api/server";
import { forward, useEngine } from "@/lib/api/engine";
import { appConnectionRequestSchema } from "@sbc/contracts";
import { MockError } from "@/lib/mock/store";

const installationsRequest = appConnectionRequestSchema
  .pick({ host: true, appId: true, privateKey: true })
  .strict();

/** Lists a GitHub App's installations. The key goes to the engine for this call only; nothing is stored or logged. */
export async function POST(request: Request) {
  try {
    const input = await body(request, installationsRequest);
    if (!useEngine())
      throw new MockError("The GitHub App method needs a running engine.", 422);
    return await forward("/connections/app-installations", {
      method: "POST",
      body: input,
    });
  } catch (error) {
    return apiError(error);
  }
}
