// Test helper: the Prisma surface ConnectionService, UiProductService and ThreadService use (product, repo, connection, credential, chat), in memory.
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@falkon/db";
import { fakeProductTable } from "../../backend/src/productTable.fake";

type Row = Record<string, any>;
type Where = Record<string, any>;

function matches(row: Row, where: Where = {}): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (k === "OR") return (v as Where[]).some((w) => matches(row, w));
    const value = row[k];
    if (v && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return v.in.includes(value);
      if ("notIn" in v) return !v.notIn.includes(value);
      if ("not" in v) return value !== v.not;
    }
    return v instanceof Date ? value instanceof Date && value.getTime() === v.getTime() : value === v;
  });
}

export function fakeEngineDb() {
  const credentials: Row[] = [];
  const connections: Row[] = [];
  const repos: Row[] = [];
  const chats: Row[] = [];
  const scans: Row[] = [];
  let nextConnection = 1;
  let nextRepo = 1;
  const product = fakeProductTable();
  const withCredential = (c: Row) => ({ ...structuredClone({ ...c, credential: undefined }), repos: c.repos ?? [], credential: credentials.find((k) => k.id === c.credentialId) ?? null });

  const db = {
    product,
    credentials,
    connections,
    repos,
    chats,
    scans,
    knowledgeScan: {
      async groupBy({ where }: { where?: Where }) {
        const max = new Map<number, Date>();
        for (const x of scans.filter((x) => matches(x, where))) if (!max.has(x.repoId) || x.startedAt > max.get(x.repoId)!) max.set(x.repoId, x.startedAt);
        return [...max].map(([repoId, startedAt]) => ({ repoId, _max: { startedAt } }));
      },
      async findMany({ where }: { where: { OR: { repoId: number; startedAt: Date }[] } }) {
        return scans.filter((x) => where.OR.some((o) => o.repoId === x.repoId && o.startedAt.getTime() === x.startedAt.getTime())).sort((a, b) => b.id - a.id);
      },
    },
    credential: {
      async update({ where, data }: { where: Row; data: Row }) {
        return Object.assign(credentials.find((k) => k.id === where.id)!, data);
      },
      async delete({ where }: { where: Row }) {
        credentials.splice(credentials.findIndex((k) => k.id === where.id), 1);
      },
    },
    connection: {
      async create({ data }: { data: Row }) {
        const { credential, ...rest } = data;
        credentials.push({ createdAt: new Date(), rotatedAt: null, lastCheckedAt: null, ...credential.create });
        const row = { id: nextConnection++, createdAt: new Date(), syncError: null, syncedAt: null, syncRequestedAt: null, ...rest, credentialId: credential.create.id };
        connections.push(row);
        return withCredential(row);
      },
      async findMany(args: { where?: Where } = {}) {
        return connections.filter((c) => matches(c, args.where)).map(withCredential);
      },
      async findFirst({ where }: { where: Where }) {
        const c = connections.find((row) => matches(row, where));
        return c ? withCredential(c) : null;
      },
      async findUnique({ where }: { where: Where }) {
        const c = connections.find((row) => matches(row, where));
        return c ? withCredential(c) : null;
      },
      async findUniqueOrThrow({ where }: { where: Where }) {
        const c = await db.connection.findUnique({ where });
        if (!c) throw new Error("not found");
        return c;
      },
      async update({ where, data }: { where: Where; data: Row }) {
        const c = connections.find((row) => matches(row, where))!;
        Object.assign(c, structuredClone(data));
        return withCredential(c);
      },
      async updateMany({ where, data }: { where: Where; data: Row }) {
        const hit = connections.filter((c) => matches(c, where));
        for (const c of hit) Object.assign(c, structuredClone(data));
        return { count: hit.length };
      },
      async delete({ where }: { where: Where }) {
        connections.splice(connections.findIndex((c) => matches(c, where)), 1);
      },
    },
    repo: {
      async findMany(args: { where?: Where } = {}) {
        return repos.filter((r) => matches(r, args.where)).map((r) => structuredClone(r));
      },
      async updateMany({ where, data }: { where: Where; data: Row }) {
        const hit = repos.filter((r) => matches(r, where));
        for (const r of hit) Object.assign(r, data);
        return { count: hit.length };
      },
    },
    chat: {
      async create({ data }: { data: Row }) {
        const now = new Date();
        const row = { id: randomUUID(), name: null, visibility: "PRIVATE", createdBy: null, productId: null, messages: [], createdAt: now, updatedAt: now, ...structuredClone(data) };
        chats.push(row);
        return structuredClone(row);
      },
      async findMany({ where, orderBy, take }: { where?: Where; orderBy?: Row; take?: number } = {}) {
        const hit = chats.filter((c) => matches(c, where)).map((c) => structuredClone(c));
        return (orderBy?.updatedAt === "desc" ? hit.sort((a, b) => b.updatedAt - a.updatedAt) : hit).slice(0, take);
      },
      async findUnique({ where }: { where: Where }) {
        const c = chats.find((row) => matches(row, where));
        return c ? structuredClone(c) : null;
      },
      async delete({ where }: { where: Where }) {
        const at = chats.findIndex((row) => matches(row, where));
        if (at < 0) throw Object.assign(new Error("Record to delete does not exist."), { code: "P2025" });
        return structuredClone(chats.splice(at, 1)[0]);
      },
      async deleteMany({ where }: { where: Where }) {
        const hit = chats.filter((row) => matches(row, where));
        for (const row of hit) chats.splice(chats.indexOf(row), 1);
        return { count: hit.length };
      },
      async update({ where, data }: { where: Where; data: Row }) {
        const c = chats.find((row) => matches(row, where));
        if (!c) throw Object.assign(new Error("Record to update not found."), { code: "P2025" });
        Object.assign(c, structuredClone(data), { updatedAt: new Date(Math.max(Date.now(), c.updatedAt.getTime() + 1)) });
        return structuredClone(c);
      },
    },
    async $transaction<T>(fn: (tx: unknown) => Promise<T>) {
      return fn(db);
    },
  };

  /** Adds a Repo row as the backend sync would after the first sync (`github.com/acme/app`). */
  const addRepo = (name: string, over: Row = {}) => {
    const row = {
      id: nextRepo++, name, kind: "CODE", status: "PENDING", error: null, defaultBranch: "main", headCommit: null, metadata: {}, pushedAt: null, lastIndexedAt: null, indexRequestedAt: null, kbScannedCommit: null, kbExcluded: false,
      createdAt: new Date(), external_codeHostType: "github", external_codeHostUrl: `https://${name.split("/")[0]}`, ...over,
    };
    repos.push(row);
    return row;
  };
  return { db: db as unknown as Pick<PrismaClient, "product" | "repo" | "connection" | "chat" | "knowledgeScan" | "$transaction"> & Row, ...db, addRepo };
}
