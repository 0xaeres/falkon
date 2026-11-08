import { GitBranch } from "lucide-react";
import type { Repository } from "@falkon/contracts";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function BranchSelect({
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
