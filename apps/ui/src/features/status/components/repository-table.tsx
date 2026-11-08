import Link from "next/link";
import { ArrowUpRight, GitBranch } from "lucide-react";
import type { Product } from "@falkon/contracts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StateDot } from "@/components/ui/primitives";
import { relativeTime } from "@/lib/format";
import type { repoState } from "../repo-state";

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

/** Every repository of the Product with its branch, revision, language and index state. */
export function RepositoryTable({
  product,
  states,
}: {
  product: Product;
  states: ReturnType<typeof repoState>[];
}) {
  return (
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
  );
}
