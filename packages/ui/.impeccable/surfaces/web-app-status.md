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

Operate. The product owner answers one question: is this Product's context current and trustworthy? Shows one verdict, the active Evidence Generation, coverage gaps, and semantic overlay state. Actions: retry a failed sync, edit repositories (reopens setup in edit mode), open chat. No per-repository revision rows, history charts, or sync logs.

## Approved composition

Status navigation rail with detail workspace, requested by the user on 2026-10-11 in issue #25. This replaces the original layer-stack composition chosen under seed key cd9ff8b6. The original galleries remain historical references for content and states, not authority for the new status layout. Current captures are in `.impeccable/review/status-navigation/`.

## Direction contract

THESIS: A compact status navigation rail next to the global navigation keeps section health visible while the main workspace explains the selected section. Preserve the freshness verdict and immediate recovery actions; avoid telemetry dashboards, metric tiles, and history charts.

OWN-WORLD: Inherits setup's category-standard world: near-black `#0A0A0A`, surfaces `#111113`/`#18181B`, borders `#27272A`/`#3F3F46`, Geist and Geist Mono, white primary button. State colour only where it means something: blue building/selected, amber behind or catching up, red failed, green confirmed. White text on blue uses `#2563EB`.

STORY: The owner reads the verdict sentence in the main area, sees the most urgent section already selected in the status rail, reads its details, and retries, edits repositories, or opens chat. Selecting another section updates the same workspace.

FIRST VIEWPORT: Existing global sidebar remains 240px, collapsible to a 56px icon rail with the [ key and a drawer on mobile. Directly beside it, a 232px status rail lists Evidence Generation, Sync, Repositories, and the separated Semantic overlay. Each destination has an icon and labeled health; selection uses a quiet tonal fill. Active evidence and publication age sit at the foot. The flexible main workspace leads with the verdict, freshness sentence, Open chat and Edit repositories, followed by the selected section's title, summary, health, and detailed information. Below 1024px the rail is 212px and stays beside the details. Below 768px a native 44px section picker replaces the rail; details remain immediately visible and scroll independently.

FORM: User-specified secondary vertical navigation and detail workspace; the established category-standard visual world remains unchanged.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## States

Verdicts: Building first generation (Open chat disabled with reason), Current, Updating, Behind (against 5/15/30 min freshness targets), Partly behind (failed sync), New generation failed (previous stays active). Overlay: catching up, current, unavailable (evidence unaffected). The most urgent section is selected on load. Desktop and tablet navigation expose all four sections; mobile uses a section picker with current health in each option. Existing retry, dismiss, repository edit, and chat actions remain available.

## Open decisions

`index-status` response shape; whether a dismissed failed sync can return; switcher behaviour with one Product.
