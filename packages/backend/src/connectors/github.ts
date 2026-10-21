import { Octokit } from "@octokit/rest";
import micromatch from "micromatch";
import pLimit from "p-limit";
import { getTokenFromConfig, type GithubConnectionConfig } from "@falkon/shared";
import { fetchWithRetry, joinName, marshalBool, perTarget, repoNameRoot, statusIs, trimSlashes, type RepoRecord } from "./types";

const GITHUB_CLOUD = "github.com";
const limit = pLimit(5);

export interface GithubRepo {
  id: number;
  full_name: string;
  fork: boolean;
  private: boolean;
  visibility?: string;
  html_url: string;
  clone_url?: string;
  stargazers_count?: number;
  watchers_count?: number;
  subscribers_count?: number;
  forks_count?: number;
  default_branch?: string;
  archived?: boolean;
  topics?: string[];
  size?: number;
  owner: { avatar_url: string; login: string };
}

export function githubClient(token: string | undefined, url?: string) {
  const enterprise = url && new URL(url).hostname !== GITHUB_CLOUD;
  return new Octokit({ auth: token, ...(enterprise ? { baseUrl: `${url}/api/v3` } : {}) });
}

async function collect(it: AsyncIterable<{ data: unknown }>, signal?: AbortSignal) {
  const out: GithubRepo[] = [];
  for await (const { data } of it) {
    if (signal?.aborted) throw new DOMException("Operation aborted", "AbortError");
    out.push(...(data as GithubRepo[]));
  }
  return out;
}

export async function listGithubRepos(config: GithubConnectionConfig, signal?: AbortSignal): Promise<GithubRepo[]> {
  const hostname = config.url ? new URL(config.url).hostname : GITHUB_CLOUD;
  const token = config.token
    ? await getTokenFromConfig(config.token)
    : hostname === GITHUB_CLOUD
      ? process.env.FALLBACK_GITHUB_CLOUD_TOKEN
      : undefined;
  const gh = githubClient(token, config.url);
  // Fail fast on a bad token rather than silently listing only public repos.
  if (token) await gh.rest.users.getAuthenticated();

  const notFound = statusIs(404);
  const repos: GithubRepo[] = [];
  if (config.orgs) {
    repos.push(
      ...(await perTarget(config.orgs, (o) => `GitHub org ${o}`, (org) =>
        limit(() =>
          fetchWithRetry(() => collect(gh.paginate.iterator(gh.repos.listForOrg, { org, per_page: 100, request: { signal } }), signal), `org ${org}`),
        ), notFound)),
    );
  }
  if (config.repos) {
    repos.push(
      ...(await perTarget(config.repos, (r) => `GitHub repo ${r}`, (r) =>
        limit(async () => {
          const [owner, repo] = r.split("/");
          const res = await fetchWithRetry(() => gh.repos.get({ owner: owner!, repo: repo!, request: { signal } }), r);
          return [res.data as GithubRepo];
        }), notFound)),
    );
  }
  if (config.users) {
    // Search, not listForUser: it is the one listing that includes forks and the user's private repos.
    repos.push(
      ...(await perTarget(config.users, (u) => `GitHub user ${u}`, (user) =>
        limit(() =>
          fetchWithRetry(
            () => collect(gh.paginate.iterator(gh.rest.search.repos, { q: `user:${user} fork:true`, per_page: 100, request: { signal } }), signal),
            `user ${user}`,
          ),
        ), notFound)),
    );
  }
  return repos.filter((r) => !excludeGithubRepo(r, config));
}

export function excludeGithubRepo(repo: GithubRepo, config: Pick<GithubConnectionConfig, "exclude" | "topics">): boolean {
  const ex = config.exclude;
  if (!repo.clone_url) return true;
  if (ex?.forks && repo.fork) return true;
  if (ex?.archived && repo.archived) return true;
  if (ex?.private && repo.private && repo.visibility !== "internal") return true;
  if (ex?.repos && micromatch.isMatch(repo.full_name, ex.repos)) return true;
  if (ex?.topics) {
    const patterns = ex.topics.map((t) => t.toLowerCase());
    if ((repo.topics ?? []).some((t) => micromatch.isMatch(t, patterns))) return true;
  }
  if (config.topics) {
    const patterns = config.topics.map((t) => t.toLowerCase());
    if (!(repo.topics ?? []).some((t) => micromatch.isMatch(t, patterns))) return true;
  }
  // GitHub reports size in KB.
  const bytes = repo.size ? repo.size * 1000 : undefined;
  if (ex?.size && bytes) {
    if (ex.size.min && bytes < ex.size.min) return true;
    if (ex.size.max && bytes > ex.size.max) return true;
  }
  return false;
}

export function githubRecord(repo: GithubRepo, hostUrl: string, config: Pick<GithubConnectionConfig, "revisions">): RepoRecord {
  const name = joinName(repoNameRoot(hostUrl), repo.full_name);
  const isPublic = repo.private === false;
  return {
    externalId: repo.id.toString(),
    codeHostType: "github",
    codeHostUrl: hostUrl,
    cloneUrl: new URL(repo.clone_url!).toString(),
    webUrl: repo.html_url,
    name,
    displayName: repo.full_name,
    defaultBranch: repo.default_branch,
    imageUrl: repo.owner.avatar_url,
    isFork: repo.fork,
    isArchived: !!repo.archived,
    isPublic,
    metadata: {
      gitConfig: {
        "zoekt.web-url-type": "github",
        "zoekt.web-url": repo.html_url,
        "zoekt.name": name,
        "zoekt.github-stars": String(repo.stargazers_count ?? 0),
        "zoekt.github-watchers": String(repo.watchers_count ?? 0),
        "zoekt.github-subscribers": String(repo.subscribers_count ?? 0),
        "zoekt.github-forks": String(repo.forks_count ?? 0),
        "zoekt.archived": marshalBool(repo.archived),
        "zoekt.fork": marshalBool(repo.fork),
        "zoekt.public": marshalBool(isPublic),
        "zoekt.display-name": repo.full_name,
      },
      branches: config.revisions?.branches,
      tags: config.revisions?.tags,
      codeHostMetadata: { github: { topics: repo.topics ?? [] } },
    },
  };
}

export async function compileGithub(config: GithubConnectionConfig, signal?: AbortSignal): Promise<RepoRecord[]> {
  const hostUrl = trimSlashes(config.url ?? "https://github.com");
  return (await listGithubRepos(config, signal)).map((r) => githubRecord(r, hostUrl, config));
}
