// The MCP handlers and the Ask agent live in ./engine (moved from the web package, spec D141).
import { prisma } from "@falkon/db";
import { accessPolicyFromEnv } from "@falkon/shared";
import { productDeps } from "./engine/tools";
import { handleMcpDelete, handleMcpPost } from "./engine/mcp";
import { adminToken, startAdmin } from "./admin";
import { createApp } from "./app";
import { ConnectionService } from "./connections";
import { PrismaProductRegistry } from "./product";
import { KnowledgeService } from "./knowledge";
import { SearchService } from "./search";
import { ThreadService } from "./threads";
import { UiProductService } from "./ui";

// An AUTH_MODE other than none or apiKey throws here: the service refuses to start.
// A set ADMIN_TOKEN shorter than 32 characters throws here too, and the admin token file is created, before anything listens.
adminToken(process.env);
const policy = accessPolicyFromEnv(process.env);
const registry = new PrismaProductRegistry(prisma);

const host = process.env.API_HOST ?? "127.0.0.1";
const port = Number(process.env.API_PORT ?? 3001);
const app = await createApp(registry, { post: handleMcpPost, delete: handleMcpDelete }, { policy });
app.enableShutdownHooks();
await app.listen(port, host);
console.log(`api listening on ${host}:${port} (AUTH_MODE=${process.env.AUTH_MODE ?? "none"})`);

const connections = new ConnectionService(prisma);
const ui = new UiProductService(prisma, connections);
productDeps.generation = async (slug) => (await ui.status(slug)).generation ?? "";
await startAdmin(registry, process.env, connections, ui, new ThreadService(prisma, ui), new SearchService(prisma), new KnowledgeService(prisma, ui));
