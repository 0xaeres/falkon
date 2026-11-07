// Upserts a Product row straight into Postgres, for the eval and smoke stacks (Products otherwise come only from /setup).
// Run inside a stack's backend container: pnpm --filter @falkon/backend exec tsx ../../scripts/seed-product.ts <slug> <name> <include glob>...
// repoNames stays empty on insert and untouched on update: the backend re-resolves it from `definition` after each sync.
import { prisma } from "../packages/db/src/index";

const [slug, name, ...include] = process.argv.slice(2);
if (!slug || !name || include.length === 0) throw new Error("Usage: seed-product.ts <slug> <name> <include glob>...");
const definition = { include };
(async () => {
  await prisma.product.upsert({ where: { slug }, create: { slug, name, definition, repoNames: [] }, update: { name, definition } });
  await prisma.$disconnect();
})();
