Replaced the old status layer cards with a secondary vertical section/status rail directly beside global navigation. The main workspace now shows the Product verdict, immediate actions, and the selected section's complete details.

The rail stays beside details at tablet widths and becomes an accessible native section picker on mobile. Selection preserves health labels, generation provenance, recovery actions, and semantic-prediction disclosures. The existing API and data contracts are unchanged; no dependencies were added.

Validation: TypeScript, ESLint, formatting, production build, and all seven existing API checks pass. Browser checks cover all four sections, keyboard activation, the mobile picker, and 1280px/861px/390px layouts. The tablet has no document overflow. Independent review found no material UI findings, verified the updated status brief, DESIGN.md, and sidecar, and returned a ship verdict.

Representative screenshots and the review report are saved in `.impeccable/review/status-navigation/`. The production preview remains available at http://127.0.0.1:4311/payments-platform/status.
