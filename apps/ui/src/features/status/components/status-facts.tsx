import type { ReactNode } from "react";
import { Boxes, BookOpenText, History, Hammer, RefreshCw } from "lucide-react";
import type { Product, Status } from "@falkon/contracts";
import { ProviderLogo } from "@/components/ui/brand";
import { StateDot, type Tone } from "@/components/ui/primitives";

const KNOWLEDGE: Record<
  NonNullable<Status["knowledge"]>["state"],
  [string, Tone]
> = {
  off: ["Off", ""],
  "no-model": ["No model", ""],
  pending: ["Waiting for first scan", ""],
  scanning: ["Scanning", "blue"],
  ready: ["Ready", "green"],
  "budget-exhausted": ["Stopped at token limit", "amber"],
  failed: ["Last scan failed", "red"],
};

/** One fact about the Product: an icon tile, a label, and a value. */
function Fact({
  icon,
  label,
  children,
  detail,
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
  detail?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-start gap-3.5 bg-card p-3.5 sm:p-4">
      <span className="hidden size-10 shrink-0 place-items-center rounded-lg border bg-secondary text-muted-foreground sm:grid [&_svg]:size-[18px]">
        {icon}
      </span>
      <div className="min-w-0">
        <div className="font-mono text-[0.6875rem] tracking-[0.06em] text-faint uppercase">
          {label}
        </div>
        <div className="mt-1 flex min-w-0 items-center gap-2 text-sm font-medium sm:text-[0.9375rem]">
          {children}
        </div>
        {detail && (
          <div className="mt-0.5 truncate text-xs text-muted-foreground">
            {detail}
          </div>
        )}
      </div>
    </div>
  );
}

/** The six fact tiles beside the shortcuts. */
export function StatusFacts({
  product,
  status,
  age,
  building,
  indexed,
  failed,
}: {
  product: Product;
  status: Status;
  age: string | null;
  building: boolean;
  indexed: number;
  failed: number;
}) {
  const [kbLabel, kbTone]: [string, Tone] = status.knowledge
    ? KNOWLEDGE[status.knowledge.state]
    : ["Not reported", ""];
  return (
    <section aria-label="Product facts" className="col-span-12 lg:col-span-8">
      <div className="grid h-full grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border xl:grid-cols-3">
        <Fact
          icon={<History />}
          label="Last indexed"
          detail={building ? "Next index building" : "Latest published index"}
        >
          {age ?? "Not yet"}
        </Fact>
        <Fact
          icon={<Boxes />}
          label="Repositories"
          detail={
            failed
              ? `${failed} failed`
              : `${product.repositories.length} in this Product`
          }
        >
          <span className="tabular-nums">
            {indexed}
            <span className="text-muted-foreground">
              {" "}
              / {product.repositories.length}
            </span>
          </span>
          <span className="text-[0.8125rem] font-normal text-muted-foreground">
            indexed
          </span>
        </Fact>
        <Fact
          icon={
            <ProviderLogo
              provider={product.provider}
              size={16}
              className="p-[3px]"
            />
          }
          label="Code host"
          detail={
            product.provider === "git"
              ? "Git remotes"
              : product.provider === "github"
                ? "GitHub"
                : "GitHub Enterprise"
          }
        >
          <span className="truncate">{product.host}</span>
        </Fact>
        <Fact
          icon={<RefreshCw />}
          label="Sync"
          detail={
            status.nextGeneration
              ? "Next index building"
              : status.sync === "pinned"
                ? "Revisions pinned"
                : "Following branch heads"
          }
        >
          <StateDot
            tone={
              status.sync === "failed"
                ? "red"
                : status.sync === "pinned"
                  ? ""
                  : "green"
            }
          />
          {status.sync === "failed"
            ? "Failed"
            : status.sync === "pinned"
              ? "Pinned"
              : "Current"}
        </Fact>
        <Fact
          icon={<Hammer />}
          label="Build"
          detail={
            building ? `${Math.round(status.progress)}% complete` : undefined
          }
        >
          <StateDot
            tone={building ? "blue" : status.build === "failed" ? "red" : ""}
          />
          {building
            ? "Building"
            : status.build === "failed"
              ? "Failed"
              : "Idle"}
        </Fact>
        <Fact
          icon={<BookOpenText />}
          label="Knowledge base"
          detail={status.knowledge?.detail}
        >
          <StateDot tone={kbTone} />
          {kbLabel}
        </Fact>
      </div>
    </section>
  );
}
