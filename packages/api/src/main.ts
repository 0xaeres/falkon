// Imports the Next-free runners from the web package in place (spec D19): no file moves, no copies.
import { handleMcpDelete, handleMcpPost } from "../../web/src/lib/mcp";
import { loadContexts } from "../../web/src/lib/repos";
import { createApp } from "./app";
import { ContextProductResolver } from "./product";

const host = process.env.API_HOST ?? "127.0.0.1";
const port = Number(process.env.API_PORT ?? 3001);

const app = await createApp(new ContextProductResolver(loadContexts), { post: handleMcpPost, delete: handleMcpDelete });
app.enableShutdownHooks();
await app.listen(port, host);
console.log(`api listening on ${host}:${port}`);
