Implemented in the separate sibling app `falkon-ui`.

- Next.js App Router setup, status, and chat follow the three locked design briefs and approved `build.py` galleries.
- Next.js Route Handlers serve synthetic Products, repositories, status, persistent threads, and real NDJSON streaming. Zod contracts and one typed HTTP client localize integration changes.
- Shared workspace layout, reusable controls, locally hosted fonts, on-demand repository/evidence modules, responsive drawers/sheets, and reduced-motion support are included.
- TypeScript, ESLint, formatting, production build, and all seven API tests pass. Runtime audit reports zero advisories. Upstream development-tool advisories are documented in README.
- Browser checks cover setup, branch persistence, Product switching, sidebar persistence, grounded and partial answers, citations, retry, cancellation, and 1280px/390px layouts.
- Independent finish review requested three fixes; all were resolved in one batch and the verdict is ship. Evidence is saved under `.impeccable/review`.

Real authentication, code-host connections, backend contract mapping, and production persistence remain integration work outside this mock-UI issue. The current NestJS query endpoint is not a drop-in replacement for free-form chat. No deployment was requested or performed.
