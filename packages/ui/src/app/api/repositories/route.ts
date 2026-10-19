import { endpoint } from "@/lib/api/server";
import { repositories } from "@/lib/mock/fixtures";
export async function GET() {
  return endpoint(async () => repositories);
}
