import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/** Table-shaped placeholder while the code host lists repositories. */
export function RepositoryPickerSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading repositories"
      className="flex flex-col gap-4"
    >
      <div className="flex justify-between">
        <Skeleton className="h-4 w-60" />
        <Skeleton className="h-4 w-28" />
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[220px_1fr]">
        <Skeleton className="h-9" />
        <Skeleton className="h-9" />
      </div>
      <div className="overflow-hidden rounded-lg border">
        <div className="flex gap-6 border-b bg-card px-3 py-3">
          <Skeleton className="size-4" />
          <Skeleton className="h-3.5 w-24" />
        </div>
        {[72, 56, 64, 48, 60, 52].map((width, index) => (
          <div
            key={index}
            className={cn(
              "flex items-center gap-4 px-3 py-3",
              index < 5 && "border-b",
            )}
          >
            <Skeleton className="size-4" />
            <div className="flex flex-1 flex-col gap-1.5">
              <Skeleton className="h-3.5" style={{ width: `${width * 3}px` }} />
              <Skeleton className="h-3 w-24" />
            </div>
            <Skeleton className="hidden h-3.5 w-16 md:block" />
            <Skeleton className="h-8 w-32" />
            <Skeleton className="hidden h-3.5 w-14 sm:block" />
          </div>
        ))}
      </div>
    </div>
  );
}
