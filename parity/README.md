# Parity harness

Differential tests against real Sourcebot v6. Three layers, each isolating one source of difference.

| Layer | Command | Compares | Needs |
| --- | --- | --- | --- |
| Grammar | `pnpm parity:grammar` | v6's compiled query parser + its parse-tree→IR transform (`grammar/oracle.cjs`) vs the clone's `parseQuery`, over v6's own grammar fixtures, `queries.json` and seeded fuzz, in both dialects | `./setup-oracle.sh` once (copies the parser out of the v6 image) |
| Engine | `pnpm parity:engine` | the same zoekt request sent over gRPC to v6's zoekt (`127.0.0.1:16070`) and the clone's (`127.0.0.1:16071`): indexed repos/branches/doc counts, files, ranges, languages, chunk text, order | the compose stack |
| API | `pnpm parity:search` | `POST /api/search` on both, normalized | a registered v6 (see below) |

Reports land in `reports/` (`latest.md`, `engine-latest.md`, `grammar-latest.json`).

## Local stack

```bash
./parity/up.sh
```

Fetches the pinned corpus (`corpus.json` + `corpus.lock`, plus a synthetic edge-case repo from `make-edge-repo.sh`),
generates both configs from one corpus definition, starts v6 (`:3100`) and the clone (`:3200`), and seeds a v6 owner
and API key into `.gen/keys.env`. v6 refuses API calls until a deployment is registered with Sourcebot, so the grammar
and engine layers work immediately while the API layer needs that one-time registration (sign in with the seeded owner).

## External oracle

Point the harness at a v6 deployment that is already registered, and run the clone over the same repos:

```bash
node parity/external-oracle.mjs /path/to/v6/compose.yml
docker compose -f parity/.gen/external/compose.yml up -d --build
V6_URL=http://localhost:3000 V6_API_KEY_FILE=/path/to/api-key node parity/run.mjs --queries parity/queries.openmrs.json
```

The key is read from the file by the runner, never from a shell variable.

## Known non-differences

- Result order among equal-score files can vary run to run on both engines (parallel shard search); an "order"
  verdict on a large truncated result is usually that.
- v6 reindexes only on `settings.reindexIntervalMs`; the parity config sets it to 60s so the oracle follows corpus edits.
