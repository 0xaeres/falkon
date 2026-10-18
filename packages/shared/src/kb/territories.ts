import { FILE_WEIGHT_CAP, MAX_SCOUTS, TERRITORY_WEIGHT } from "./limits";

export interface FileInfo {
  path: string;
  size: number;
}

/** A slice of the repo handed to one scout: whole directories (or loose files) up to a weight budget. */
export interface Territory {
  id: string;
  prefixes: string[];
  fileCount: number;
  weight: number;
}

export interface TerritoryOptions {
  weight?: number;
  maxScouts?: number;
}

const weigh = (size: number) => Math.min(size, FILE_WEIGHT_CAP);

interface Node {
  name: string;
  path: string;
  isDir: boolean;
  files: number;
  weight: number;
  kids: Map<string, Node>;
}

function build(files: FileInfo[]): Node {
  const root: Node = { name: "", path: "", isDir: true, files: 0, weight: 0, kids: new Map() };
  for (const f of files) {
    const w = weigh(f.size);
    const parts = f.path.split("/");
    let dir = root;
    root.files++;
    root.weight += w;
    parts.forEach((part, i) => {
      const p = parts.slice(0, i + 1).join("/");
      if (i === parts.length - 1) {
        dir.kids.set(part, { name: part, path: p, isDir: false, files: 1, weight: w, kids: new Map() });
        return;
      }
      let child = dir.kids.get(part);
      if (!child) {
        child = { name: part, path: p, isDir: true, files: 0, weight: 0, kids: new Map() };
        dir.kids.set(part, child);
      }
      child.files++;
      child.weight += w;
      dir = child;
    });
  }
  return root;
}

/** The budget actually used: at least `weight`, and large enough that at most `maxScouts` territories result. */
export function effectiveBudget(files: FileInfo[], o: TerritoryOptions = {}): number {
  const total = files.reduce((n, f) => n + weigh(f.size), 0);
  return Math.max(o.weight ?? TERRITORY_WEIGHT, Math.ceil(total / (o.maxScouts ?? MAX_SCOUTS)));
}

/**
 * Walk the tree in name order, packing siblings into buckets under the budget. A directory heavier
 * than the budget is descended into instead of being packed whole, so territories follow the
 * repo's own structure rather than cutting directories in half.
 */
export function carveTerritories(files: FileInfo[], o: TerritoryOptions = {}): Territory[] {
  if (files.length === 0) return [{ id: "t01", prefixes: [""], fileCount: 0, weight: 0 }];
  const budget = effectiveBudget(files, o);
  const out: Omit<Territory, "id">[] = [];

  const visit = (dir: Node) => {
    let bucket: Node[] = [];
    let weight = 0;
    let count = 0;
    const flush = () => {
      if (!bucket.length) return;
      out.push({ prefixes: bucket.map((n) => n.path).sort(), fileCount: count, weight });
      bucket = [];
      weight = 0;
      count = 0;
    };
    for (const kid of [...dir.kids.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      if (kid.isDir && kid.weight > budget) {
        flush();
        visit(kid);
        continue;
      }
      if (bucket.length && weight + kid.weight > budget) flush();
      bucket.push(kid);
      weight += kid.weight;
      count += kid.files;
    }
    flush();
  };

  visit(build(files));
  return out.map((t, i) => ({ id: `t${String(i + 1).padStart(2, "0")}`, ...t }));
}

export const filesUnder = (files: FileInfo[], prefixes: string[]): FileInfo[] =>
  files.filter((f) => prefixes.some((p) => p === "" || f.path === p || f.path.startsWith(`${p}/`)));

/** Paths a scout should not spend tokens on: dependencies, build output, lockfiles, binaries, minified code. */
const SKIP_DIR = /(^|\/)(node_modules|vendor|dist|build|out|target|\.next|\.git|coverage|__pycache__|\.venv|venv)(\/|$)/;
const SKIP_FILE = /(\.lock|-lock\.json|\.min\.(js|css)|\.map|\.svg|\.png|\.jpe?g|\.gif|\.ico|\.woff2?|\.ttf|\.pdf|\.zip|\.gz|\.wasm)$/i;
export const isNoise = (p: string) => SKIP_DIR.test(p) || SKIP_FILE.test(p) || /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/.test(p);
