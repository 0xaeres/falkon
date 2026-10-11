import type { Metadata } from "next";
import { Suspense } from "react";
import { SetupWizard } from "@/features/setup/setup-wizard";
import { LoadingMark } from "@/components/ui/primitives";
export const metadata: Metadata = { title: "Product setup" };
export default function SetupPage() {
  return (
    <Suspense fallback={<LoadingMark />}>
      <SetupWizard />
    </Suspense>
  );
}
