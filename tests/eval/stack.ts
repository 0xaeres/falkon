import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadProduct, stackRepoName } from "./data.js";

/** The Product that holds all 42 repositories; the eval talks to `/mcp/o3` on the api service. */
export const PRODUCT = "o3";
/** The admin listener of a stack is published on the MCP port plus this, so the four stacks never collide. */
const ADMIN_PORT_OFFSET = 100;
const stackRepos = stackRepoName("*");

type Stack = { o3Dir: string; repoRoot: string; port: number; project: string; instructions?: "off"; recipe?: "on"; prs?: "on"; gitHistory?: "on" };

/** The clone's config and an isolated compose project that indexes every product repository in place, read-only. The api service sets both history flags explicitly: `off` unless this stack's own flag turns its family on. */
export function stackFiles({ o3Dir, repoRoot, port, project, instructions, recipe, prs, gitHistory }: Stack) {
  const repos = loadProduct().repositories;
  const config = {
    knowledgeBase: { enabled: false },
    // Connection names are limited to [a-zA-Z0-9_-]; the repository names the agents see come from the origin URLs.
    connections: Object.fromEntries(repos.map((r) => [r.name.replace(/[^a-zA-Z0-9_-]/g, "-"), { type: "git", url: `file:///repos/${r.name}` }])),
  };
  const environment = { DATABASE_URL: "postgresql://falkon:falkon@postgres:5432/falkon", REDIS_URL: "redis://redis:6379", DATA_DIR: "/data", CONFIG_PATH: "/config/config.json", ZOEKT_URL: "http://zoekt:6070", GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "safe.directory", GIT_CONFIG_VALUE_0: "*" };
  const app = { image: "falkon-eval-app", pull_policy: "never", environment, volumes: ["data:/data", "./config.json:/config/config.json:ro", ...repos.map((r) => `${o3Dir}/${r.checkout}:/repos/${r.name}:ro`)] };
  const adminPort = port + ADMIN_PORT_OFFSET;
  const apiEnvironment = { ...environment, API_HOST: "0.0.0.0", API_ADMIN_HOST: "0.0.0.0", AUTH_MODE: "none", ADMIN_TOKEN: "${ADMIN_TOKEN}", ...(instructions ? { MCP_INSTRUCTIONS: instructions } : {}), ...(recipe ? { MCP_IMPACT_RECIPE: recipe } : {}), MCP_HISTORY_TOOLS: prs ? "on" : "off", MCP_GIT_TOOLS: gitHistory ? "on" : "off", ...(gitHistory ? { DISCUSSION_TICKET_KEYS: "TRUNK,RESTWS,O3" } : {}) };
  const compose = {
    name: project,
    services: {
      postgres: { image: "postgres:17-alpine", environment: { POSTGRES_USER: "falkon", POSTGRES_PASSWORD: "falkon", POSTGRES_DB: "falkon" }, volumes: ["pgdata:/var/lib/postgresql/data"], healthcheck: { test: ["CMD-SHELL", "pg_isready -U falkon"], interval: "3s", retries: 30 } },
      redis: { image: "redis:7-alpine", healthcheck: { test: ["CMD", "redis-cli", "ping"], interval: "3s", retries: 30 } },
      // --prs on: the backend imports the pull request snapshot (S47) after indexing each repository.
      backend: { ...app, ...(prs ? { environment: { ...environment, DISCUSSIONS_SNAPSHOT_DIR: "/discussions", DISCUSSION_TICKET_KEYS: "TRUNK,RESTWS,O3" }, volumes: [...app.volumes, `${o3Dir}/github-snapshot:/discussions:ro`] } : {}), build: { context: repoRoot, dockerfile: "docker/Dockerfile" }, command: ["sh", "-c", "pnpm --filter @falkon/db push && pnpm --filter @falkon/backend start"], depends_on: { postgres: { condition: "service_healthy" }, redis: { condition: "service_healthy" } } },
      zoekt: { ...app, command: ["zoekt-webserver", "-index", "/data/index", "-rpc", "-listen", ":6070"], depends_on: ["backend"] },
      api: { ...app, environment: apiEnvironment, command: ["node", "packages/api/dist/main.js"], ports: [`127.0.0.1:${port}:3001`, `127.0.0.1:${adminPort}:3002`], depends_on: { backend: { condition: "service_started" }, zoekt: { condition: "service_started" }, redis: { condition: "service_healthy" } } },
    },
    volumes: { pgdata: {}, data: {} },
  };
  return { config, compose, project };
}

/** The admin token of a stack: generated once into its state directory (mode 600), never into the compose file. */
export function adminToken(stateDir: string): string {
  const file = join(stateDir, "admin.token");
  if (!existsSync(file)) writeFileSync(file, randomBytes(24).toString("hex"), { mode: 0o600 });
  chmodSync(file, 0o600);
  return readFileSync(file, "utf8").trim();
}

/**
 * Seeds the Product holding every stack repository (an upsert, so a re-used stack is fine) by running `seed` with the seed script's arguments.
 * `seed` throws until the backend container runs and its `db push` has created the schema: every failure is retried until the deadline.
 */
export async function ensureProduct(seed: (args: string[]) => void, { wait = 120_000, sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}): Promise<void> {
  const deadline = Date.now() + wait;
  for (;;) {
    try {
      return seed([PRODUCT, "O3", stackRepos]);
    } catch (e) {
      if (Date.now() > deadline) throw new Error(`The backend did not seed the ${PRODUCT} Product within ${wait / 1000}s: ${e instanceof Error ? e.message : e}`);
    }
    await sleep(2000);
  }
}

/** `up` writes the files under stateDir, starts the stack and seeds the Product; `down` stops it (`down -v` also deletes indexes and database). */
export async function stack(action: string, extra: string[], s: Stack & { stateDir: string }): Promise<string> {
  const { config, compose, project } = stackFiles(s);
  mkdirSync(s.stateDir, { recursive: true });
  writeFileSync(join(s.stateDir, "config.json"), JSON.stringify(config, null, 2));
  writeFileSync(join(s.stateDir, "compose.json"), JSON.stringify(compose));
  const token = adminToken(s.stateDir);
  const docker = (...args: string[]) => execFileSync("docker", ["compose", "-p", project, "-f", join(s.stateDir, "compose.json"), ...args], { stdio: "inherit", env: { ...process.env, ADMIN_TOKEN: token } });
  // Runs scripts/seed-product.ts in the backend container, which has the repo and DATABASE_URL; stderr is captured so a retry stays quiet until the deadline.
  const seed = (args: string[]) => { execFileSync("docker", ["compose", "-p", project, "-f", join(s.stateDir, "compose.json"), "exec", "-T", "backend", "pnpm", "--filter", "@falkon/backend", "exec", "tsx", "../../scripts/seed-product.ts", ...args], { stdio: "pipe", env: { ...process.env, ADMIN_TOKEN: token } }); };
  if (action === "up") { docker("up", "-d", "--build"); await ensureProduct(seed); }
  else if (action === "down") docker("down", ...extra);
  else throw new Error("Usage: pnpm eval -- stack up|down [-v]");
  return `stack ${action}: project ${project}, http://127.0.0.1:${s.port}/mcp/${PRODUCT}\n`;
}
