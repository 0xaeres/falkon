import type { Repository, Status } from "@falkon/contracts";

type Shown = { label: string; tone: "green" | "red" | "blue" | "" };

/** The state shown for one repository: the engine's `state` when sent, else derived (named in a gap = Failed, has a revision = Indexed). */
export function repoState(repo: Repository, status: Status): Shown {
  switch (repo.state) {
    case "pending":
      return { label: "Pending", tone: "" };
    case "indexing":
      return { label: "Indexing", tone: "blue" };
    case "indexed":
      return { label: "Indexed", tone: "green" };
    case "failed":
      return { label: "Failed", tone: "red" };
    case "skipped":
      return { label: "Skipped", tone: "" };
  }
  if (status.gaps.some((gap) => gap.detail === repo.id))
    return { label: "Failed", tone: "red" };
  return repo.revision
    ? { label: "Indexed", tone: "green" }
    : { label: "Pending", tone: "" };
}
