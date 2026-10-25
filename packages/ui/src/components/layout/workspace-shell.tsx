"use client";

import {
  createContext,
  useContext,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import useSWR, { useSWRConfig } from "swr";
import {
  Check,
  ChevronsUpDown,
  Layers,
  Menu,
  MessageCircle,
  PanelLeft,
  Plug,
  Plus,
  Search,
  Settings,
  type LucideIcon,
} from "lucide-react";
import { api, keys } from "@/lib/api/client";
import type { Product, Status, ThreadSummary } from "@falkon/contracts";
import { cn } from "@/lib/utils";
import { Logo, Mark } from "../ui/brand";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "../ui/sheet";
import { Skeleton } from "../ui/skeleton";
import { Spinner } from "../ui/spinner";
import { ErrorState, LoadingMark, StateDot, type Tone } from "../ui/primitives";

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

const PAGES = [
  { name: "Status", icon: Layers },
  { name: "Chat", icon: MessageCircle },
  { name: "Search", icon: Search },
  { name: "Connect", icon: Plug },
] as const;
type PageName = (typeof PAGES)[number]["name"] | "Settings";

/** The colour of a Product's state, wherever the Product is named. */
export const scenarioTone = (scenario: Product["scenario"]): Tone =>
  scenario === "current"
    ? "green"
    : scenario === "updating" || scenario === "building"
      ? "blue"
      : scenario === "failed"
        ? "red"
        : "amber";

// How the rail behaves, the operator's choice: always open, always closed, or closed and widening over the page on hover.
type RailMode = "expanded" | "collapsed" | "hover";
const RAIL_MODES: [RailMode, string][] = [
  ["expanded", "Expanded"],
  ["collapsed", "Collapsed"],
  ["hover", "Expand on hover"],
];
const subscribe = (listener: () => void) => {
  window.addEventListener("storage", listener);
  window.addEventListener("sidebar-change", listener);
  return () => {
    window.removeEventListener("storage", listener);
    window.removeEventListener("sidebar-change", listener);
  };
};
function railPreference(): RailMode {
  try {
    const stored = localStorage.getItem("falkon.sidebar");
    return stored === "expanded" || stored === "collapsed" ? stored : "hover";
  } catch {
    return "hover";
  }
}
function setRailMode(mode: RailMode) {
  try {
    localStorage.setItem("falkon.sidebar", mode);
  } catch {
    /* Without storage the rail keeps expanding on hover. */
  }
  window.dispatchEvent(new Event("sidebar-change"));
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
  } = useSWR(keys.status(productId), api.status, {
    refreshInterval: (data) => (data?.scenario === "building" ? 2000 : 30000),
  });
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
  if (error)
    return <ErrorState error={error} retry={() => void refreshProduct()} />;
  if (!product) return <LoadingMark />;
  const context: Workspace = {
    product,
    status,
    threads: threads ?? [],
    statusError,
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

  // In the rail, labels stay in the DOM and the `rail-open` variant reveals them; in the mobile sheet they always show.
  const label = (mobile: boolean) =>
    cn(
      "flex-1 truncate",
      !mobile &&
        "opacity-0 transition-opacity duration-150 rail-open:opacity-100",
    );
  const item = (name: PageName, Icon: LucideIcon, mobile: boolean) => {
    const on = active === name;
    return (
      <Link
        key={name}
        href={`/${productId}/${name.toLowerCase()}`}
        aria-current={on ? "page" : undefined}
        aria-label={name}
        title={mobile ? undefined : name}
        onClick={() => setDrawer(false)}
        className={cn(
          "relative flex h-9 shrink-0 items-center gap-3 rounded-md px-[11px] text-[0.8125rem] font-medium whitespace-nowrap text-sidebar-foreground transition-colors duration-150 hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground",
          on &&
            "bg-sidebar-accent text-sidebar-accent-foreground shadow-[inset_0_0_0_1px_var(--border)]",
          mobile && "h-11",
        )}
      >
        <Icon className="size-[17px] shrink-0" aria-hidden="true" />
        <span className={label(mobile)}>{name}</span>
        {name === "Status" && (
          <StateDot
            tone={dot}
            className={cn(
              !mobile &&
                "absolute top-2 left-[26px] size-[7px] ring-2 ring-sidebar rail-open:static rail-open:ring-0",
            )}
          />
        )}
      </Link>
    );
  };

  const history = (mobile: boolean) => (
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
          onClick={() => void newThread()}
          aria-label="New thread"
          title="New thread"
          disabled={creating}
        >
          {creating ? <Spinner /> : <Plus />}
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-2 pb-2">
        {threadsError ? (
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
            Questions you ask about {product.name} are kept here.
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
                      <Link
                        key={thread.id}
                        href={`/${productId}/chat/${thread.id}`}
                        aria-current={current ? "page" : undefined}
                        onClick={() => setDrawer(false)}
                        className={cn(
                          "block truncate rounded-md px-2 py-1.5 text-[0.8125rem] text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground",
                          current && "bg-sidebar-accent text-foreground",
                        )}
                      >
                        {thread.title}
                      </Link>
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

  const rail = (mobile = false) => (
    <>
      <nav aria-label="Main" className="flex shrink-0 flex-col gap-0.5 p-2">
        {PAGES.map(({ name, icon }) => item(name, icon, mobile))}
      </nav>
      {history(mobile)}
      <nav
        aria-label="Product"
        className="flex shrink-0 flex-col gap-0.5 border-t border-sidebar-border p-2"
      >
        {item("Settings", Settings, mobile)}
      </nav>
    </>
  );

  return (
    <WorkspaceContext.Provider value={context}>
      <div className="flex h-dvh flex-col overflow-hidden">
        <header className="flex h-12 shrink-0 items-center gap-1 border-b bg-sidebar pr-3 md:gap-2 md:pr-4">
          <Button
            variant="ghost"
            size="icon"
            className="ml-1.5 md:hidden"
            aria-label="Open navigation"
            onClick={() => setDrawer(true)}
          >
            <Menu />
          </Button>
          <Link
            href={`/${productId}/status`}
            aria-label="Falkon status"
            className="hidden h-12 w-14 shrink-0 place-items-center text-foreground md:grid"
          >
            <Mark size={22} />
          </Link>
          <span className="hidden text-input md:inline" aria-hidden="true">
            /
          </span>
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label="Switch Product"
              className="flex h-8 min-w-0 items-center gap-2 rounded-md px-2 text-[0.8125rem] font-medium outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/60 data-[state=open]:bg-accent"
            >
              <span className="grid size-5 shrink-0 place-items-center rounded-[5px] bg-[#2a2a30] text-[0.625rem] font-semibold tracking-wide text-foreground">
                {product.initials}
              </span>
              <span className="truncate">{product.name}</span>
              <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" sideOffset={6} className="w-64">
              <DropdownMenuLabel className="text-xs font-normal text-faint">
                Products
              </DropdownMenuLabel>
              {products?.map((entry) => (
                <DropdownMenuItem
                  key={entry.id}
                  onSelect={() =>
                    router.push(`/${entry.id}/${active.toLowerCase()}`)
                  }
                  className="gap-2.5"
                >
                  <span className="grid size-5 shrink-0 place-items-center rounded-[5px] bg-[#2a2a30] text-[0.625rem] font-semibold">
                    {entry.initials}
                  </span>
                  <span className="flex-1 truncate">{entry.name}</span>
                  <StateDot tone={scenarioTone(entry.scenario)} />
                  {entry.id === productId ? (
                    <Check className="size-3.5" />
                  ) : (
                    <span className="w-3.5" aria-hidden="true" />
                  )}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild className="gap-2.5">
                <Link href="/setup">
                  <Plus className="size-4" />
                  New Product
                </Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <span className="text-input" aria-hidden="true">
            /
          </span>
          <span className="truncate px-1 text-[0.8125rem] text-muted-foreground">
            {active}
          </span>
          <span className="flex-1" />
          {status && (
            <Link
              href={`/${productId}/status`}
              className="hidden h-7 items-center gap-2 rounded-full border px-2.5 text-xs text-muted-foreground transition-colors hover:border-input hover:text-foreground sm:flex"
            >
              <StateDot tone={dot} />
              {status.verdict}
            </Link>
          )}
          {active !== "Connect" && (
            <Button asChild size="sm" className="h-7 rounded-md px-2.5 text-xs">
              <Link href={`/${productId}/connect`}>
                <Plug className="size-3.5" />
                Connect
              </Link>
            </Button>
          )}
        </header>
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
              <div className="shrink-0 border-t border-sidebar-border p-2">
                <DropdownMenu open={railMenu} onOpenChange={setRailMenu}>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Sidebar control"
                      title="Sidebar control"
                      className="ml-[3px] text-faint"
                    >
                      <PanelLeft />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    side="top"
                    align="start"
                    sideOffset={6}
                    className="w-52"
                  >
                    <DropdownMenuLabel className="text-xs font-normal text-faint">
                      Sidebar control
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuGroup>
                      <DropdownMenuRadioGroup
                        value={mode}
                        onValueChange={(value) =>
                          setRailMode(value as RailMode)
                        }
                      >
                        {RAIL_MODES.map(([value, text]) => (
                          <DropdownMenuRadioItem key={value} value={value}>
                            {text}
                          </DropdownMenuRadioItem>
                        ))}
                      </DropdownMenuRadioGroup>
                    </DropdownMenuGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </div>
          <main
            id="main"
            className="flex min-w-0 flex-1 flex-col overflow-y-auto"
          >
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
