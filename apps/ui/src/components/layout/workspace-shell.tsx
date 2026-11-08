"use client";

import {
  createContext,
  useContext,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import useSWR, { useSWRConfig } from "swr";
import { api, keys } from "@/lib/api/client";
import type { Product, Status, ThreadSummary } from "@falkon/contracts";
import { Logo } from "../ui/brand";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "../ui/sheet";
import { ErrorState, LoadingMark, type Tone } from "../ui/primitives";
import { useProductEvents, visibleStatusError } from "./use-product-events";
import { ReconnectingNotice } from "./reconnecting-notice";
import { ChatHistory } from "./shell/chat-history";
import { DeleteChatDialog } from "./shell/delete-chat-dialog";
import {
  RailControl,
  railPreference,
  subscribe,
  type RailMode,
} from "./shell/rail-control";
import { RailNav, type PageName } from "./shell/rail-nav";
import { WorkspaceHeader } from "./shell/workspace-header";
import { cn } from "@/lib/utils";

type Workspace = {
  product: Product;
  status?: Status;
  threads: ThreadSummary[];
  refresh: () => Promise<unknown>;
  statusError: unknown;
  refreshStatus: () => Promise<unknown>;
};
const WorkspaceContext = createContext<Workspace | null>(null);
export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error("Workspace context is required.");
  return context;
}

/** The sidebar's delete: remove (forced), refresh the list, and leave only when the deleted thread is the open one. Errors propagate. */
export async function deleteThreadFrom(
  productId: string,
  threadId: string,
  pathname: string,
  deps: {
    remove: (productId: string, threadId: string) => Promise<void>;
    refresh: () => Promise<unknown>;
    leave: (href: string) => void;
  },
) {
  await deps.remove(productId, threadId);
  await deps.refresh();
  if (pathname.endsWith(`/${threadId}`)) deps.leave(`/${productId}/chat`);
}

export function WorkspaceShell({
  productId,
  initialProduct,
  children,
}: {
  productId: string;
  initialProduct: Product;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { mutate } = useSWRConfig();
  const {
    data: product,
    error,
    mutate: refreshProduct,
  } = useSWR(keys.product(productId), api.product, {
    fallbackData: initialProduct,
  });
  const { data: products } = useSWR(keys.products, api.products);
  const {
    data: status,
    error: statusError,
    mutate: refreshStatus,
  } = useSWR(keys.status(productId), api.status); // loaded once; the event stream below keeps it and the threads current
  const { reconnecting } = useProductEvents(productId);
  const {
    data: threads,
    error: threadsError,
    mutate: refreshThreads,
  } = useSWR(keys.threads(productId), api.threads);
  const mode = useSyncExternalStore(
    subscribe,
    railPreference,
    () => "hover" as RailMode,
  );
  const [railMenu, setRailMenu] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [creating, setCreating] = useState(false);
  const [actionError, setActionError] = useState("");
  const [deleting, setDeleting] = useState<ThreadSummary | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false); // `deleting` stays set so the title holds during the close animation
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const active: PageName = pathname.includes("/chat")
    ? "Chat"
    : pathname.endsWith("/search")
      ? "Search"
      : pathname.endsWith("/settings")
        ? "Settings"
        : pathname.endsWith("/connect")
          ? "Connect"
          : "Status";
  async function newThread() {
    setCreating(true);
    setActionError("");
    try {
      const thread = await api.newThread(productId);
      await mutate(keys.threads(productId));
      setDrawer(false);
      router.push(`/${productId}/chat/${thread.id}`);
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : "Couldn’t create a thread. Try again.",
      );
    } finally {
      setCreating(false);
    }
  }
  async function confirmDelete() {
    if (!deleting) return;
    setDeleteBusy(true);
    setDeleteError("");
    try {
      await deleteThreadFrom(productId, deleting.id, pathname, {
        remove: api.removeThread,
        refresh: () => mutate(keys.threads(productId)),
        leave: router.push,
      });
      setDrawer(false);
      setDeleteOpen(false);
    } catch (error) {
      setDeleteError(
        error instanceof Error
          ? error.message
          : "Couldn’t delete the chat. Try again.",
      );
    } finally {
      setDeleteBusy(false);
    }
  }
  if (error)
    return <ErrorState error={error} retry={() => void refreshProduct()} />;
  if (!product) return <LoadingMark />;
  const context: Workspace = {
    product,
    status,
    threads: threads ?? [],
    statusError: visibleStatusError(status, statusError),
    refreshStatus,
    refresh: async () => {
      await Promise.all([
        refreshProduct(),
        refreshStatus(),
        mutate(keys.products),
        mutate(keys.threads(productId)),
      ]);
    },
  };
  const dot: Tone =
    status?.sync === "failed" || status?.verdict === "Behind"
      ? "amber"
      : status?.build === "building"
        ? "blue"
        : "green";

  const rail = (mobile = false) => (
    <RailNav
      mobile={mobile}
      productId={productId}
      active={active}
      dot={dot}
      onNavigate={() => setDrawer(false)}
      history={
        <ChatHistory
          mobile={mobile}
          productId={productId}
          productName={product.name}
          pathname={pathname}
          threads={threads}
          threadsError={threadsError}
          refreshThreads={refreshThreads}
          creating={creating}
          actionError={actionError}
          onNew={() => void newThread()}
          onNavigate={() => setDrawer(false)}
          onDelete={(thread) => {
            setDeleteError("");
            setDeleting(thread);
            setDeleteOpen(true);
          }}
        />
      }
    />
  );

  return (
    <WorkspaceContext.Provider value={context}>
      <DeleteChatDialog
        open={deleteOpen}
        title={deleting?.title}
        error={deleteError}
        busy={deleteBusy}
        onClose={() => setDeleteOpen(false)}
        onConfirm={() => void confirmDelete()}
      />
      <div className="flex h-dvh flex-col overflow-hidden">
        <WorkspaceHeader
          productId={productId}
          product={product}
          products={products}
          active={active}
          status={status}
          dot={dot}
          onOpenNavigation={() => setDrawer(true)}
        />
        <div className="flex min-h-0 flex-1">
          {/* The slot holds the rail's width in the layout: 256px when expanded, else 56px; in hover mode the panel widens over the page. */}
          <div
            className={cn(
              "relative hidden shrink-0 transition-[width] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] md:block",
              mode === "expanded" ? "w-64" : "w-14",
            )}
          >
            <div
              data-mode={mode}
              data-menu={railMenu ? "open" : "closed"}
              className="group/rail absolute inset-y-0 left-0 z-40 flex w-14 flex-col overflow-hidden border-r border-sidebar-border bg-sidebar transition-[width,box-shadow] delay-0 duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] data-[mode=expanded]:w-64 data-[mode=hover]:hover:w-64 data-[mode=hover]:hover:delay-100 data-[mode=hover]:hover:shadow-[12px_0_32px_-12px_rgba(0,0,0,0.7)] data-[mode=hover]:has-[:focus-visible]:w-64 data-[mode=hover]:has-[:focus-visible]:shadow-[12px_0_32px_-12px_rgba(0,0,0,0.7)] data-[mode=hover]:data-[menu=open]:w-64"
            >
              {rail()}
              <RailControl
                mode={mode}
                open={railMenu}
                onOpenChange={setRailMenu}
              />
            </div>
          </div>
          <main
            id="main"
            className="flex min-w-0 flex-1 flex-col overflow-y-auto"
          >
            {reconnecting && status && <ReconnectingNotice />}
            {children}
          </main>
        </div>
        <Sheet open={drawer} onOpenChange={setDrawer}>
          <SheetContent
            side="left"
            className="w-[300px] gap-0 border-sidebar-border bg-sidebar p-0 sm:max-w-[300px]"
          >
            <SheetTitle className="flex h-12 shrink-0 items-center border-b border-sidebar-border px-4">
              <Logo />
            </SheetTitle>
            <SheetDescription className="sr-only">
              Navigate to status, chat, search, connect, and settings, or open a
              saved conversation.
            </SheetDescription>
            {drawer && rail(true)}
          </SheetContent>
        </Sheet>
      </div>
    </WorkspaceContext.Provider>
  );
}
