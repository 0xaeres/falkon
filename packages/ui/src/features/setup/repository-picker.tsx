"use client";
import { useState } from "react";
import { GitBranch, Search, X } from "lucide-react";
import type { Repository } from "@falkon/contracts";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export const countLine = (
  repositories: Repository[],
  privateShown: number | null,
) =>
  `${repositories.length} ${repositories.length === 1 ? "repository" : "repositories"} visible to this token${privateShown === null ? "" : ` · ${privateShown} private`}`;
export const privateOnly = (repositories: Repository[], only: boolean) =>
  only ? repositories.filter((repo) => repo.private) : repositories;

function BranchSelect({
  repo,
  value,
  disabled,
  onChange,
}: {
  repo: Repository;
  value: string;
  disabled?: boolean;
  onChange: (branch: string) => void;
}) {
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger
        size="sm"
        aria-label={`Branch for ${repo.name}`}
        className="w-full max-w-[200px] justify-start font-mono text-xs *:data-[slot=select-value]:flex-1"
        onClick={(event) => event.stopPropagation()}
      >
        <GitBranch className="text-muted-foreground" aria-hidden="true" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent
        position="popper"
        align="start"
        aria-label={`Branches for ${repo.name}`}
      >
        <SelectGroup>
          {repo.branches.map((branch) => (
            <SelectItem
              key={branch}
              value={branch}
              className="font-mono text-xs"
            >
              {branch}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

export default function RepositoryPicker({
  repositories,
  selected,
  onChange,
}: {
  repositories: Repository[];
  selected: Record<string, string>;
  onChange: (value: Record<string, string>) => void;
}) {
  const [query, setQuery] = useState("");
  const [only, setOnly] = useState(false);
  const [organization, setOrganization] = useState(
    repositories[0]?.organization ?? "",
  );
  const organizations = [
    ...new Set(repositories.map((repo) => repo.organization)),
  ];
  const visible = privateOnly(repositories, only).filter(
    (repo) =>
      (!organization || repo.organization === organization) &&
      repo.name.toLowerCase().includes(query.toLowerCase()),
  );
  const selectedRepos = repositories.filter((repo) => selected[repo.id]);
  const allVisible =
    visible.length > 0 && visible.every((repo) => selected[repo.id]);
  const someVisible = visible.some((repo) => selected[repo.id]);
  function toggle(repo: Repository, on: boolean) {
    const next = { ...selected };
    if (on) next[repo.id] = repo.branch;
    else delete next[repo.id];
    onChange(next);
  }
  function selectAll() {
    const next = { ...selected };
    visible.forEach((repo) => {
      if (allVisible) delete next[repo.id];
      else next[repo.id] ??= repo.branch;
    });
    onChange(next);
  }
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-[0.8125rem] text-muted-foreground">
          {countLine(repositories, only ? visible.length : null)}
        </span>
        <div className="flex items-center gap-2">
          <Switch
            id="private-only"
            aria-label="Private only"
            checked={only}
            onCheckedChange={setOnly}
          />
          <Label
            htmlFor="private-only"
            className="text-[0.8125rem] font-normal text-muted-foreground"
          >
            Private only
          </Label>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,220px)_1fr]">
        <Select
          value={organization}
          onValueChange={setOrganization}
          disabled={organizations.length < 2}
        >
          <SelectTrigger
            id="organization"
            aria-label="Organization"
            className="w-full"
          >
            <SelectValue placeholder="Organization" />
          </SelectTrigger>
          <SelectContent position="popper" align="start">
            <SelectGroup>
              {organizations.map((org) => (
                <SelectItem key={org} value={org}>
                  {org}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <InputGroup>
          <InputGroupInput
            aria-label="Search repositories"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={`Search ${repositories.length} repositories`}
          />
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          {query && (
            <InputGroupAddon align="inline-end">
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Clear search"
                onClick={() => setQuery("")}
              >
                <X />
              </Button>
            </InputGroupAddon>
          )}
        </InputGroup>
      </div>
      <div className="overflow-hidden rounded-lg border">
        <div>
          <Table containerClassName="max-h-[420px] overflow-y-auto">
            <TableHeader className="sticky top-0 z-10 bg-card">
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-10 pl-3">
                  <Checkbox
                    aria-label="Select all visible repositories"
                    checked={
                      allVisible ? true : someVisible ? "indeterminate" : false
                    }
                    onCheckedChange={selectAll}
                    disabled={!visible.length}
                  />
                </TableHead>
                <TableHead>Repository</TableHead>
                <TableHead className="hidden xl:table-cell">Language</TableHead>
                <TableHead>Branch</TableHead>
                <TableHead className="hidden pr-4 text-right lg:table-cell">
                  Head
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((repo) => {
                const on = !!selected[repo.id];
                return (
                  <TableRow
                    key={repo.id}
                    data-state={on ? "selected" : undefined}
                    className="cursor-pointer"
                    onClick={(event) => {
                      if (
                        (event.target as HTMLElement).closest(
                          "button,input,label,[role=combobox]",
                        )
                      )
                        return;
                      toggle(repo, !on);
                    }}
                  >
                    <TableCell className="pl-3">
                      <Checkbox
                        id={`repository-${repo.id}`}
                        aria-label={`Select ${repo.name}`}
                        checked={on}
                        onCheckedChange={(value) =>
                          toggle(repo, value === true)
                        }
                      />
                    </TableCell>
                    <TableCell className="max-w-[300px]">
                      <label
                        htmlFor={`repository-${repo.id}`}
                        className="flex min-w-0 cursor-pointer flex-col"
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="truncate font-medium">
                            {repo.name}
                          </span>
                          {repo.private !== undefined && (
                            <Badge
                              variant="muted"
                              className="py-0 text-[0.6875rem]"
                            >
                              {repo.private ? "Private" : "Public"}
                            </Badge>
                          )}
                        </span>
                        <span className="truncate text-xs text-muted-foreground">
                          {[
                            repo.language,
                            `Updated ${relativeTime(repo.updated)}`,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </label>
                    </TableCell>
                    <TableCell className="hidden text-xs text-muted-foreground xl:table-cell">
                      {repo.language}
                    </TableCell>
                    <TableCell>
                      <BranchSelect
                        repo={repo}
                        value={selected[repo.id] ?? repo.branch}
                        disabled={!on}
                        onChange={(branch) =>
                          onChange({ ...selected, [repo.id]: branch })
                        }
                      />
                    </TableCell>
                    <TableCell className="hidden pr-4 text-right font-mono text-xs text-muted-foreground lg:table-cell">
                      {repo.revision || "—"}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {!visible.length && (
            <Empty className="border-0 py-10">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Search />
                </EmptyMedia>
                <EmptyTitle>
                  {query
                    ? `No repositories match “${query}”`
                    : "No repositories here"}
                </EmptyTitle>
                <EmptyDescription>
                  Try a different name or choose another organization.
                </EmptyDescription>
              </EmptyHeader>
              {query && (
                <EmptyContent>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setQuery("")}
                  >
                    Clear search
                  </Button>
                </EmptyContent>
              )}
            </Empty>
          )}
        </div>
        <div className="flex items-center justify-between border-t bg-card px-4 py-2.5 text-xs text-muted-foreground">
          <span>
            Showing {visible.length} of {repositories.length}
          </span>
          <span className="font-medium text-foreground">
            {selectedRepos.length} selected
          </span>
        </div>
      </div>
      <Accordion
        type="single"
        collapsible
        defaultValue="selected"
        className="rounded-lg border bg-card"
      >
        <AccordionItem value="selected" className="border-0">
          <AccordionTrigger
            disabled={!selectedRepos.length}
            className="px-4 py-3 text-[0.8125rem] hover:no-underline disabled:opacity-60"
          >
            <span className="flex items-center gap-2">
              Selected repositories
              <Badge
                variant={selectedRepos.length ? "info" : "muted"}
                className="font-mono"
              >
                {selectedRepos.length}
              </Badge>
            </span>
          </AccordionTrigger>
          <AccordionContent className="pb-0">
            <ul
              aria-label="Selected repositories"
              className="divide-y border-t"
            >
              {selectedRepos.map((repo) => (
                <li
                  key={repo.id}
                  className="flex items-center gap-3 px-4 py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[0.8125rem] font-medium">
                      {repo.name}
                    </div>
                    <div className="truncate font-mono text-[0.6875rem] text-faint">
                      {repo.organization}
                    </div>
                  </div>
                  <BranchSelect
                    repo={repo}
                    value={selected[repo.id]}
                    onChange={(branch) =>
                      onChange({ ...selected, [repo.id]: branch })
                    }
                  />
                  <span className="hidden w-16 text-right font-mono text-xs text-muted-foreground sm:block">
                    {repo.revision}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove ${repo.name}`}
                    onClick={() => toggle(repo, false)}
                  >
                    <X />
                  </Button>
                </li>
              ))}
            </ul>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}

/** Table-shaped placeholder while the code host lists repositories. */
export function RepositoryPickerSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading repositories"
      className="flex flex-col gap-4"
    >
      <div className="flex justify-between">
        <Skeleton className="h-4 w-60" />
        <Skeleton className="h-4 w-28" />
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[220px_1fr]">
        <Skeleton className="h-9" />
        <Skeleton className="h-9" />
      </div>
      <div className="overflow-hidden rounded-lg border">
        <div className="flex gap-6 border-b bg-card px-3 py-3">
          <Skeleton className="size-4" />
          <Skeleton className="h-3.5 w-24" />
        </div>
        {[72, 56, 64, 48, 60, 52].map((width, index) => (
          <div
            key={index}
            className={cn(
              "flex items-center gap-4 px-3 py-3",
              index < 5 && "border-b",
            )}
          >
            <Skeleton className="size-4" />
            <div className="flex flex-1 flex-col gap-1.5">
              <Skeleton className="h-3.5" style={{ width: `${width * 3}px` }} />
              <Skeleton className="h-3 w-24" />
            </div>
            <Skeleton className="hidden h-3.5 w-16 md:block" />
            <Skeleton className="h-8 w-32" />
            <Skeleton className="hidden h-3.5 w-14 sm:block" />
          </div>
        ))}
      </div>
    </div>
  );
}
