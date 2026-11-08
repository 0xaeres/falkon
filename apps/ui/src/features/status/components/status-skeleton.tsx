"use client";

import { Page } from "@/components/ui/primitives";
import { Skeleton } from "@/components/ui/skeleton";

/** Same frame as the loaded page: header, fact tiles, shortcuts, repository rows. */
export function StatusSkeleton() {
  return (
    <Page>
      <div
        role="status"
        aria-label="Loading status"
        className="col-span-12 flex items-end justify-between gap-4"
      >
        <div className="flex flex-col gap-2.5">
          <Skeleton className="h-7 w-36" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="h-9 w-28" />
      </div>
      <div className="col-span-12 grid grid-cols-1 gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-2 lg:col-span-8 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="flex gap-3.5 bg-card p-4">
            <Skeleton className="size-10 rounded-lg" />
            <div className="flex flex-1 flex-col gap-2 pt-0.5">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-3 w-24" />
            </div>
          </div>
        ))}
      </div>
      <div className="col-span-12 flex flex-col gap-4 rounded-xl border bg-card p-5 lg:col-span-4">
        <Skeleton className="h-4 w-32" />
        {[0, 1, 2].map((row) => (
          <div key={row} className="flex items-center gap-3 py-1.5">
            <Skeleton className="size-4" />
            <div className="flex flex-1 flex-col gap-1.5">
              <Skeleton className="h-3.5 w-28" />
              <Skeleton className="h-3 w-44" />
            </div>
          </div>
        ))}
      </div>
      <div className="col-span-12 rounded-xl border bg-card">
        <div className="flex flex-col gap-2 border-b p-5">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-3 w-56" />
        </div>
        {[0, 1, 2, 3].map((row) => (
          <div
            key={row}
            className="flex items-center gap-6 border-b px-5 py-3.5 last:border-0"
          >
            <div className="flex flex-1 flex-col gap-1.5">
              <Skeleton className="h-3.5 w-40" />
              <Skeleton className="h-3 w-24" />
            </div>
            <Skeleton className="h-3.5 w-16" />
            <Skeleton className="hidden h-3.5 w-16 md:block" />
            <Skeleton className="h-5 w-20 rounded-full" />
          </div>
        ))}
      </div>
    </Page>
  );
}
