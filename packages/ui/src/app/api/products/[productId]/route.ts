import { proxy, type ProductRoute } from "@/lib/api/server";
import { editRequestSchema } from "@sbc/contracts";
export async function GET(_request: Request, context: ProductRoute) {
  const { productId } = await context.params;
  return proxy(`/ui/products/${encodeURIComponent(productId)}`, "GET");
}
export async function PATCH(request: Request, context: ProductRoute) {
  const { productId } = await context.params;
  return proxy(
    `/ui/products/${encodeURIComponent(productId)}`,
    "PATCH",
    request,
    editRequestSchema,
  );
}
