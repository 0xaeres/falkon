import { proxy } from "@/lib/api/server";
import { atRequestTime } from "@/lib/api/engine";
import { setupRequestSchema } from "@falkon/contracts";

export async function GET() {
  await atRequestTime();
  return proxy("/ui/products", "GET");
}
export async function POST(request: Request) {
  return proxy("/ui/products", "POST", request, setupRequestSchema);
}
