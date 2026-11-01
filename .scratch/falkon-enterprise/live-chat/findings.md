# Live end-to-end test of chat and knowledge base on the OpenMRS corpus (2026-11-01)

Setup: disposable compose project `falkon-live` built from `main` at `7120551`, the human's model (DeepSeek-V4.1-Flash on DeepInfra) loaded through `env_file` (never read), the OpenMRS checkouts under `/Users/aeres/Desktop/projects/falkon/.local/eval/o3` mounted read-only. Part 1 used six repositories (`esm-patient-management`, `esm-billing-app`, `module-billing`, `module-fhir2`, `esm-form-engine-lib`, `contrib-o3-docs`); part 2 used all 42. The human's own running stack is a seven-day-old image holding only an `agent-loop` Product, so it was not used. Scripts are in this folder (`gen.js` builds the compose file and config, `ask.js` sends one question through the admin API, `sum.js` summarises a trace, `score2.ts` scores against the eval gold). Stored answers: `runs-human/` and `runs-eval/`.

## Part 1: ten human-style questions (six repositories)

Every question got a long, well structured answer (425 to 923 words, tables, a diagram where useful, a "not verified" note) in 7 to 15 model steps and 11 to 36 tool calls. The question about a Kubernetes operator that does not exist was answered correctly as absent. The history question found pull request 155 (cashier on payments) and explained the reason. Spot checks of the content found it consistent with the code.

Tools used across the ten: `grep`, `read_file`, `list_tree`, `glob`, `list_commits`, `get_diff`, `list_repos`. Never used: `find_symbol_references`, `find_symbol_definitions`, `list_branches`.

## Part 2: twelve eval questions with known answers (all 42 repositories, one run each)

Recall as the eval scores it (a cited span covers a required span), on the 12 `openmrs-xrepo` dev questions (three each of four kinds):

| View | Mean recall |
|---|---:|
| Evidence the chat shows the human (at most 12 citations) | 0.833 |
| Every `@file` reference the model wrote (before the cap) | 0.817 |
| Files the agent read (path match only) | 0.917 |

The recorded eval figure for Sonnet on dev is 0.95 (Haiku is lower), so a Flash-class model in chat is somewhat below, not far below. With n 12 and one run each this is indicative only.

## Defects and gaps found

1. **Chat has its own fixed tool list.** `AGENT_TOOL_ORDER` in `packages/api/src/engine/ask/agent.ts` names ten tools. The pull request, discussion, provenance and git history tools (cycles 15 to 19c) are not in it, so their eval gains cannot appear in chat. The Ask prompt does not mention them either.
2. **Citation cap.** `MAX_EVIDENCE = 12` in `ask/evidence.ts`. Citations beyond twelve become bare file paths in the text and the answer is marked partial ("N references were not shown"): 8 of the 10 part 1 answers carried that label, with 4 to 28 hidden references. All 12 part 2 answers hit the cap (cited 13 to 44 references).
3. **Prompt wording.** The static Ask prompt says "Be clear and very concise" and never asks for an explanation suited to a newcomer, although the model writes long answers anyway.
4. **Stray marker.** In the Kubernetes question the stored answer text ends with a literal `<!--reply-->` line followed by a second, shorter summary.
5. **Knowledge base produced no documents.** Four scans on three repositories all ended `BUDGET_EXHAUSTED` (budgets of 400k and 1M tokens, discovery alone used 262k to 293k). The log estimate for a first scan (about 390k for a 4.7 MB repository) was far below real use, so the estimate cannot size a budget. With no documents the chat never searched knowledge base text. A scan at the default 2M budget was not run (cost).

## Not tested

Follow-up turns (the engine keeps only the answer part of earlier turns), repository selection in the UI, the UI itself, and a knowledge base that completed. The human's reports may also come from the stale image on their own stack, which predates cycles 9 to 20.
