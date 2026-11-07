import { Suspense } from "react";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { engineProducts } from "@/lib/api/engine";
// ENGINE_URL is runtime config: decide per request, never at build time.
async function Go(): Promise<null> {
  await connection();
  const [first] = await engineProducts();
  redirect(first ? `/${first.id}/status` : "/setup");
}
export default function Home() {
  return (
    <Suspense fallback={null}>
      <Go />
    </Suspense>
  );
}
