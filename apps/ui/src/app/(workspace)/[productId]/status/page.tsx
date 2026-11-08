import { Suspense } from "react";
import type { Metadata } from "next";
import { StatusView } from "@/features/status/status-view";
import { StatusSkeleton } from "@/features/status/components/status-skeleton";
import { atRequestTime } from "@/lib/api/engine";
import { engineStatus } from "@/lib/api/server";
export const metadata: Metadata = { title: "Status" };

// The engine answer is per request: read after atRequestTime(), inside Suspense, so the route stays dynamic.
async function Status({ params }: { params: Promise<{ productId: string }> }) {
  await atRequestTime();
  const { productId } = await params;
  return <StatusView initialStatus={await engineStatus(productId)} />;
}
export default function StatusPage(props: {
  params: Promise<{ productId: string }>;
}) {
  return (
    <Suspense fallback={<StatusSkeleton />}>
      <Status {...props} />
    </Suspense>
  );
}
