import { prisma } from "@falkon/db";
import { repoPath, setRepoResolver } from "@falkon/shared";

// Git readers (read_file, list_tree, ...) find a repo's git data through its database row:
// code-host repos live under DATA_DIR/repos/<id>, file:// repos are read where they are.
setRepoResolver(async (name) => {
  const r = await prisma.repo.findUnique({ where: { name } });
  return r ? repoPath(r).path : undefined;
});

/** Search contexts as synced from config `contexts`: name -> repo names. */
export async function loadContexts(): Promise<Record<string, string[]>> {
  const rows = await prisma.searchContext.findMany({ select: { name: true, repoNames: true } });
  return Object.fromEntries(rows.map((c) => [c.name, c.repoNames]));
}
