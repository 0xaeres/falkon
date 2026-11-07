import { proxy, type ProductRoute } from "@/lib/api/server";
export async function GET(_request: Request, context: ProductRoute) {
  const { productId } = await context.params;
  return proxy(`/ui/products/${encodeURIComponent(productId)}/status`, "GET");
}
