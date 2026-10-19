import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadProduct } from "./data.js";

type Stack = { o3Dir: string; repoRoot: string; port: number; project: string; instructions?: "off"; recipe?: "on" };

/** The clone's config and an isolated compose project that indexes every product repository in place, read-only. */
export function stackFiles({ o3Dir, repoRoot, port, project, instructions, recipe }: Stack) {
  const repos = loadProduct().repositories;
  const config = {
    knowledgeBase: { enabled: false },
    // Connection names are limited to [a-zA-Z0-9_-]; the repository names the agents see come from the origin URLs.
    connections: Object.fromEntries(repos.map((r) => [r.name.replace(/[^a-zA-Z0-9_-]/g, "-"), { type: "git", url: `file:///repos/${r.name}` }])),
  };
  const environment = { DATABASE_URL: "postgresql://sbc:sbc@postgres:5432/sbc", REDIS_URL: "redis://redis:6379", DATA_DIR: "/data", CONFIG_PATH: "/config/config.json", ZOEKT_URL: "http://zoekt:6070", AUTH_URL: `http://127.0.0.1:${port}`, GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "safe.directory", GIT_CONFIG_VALUE_0: "*" };
  const app = { image: "falkon-eval-app", pull_policy: "never", environment, volumes: ["data:/data", "./config.json:/config/config.json:ro", ...repos.map((r) => `${o3Dir}/${r.checkout}:/repos/${r.name}:ro`)] };
  const compose = {
    name: project,
    services: {
      postgres: { image: "postgres:17-alpine", environment: { POSTGRES_USER: "sbc", POSTGRES_PASSWORD: "sbc", POSTGRES_DB: "sbc" }, volumes: ["pgdata:/var/lib/postgresql/data"], healthcheck: { test: ["CMD-SHELL", "pg_isready -U sbc"], interval: "3s", retries: 30 } },
      redis: { image: "redis:7-alpine", healthcheck: { test: ["CMD", "redis-cli", "ping"], interval: "3s", retries: 30 } },
      backend: { ...app, build: { context: repoRoot, dockerfile: "docker/Dockerfile" }, command: ["sh", "-c", "pnpm --filter @sbc/db push && pnpm --filter @sbc/backend start"], depends_on: { postgres: { condition: "service_healthy" }, redis: { condition: "service_healthy" } } },
      zoekt: { ...app, command: ["zoekt-webserver", "-index", "/data/index", "-rpc", "-listen", ":6070"], depends_on: ["backend"] },
      web: { ...app, environment: { ...environment, ...(instructions ? { MCP_INSTRUCTIONS: instructions } : {}), ...(recipe ? { MCP_IMPACT_RECIPE: recipe } : {}) }, command: ["pnpm", "--filter", "@sbc/web", "start"], ports: [`127.0.0.1:${port}:3000`], depends_on: ["backend", "zoekt"] },
    },
    volumes: { pgdata: {}, data: {} },
  };
  return { config, compose, project };
}

/** `up` writes the files under stateDir and starts the stack; `down` stops it (`down -v` also deletes indexes and database). */
export function stack(action: string, extra: string[], s: Stack & { stateDir: string }): string {
  const { config, compose, project } = stackFiles(s);
  mkdirSync(s.stateDir, { recursive: true });
  writeFileSync(join(s.stateDir, "config.json"), JSON.stringify(config, null, 2));
  writeFileSync(join(s.stateDir, "compose.json"), JSON.stringify(compose));
  const docker = (...args: string[]) => execFileSync("docker", ["compose", "-p", project, "-f", join(s.stateDir, "compose.json"), ...args], { stdio: "inherit" });
  if (action === "up") docker("up", "-d", "--build");
  else if (action === "down") docker("down", ...extra);
  else throw new Error("Usage: pnpm eval -- stack up|down [-v]");
  return `stack ${action}: project ${project}, http://127.0.0.1:${s.port}/api/mcp\n`;
}
