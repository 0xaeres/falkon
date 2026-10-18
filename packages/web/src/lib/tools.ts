import { prisma } from "@sbc/db";
import { createToolRunner } from "@sbc/shared";

export const runTool = createToolRunner({
  async listRepos({ query, page, perPage, sort, direction }) {
    return prisma.repo.findMany({
      where: query ? { name: { contains: query, mode: "insensitive" } } : undefined,
      orderBy: sort === "pushed" ? { pushedAt: direction } : { name: direction },
      skip: (page - 1) * perPage,
      take: perPage,
      select: { name: true, defaultBranch: true, status: true, pushedAt: true },
    });
  },
});
