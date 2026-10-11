import { body, endpoint } from "@/lib/api/server";
import { setupRequestSchema } from "@/lib/contracts";
import { repositories } from "@/lib/mock/fixtures";
import { MockError, transact } from "@/lib/mock/store";

export async function GET() {
  return endpoint(() => transact((db) => db.products));
}
export async function POST(request: Request) {
  return endpoint(async () => {
    const input = await body(request, setupRequestSchema);
    return transact((db) => {
      if (db.products.some((product) => product.id === input.id))
        throw new MockError(
          "This productId is already in use. Choose another name.",
          409,
        );
      const selected = input.repositories.map((choice) => {
        const repo = repositories.find((item) => item.id === choice.id);
        if (!repo || !repo.branches.includes(choice.branch))
          throw new MockError("Choose a valid repository and branch.");
        return { ...repo, branch: choice.branch };
      });
      if (new Set(selected.map((repo) => repo.id)).size !== selected.length)
        throw new MockError("Repositories must be unique.");
      const product = {
        id: input.id,
        name: input.name,
        initials: input.name
          .split(/\s+/)
          .map((word) => word[0])
          .join("")
          .slice(0, 2)
          .toUpperCase(),
        provider: input.provider,
        host: input.host,
        repositories: selected,
        activeGeneration: null,
        scenario: "building" as const,
        queuedAt: Date.now(),
        dismissed: false,
      };
      db.products.push(product);
      return product;
    }, true);
  });
}
