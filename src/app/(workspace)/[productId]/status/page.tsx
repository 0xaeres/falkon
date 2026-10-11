import { Suspense } from "react";
import { Skeleton } from "@/components/ui/primitives";
import type { Metadata } from "next";
import { StatusView } from "@/features/status/status-view";
export const metadata: Metadata = { title: "Status" };
export default function StatusPage() {
  return (
    <Suspense fallback={<Skeleton />}>
      <StatusView />
    </Suspense>
  );
}
