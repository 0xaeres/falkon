import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, ChevronsUpDown, Menu, Plug, Plus } from "lucide-react";
import type { Product, Status } from "@falkon/contracts";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { StateDot, type Tone } from "@/components/ui/primitives";
import { Mark } from "@/components/ui/brand";
import type { PageName } from "./rail-nav";

/** The colour of a Product's state, wherever the Product is named. */
const scenarioTone = (scenario: Product["scenario"]): Tone =>
  scenario === "current"
    ? "green"
    : scenario === "updating" || scenario === "building"
      ? "blue"
      : scenario === "failed"
        ? "red"
        : "amber";

/** The top bar: Product switcher, current page, status chip and the Connect shortcut. */
export function WorkspaceHeader({
  productId,
  product,
  products,
  active,
  status,
  dot,
  onOpenNavigation,
}: {
  productId: string;
  product: Product;
  products?: Product[];
  active: PageName;
  status?: Status;
  dot: Tone;
  onOpenNavigation: () => void;
}) {
  const router = useRouter();
  return (
    <header className="flex h-12 shrink-0 items-center gap-1 border-b bg-sidebar pr-3 md:gap-2 md:pr-4">
      <Button
        variant="ghost"
        size="icon"
        className="ml-1.5 md:hidden"
        aria-label="Open navigation"
        onClick={() => onOpenNavigation()}
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
  );
}
