import { Suspense } from "react";
import type { Metadata } from "next";
import { StatusSkeleton, StatusView } from "@/features/status/status-view";
export const metadata: Metadata = { title: "Status" };
export default function StatusPage() {
  return (
    <Suspense fallback={<StatusSkeleton />}>
      <StatusView />
    </Suspense>
  );
}
