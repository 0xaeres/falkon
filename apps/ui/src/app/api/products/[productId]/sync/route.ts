import { proxy, type ProductRoute } from "@/lib/api/server";
import { syncRequestSchema } from "@falkon/contracts";
export async function POST(request: Request, context: ProductRoute) {
  const { productId } = await context.params;
  return proxy(
    `/ui/products/${encodeURIComponent(productId)}/sync`,
    "POST",
    request,
    syncRequestSchema,
  );
}
