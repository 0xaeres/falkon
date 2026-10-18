// Mock code host for the connector differential: one HTTP server answering the GitHub Enterprise,
// GitLab, Gitea, Gerrit and Bitbucket Server APIs with fixed fixtures (pagination, 404 targets,
// forks, archived, private/internal, topics, sizes, duplicates). Unmatched requests are logged.
import http from "node:http";

const PORT = Number(process.env.PORT ?? 8080);
const HOST = process.env.MOCK_HOST ?? `http://mockhost:${PORT}`;

// ---- fixtures ----
const ghRepo = (id, full, o = {}) => ({
  id,
  name: full.split("/")[1],
  full_name: full,
  fork: false,
  private: false,
  html_url: `${HOST}/${full}`,
  clone_url: `${HOST}/${full}.git`,
  stargazers_count: id * 3,
  watchers_count: id * 2,
  subscribers_count: id,
  forks_count: id % 5,
  default_branch: "main",
  archived: false,
  topics: [],
  size: 100,
  owner: { login: full.split("/")[0], avatar_url: `${HOST}/avatars/${full.split("/")[0]}` },
  ...o,
});
const ghOrg = [
  ghRepo(1, "acme/app", { topics: ["Backend", "core", "backend-api"] }),
  ghRepo(10, "acme/svc", { topics: ["backend"], default_branch: "trunk" }),
  ghRepo(2, "acme/fork-of-lib", { fork: true }),
  ghRepo(3, "acme/old", { archived: true }),
  ghRepo(4, "acme/secret", { private: true }),
  ghRepo(5, "acme/internal", { private: true, visibility: "internal" }),
  ghRepo(6, "acme/huge", { size: 5_000_000 }),
  ghRepo(7, "acme/tiny", { size: 1 }),
  ghRepo(8, "acme/no-clone", { clone_url: undefined }),
  ghRepo(9, "acme/web", { topics: ["frontend"], default_branch: "develop" }),
  ...Array.from({ length: 103 }, (_, i) => ghRepo(100 + i, `acme/bulk-${i}`)),
];
const ghUser = [ghRepo(50, "bob/dots"), ghRepo(51, "bob/fork", { fork: true })];

const glProject = (id, path, o = {}) => ({
  id,
  name: path.split("/").pop(),
  path_with_namespace: path,
  http_url_to_repo: `https://mockhost:8080/${path}.git`,
  web_url: `${HOST}/${path}`,
  default_branch: "main",
  visibility: "public",
  archived: false,
  topics: [],
  forks_count: 2,
  star_count: 7,
  avatar_url: null,
  namespace: { kind: "group", full_path: path.split("/").slice(0, -1).join("/") },
  ...o,
});
const glGroup = [
  glProject(1, "acme/api", { topics: ["Backend"], avatar_url: `${HOST}/a.png` }),
  glProject(2, "acme/sub/deep", { visibility: "internal" }),
  glProject(3, "acme/private", { visibility: "private" }),
  glProject(4, "acme/archived", { archived: true }),
  glProject(5, "acme/forked", { forked_from_project: { id: 99 } }),
  ...Array.from({ length: 105 }, (_, i) => glProject(100 + i, `acme/many-${i}`)),
];
const glUser = [glProject(50, "bob/notes", { namespace: { kind: "user", full_path: "bob" } })];
const glAll = [...glGroup, ...glUser, glProject(70, "other/thing")];

const gtRepo = (id, full, o = {}) => ({
  id,
  name: full.split("/")[1],
  full_name: full,
  clone_url: `http://gitea.internal:3000/${full}.git`,
  html_url: `${HOST}/${full}`,
  default_branch: "main",
  fork: false,
  private: false,
  internal: false,
  archived: false,
  owner: { login: full.split("/")[0], avatar_url: `${HOST}/av/${id}` },
  ...o,
});
const gtOrg = [
  gtRepo(1, "acme/svc"),
  gtRepo(2, "acme/priv", { private: true }),
  gtRepo(3, "acme/int", { internal: true }),
  gtRepo(4, "acme/arch", { archived: true }),
  gtRepo(5, "acme/frk", { fork: true }),
  ...Array.from({ length: 101 }, (_, i) => gtRepo(100 + i, `acme/r${i}`)),
];
const gtUser = [gtRepo(50, "bob/x")];

const gerritProjects = {
  "All-Projects": { id: "All-Projects", state: "ACTIVE" },
  "All-Users": { id: "All-Users", state: "ACTIVE" },
  "platform/build": { id: "platform%2Fbuild", state: "ACTIVE", web_links: [{ name: "gitiles", url: "/plugins/gitiles/platform/build" }] },
  "platform/ro": { id: "platform%2Fro", state: "READ_ONLY" },
  "platform/hidden": { id: "platform%2Fhidden", state: "HIDDEN" },
  "tools/ext": { id: "tools%2Fext", state: "ACTIVE", web_links: [{ name: "browse", url: "https://code.example.com/tools/ext" }] },
  ...Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`bulk/p${i}`, { id: `bulk%2Fp${i}`, state: "ACTIVE" }])),
};

const bbRepo = (id, project, slug, o = {}) => ({
  id,
  slug,
  name: slug,
  public: false,
  archived: false,
  project: { key: project },
  defaultBranch: "main",
  links: {
    clone: [
      { name: "ssh", href: `ssh://git@mockhost:7999/${project.toLowerCase()}/${slug}.git` },
      { name: "http", href: `${HOST}/scm/${project.toLowerCase()}/${slug}.git` },
    ],
    self: [{ href: `${HOST}/projects/${project}/repos/${slug}/browse` }],
  },
  ...o,
});
const bbProject = [
  bbRepo(1, "PRJ", "core", { public: true }),
  bbRepo(2, "PRJ", "arch", { archived: true }),
  bbRepo(3, "PRJ", "frk", { origin: { id: 1 } }),
  ...Array.from({ length: 1003 }, (_, i) => bbRepo(100 + i, "PRJ", `b${i}`)),
];
const bbAll = [...bbProject, bbRepo(50, "OTH", "misc")];

// ---- helpers ----
const send = (res, status, body, headers = {}) => {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(text);
};
const page = (items, req, size, url) => {
  const p = Number(url.searchParams.get("page") ?? 1);
  const per = Number(url.searchParams.get("per_page") ?? url.searchParams.get("limit") ?? size);
  const slice = items.slice((p - 1) * per, p * per);
  const last = Math.max(1, Math.ceil(items.length / per));
  const next = new URL(url, HOST);
  next.searchParams.set("page", String(p + 1));
  const headers = {
    "x-total-count": String(items.length),
    "x-total": String(items.length),
    "x-total-pages": String(last),
    "x-page": String(p),
    "x-per-page": String(per),
    ...(p < last ? { "x-next-page": String(p + 1), link: `<${HOST}${next.pathname}${next.search}>; rel="next"` } : { "x-next-page": "" }),
  };
  return [slice, headers];
};

http
  .createServer((req, res) => {
    // Real servers collapse duplicate slashes (a config url with a trailing slash yields //api/v3).
    const url = new URL(req.url.replace(/\/{2,}/g, "/"), HOST);
    const p = url.pathname;
    let m;
    // GitHub Enterprise (/api/v3)
    if (p === "/api/v3/user") return send(res, 200, { login: "mock" });
    if ((m = /^\/api\/v3\/orgs\/([^/]+)\/repos$/.exec(p))) {
      if (m[1] !== "acme") return send(res, 404, { message: "Not Found" });
      const [items, h] = page(ghOrg, req, 30, url);
      return send(res, 200, items, h);
    }
    if ((m = /^\/api\/v3\/repos\/([^/]+)\/([^/]+)$/.exec(p))) {
      const r = [...ghOrg, ...ghUser].find((x) => x.full_name === `${m[1]}/${m[2]}`);
      return r ? send(res, 200, r) : send(res, 404, { message: "Not Found" });
    }
    if (p === "/api/v3/search/repositories") {
      const user = /user:(\S+)/.exec(url.searchParams.get("q") ?? "")?.[1];
      const all = user === "bob" ? ghUser : [];
      const [items, h] = page(all, req, 30, url);
      return send(res, 200, { total_count: all.length, incomplete_results: false, items }, h);
    }
    // GitLab (/api/v4)
    if (p === "/api/v4/projects") {
      const [items, h] = page(glAll, req, 20, url);
      return send(res, 200, items, h);
    }
    if ((m = /^\/api\/v4\/groups\/([^/]+)\/projects$/.exec(p))) {
      if (decodeURIComponent(m[1]) !== "acme") return send(res, 404, { message: "404 Group Not Found" });
      const [items, h] = page(glGroup, req, 20, url);
      return send(res, 200, items, h);
    }
    if ((m = /^\/api\/v4\/users\/([^/]+)\/projects$/.exec(p))) {
      if (m[1] !== "bob") return send(res, 404, { message: "404 User Not Found" });
      const [items, h] = page(glUser, req, 20, url);
      return send(res, 200, items, h);
    }
    if ((m = /^\/api\/v4\/projects\/(.+)$/.exec(p))) {
      const key = decodeURIComponent(m[1]);
      const r = glAll.find((x) => x.path_with_namespace === key || String(x.id) === key);
      return r ? send(res, 200, r) : send(res, 404, { message: "404 Project Not Found" });
    }
    // Gitea (/api/v1)
    if ((m = /^\/api\/v1\/orgs\/([^/]+)\/repos$/.exec(p))) {
      if (m[1] !== "acme") return send(res, 404, { message: "not found" });
      const [items, h] = page(gtOrg, req, 30, url);
      return send(res, 200, items, h);
    }
    if ((m = /^\/api\/v1\/users\/([^/]+)\/repos$/.exec(p))) {
      if (m[1] !== "bob") return send(res, 404, { message: "not found" });
      const [items, h] = page(gtUser, req, 30, url);
      return send(res, 200, items, h);
    }
    if ((m = /^\/api\/v1\/repos\/([^/]+)\/([^/]+)$/.exec(p))) {
      const r = [...gtOrg, ...gtUser].find((x) => x.full_name === `${m[1]}/${m[2]}`);
      return r ? send(res, 200, r) : send(res, 404, { message: "not found" });
    }
    // Gerrit
    if (p === "/gerrit/projects/") {
      const entries = Object.entries(gerritProjects);
      const start = Number(url.searchParams.get("S") ?? 0);
      const chunk = entries.slice(start, start + 10);
      const body = Object.fromEntries(chunk.map(([k, v], i) => [k, { ...v, ...(i === chunk.length - 1 && start + 10 < entries.length ? { _more_projects: true } : {}) }]));
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(")]}'\n" + JSON.stringify(body));
    }
    // Bitbucket Server
    const bbPage = (items) => {
      const start = Number(url.searchParams.get("start") ?? 0);
      const limit = Number(url.searchParams.get("limit") ?? 25);
      const values = items.slice(start, start + limit);
      const isLastPage = start + limit >= items.length;
      return send(res, 200, { size: values.length, limit, start, isLastPage, values, ...(isLastPage ? {} : { nextPageStart: start + limit }) });
    };
    if (p === "/bitbucket/rest/api/1.0/repos") return bbPage(bbAll);
    if ((m = /^\/bitbucket\/rest\/api\/1\.0\/projects\/([^/]+)\/repos$/.exec(p))) {
      if (m[1] !== "PRJ") return send(res, 404, { errors: [{ message: "Project does not exist" }] });
      return bbPage(bbProject);
    }
    if ((m = /^\/bitbucket\/rest\/api\/1\.0\/projects\/([^/]+)\/repos\/([^/]+)$/.exec(p))) {
      const r = bbAll.find((x) => x.project.key === m[1] && x.slug === m[2]);
      if (!r) return send(res, 404, { errors: [] });
      // Anonymous access to a "public" repo is refused when the instance flag is off.
      if (!req.headers.authorization && process.env.BB_PUBLIC_ACCESS === "off") return send(res, 401, { errors: [] });
      return send(res, 200, r);
    }
    console.error(`UNMATCHED ${req.method} ${req.url}`);
    send(res, 599, { message: `unmatched ${req.url}` });
  })
  .listen(PORT, () => console.error(`mock code host on :${PORT}`));
