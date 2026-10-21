# Originality check (D56): reference set recipe

The check (`tests/originality`, run as `ORIGINALITY_REF_DIR=<dir> pnpm originality`) compares Falkon's shipped prompt, tool-description, knowledge-base prompt and config-schema description text with a directory of reference text. It exits 1 and lists each shared run of 8 or more words, 2 when `ORIGINALITY_REF_DIR` is unset, 0 when clean. Reference text is never copied into the repo.

## Building the reference directory

Reference image: `docker.sourcebot.dev/sourcebot-dev/sourcebot:v6.0.1`.

1. Extract the packages into a scratch directory (no network):
   `docker run --rm --network none --entrypoint sh <img> -c 'cd /app && tar -c --exclude=node_modules packages docs' | tar -x -C <scratch>`
2. The reference set is a flat directory holding:
   - the `packages/web/.next/server` chunks (non-map) that contain any of `powerful agentic`, `Lists branches in a repository`, `DO NOT USE THIS TOOL UNLESS`, `ask_codebase`, `list_language_models`, `search_code`, `read_file`;
   - the non-test `.ts` files of `packages/backend/src/ee/knowledge/`.
   (36 files, 5.3 MB for v6.0.1.)

## What is scanned on Falkon's side

String and template literals (template expressions and comments dropped) of `packages/web/src/lib/ask/{prompt,impact,evidence,brief}.ts`, `packages/shared/src/tools.ts`, `packages/web/src/lib/mcp.ts` and the non-test `packages/shared/src/kb/**/*.ts`; the whole of `packages/shared/src/toolText.json`; the `description` strings of `packages/shared/schemas/falkon/config.json`. Literals only, because raw scanning flags shared code idioms (zod shapes, schema keywords) that are not prose.

## Results

- Before the rewrite (cycle 9, S36 start): 127 shared runs.
- After the rewrite: 2 runs left, the grep and glob "(Results truncated. Consider ...)" output hints in `tools.ts`; they are pinned by `tests/contract/outputs.json`, so changing them is a gate-2 decision.
