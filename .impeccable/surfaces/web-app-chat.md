---
version: 1
slug: "web-app-chat"
primary_target: "src/features/chat/chat-view.tsx"
related_targets:
  [
    "src/features/chat/evidence-panel.tsx",
    "src/app/(workspace)/[productId]/chat/[threadId]/page.tsx",
    "src/components/layout/workspace-shell.tsx",
  ]
---

# Chat

Implemented in `src/features/chat/chat-view.tsx` and `src/features/chat/evidence-panel.tsx`, routed under `src/app/(workspace)/[productId]/chat/`, scoped to one Product. Shared navigation is in `src/components/layout/workspace-shell.tsx`.

## Scope and mode

Operate. The product owner asks free-form questions about one Product's code and verifies each answer against exact source evidence. Threads with follow-ups, saved per Product. No cross-Product questions, no Jira or Confluence, no uploads. Semantic predictions, if shown, are labelled predicted and never presented as evidence.

## Approved composition

Three-pane, chosen 2026-10-11 (seed key 59adddfc): `.impeccable/mocks/decision/three-pane.html`. Full mockups: `.impeccable/mocks/chat/index.html`. Brief locked by the user 2026-10-11.

## Direction contract

THESIS: A familiar three-pane chat where evidence is never more than one glance away; refuses chatbot styling, uncited prose, and confident tone on partial answers.

OWN-WORLD: Inherits setup's category-standard world: near-black `#0A0A0A`, surfaces `#111113`/`#18181B`, borders `#27272A`/`#3F3F46`, Geist for prose, Geist Mono for paths, revisions, and code. Citation markers are small mono chips; the active one and selected evidence tab use `#2563EB` with white text. Amber callouts for unresolved targets and partial results.

STORY: The owner asks, watches the answer stream in with numbered citations, opens each citation's excerpt with its repository, path, line range, and revision, notes what Falkon could not see, and asks a follow-up.

FIRST VIEWPORT: Shared vertical sidebar (240px, collapsible to a 56px icon rail, collapsed by default below 1280px, a drawer on mobile): mark, Product switcher, Status, Chat, Settings, then a Threads section with New thread and threads grouped by day, Docs and Account at the foot. Collapsed, the threads list hides behind a New thread icon. Centre about 680px: thread with questions as right-aligned bubbles, answers as plain prose with a meta line (Grounded answer, generation id), composer pinned at the bottom. Right 440px: Evidence panel with numbered tabs and the selected excerpt, cited lines highlighted, Open in code host link.

FORM: Surface structure 1 of the ranked list (three-pane), dealt by seed key 59adddfc; world is the category standard.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## States

Empty thread with Product-specific example questions; streaming; grounded; partial (reasons from `partialReasons`); unresolved target; abstention as a first-class answer with reason and what to try; generation changed mid-thread (divider, later answers use the new generation); no generation yet (composer disabled, link to status); authorization unavailable; network error with retry. Evidence panel collapses when nothing is selected; under 1280px the sidebar starts collapsed; mobile evidence opens as a full-screen sheet.

## Open decisions

Free-form questions need the general `retrieve` endpoint (today's query API needs an HTTP route target); thread storage; re-running an old thread against a newer generation.
