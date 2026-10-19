import { body, endpoint, type ProductRoute } from "@/lib/api/server";
import { setupRequestSchema } from "@/lib/contracts";
import { makeStatus, repositories } from "@/lib/mock/fixtures";
import { findProduct, MockError, transact } from "@/lib/mock/store";
export async function GET(_request: Request, context: ProductRoute) {
  const { productId } = await context.params;
  return endpoint(() => transact((db) => findProduct(db, productId)));
}
export async function PATCH(request: Request, context: ProductRoute) {
  const { productId } = await context.params;
  return endpoint(async () => {
    const input = await body(request, setupRequestSchema);
    if (input.id !== productId)
      throw new MockError("Product identity cannot be changed.");
    return transact((db) => {
      const product = findProduct(db, productId);
      const selected = input.repositories.map((choice) => {
        const repo = [...product.repositories, ...repositories].find(
          (item) => item.id === choice.id,
        );
        if (!repo || !repo.branches.includes(choice.branch))
          throw new MockError("Choose a valid repository and branch.");
        return { ...repo, branch: choice.branch };
      });
      if (new Set(selected.map((repo) => repo.id)).size !== selected.length)
        throw new MockError("Repositories must be unique.");
      const activeGeneration = makeStatus(product).generation;
      Object.assign(product, {
        repositories: selected,
        activeGeneration,
        scenario: activeGeneration ? "updating" : "building",
        queuedAt: Date.now(),
        dismissed: false,
      });
      return product;
    }, true);
  });
}
