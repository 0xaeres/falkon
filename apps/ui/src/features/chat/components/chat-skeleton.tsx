"use client";

import { Skeleton } from "@/components/ui/skeleton";

/** Conversation-shaped placeholder: a question, an answer's lines, the composer. */
export function ChatSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading chat"
      className="flex min-h-0 flex-1 flex-col"
    >
      <div className="mx-auto flex w-full max-w-[1080px] flex-1 flex-col gap-6 px-5 pt-8 md:px-8">
        <Skeleton className="h-10 w-64 self-end rounded-xl" />
        <div className="flex flex-col gap-2.5">
          <Skeleton className="h-5 w-40 rounded-full" />
          <Skeleton className="h-3.5 w-full" />
          <Skeleton className="h-3.5 w-[92%]" />
          <Skeleton className="h-3.5 w-[78%]" />
          <Skeleton className="h-3.5 w-[60%]" />
        </div>
      </div>
      <div className="mx-auto w-full max-w-[1080px] px-5 pb-5 md:px-8">
        <Skeleton className="h-[104px] w-full rounded-xl" />
      </div>
    </div>
  );
}
