import type { ReactNode } from "react";
import Link from "next/link";
import {
  Layers,
  MessageCircle,
  Plug,
  Search,
  Settings,
  type LucideIcon,
} from "lucide-react";
import { StateDot, type Tone } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

export const PAGES = [
  { name: "Status", icon: Layers },
  { name: "Chat", icon: MessageCircle },
  { name: "Search", icon: Search },
  { name: "Connect", icon: Plug },
] as const;
export type PageName = (typeof PAGES)[number]["name"] | "Settings";

/** The rail: page links, the chat list passed in as `history`, then Settings. */
export function RailNav({
  mobile = false,
  productId,
  active,
  dot,
  history,
  onNavigate,
}: {
  mobile?: boolean;
  productId: string;
  active: PageName;
  dot: Tone;
  history: ReactNode;
  onNavigate: () => void;
}) {
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
        onClick={() => onNavigate()}
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

  return (
    <>
      <nav aria-label="Main" className="flex shrink-0 flex-col gap-0.5 p-2">
        {PAGES.map(({ name, icon }) => item(name, icon, mobile))}
      </nav>
      {history}
      <nav
        aria-label="Product"
        className="flex shrink-0 flex-col gap-0.5 border-t border-sidebar-border p-2"
      >
        {item("Settings", Settings, mobile)}
      </nav>
    </>
  );
}
