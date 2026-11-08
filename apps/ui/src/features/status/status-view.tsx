"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ChevronRight,
  MessageCircle,
  Plug,
  RefreshCw,
  Search,
} from "lucide-react";
import { useWorkspace } from "@/components/layout/workspace-shell";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import {
  ErrorState,
  Notice,
  Page,
  StateDot,
  type Tone,
} from "@/components/ui/primitives";
import type { Status } from "@falkon/contracts";
import { api } from "@/lib/api/client";
import { generationAge } from "@/lib/format";
import { useMinute } from "./use-minute";
import { repoState } from "./repo-state";
import { RepositoryTable } from "./components/repository-table";
import { StatusFacts } from "./components/status-facts";
import { StatusSkeleton } from "./components/status-skeleton";

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

/** `initialStatus` is the server's first-HTML answer; the workspace's live status (SWR, then the event stream) wins once it exists. */
export function StatusView({ initialStatus }: { initialStatus?: Status }) {
  const {
    product,
    status: live,
    statusError,
    refreshStatus,
    refresh,
  } = useWorkspace();
  const status = live ?? initialStatus;
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  useMinute(); // re-renders each minute; the age itself reads the real clock
  if (statusError && !live)
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

      <StatusFacts
        product={product}
        status={status}
        age={age}
        building={building}
        indexed={indexed}
        failed={failed}
      />

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

      <RepositoryTable product={product} states={states} />
    </Page>
  );
}
