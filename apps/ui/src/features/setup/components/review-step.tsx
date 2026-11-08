import { GitBranch } from "lucide-react";
import { ProviderLogo } from "@/components/ui/brand";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import type { Provider, Repository } from "@falkon/contracts";

export function ReviewStep({
  name,
  id,
  provider,
  providerName,
  connectionHost,
  picked,
  selected,
}: {
  name: string;
  id: string;
  provider: Provider;
  providerName?: string;
  connectionHost?: string;
  picked: Repository[];
  selected: Record<string, string>;
}) {
  return (
    <div className="flex flex-col gap-5">
      <dl className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-2">
        <div className="bg-card px-4 py-3">
          <dt className="text-xs text-muted-foreground">Product</dt>
          <dd className="mt-1 flex items-baseline gap-2">
            <strong className="font-medium">{name}</strong>
            <span className="font-mono text-xs text-faint">{id}</span>
          </dd>
        </div>
        <div className="bg-card px-4 py-3">
          <dt className="text-xs text-muted-foreground">Code host</dt>
          <dd className="mt-1 flex items-center gap-2 text-[0.8125rem]">
            <ProviderLogo provider={provider} size={12} className="p-1" />
            {providerName} · {connectionHost}
          </dd>
        </div>
      </dl>
      <div>
        <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
          Repositories
          <Badge variant="muted" className="font-mono">
            {picked.length}
          </Badge>
        </div>
        <ul className="divide-y overflow-hidden rounded-lg border">
          {picked.map((repo) => (
            <li
              key={repo.id}
              className="flex items-center gap-3 bg-card px-4 py-2.5"
            >
              <span className="min-w-0 flex-1 truncate text-[0.8125rem] font-medium">
                {repo.name}
              </span>
              <span className="inline-flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
                <GitBranch className="size-3.5" aria-hidden="true" />
                {selected[repo.id]}
              </span>
              <Separator orientation="vertical" className="h-3.5" />
              <span className="font-mono text-xs text-faint">
                {repo.revision}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
