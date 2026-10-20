import { createSign } from "node:crypto";
import { openCredential, seal, type SealedCredential } from "./credentialStore";

export const githubApiBase = (host: string) => (host === "github.com" ? "https://api.github.com" : `https://${host}/api/v3`);

/** What a `github-app` Credential seals, as one JSON string. Never returned or logged. */
export interface AppSecret {
  appId: string;
  privateKey: string;
  installationId: string;
}

/** Fixed-vocabulary failure: the message never carries the key, a JWT, a token or provider text. */
export class GithubAppError extends Error {
  constructor(readonly kind: "invalid" | "unavailable") {
    super(`GitHub App ${kind}`);
  }
}

export interface AppOptions {
  fetch?: typeof fetch;
  now?: () => number;
  /** Reuse a cached token only if it was minted less than this long ago (default: the ~50 minute cache window). */
  maxAgeMs?: number;
}

export const sealAppSecret = (secret: AppSecret, row: { id: string; host: string }) => seal(JSON.stringify(secret), row);

const CACHE_MS = 50 * 60_000;
const MARGIN_MS = 5 * 60_000;
// ponytail: per-process map, one entry per credential id; the entry is overwritten, never evicted (few credentials).
// ponytail: concurrent cold mints are not deduplicated (thundering herd accepted); cache the in-flight promise if sync fan-out proves costly.
const cache = new Map<string, { token: string; until: number; mintedAt: number }>();
/** Forgets the cached token of one credential (after the host rejected it), or all of them. */
export const clearInstallationTokens = (id?: string) => void (id ? cache.delete(id) : cache.clear());

const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");

/** RS256 App JWT: iat 60 s back for clock skew, valid 9 minutes (GitHub's maximum is 10). */
function appJwt(appId: string, pem: string, nowMs: number) {
  const iat = Math.floor(nowMs / 1000) - 60;
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({ iat, exp: iat + 60 + 9 * 60, iss: appId })}`;
  try {
    return `${unsigned}.${createSign("RSA-SHA256").update(unsigned).sign(pem).toString("base64url")}`;
  } catch {
    throw new GithubAppError("invalid"); // malformed key
  }
}

async function call(host: string, path: string, init: RequestInit, auth: string, f: typeof fetch) {
  let res: Response;
  try {
    res = await f(`${githubApiBase(host)}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${auth}`, accept: "application/vnd.github+json", "user-agent": "falkon" },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new GithubAppError("unavailable");
  }
  if ([401, 403, 404].includes(res.status)) throw new GithubAppError("invalid");
  if (!res.ok) throw new GithubAppError("unavailable");
  return res.json().catch(() => {
    throw new GithubAppError("unavailable");
  });
}

/** An installation access token for credential `id`, minted on demand and cached about 50 minutes (or until expires_at minus 5). */
export async function installationToken(cred: { id: string; host: string } & AppSecret, { fetch: f = fetch, now = Date.now, maxAgeMs = Infinity }: AppOptions = {}) {
  const hit = cache.get(cred.id);
  if (hit && hit.until > now() && now() - hit.mintedAt < maxAgeMs) return hit.token;
  const jwt = appJwt(cred.appId, cred.privateKey, now());
  const body = (await call(cred.host, `/app/installations/${encodeURIComponent(cred.installationId)}/access_tokens`, { method: "POST" }, jwt, f)) as { token?: string; expires_at?: string };
  if (typeof body.token !== "string") throw new GithubAppError("unavailable");
  const expires = Date.parse(body.expires_at ?? "") - MARGIN_MS;
  cache.set(cred.id, { token: body.token, mintedAt: now(), until: Math.min(now() + CACHE_MS, Number.isNaN(expires) ? Infinity : expires) });
  return body.token;
}

/** `GET /app/installations` with the App JWT; the key is not kept. */
export async function listInstallations(host: string, appId: string, pem: string, { fetch: f = fetch, now = Date.now }: AppOptions = {}) {
  const rows = (await call(host, "/app/installations?per_page=100", {}, appJwt(appId, pem, now()), f)) as { id: number; account?: { login?: string } }[];
  return rows.map((r) => ({ id: String(r.id), account: r.account?.login ?? "" }));
}

export interface InstallationRepo {
  full_name: string;
  default_branch: string;
  pushed_at: string | null;
}

/** `GET /installation/repositories?per_page=100`, at most 3 pages (300 repositories). */
export async function installationRepositories(host: string, token: string, { fetch: f = fetch }: AppOptions = {}) {
  const out: InstallationRepo[] = [];
  for (let page = 1; page <= 3; page++) {
    const { repositories } = (await call(host, `/installation/repositories?per_page=100&page=${page}`, {}, token, f)) as { repositories?: InstallationRepo[] };
    if (!Array.isArray(repositories)) throw new GithubAppError("unavailable");
    out.push(...repositories);
    if (repositories.length < 100) break;
  }
  return out;
}

type Row = Pick<SealedCredential, "id" | "host"> & { kind: string };

/** The usable token for an already-opened credential: the plain token, or a minted installation token for `github-app`. */
export async function tokenFromSecret(row: Row, plain: string, opts?: AppOptions) {
  if (row.kind !== "github-app") return plain;
  let secret: AppSecret;
  try {
    secret = JSON.parse(plain);
  } catch {
    throw new GithubAppError("invalid"); // never surface the parser's message
  }
  return installationToken({ id: row.id, host: row.host, ...secret }, opts);
}

/** Credential row -> token for an outbound call; the shared entry for the backend resolver. */
export const credentialToken = (row: SealedCredential & { kind: string }, opts?: AppOptions) => tokenFromSecret(row, openCredential(row), opts);
