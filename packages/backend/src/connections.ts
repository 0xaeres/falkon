import path from "node:path";
import type { Connection } from "@sbc/shared";

export interface RepoSpec {
  name: string;
  cloneUrl: string;
  tokenEnv?: string;
  branches: string[]; // branch globs to index beyond the default branch
  tags: string[]; // tag globs to index
  isFork?: boolean;
  isArchived?: boolean;
  isPublic?: boolean;
  webUrl?: string;
}

interface GhRepo {
  full_name: string;
  clone_url: string;
  fork: boolean;
  archived: boolean;
  private: boolean;
  html_url: string;
}

async function gh<T>(apiUrl: string, route: string, token?: string): Promise<T> {
  const res = await fetch(`${apiUrl}${route}`, {
    headers: {
      accept: "application/vnd.github+json",
      "user-agent": "sourcebot-clone",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) throw new Error(`github ${route}: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

async function ghPaged(apiUrl: string, route: string, token?: string): Promise<GhRepo[]> {
  const all: GhRepo[] = [];
  for (let page = 1; ; page++) {
    const sep = route.includes("?") ? "&" : "?";
    const batch = await gh<GhRepo[]>(apiUrl, `${route}${sep}per_page=100&page=${page}`, token);
    all.push(...batch);
    if (batch.length < 100) return all;
  }
}

/** Expand connections from config.json into concrete repos. */
export async function resolveConnections(conns: Connection[]): Promise<RepoSpec[]> {
  const out = new Map<string, RepoSpec>();
  for (const c of conns) {
    const { branches, tags } = c.revisions;
    if (c.type === "git") {
      out.set(c.name, { name: c.name, cloneUrl: c.url, tokenEnv: c.tokenEnv, branches, tags });
    } else if (c.type === "local") {
      out.set(c.name, { name: c.name, cloneUrl: path.resolve(c.path), branches, tags });
    } else {
      const token = c.tokenEnv ? process.env[c.tokenEnv] : undefined;
      const repos: GhRepo[] = [];
      for (const o of c.orgs) repos.push(...(await ghPaged(c.apiUrl, `/orgs/${o}/repos`, token)));
      for (const u of c.users) repos.push(...(await ghPaged(c.apiUrl, `/users/${u}/repos`, token)));
      for (const r of c.repos) repos.push(await gh<GhRepo>(c.apiUrl, `/repos/${r}`, token));
      for (const r of repos) {
        if (c.exclude.forks && r.fork) continue;
        if (c.exclude.archived && r.archived) continue;
        const host = new URL(c.apiUrl).host.replace(/^api\./, "");
        out.set(`${host}/${r.full_name}`, {
          name: `${host}/${r.full_name}`,
          cloneUrl: r.clone_url,
          tokenEnv: c.tokenEnv,
          branches,
          tags,
          isFork: r.fork,
          isArchived: r.archived,
          isPublic: !r.private,
          webUrl: r.html_url,
        });
      }
    }
  }
  return [...out.values()];
}
