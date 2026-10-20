import { redirect } from "next/navigation";
import { engineProducts, useEngine } from "@/lib/api/engine";
export const dynamic = "force-dynamic";
export default async function Home() {
  if (!useEngine()) redirect("/payments-platform/status");
  const [first] = await engineProducts();
  redirect(first ? `/${first.id}/status` : "/setup");
}
