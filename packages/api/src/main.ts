// Imports the Next-free runners from the web package in place (spec D19): no file moves, no copies.
import { prisma } from "@sbc/db";
import { accessPolicyFromEnv } from "@sbc/shared";
import { handleMcpDelete, handleMcpPost } from "../../web/src/lib/mcp";
import { createAdminApp } from "./admin";
import { createApp } from "./app";
import { PrismaProductRegistry } from "./product";

// An AUTH_MODE other than none or apiKey throws here: the service refuses to start.
const policy = accessPolicyFromEnv(process.env);
const registry = new PrismaProductRegistry(prisma);

const host = process.env.API_HOST ?? "127.0.0.1";
const port = Number(process.env.API_PORT ?? 3001);
const app = await createApp(registry, { post: handleMcpPost, delete: handleMcpDelete }, { policy });
app.enableShutdownHooks();
await app.listen(port, host);
console.log(`api listening on ${host}:${port} (AUTH_MODE=${process.env.AUTH_MODE ?? "none"})`);

const adminHost = process.env.API_ADMIN_HOST ?? "127.0.0.1";
const adminPort = Number(process.env.API_ADMIN_PORT ?? 3002);
const admin = await createAdminApp(registry);
admin.enableShutdownHooks();
await admin.listen(adminPort, adminHost);
console.log(`api admin listening on ${adminHost}:${adminPort}`);
