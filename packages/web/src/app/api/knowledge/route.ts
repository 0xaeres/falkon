import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@falkon/db";
import { env, loadConfig, scopeFor } from "@falkon/shared";
import { scopeOf, unauthorized } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Knowledge base status per code repo, limited to the caller's scope. */
export async function GET(req: NextRequest) {
  const scope = scopeOf(req);
  if (!scope) return unauthorized();
  let cfg;
  try {
    cfg = (await loadConfig(env.configPath)).knowledgeBase;
  } catch {
    cfg = undefined;
  }
  const repos = (await prisma.repo.findMany({ where: { kind: "CODE" }, orderBy: { name: "asc" } })).filter((r) => scope.allows(r.name));
  const out = await Promise.all(
    repos.map(async (r) => {
      const [scan, docs] = await Promise.all([
        prisma.knowledgeScan.findFirst({ where: { repoId: r.id }, orderBy: { startedAt: "desc" } }),
        prisma.knowledgeDoc.findMany({ where: { repoId: r.id }, orderBy: { path: "asc" }, select: { path: true, title: true, summary: true, updatedAt: true } }),
      ]);
      const selected = !!cfg?.enabled && !r.kbExcluded && (cfg.repos === "all" || scopeFor(cfg.repos).allows(r.name));
      return {
        repo: r.name,
        selected,
        excluded: r.kbExcluded,
        pending: r.kbRequest,
        scannedCommit: r.kbScannedCommit,
        lastScan: scan && { id: scan.id, mode: scan.mode, status: scan.status, tokensUsed: scan.tokensUsed, docsWritten: scan.docsWritten, error: scan.error, startedAt: scan.startedAt, finishedAt: scan.finishedAt },
        docs,
      };
    }),
  );
  return NextResponse.json({ enabled: !!cfg?.enabled, repos: out });
}

const body = z.object({ repo: z.string().min(1), action: z.enum(["scan", "delete", "include"]) });

/** Ask the backend to scan, delete or re-include a repo's knowledge base. Needs unrestricted access. */
export async function POST(req: NextRequest) {
  const scope = scopeOf(req);
  if (!scope) return unauthorized();
  if (scope.repoFilter !== null) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  const r = await prisma.repo.findFirst({ where: { name: parsed.data.repo, kind: "CODE" } });
  if (!r) return NextResponse.json({ error: "repo not found" }, { status: 404 });
  await prisma.repo.update({ where: { id: r.id }, data: { kbRequest: parsed.data.action, kbRequestedAt: new Date() } });
  return NextResponse.json({ ok: true });
}
