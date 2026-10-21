import { apiError, body } from "@/lib/api/server";
import { forward } from "@/lib/api/engine";
import { connectionRequestSchema } from "@sbc/contracts";
export async function POST(request: Request) {
  try {
    return await forward("/connections", {
      method: "POST",
      body: await body(request, connectionRequestSchema),
    });
  } catch (error) {
    return apiError(error);
  }
}
