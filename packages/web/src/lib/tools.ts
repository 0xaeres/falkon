import { prisma } from "@sbc/db";
import { createToolRunner } from "@sbc/shared";
import "./repos";

export const runTool = createToolRunner({
  async listRepos({ query, sort, direction }) {
    return prisma.repo.findMany({
      where: query ? { name: { contains: query, mode: "insensitive" } } : undefined,
      orderBy: sort === "pushed" ? { pushedAt: direction } : { name: direction },
      select: { name: true, defaultBranch: true, status: true, pushedAt: true },
    });
  },
});
