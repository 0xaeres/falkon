import { X } from "lucide-react";
import type { Repository } from "@falkon/contracts";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BranchSelect } from "./branch-select";

/** The chosen repositories with their branches, each removable. */
export function SelectedRepositories({
  repositories,
  selected,
  onBranch,
  onRemove,
}: {
  repositories: Repository[];
  selected: Record<string, string>;
  onBranch: (repo: Repository, branch: string) => void;
  onRemove: (repo: Repository) => void;
}) {
  return (
    <Accordion
      type="single"
      collapsible
      defaultValue="selected"
      className="rounded-lg border bg-card"
    >
      <AccordionItem value="selected" className="border-0">
        <AccordionTrigger
          disabled={!repositories.length}
          className="px-4 py-3 text-[0.8125rem] hover:no-underline disabled:opacity-60"
        >
          <span className="flex items-center gap-2">
            Selected repositories
            <Badge
              variant={repositories.length ? "info" : "muted"}
              className="font-mono"
            >
              {repositories.length}
            </Badge>
          </span>
        </AccordionTrigger>
        <AccordionContent className="pb-0">
          <ul aria-label="Selected repositories" className="divide-y border-t">
            {repositories.map((repo) => (
              <li key={repo.id} className="flex items-center gap-3 px-4 py-2.5">
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
                  onChange={(branch) => onBranch(repo, branch)}
                />
                <span className="hidden w-16 text-right font-mono text-xs text-muted-foreground sm:block">
                  {repo.revision}
                </span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove ${repo.name}`}
                  onClick={() => onRemove(repo)}
                >
                  <X />
                </Button>
              </li>
            ))}
          </ul>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
