import { body, endpoint, proxy, type ProductRoute } from "@/lib/api/server";
import { useEngine } from "@/lib/api/engine";
import { syncRequestSchema } from "@sbc/contracts";
import { makeStatus } from "@/lib/mock/fixtures";
import { findProduct, transact } from "@/lib/mock/store";
export async function POST(request: Request, context: ProductRoute) {
  const { productId } = await context.params;
  if (useEngine())
    return proxy(`/ui/products/${encodeURIComponent(productId)}/sync`, "POST", request, syncRequestSchema);
  return endpoint(async () => {
    await body(request, syncRequestSchema);
    return transact((db) => {
      const product = findProduct(db, productId);
      product.activeGeneration = makeStatus(product).generation ?? "g-0042";
      product.scenario = "current";
      product.queuedAt = null;
      return makeStatus(product);
    }, true);
  });
}
