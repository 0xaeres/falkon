---
version: 1
slug: "web-app-setup"
primary_target: "src/features/setup/setup-wizard.tsx"
related_targets:
  ["src/features/setup/repository-picker.tsx", "src/app/setup/page.tsx"]
---

# Product setup

Implemented in `src/features/setup/setup-wizard.tsx` and `src/features/setup/repository-picker.tsx`, routed by `src/app/setup/page.tsx` at `/setup` in this Next.js app.

## Scope and mode

Operate. A product owner registers a Product and queues its first ingestion in five steps: connect code host, name the Product, choose repositories, other sources, review and queue. Setup ends when ingestion is queued; the owner lands on the status dashboard.

## Approved composition

The user approved the mockups on 2026-10-11 and asked to lock them in: `.impeccable/mocks/setup/index.html`. Every frame there is the composition the build matches, including states: token rejected, no matching repositories, queue failed, queued toast, and mobile step 3.

## Direction contract

THESIS: The developer-tool onboarding wizard played straight at Vercel, Linear, and Sourcegraph craft; it refuses quirk, costume, and any state that implies more than Falkon can do.

OWN-WORLD: Near-black ground `#0A0A0A`, surfaces `#111113`/`#18181B`, hairline borders `#27272A`/`#3F3F46`, text `#FAFAFA`/`#A1A1AA`/`#8B8B93`. White primary button, blue `#3B82F6` for focus and selection only, amber for text-only evidence, red for errors, green for confirmed. Geist for UI, Geist Mono for revisions and productId. Real brand logos on white tiles. Falkon mark from `brand/`.

STORY: The owner connects a host, names the Product and sees its permanent productId, picks repositories and branches knowing which get text evidence only, sees Jira and Confluence honestly marked Not yet, and queues ingestion knowing the build continues on the status page.

FIRST VIEWPORT: 56px top bar with mark, breadcrumb, Docs, avatar. Centered 760px column (880px for repositories): horizontal five-step stepper, then one card with title, one-line explanation, body, and a footer holding a hint on the left and Back plus a single white primary action on the right.

FORM: Category standard (canon), chosen by the user over the roll's assigned direction; seed key fc4ccf57.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Open decisions

UI authentication, hosting, the Product-creation and repository-listing API contracts, and server-side credential storage.
