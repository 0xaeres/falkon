import { Suspense } from "react";
import { LoadingMark } from "@/components/ui/primitives";
import type { Metadata } from "next";
import { SearchView } from "@/features/search/search-view";
export const metadata: Metadata = { title: "Search" };
export default function SearchPage() {
  return (
    <Suspense fallback={<LoadingMark />}>
      <SearchView />
    </Suspense>
  );
}
