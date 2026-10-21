---
version: 1
slug: "web-app-status"
primary_target: "src/features/status/status-view.tsx"
related_targets:
  [
    "src/app/(workspace)/[productId]/status/page.tsx",
    "src/components/layout/workspace-shell.tsx",
  ]
---

# Status dashboard

Implemented in `src/features/status/status-view.tsx`, routed by `src/app/(workspace)/[productId]/status/page.tsx`, scoped to one Product. Shared navigation is in `src/components/layout/workspace-shell.tsx`.

## Scope and mode

Operate. The product owner answers one question: is this Product's context current? One verdict line with generation and age, a Sync now button, the repositories table (name, branch, state, last indexed), one knowledge-base line, and gaps or errors only when present. A progress line shows only while a build runs. Chat, Connect and Settings are reached from the shared navigation. No section navigation, layer cards, stage bar, history charts, or sync logs (cycle 10, D70).

## States

Verdicts come from the engine: Building, Updating, Current, Partly behind, Needs attention. A repository state is Indexed, Pending, Failed, or Skipped; an unknown state reads Skipped.
