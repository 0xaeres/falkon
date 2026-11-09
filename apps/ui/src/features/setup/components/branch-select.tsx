"use client";
import { useState } from "react";
import { GitBranch } from "lucide-react";
import useSWR from "swr";
import type { Repository } from "@falkon/contracts";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api, keys } from "@/lib/api/client";

type Branches = { branches: string[]; truncated: boolean };
// A branch name cannot contain a space, so this value never collides with one.
const RETRY = " retry";

/** The SWR key: null until the dropdown has been opened once, so closed dropdowns make no request. */
export const branchKey = (
  asked: boolean,
  connectionId: string,
  repo: Pick<Repository, "organization" | "name">,
) => (asked ? keys.branches(connectionId, repo.organization, repo.name) : null);

/**
 * What the open list shows, in order: the host's branches (default first) with the current value always
 * present (while loading, on failure, and if it vanished), then at most one status line.
 */
export function branchRows({
  value,
  data,
  error,
  asked,
}: {
  value: string;
  data?: Branches;
  error?: unknown;
  asked: boolean;
}) {
  return {
    branches: [...new Set([...(data?.branches ?? []), value])],
    loading: asked && !data && !error,
    retry: !!error,
    cut: data?.truncated
      ? `List cut at ${data.branches.length} branches`
      : null,
  };
}

export function BranchSelect({
  connectionId,
  repo,
  value,
  disabled,
  onChange,
}: {
  connectionId: string;
  repo: Repository;
  value: string;
  disabled?: boolean;
  onChange: (branch: string) => void;
}) {
  // Asked on the first open and kept for the page: SWR caches the list per repository.
  const [asked, setAsked] = useState(false);
  const { data, error, mutate } = useSWR(
    branchKey(asked, connectionId, repo),
    api.branches,
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );
  const rows = branchRows({ value, data, error, asked });
  return (
    <Select
      value={value}
      onValueChange={(branch) =>
        branch === RETRY ? void mutate() : onChange(branch)
      }
      onOpenChange={(open) => open && setAsked(true)}
      disabled={disabled}
    >
      <SelectTrigger
        size="sm"
        aria-label={`Branch for ${repo.name}`}
        className="w-full max-w-[200px] justify-start font-mono text-xs *:data-[slot=select-value]:flex-1"
        onClick={(event) => event.stopPropagation()}
      >
        <GitBranch className="text-muted-foreground" aria-hidden="true" />
        <SelectValue>{value}</SelectValue>
      </SelectTrigger>
      <SelectContent
        position="popper"
        align="start"
        aria-label={`Branches for ${repo.name}`}
      >
        <SelectGroup>
          {rows.branches.map((branch) => (
            <SelectItem
              key={branch}
              value={branch}
              className="font-mono text-xs"
            >
              {branch}
            </SelectItem>
          ))}
          {rows.loading && <SelectLabel>Loading branches…</SelectLabel>}
          {rows.retry && (
            <SelectItem value={RETRY} className="text-xs">
              Could not load branches. Retry
            </SelectItem>
          )}
          {rows.cut && <SelectLabel>{rows.cut}</SelectLabel>}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
