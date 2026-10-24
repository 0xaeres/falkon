/**
 * The live GitHub discussion source (ADR 0001, 4.11; D115 to D118, D121, D124, D126): a permission probe, discovery through the
 * REST issues listing in ascending updated order, detail through GraphQL in batches with the S47 fragment, and a yield to the
 * rate limit before the budget runs out. Errors are fixed strings: GitHub text and the token never reach a log or the store.
 */
import { NoAccess, RateLimited, getTokenFromConfig, type Discussion, type DiscussionSource, type Token } from "@falkon/shared";
import { githubClient } from "./connectors/github";
import { fetchWithRetry } from "./connectors/types";
import { mapSnapshotPull } from "./discussions";
import { BATCH, detailQuery, firstPages, shapePull } from "./githubQuery";

/** The seam the tests replace: Octokit in production. HTTP failures throw an error with `status`, as Octokit does. */
export interface GithubTransport {
  get(path: string, params: Record<string, string | number>): Promise<{ data: any; headers: Record<string, unknown> }>;
  /** The response body: `errors` with partial or no `data` is returned, not thrown. */
  graphql(query: string, variables: Record<string, unknown>): Promise<{ data?: any; errors?: unknown[] }>;
}

const FAILED = "GitHub request failed";
const RATE = "rateLimit{limit cost remaining resetAt}";
const PAGE = 100, LOW = 0.1, RECONCILE_MS = 30 * 86_400_000;
const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z");
/** `host/owner/name` (or an API url) → [owner, name]. */
const ownerName = (s: string) => s.split("/").slice(-2) as [string | undefined, string | undefined];

/**
 * A 403 or 404, sorted before fetchWithRetry could sleep on it: a 403 with a rate signal (no budget left, retry-after, or a
 * rate or abuse message, which is read here and never kept) is a limit, any other is a refusal (D115). Others pass through.
 */
function classify(e: any): unknown {
  if (e?.status !== 403 && e?.status !== 404) return e;
  const h = e.response?.headers ?? {}, spent = String(h["x-ratelimit-remaining"]) === "0";
  if (e.status === 403 && spent && h["x-ratelimit-reset"]) return new RateLimited(new Date(Number(h["x-ratelimit-reset"]) * 1000));
  if (e.status === 403 && (spent || h["retry-after"] !== undefined || /rate limit|abuse|secondary/i.test(`${e.message} ${e.response?.data?.message}`))) return new Error(FAILED);
  return new NoAccess();
}

export function githubSource({ transport, backfillMonths = 24, reconcile = false, now = () => new Date() }: {
  transport: GithubTransport; backfillMonths?: number; reconcile?: boolean; now?: () => Date;
}): DiscussionSource {
  let resetAt: Date | null = null; // set once a response shows less than LOW of the budget left (D118)
  const note = (remaining: unknown, limit: unknown, reset: Date) => {
    if (Number(remaining) < LOW * (Number(limit) || 5000) && !Number.isNaN(reset.getTime())) resetAt = reset;
  };
  const call = async <T>(fn: () => Promise<T>, what: string, attempts?: number): Promise<T> => {
    if (resetAt && now() < resetAt) throw new RateLimited(resetAt);
    resetAt = null;
    try {
      return await fetchWithRetry(() => fn().catch((e) => { throw classify(e); }), what, attempts);
    } catch (e) {
      throw e instanceof NoAccess || e instanceof RateLimited ? e : new Error(FAILED); // a fixed string: no GitHub text, no cause
    }
  };
  const get = async (path: string, params: Record<string, string | number>, what: string, attempts?: number) => {
    const { data, headers: h } = await call(() => transport.get(path, params), what, attempts);
    note(h["x-ratelimit-remaining"], h["x-ratelimit-limit"], new Date(Number(h["x-ratelimit-reset"]) * 1000));
    return data;
  };
  const detail = async (owner: string, name: string, nums: number[]): Promise<any[]> => {
    const { data, errors } = await call(() => transport.graphql(detailQuery(nums, RATE), { owner, name }), `pull requests of ${owner}/${name}`);
    if (data?.rateLimit) note(data.rateLimit.remaining, data.rateLimit.limit, new Date(data.rateLimit.resetAt));
    if (!data?.repository && errors?.some((x: any) => x?.type === "RATE_LIMITED")) {
      const reset = new Date(data?.rateLimit?.resetAt ?? NaN);
      throw new RateLimited(Number.isNaN(reset.getTime()) ? new Date(now().getTime() + 60_000) : reset);
    }
    if (!data?.repository) throw new Error(FAILED);
    return nums.map((n) => data.repository[`p${n}`]);
  };
  /** `listed`: the item's REST updated_at. The earlier of the two times is kept, so the cursor follows the listing's order. */
  const toDiscussion = (node: any, number: number, listed: string): Discussion | { skipped: string } => {
    try {
      const d = mapSnapshotPull(shapePull(node, firstPages(node))), at = new Date(listed);
      return at < d.updatedAt ? { ...d, updatedAt: at } : d;
    } catch {
      return { skipped: `#${number}` };
    }
  };
  /** One detail batch, ascending by updatedAt; the listing's repository url names the repository even after a rename. */
  async function* batch(items: any[]) {
    const [owner, name] = ownerName(String(items[0].repository_url));
    const nodes = await detail(owner!, name!, items.map((i) => i.number));
    const out = nodes.map((n, k) => toDiscussion(n, items[k].number, items[k].updated_at));
    const at = (d: Discussion | { skipped: string }) => ("skipped" in d ? -Infinity : d.updatedAt.getTime());
    yield* out.sort((a, b) => at(a) - at(b));
  }
  return {
    async covers(repo) {
      const [owner, name] = ownerName(repo);
      if (!owner || !name) return false;
      // Pull requests: Read, then Issues: Read (conversation comments come from the issues API); 403/404 → NoAccess (D115)
      await get(`/repos/${owner}/${name}/pulls`, { per_page: 1 }, `probe of ${owner}/${name}`, 1);
      await get(`/repos/${owner}/${name}/issues/comments`, { per_page: 1 }, `probe of ${owner}/${name}`, 1);
      return true;
    },
    async *pulls(repo, cursor) {
      const [owner, name] = ownerName(repo);
      if (!owner || !name) return;
      const start = now();
      start.setUTCMonth(start.getUTCMonth() - backfillMonths);
      let since = cursor ?? start; // the stored cursor, never the local clock, once there is one
      if (reconcile && now().getTime() - RECONCILE_MS < since.getTime()) since = new Date(now().getTime() - RECONCILE_MS);
      // Keyset pages: each request starts at the last updated_at read, so an item edited mid-run moves later, never skips one.
      let at = iso(since), page = 1;
      const seen = new Set<string>();
      for (;;) {
        const items: any[] = await get(`/repos/${owner}/${name}/issues`, { state: "all", sort: "updated", direction: "asc", since: at, per_page: PAGE, page }, `pull requests of ${owner}/${name}`);
        const fresh = items.filter((i) => "pull_request" in i && !seen.has(`${i.number}@${i.updated_at}`));
        for (const i of fresh) seen.add(`${i.number}@${i.updated_at}`);
        for (let k = 0; k < fresh.length; k += BATCH) yield* batch(fresh.slice(k, k + BATCH));
        if (items.length < PAGE) return;
        const last = items.at(-1).updated_at;
        if (last === at) page++; // a full page sharing one updated time: page within it
        else [at, page] = [last, 1];
      }
    },
  };
}

/** The production transport: Octokit with the connection's token, on github.com or the connection's enterprise `url`. */
export async function githubTransport(config: { token?: Token; url?: string }): Promise<GithubTransport> {
  if (!config.token) throw new Error("GitHub token missing");
  const gh = githubClient(await getTokenFromConfig(config.token), config.url);
  return {
    get: (path, params) => gh.request(`GET ${path}`, params),
    graphql: (query, variables) =>
      gh.graphql<any>(query, variables).then(
        (data) => ({ data }),
        (e) => {
          if (e?.name === "GraphqlResponseError") return { data: e.data, errors: e.errors };
          throw e;
        },
      ),
  };
}
