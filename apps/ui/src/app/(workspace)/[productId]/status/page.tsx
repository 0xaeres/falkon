import { Suspense } from "react";
import type { Metadata } from "next";
import { StatusView } from "@/features/status/status-view";
import { StatusSkeleton } from "@/features/status/components/status-skeleton";
export const metadata: Metadata = { title: "Status" };
export default function StatusPage() {
  return (
    <Suspense fallback={<StatusSkeleton />}>
      <StatusView />
    </Suspense>
  );
}
