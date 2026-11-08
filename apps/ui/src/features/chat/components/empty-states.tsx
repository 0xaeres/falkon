import Link from "next/link";
import { ConversationEmptyState } from "@/components/ai-elements/conversation";
import { Mark } from "@/components/ui/brand";
import { Button } from "@/components/ui/button";

/** What the empty conversation shows: still indexing, or an invitation to ask. */
export function EmptyStates({
  productId,
  productName,
  repositoryCount,
  indexed,
}: {
  productId: string;
  productName: string;
  repositoryCount: number;
  indexed: boolean;
}) {
  return indexed ? (
    <ConversationEmptyState className="mt-10 gap-4">
      <Mark size={36} />
      <h1 className="text-lg font-semibold tracking-[-0.015em]">
        Ask about {productName}
      </h1>
      <p className="text-[0.8125rem] text-muted-foreground">
        Answers cite exact source lines in {repositoryCount}{" "}
        {repositoryCount === 1 ? "repository" : "repositories"}.
      </p>
    </ConversationEmptyState>
  ) : (
    <ConversationEmptyState className="mt-10 gap-4">
      <Mark size={36} />
      <h1 className="text-lg font-semibold tracking-[-0.015em]">
        {productName} is still being indexed
      </h1>
      <p className="text-[0.8125rem] text-muted-foreground">
        Chat opens when the first index is ready.
      </p>
      <Button asChild variant="outline" size="sm">
        <Link href={`/${productId}/status`}>View status</Link>
      </Button>
    </ConversationEmptyState>
  );
}
