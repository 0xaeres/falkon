// Bundles the Nest app into dist/main.js so it runs under plain `node` (no tsx loader, no esbuild service at runtime).
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

// Workspace sources locate files (JSON schemas) relative to import.meta.url; pin it to the source file, not dist/.
const keepSourceUrl = {
  name: "keep-source-url",
  setup(b) {
    b.onLoad({ filter: /\/packages\/[^/]+\/src\/.*\.ts$/ }, ({ path }) => {
      const source = fs.readFileSync(path, "utf8");
      return { contents: source.replaceAll("import.meta.url", JSON.stringify(pathToFileURL(path).href)), loader: "ts" };
    });
  },
};

await build({
  entryPoints: ["src/main.ts"],
  // Splitting moves the dynamically imported `ai` SDK into chunks under dist/chunks that load on first ask_codebase use;
  // a single-file bundle would still evaluate it at start. `node dist/main.js` is unchanged.
  outdir: "dist",
  splitting: true,
  entryNames: "[name]",
  chunkNames: "chunks/[name]-[hash]",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  tsconfig: "tsconfig.json", // experimentalDecorators: explicit @Inject keeps working
  // The generated Prisma client lives in node_modules; Nest loads these optional peers lazily and only when used.
  external: ["@prisma/client", "@nestjs/microservices", "@nestjs/websockets", "@nestjs/platform-socket.io", "class-validator", "class-transformer"],
  banner: { js: 'import { createRequire as __cr } from "node:module"; const require = __cr(import.meta.url);' },
  plugins: [keepSourceUrl],
  logLevel: "warning",
});
