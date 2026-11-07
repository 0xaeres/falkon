"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  BookOpenText,
  Boxes,
  ChevronRight,
  GitBranch,
  History,
  Hammer,
  MessageCircle,
  Plug,
  RefreshCw,
  Search,
} from "lucide-react";
import type { Status } from "@falkon/contracts";
import { useWorkspace } from "@/components/layout/workspace-shell";
import { ProviderLogo } from "@/components/ui/brand";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ErrorState,
  Notice,
  Page,
  StateDot,
  type Tone,
} from "@/components/ui/primitives";
import { api } from "@/lib/api/client";
import { generationAge, relativeTime } from "@/lib/format";
import { useMinute } from "@/lib/use-minute";
import { repoState } from "./repo-state";

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
const LANGUAGE: Record<string, string> = {
  typescript: "#3178c6",
  javascript: "#f1e05a",
  java: "#b07219",
  go: "#00add8",
  python: "#3572a5",
  rust: "#dea584",
  hcl: "#844fba",
  kotlin: "#a97bff",
  ruby: "#701516",
};
export const badgeTone = {
  green: "success",
  blue: "info",
  amber: "warning",
  red: "danger",
  "": "muted",
} as const;

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

const SHORTCUTS = [
  {
    page: "chat",
    icon: MessageCircle,
    title: "Ask a question",
    text: "Grounded answers that cite exact source lines",
  },
  {
    page: "search",
    icon: Search,
    title: "Search code",
    text: "Regex and symbol search across every repository",
  },
  {
    page: "connect",
    icon: Plug,
    title: "Connect an agent",
    text: "Claude Code, Codex, or Copilot over MCP",
  },
] as const;

export function StatusView() {
  const { product, status, statusError, refreshStatus, refresh } =
    useWorkspace();
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  useMinute(); // re-renders each minute; the age itself reads the real clock
  if (statusError)
    return (
      <ErrorState error={statusError} retry={() => void refreshStatus()} />
    );
  if (!status) return <StatusSkeleton />;
  const age =
    status.generation && status.generationAt !== null
      ? generationAge(status.generationAt)
      : null;
  const building = status.build === "building";
  const states = product.repositories.map((repo) => repoState(repo, status));
  const indexed = states.filter((state) => state.label === "Indexed").length;
  const failed = states.filter((state) => state.label === "Failed").length;
  const verdictTone: Tone =
    status.scenario === "current"
      ? "green"
      : building || status.scenario === "updating"
        ? "blue"
        : status.scenario === "failed"
          ? "red"
          : "amber";
  const [kbLabel, kbTone]: [string, Tone] = status.knowledge
    ? KNOWLEDGE[status.knowledge.state]
    : ["Not reported", ""];
  async function syncNow() {
    setBusy(true);
    setActionError("");
    try {
      await api.sync(product.id, { action: "retry" });
      await refresh();
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : "The sync could not be started. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Page>
      <div className="col-span-12 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <StateDot tone={verdictTone} className="size-2" />
            <h1 className="text-2xl leading-tight font-semibold tracking-[-0.02em]">
              {status.verdict}
            </h1>
          </div>
          <p className="mt-1.5 text-[0.8125rem] text-muted-foreground">
            {status.generation
              ? `Answers use the index${age ? ` published ${age}` : ""}, across ${product.repositories.length} ${product.repositories.length === 1 ? "repository" : "repositories"}.`
              : "No index is published yet. Chat opens when the first one is ready."}
          </p>
        </div>
        <Button
          disabled={busy}
          aria-busy={busy || undefined}
          onClick={() => void syncNow()}
        >
          {busy ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <RefreshCw data-icon="inline-start" />
          )}
          Sync now
        </Button>
      </div>

      {building && (
        <div className="col-span-12 flex items-center gap-4 rounded-xl border border-info/25 bg-info/[0.06] px-4 py-3">
          <span className="text-[0.8125rem] font-medium whitespace-nowrap">
            Indexing
          </span>
          <Progress
            value={status.progress}
            aria-label="Build progress"
            className="h-1.5 flex-1 bg-info/15 [&>div]:bg-info"
          />
          <span className="font-mono text-xs text-muted-foreground tabular-nums">
            {Math.round(status.progress)}%
          </span>
        </div>
      )}
      {actionError && (
        <Notice tone="err" className="col-span-12">
          {actionError}
        </Notice>
      )}

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

      <Card className="col-span-12 lg:col-span-4">
        <CardHeader className="border-b pb-3">
          <CardTitle>Use {product.name}</CardTitle>
        </CardHeader>
        <div className="flex flex-1 flex-col divide-y">
          {SHORTCUTS.map(({ page, icon: Icon, title, text }) => (
            <Link
              key={page}
              href={`/${product.id}/${page}`}
              className="group flex flex-1 items-center gap-3 px-5 py-3.5 transition-colors hover:bg-accent/50"
            >
              <Icon className="size-4 shrink-0 text-muted-foreground group-hover:text-foreground" />
              <span className="min-w-0 flex-1">
                <span className="block text-[0.8125rem] font-medium">
                  {title}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {text}
                </span>
              </span>
              <ChevronRight className="size-4 text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
            </Link>
          ))}
        </div>
      </Card>

      {status.gaps.length > 0 && (
        <Card className="col-span-12 border-warning/25">
          <CardHeader className="border-b pb-3">
            <CardTitle>
              <h2>Gaps</h2>
            </CardTitle>
            <CardDescription>
              What the current index could not cover.
            </CardDescription>
          </CardHeader>
          <div className="divide-y">
            {status.gaps.map((gap) => (
              <div
                className="flex items-start gap-4 px-5 py-3"
                key={`${gap.title}:${gap.detail}`}
              >
                <span className="min-w-7 rounded-md border border-warning/25 bg-warning/10 px-1.5 py-0.5 text-center font-mono text-xs text-warning tabular-nums">
                  {gap.count}
                </span>
                <div className="min-w-0">
                  <div className="text-[0.8125rem] font-medium">
                    {gap.title}
                  </div>
                  <div className="truncate font-mono text-xs text-muted-foreground">
                    {gap.detail}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card className="col-span-12">
        <CardHeader className="border-b pb-3">
          <CardTitle>
            <h2>Repositories</h2>
          </CardTitle>
          <CardDescription>
            Each is read at the head of its branch.
          </CardDescription>
          <CardAction>
            <Button asChild variant="ghost" size="sm">
              <Link href={`/${product.id}/settings`}>
                Manage
                <ArrowUpRight />
              </Link>
            </Button>
          </CardAction>
        </CardHeader>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="pl-5">Repository</TableHead>
              <TableHead>Branch</TableHead>
              <TableHead className="hidden md:table-cell">Revision</TableHead>
              <TableHead className="hidden lg:table-cell">Language</TableHead>
              <TableHead className="hidden lg:table-cell">Updated</TableHead>
              <TableHead className="pr-5 text-right">State</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {product.repositories.map((repo, index) => {
              const state = states[index];
              return (
                <TableRow key={repo.id}>
                  <TableCell className="max-w-[280px] pl-5" title={repo.id}>
                    <div className="truncate font-medium">{repo.name}</div>
                    <div className="truncate font-mono text-[0.6875rem] text-faint">
                      {repo.organization}
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="inline-flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
                      <GitBranch className="size-3.5" aria-hidden="true" />
                      {repo.branch}
                    </span>
                  </TableCell>
                  <TableCell className="hidden font-mono text-xs text-muted-foreground md:table-cell">
                    {repo.revision || "—"}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">
                    {repo.language ? (
                      <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                        <span
                          className="size-2 rounded-full"
                          style={{
                            background:
                              LANGUAGE[repo.language.toLowerCase()] ??
                              "var(--faint)",
                          }}
                          aria-hidden="true"
                        />
                        {repo.language}
                      </span>
                    ) : (
                      <span className="text-xs text-faint">—</span>
                    )}
                  </TableCell>
                  <TableCell className="hidden text-xs text-muted-foreground lg:table-cell">
                    {relativeTime(repo.updated)}
                  </TableCell>
                  <TableCell className="pr-5 text-right">
                    <Badge variant={badgeTone[state.tone]}>
                      <StateDot tone={state.tone} className="shadow-none" />
                      {state.label}
                    </Badge>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>
    </Page>
  );
}

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
