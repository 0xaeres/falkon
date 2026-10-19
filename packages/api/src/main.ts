// Imports the Next-free runners from the web package in place (spec D19): no file moves, no copies.
import { prisma } from "@sbc/db";
import { accessPolicyFromEnv } from "@sbc/shared";
import { handleMcpDelete, handleMcpPost } from "../../web/src/lib/mcp";
import { adminToken, startAdmin } from "./admin";
import { createApp } from "./app";
import { ConnectionService } from "./connections";
import { PrismaProductRegistry } from "./product";
import { ThreadService } from "./threads";
import { UiProductService } from "./ui";

// An AUTH_MODE other than none or apiKey throws here: the service refuses to start.
// A set ADMIN_TOKEN shorter than 32 characters throws here too, before anything listens.
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
await startAdmin(registry, process.env, connections, ui, new ThreadService(prisma, ui));
