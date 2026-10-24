// In-memory ProvenanceStore for tests without a database: the semantics the Postgres adapter must match
// (provenance.contract.ts runs the same cases against both).
import {
  MAX_OFFSET, MAX_ROWS, notIngested, searchBounds,
  type Discussion, type Link, type ProvenanceStore, type RepoLink, type SearchHit, type SyncState,
} from "./provenance";

/** `repos`: repository name → id, the code repositories the registry holds. */
export function fakeProvenanceStore(repos: Record<string, number>) {
  const discussions = new Map<string, Discussion & { repoId: number }>();
  const links: (Link & { repoId: number })[] = [];
  const states = new Map<number, SyncState>();
  const nameOf = (id: number) => Object.keys(repos).find((n) => repos[n] === id)!;
  const rows = (names: string[]) => names.filter((n) => n in repos).sort().map((name) => ({ id: repos[name]!, name, ingested: !!states.get(repos[name]!)?.lastSuccessAt }));
  const gapsOf = (r: ReturnType<typeof rows>) => r.filter((x) => !x.ingested).map((x) => notIngested(x.name));
  const copy = <T>(v: T): T => structuredClone(v);

  const store: ProvenanceStore = {
    async syncState(repoId) { return copy(states.get(repoId)); },
    async saveSyncState(repoId, s) { states.set(repoId, copy(s)); },
    async replaceDiscussion(repoId, d, ls) {
      discussions.set(`${repoId}:${d.number}`, { ...copy(d), repoId });
      for (let i = links.length - 1; i >= 0; i--) if (links[i]!.repoId === repoId && links[i]!.fromKind === "pr" && links[i]!.fromRef === String(d.number)) links.splice(i, 1);
      links.push(...ls.map((l) => ({ ...l, repoId })));
    },
    async mergeCommits(repoId) {
      return [...discussions.values()].filter((d) => d.repoId === repoId).sort((a, b) => a.number - b.number).map((d) => ({ number: d.number, mergeCommitSha: d.mergeCommitSha }));
    },
    async replaceCommitLinks(repoId, ls) {
      for (let i = links.length - 1; i >= 0; i--) if (links[i]!.repoId === repoId && links[i]!.fromKind === "commit") links.splice(i, 1);
      links.push(...ls.map((l) => ({ ...l, repoId })));
    },
    async getDiscussion(set, repo, number) {
      if (!set.includes(repo)) return undefined;
      const [r] = rows([repo]);
      if (!r) return undefined;
      if (!r.ingested) return { gap: notIngested(repo) };
      const d = discussions.get(`${r.id}:${number}`);
      if (!d) return undefined;
      const { repoId: _, ...rest } = copy(d);
      return { ...rest, comments: rest.comments.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()).slice(0, MAX_ROWS), files: rest.files.sort((a, b) => (a.path < b.path ? -1 : 1)).slice(0, MAX_ROWS) };
    },
    async search(set, q) {
      const { words, limit, offset } = searchBounds(q);
      const { kind, state, since, until } = q;
      const r = rows(q.repo === undefined ? set : set.filter((n) => n === q.repo));
      const ids = new Set(r.filter((x) => x.ingested).map((x) => x.id));
      const has = (text: string | null, w: string) => (text ?? "").toLowerCase().includes(w.toLowerCase());
      const hits: SearchHit[] = words.length
        ? [...discussions.values()]
            .filter((d) => ids.has(d.repoId) && (!kind || d.kind === kind) && (!state || d.state === state) && (!since || d.createdAt >= since) && (!until || d.createdAt <= until) && (q.any ? words.some.bind(words) : words.every.bind(words))((w: string) => has(d.title, w) || has(d.body, w) || has(d.headRef, w) || d.comments.some((c) => has(c.body, w))))
            .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime() || nameOf(a.repoId).localeCompare(nameOf(b.repoId)) || a.number - b.number)
            .map((d) => ({ repo: nameOf(d.repoId), number: d.number, title: d.title, state: d.state, mergedAt: d.mergedAt, updatedAt: d.updatedAt, url: d.url }))
        : [];
      return { hits: hits.slice(offset, offset + limit), hasMore: hits.length > offset + limit, gaps: gapsOf(r), timedOut: false, total: Math.min(hits.length, MAX_OFFSET), totalCapped: hits.length > MAX_OFFSET };
    },
    async links(set, anchor, o = {}) {
      if (anchor.kind === "pr" && !set.includes(anchor.repo)) return { links: [], gaps: [] };
      const r = rows(anchor.kind === "pr" ? [anchor.repo] : set);
      const gaps = gapsOf(r);
      if (!r.some((x) => x.ingested)) return { links: [], gaps };
      const scope = new Set(rows(set).filter((x) => x.ingested).map((x) => x.id));
      const ref = anchor.kind === "commit" ? anchor.sha.toLowerCase() : anchor.kind === "ticket" ? anchor.key.toUpperCase() : String(anchor.number);
      const match = (l: Link & { repoId: number }) =>
        anchor.kind === "commit" ? l.fromKind === "commit" && l.fromRef === ref
        : anchor.kind === "ticket" ? l.toKind === "ticket" && l.toRef === ref
        : (nameOf(l.repoId) === anchor.repo && l.fromKind === "pr" && l.fromRef === ref) || (l.toKind === "pr" && l.toRef === ref && (l.toRepo ?? nameOf(l.repoId)) === anchor.repo);
      const out: RepoLink[] = links
        .filter((l) => scope.has(l.repoId) && (l.toRepo === null || set.includes(l.toRepo)) && (o.unverified || l.verified) && match(l))
        .map(({ repoId, ...l }) => ({ repo: nameOf(repoId), ...l }))
        .sort((a, b) => [a.repo, a.fromKind, a.fromRef, a.toKind, a.toRef].join("\0").localeCompare([b.repo, b.fromKind, b.fromRef, b.toKind, b.toRef].join("\0")))
        .slice(0, MAX_ROWS);
      return { links: out, gaps };
    },
  };
  return store;
}
