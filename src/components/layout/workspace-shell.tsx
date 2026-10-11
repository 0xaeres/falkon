"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import useSWR, { useSWRConfig } from "swr";
import * as Dialog from "@radix-ui/react-dialog";
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import {
  Check,
  ChevronDown,
  FileText,
  Layers,
  Menu,
  MessageCircle,
  PanelRight,
  Plus,
  Settings,
  X,
} from "lucide-react";
import { api, keys } from "@/lib/api/client";
import type { Product, Status, ThreadSummary } from "@/lib/contracts";
import { Logo } from "../ui/brand";
import { ErrorState, Skeleton } from "../ui/primitives";

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
const subscribe = (listener: () => void) => {
  window.addEventListener("storage", listener);
  window.addEventListener("sidebar-change", listener);
  return () => {
    window.removeEventListener("storage", listener);
    window.removeEventListener("sidebar-change", listener);
  };
};
function sidebarPreference() {
  try {
    return localStorage.getItem("falkon.sidebar") ?? "auto";
  } catch {
    return "auto";
  }
}
const serverPreference = () => "auto";

export function WorkspaceShell({
  productId,
  children,
}: {
  productId: string;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { mutate } = useSWRConfig();
  const {
    data: product,
    error,
    mutate: refreshProduct,
  } = useSWR(keys.product(productId), api.product);
  const { data: products } = useSWR(keys.products, api.products);
  const {
    data: status,
    error: statusError,
    mutate: refreshStatus,
  } = useSWR(keys.status(productId), api.status, {
    refreshInterval: (data) => (data?.scenario === "building" ? 2000 : 30000),
  });
  const { data: threads } = useSWR(keys.threads(productId), api.threads);
  const mode = useSyncExternalStore(
    subscribe,
    sidebarPreference,
    serverPreference,
  );
  const [drawer, setDrawer] = useState(false);
  const [creating, setCreating] = useState(false);
  const [actionError, setActionError] = useState("");
  const active = pathname.includes("/chat")
    ? "Chat"
    : pathname.endsWith("/settings")
      ? "Settings"
      : "Status";
  function toggleSidebar() {
    const collapsed =
      mode === "collapsed" || (mode === "auto" && window.innerWidth < 1280);
    try {
      localStorage.setItem(
        "falkon.sidebar",
        collapsed ? "expanded" : "collapsed",
      );
    } catch {
      /* The control still works in storage-enabled browsers. */
    }
    window.dispatchEvent(new Event("sidebar-change"));
  }
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        event.key === "[" &&
        target instanceof HTMLElement &&
        !target.closest("input,textarea,select,[contenteditable=true]") &&
        !event.metaKey &&
        !event.ctrlKey
      ) {
        event.preventDefault();
        toggleSidebar();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
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
  if (!product) return <Skeleton />;
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
  const dot =
    status?.sync === "failed" || status?.verdict === "Behind"
      ? "amber"
      : status?.build === "building"
        ? "blue"
        : "green";
  const avatar = <span className="avatar">SS</span>;
  const navigation = (mobile = false) => (
    <nav
      className={`side ${mobile ? "mobile-side" : ""}`}
      data-mode={mobile ? "expanded" : mode}
      aria-label="Main"
    >
      <div className="sidebar-heading">
        <Link
          className="sidebar-brand"
          href={`/${productId}/status`}
          aria-label="Falkon status"
        >
          <Logo />
        </Link>
        {mobile ? (
          <Dialog.Close className="icon-btn" aria-label="Close navigation">
            <X size={16} />
          </Dialog.Close>
        ) : (
          <button
            className="icon-btn sidebar-toggle"
            onClick={toggleSidebar}
            aria-label="Toggle sidebar"
            title="Toggle sidebar ([)"
          >
            <PanelRight size={16} />
          </button>
        )}
      </div>
      <Dropdown.Root>
        <Dropdown.Trigger className="pswitch" aria-label="Switch Product">
          <span className={`pav product-${product.id}`}>
            {product.initials}
          </span>
          <span className="pn">{product.name}</span>
          <ChevronDown size={14} className="hide-collapsed" />
        </Dropdown.Trigger>
        <Dropdown.Portal>
          <Dropdown.Content
            className="product-menu"
            side="bottom"
            align="start"
            sideOffset={6}
          >
            <Dropdown.Label className="dropdown-label">Products</Dropdown.Label>
            {products?.map((item) => (
              <Dropdown.Item
                key={item.id}
                className="product-item"
                onSelect={() => {
                  setDrawer(false);
                  router.push(`/${item.id}/${active.toLowerCase()}`);
                }}
              >
                <span className={`pav product-${item.id}`}>
                  {item.initials}
                </span>
                <span className="product-menu-name">{item.name}</span>
                <span
                  className={`pdot ${item.scenario === "current" ? "green" : item.scenario === "updating" ? "blue" : "amber"}`}
                />
                {item.id === productId && <Check size={14} />}
              </Dropdown.Item>
            ))}
            <Dropdown.Separator className="menu-separator" />
            <Dropdown.Item asChild>
              <Link
                className="product-item"
                href="/setup"
                onClick={() => setDrawer(false)}
              >
                <Plus size={16} />
                New Product
              </Link>
            </Dropdown.Item>
          </Dropdown.Content>
        </Dropdown.Portal>
      </Dropdown.Root>
      <div className="nvl">
        {[
          { name: "Status", icon: Layers },
          { name: "Chat", icon: MessageCircle },
          { name: "Settings", icon: Settings },
        ].map(({ name, icon: Icon }) => (
          <Link
            key={name}
            className={`nv ${active === name ? "on" : ""}`}
            href={`/${productId}/${name.toLowerCase()}`}
            aria-current={active === name ? "page" : undefined}
            aria-label={name}
            title={name}
            onClick={() => setDrawer(false)}
          >
            <Icon size={17} />
            <span className="lb">{name}</span>
            {name === "Status" && <span className={`pdot ${dot}`} />}
          </Link>
        ))}
      </div>
      {active === "Chat" ? (
        <>
          <div className="sthreads">
            <div className="sth">
              <span>Threads</span>
              <button
                className="icon-btn"
                onClick={() => void newThread()}
                aria-label="New thread"
                disabled={creating}
              >
                <Plus size={16} />
              </button>
            </div>
            {["Today", "Yesterday", "Previous"].map((day, group) => {
              const items = (threads ?? []).filter((thread) => {
                const elapsed = Date.now() - thread.updatedAt;
                return group === 0
                  ? elapsed < 86400000
                  : group === 1
                    ? elapsed >= 86400000 && elapsed < 172800000
                    : elapsed >= 172800000;
              });
              return (
                items.length > 0 && (
                  <div key={day}>
                    <div className="grp">{day}</div>
                    {items.map((thread) => (
                      <Link
                        key={thread.id}
                        href={`/${productId}/chat/${thread.id}`}
                        className={`thread-item ${pathname.endsWith(`/${thread.id}`) ? "on" : ""}`}
                        onClick={() => setDrawer(false)}
                      >
                        {thread.title}
                      </Link>
                    ))}
                  </div>
                )
              );
            })}
          </div>
          <button
            className="nv collapsed-new"
            onClick={() => void newThread()}
            aria-label="New thread"
            title="New thread"
            disabled={creating}
          >
            <Plus size={17} />
          </button>
        </>
      ) : (
        <div className="sidebar-space" />
      )}
      {actionError && (
        <p className="sidebar-error" role="alert">
          {actionError}
        </p>
      )}
      <div className="sfoot">
        <Link className="nv" href="/docs" aria-label="Docs" title="Docs">
          <FileText size={17} />
          <span className="lb">Docs</span>
        </Link>
        <Dropdown.Root>
          <Dropdown.Trigger className="nv" aria-label="Account">
            {avatar}
            <span className="lb">Account</span>
          </Dropdown.Trigger>
          <Dropdown.Portal>
            <Dropdown.Content
              className="product-menu account-menu"
              side="top"
              align="start"
            >
              <Dropdown.Label className="dropdown-label">
                Local demo account
              </Dropdown.Label>
              <p>
                All Products and source evidence are synthetic. No identity
                provider is connected.
              </p>
            </Dropdown.Content>
          </Dropdown.Portal>
        </Dropdown.Root>
      </div>
    </nav>
  );
  return (
    <WorkspaceContext.Provider value={context}>
      <div className="shell">
        <div className="desktop-sidebar">{navigation()}</div>
        <Dialog.Root open={drawer} onOpenChange={setDrawer}>
          <header className="mobile-top">
            <Dialog.Trigger className="icon-btn" aria-label="Open navigation">
              <Menu size={18} />
            </Dialog.Trigger>
            <span>{active}</span>
            <span className="sp" />
            <span className="pav">{product.initials}</span>
          </header>
          <Dialog.Portal>
            <Dialog.Overlay className="drawer-overlay" />
            <Dialog.Content className="drawer">
              <Dialog.Title className="sr-only">
                Product navigation
              </Dialog.Title>
              <Dialog.Description className="sr-only">
                Switch Product, view status, or open a chat thread.
              </Dialog.Description>
              {navigation(true)}
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
        <main id="main" className="main">
          {children}
        </main>
      </div>
    </WorkspaceContext.Provider>
  );
}
