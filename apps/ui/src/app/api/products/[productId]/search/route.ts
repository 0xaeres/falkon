import { proxy, type ProductRoute } from "@/lib/api/server";
export async function GET(request: Request, context: ProductRoute) {
  const { productId } = await context.params;
  // The engine validates the query string (strict keys, capped limit).
  return proxy(
    `/ui/products/${encodeURIComponent(productId)}/search${new URL(request.url).search}`,
    "GET",
  );
}
