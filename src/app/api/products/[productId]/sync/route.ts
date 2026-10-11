import { z } from "zod";
import { body, endpoint, type ProductRoute } from "@/lib/api/server";
import { scenarioSchema } from "@/lib/contracts";
import { makeStatus } from "@/lib/mock/fixtures";
import { findProduct, transact } from "@/lib/mock/store";
export async function POST(request: Request, context: ProductRoute) {
  const { productId } = await context.params;
  return endpoint(async () => {
    const input = await body(
      request,
      z.object({
        action: z.enum(["retry", "dismiss", "scenario"]),
        scenario: scenarioSchema.optional(),
      }),
    );
    return transact((db) => {
      const product = findProduct(db, productId);
      product.activeGeneration = makeStatus(product).generation ?? "g-0042";
      if (input.action === "scenario" && input.scenario) {
        product.scenario = input.scenario;
        product.queuedAt = null;
        product.dismissed = false;
      } else if (input.action === "dismiss") {
        product.dismissed = true;
      } else if (input.action === "retry") {
        product.scenario = "current";
        product.queuedAt = null;
        product.dismissed = false;
      }
      return makeStatus(product);
    }, true);
  });
}
