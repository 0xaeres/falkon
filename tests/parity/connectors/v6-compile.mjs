// Runs inside the v6 image: compiles each scenario with v6's own compile*Config and prints JSON.
import fs from "node:fs";
const m = await import("/app/packages/backend/dist/repoCompileUtils.js");
const fns = { github: (c) => m.compileGithubConfig(c, 1, new AbortController().signal), gitlab: (c) => m.compileGitlabConfig(c, 1), gitea: (c) => m.compileGiteaConfig(c, 1),
  gerrit: (c) => m.compileGerritConfig(c, 1), bitbucket: (c) => m.compileBitbucketConfig(c, 1), azuredevops: (c) => m.compileAzureDevOpsConfig(c, 1), git: (c) => m.compileGenericGitHostConfig(c, 1) };
const scenarios = JSON.parse(fs.readFileSync("/m/scenarios.json", "utf8"));
const out = {};
for (const [name, cfg] of Object.entries(scenarios)) {
  if (name.startsWith("_")) continue;
  try {
    out[name] = { repos: (await fns[cfg.type](cfg)).map((r) => ({
      externalId: r.external_id, codeHostType: r.external_codeHostType, codeHostUrl: r.external_codeHostUrl, name: r.name, displayName: r.displayName,
      cloneUrl: r.cloneUrl, webUrl: r.webUrl ?? null, imageUrl: r.imageUrl ?? null, defaultBranch: r.defaultBranch ?? null,
      isFork: r.isFork, isArchived: r.isArchived, isPublic: r.isPublic ?? false, metadata: r.metadata ?? {} })) };
  } catch (e) {
    out[name] = { error: String(e?.message ?? e) };
  }
}
fs.writeFileSync("/out/v6.json", JSON.stringify(out, null, 2));
process.exit(0);
