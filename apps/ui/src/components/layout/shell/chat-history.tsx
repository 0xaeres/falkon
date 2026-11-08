import Link from "next/link";
import { Plus, Trash2 } from "lucide-react";
import type { ThreadSummary } from "@falkon/contracts";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/primitives";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

/** The rail's chat list, grouped by day, with new and delete controls. */
export function ChatHistory({
  mobile,
  productId,
  productName,
  pathname,
  threads,
  threadsError,
  refreshThreads,
  creating,
  actionError,
  onNew,
  onNavigate,
  onDelete,
}: {
  mobile: boolean;
  productId: string;
  productName: string;
  pathname: string;
  threads?: ThreadSummary[];
  threadsError: unknown;
  refreshThreads: () => unknown;
  creating: boolean;
  actionError: string;
  onNew: () => void;
  onNavigate: () => void;
  onDelete: (thread: ThreadSummary) => void;
}) {
  return (
    <aside
      aria-label="Chat history"
      className={cn(
        "flex min-h-0 flex-1 flex-col border-t border-sidebar-border",
        !mobile &&
          "invisible opacity-0 transition-opacity duration-150 rail-open:visible rail-open:opacity-100",
      )}
    >
      <header className="flex h-10 shrink-0 items-center gap-2 pr-2 pl-4">
        <h2 className="flex-1 text-xs font-medium whitespace-nowrap text-faint">
          Chat history
        </h2>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => onNew()}
          aria-label="New thread"
          title="New thread"
          disabled={creating}
        >
          {creating ? <Spinner /> : <Plus />}
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-2 pb-2">
        {threadsError && !threads ? (
          <ErrorState
            error={threadsError}
            retry={() => void refreshThreads()}
          />
        ) : !threads ? (
          <div
            role="status"
            aria-label="Loading chat history"
            className="flex flex-col gap-1 p-2"
          >
            {[80, 64, 72, 52].map((width) => (
              <Skeleton
                key={width}
                className="h-6"
                style={{ width: `${width}%` }}
              />
            ))}
          </div>
        ) : threads.length === 0 ? (
          <p className="px-2 py-3 text-xs whitespace-normal text-muted-foreground">
            Questions you ask about {productName} are kept here.
          </p>
        ) : (
          ["Today", "Yesterday", "Previous"].map((day, group) => {
            const items = threads.filter((thread) => {
              const elapsed = Date.now() - thread.updatedAt;
              return group === 0
                ? elapsed < 86400000
                : group === 1
                  ? elapsed >= 86400000 && elapsed < 172800000
                  : elapsed >= 172800000;
            });
            return (
              items.length > 0 && (
                <div key={day} className="mb-2">
                  <div className="px-2 pt-2 pb-1 text-[0.6875rem] text-faint">
                    {day}
                  </div>
                  {items.map((thread) => {
                    const current = pathname.endsWith(`/${thread.id}`);
                    return (
                      <div key={thread.id} className="group relative">
                        <Link
                          href={`/${productId}/chat/${thread.id}`}
                          aria-current={current ? "page" : undefined}
                          onClick={() => onNavigate()}
                          className={cn(
                            "block truncate rounded-md py-1.5 pr-8 pl-2 max-md:pr-11 text-[0.8125rem] text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground",
                            current && "bg-sidebar-accent text-foreground",
                          )}
                        >
                          {thread.title}
                        </Link>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          aria-label={`Delete chat: ${thread.title}`}
                          title="Delete chat"
                          onClick={() => onDelete(thread)}
                          className="absolute top-1/2 right-1 -translate-y-1/2 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 max-md:size-9 max-md:opacity-100"
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )
            );
          })
        )}
      </div>
      {actionError && (
        <p
          className="border-t px-4 py-3 text-xs whitespace-normal text-destructive"
          role="alert"
        >
          {actionError}
        </p>
      )}
    </aside>
  );
}
