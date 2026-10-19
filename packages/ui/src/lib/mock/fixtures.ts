import type {
  Answer,
  Evidence,
  Product,
  Repository,
  Status,
} from "@sbc/contracts";

// Fixed offsets from startup keep the mock's ISO timestamps plausible without a clock in tests.
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

export const repositories: Repository[] = [
  {
    id: "payments-api",
    name: "payments-api",
    language: "TypeScript",
    revision: "3f2a9c1",
    updated: ago(720000),
  },
  {
    id: "ledger-service",
    name: "ledger-service",
    language: "Java",
    revision: "a81e07d",
    updated: ago(7200000),
  },
  {
    id: "checkout-web",
    name: "checkout-web",
    language: "TypeScript",
    revision: "c09b44e",
    updated: ago(108000000),
  },
  {
    id: "payments-infra",
    name: "payments-infra",
    language: "HCL",
    revision: "5d7713a",
    updated: ago(259200000),
  },
  {
    id: "fraud-rules",
    name: "fraud-rules",
    language: "Java",
    revision: "e44f120",
    updated: ago(432000000),
  },
  {
    id: "payments-docs",
    name: "payments-docs",
    language: "Markdown",
    revision: "91aa3b0",
    updated: ago(1209600000),
  },
].map((repo) => ({
  ...repo,
  organization: "acme-payments",
  branches: ["main", "develop", "release/2026.10"],
  branch: repo.id === "checkout-web" ? "release/2026.10" : "main",
}));

export const seedProducts: Product[] = [
  {
    id: "payments-platform",
    name: "Payments Platform",
    initials: "PP",
    provider: "github-enterprise",
    host: "github.acme.internal",
    repositories: repositories.slice(0, 4),
    activeGeneration: "g-0042",
    scenario: "partly-behind",
    queuedAt: null,
  },
  {
    id: "identity-services",
    name: "Identity Services",
    initials: "ID",
    provider: "github",
    host: "github.com",
    repositories: [
      {
        ...repositories[0],
        id: "identity-api",
        name: "identity-api",
        organization: "acme-identity",
        revision: "bd071d2",
      },
    ],
    activeGeneration: "g-0042",
    scenario: "current",
    queuedAt: null,
  },
  {
    id: "storefront",
    name: "Storefront",
    initials: "SF",
    provider: "github",
    host: "github.com",
    repositories: [
      {
        ...repositories[2],
        id: "storefront-web",
        name: "storefront-web",
        organization: "acme-storefront",
        revision: "af012c8",
      },
    ],
    activeGeneration: "g-0042",
    scenario: "updating",
    queuedAt: null,
  },
];

export function makeStatus(product: Product): Status {
  const elapsed = product.queuedAt === null ? 0 : Date.now() - product.queuedAt;
  const scenario =
    product.queuedAt !== null && elapsed >= 15000
      ? "current"
      : product.scenario;
  const first = scenario === "building";
  const failed = scenario === "failed";
  const updating = scenario === "updating" || scenario === "partly-behind";
  const nextId = product.activeGeneration
    ? `g-${String(Number(product.activeGeneration.slice(2)) + 1).padStart(4, "0")}`
    : "g-0001";
  const generation = first
    ? null
    : product.queuedAt !== null && elapsed >= 15000
      ? nextId
      : product.activeGeneration;

  const generationAge =
    scenario === "partly-behind"
      ? "14 min ago"
      : failed || scenario === "behind"
        ? "41 min ago"
        : "6 min ago";
  const count = product.repositories.length;
  const verdict = first
    ? "Building first generation"
    : scenario === "partly-behind"
      ? "Partly behind"
      : failed || scenario === "behind"
        ? "Behind"
        : updating
          ? "Updating"
          : "Current";
  const sentence = first
    ? `${product.name} was just set up. Answers are available once g-0001 publishes.`
    : scenario === "partly-behind"
      ? `Answers use ${generation}, published 14 min ago. payments-infra hasn’t synced since 09:12.`
      : failed
        ? `Answers use ${generation}, published 41 min ago. The replacement failed validation, so recent changes aren’t answerable yet.`
        : scenario === "behind"
          ? `Answers use ${generation}, published 41 min ago. Recent changes are waiting to be acquired; the 5 min freshness target has been missed.`
          : updating
            ? `Answers use ${generation}. g-0043 is building and replaces it when it passes validation.`
            : `Answers use ${generation}, published ${generationAge} from the latest revision of all ${count} repositories.`;
  return {
    productId: product.id,
    verdict,
    sentence,
    generation,
    generationAge,
    nextGeneration: first ? "g-0001" : updating || failed ? nextId : null,
    build: first || updating ? "building" : failed ? "failed" : "idle",
    stage: first ? Math.min(4, Math.floor(elapsed / 3000)) : failed ? 3 : 2,
    progress: first
      ? Math.min(98, Math.max(15, Math.floor(elapsed / 150)))
      : 64,
    sync: first
      ? "pinned"
      : scenario === "partly-behind"
        ? "failed"
        : "current",
    gaps:
      product.id === "payments-platform"
        ? [
            {
              count: 212,
              title: "Files with text evidence only",
              detail: "payments-infra · HCL has no structural extraction",
            },
            {
              count: 37,
              title: "Unresolved targets",
              detail:
                "Calls into packages outside this Product, such as @acme/fraud-check",
            },
            {
              count: 4,
              title: "Files skipped",
              detail: "Over the 1 MB file limit",
            },
          ]
        : [],
    scenario,
  };
}

function refundEvidence(generation: string): Evidence[] {
  return [
    {
      id: 1,
      repository: "checkout-web",
      path: "src/refunds/RefundDialog.tsx",
      revision: "c09b44e",
      startLine: 40,
      highlightedLines: [42],
      code: [
        "const submit = async () => {",
        "  setPending(true);",
        '  await api.post("/v1/refunds", { orderId, amount });',
        "  onClose();",
        "};",
      ],
    },
    {
      id: 2,
      repository: "payments-api",
      path: "src/routes/refunds.controller.ts",
      revision: "3f2a9c1",
      startLine: 16,
      highlightedLines: [21],
      code: [
        "// Refunds are created only from a settled order.",
        "@Controller()",
        '@Post("/v1/refunds")',
        "async create(@Body() body: CreateRefundDto) {",
        "  await this.fraud.check(body.orderId);",
        "  return this.refunds.create(body);",
        "}",
      ],
    },
    {
      id: 3,
      repository: "ledger-service",
      path: "src/refunds/RefundPostingService.java",
      revision: "a81e07d",
      startLine: 28,
      highlightedLines: [30, 31],
      code: [
        "public Entry postRefund(Refund refund) {",
        "  Entry reversal = Entry.reverse(refund.original());",
        "  entries.save(reversal);",
        "  return reversal;",
        "}",
      ],
    },
  ].map((source) => ({
    ...source,
    productId: "payments-platform",
    generation,
  }));
}

export function makeAnswer(
  product: Product,
  question: string,
  generation: string,
): Answer {
  const base: Answer = {
    id: crypto.randomUUID(),
    productId: product.id,
    question,
    generation,
    kind: "abstention",
    paragraphs: [],
    evidence: [],
    gaps: [],
    partialReasons: [],
    abstention:
      "The mock dataset does not contain enough evidence for this question. Falkon won’t infer an answer from unrelated sources.",
    suggestions: [
      "Ask about a route or symbol in this Product.",
      "Add the repository containing the missing source.",
    ],
  };
  if (product.id !== "payments-platform") return base;
  const available = new Set(product.repositories.map((repo) => repo.name));
  if (
    /settlement|overnight|schedule/i.test(question) &&
    available.has("ledger-service")
  ) {
    return {
      ...base,
      abstention:
        "Falkon found the settlement batch job in ledger-service, but its retry schedule is set in a configuration file that isn’t in this Product’s repositories. Rather than guess, Falkon isn’t answering.",
      suggestions: [
        "Ask what the batch job does on failure, which is in ledger-service.",
        "If the schedule lives in a deploy repository, add it to Payments Platform.",
      ],
      evidence: [
        {
          id: 1,
          productId: product.id,
          generation,
          repository: "ledger-service",
          path: "src/settlement/SettlementBatchJob.java",
          revision: "a81e07d",
          startLine: 28,
          highlightedLines: [29],
          code: [
            '@Scheduled(cron = "${settlement.cron}")',
            "public void run() {",
            "  batches.settlePending(clock.now());",
            "}",
          ],
        },
      ],
    };
  }
  if (
    !/refund|ledger entr|payload|support console/i.test(question) ||
    !["checkout-web", "payments-api", "ledger-service"].every((name) =>
      available.has(name),
    )
  )
    return base;
  if (/payload|support console/i.test(question))
    return {
      ...base,
      kind: "partial",
      abstention: null,
      paragraphs: [
        {
          text: "The support console builds the same CreateRefundDto, but adds an operatorId field [4] that the payments-api handler ignores [5].",
          citations: [4, 5],
        },
      ],
      evidence: [
        {
          id: 4,
          productId: product.id,
          generation,
          repository: "checkout-web",
          path: "src/support/ConsoleRefund.ts",
          revision: "c09b44e",
          startLine: 12,
          highlightedLines: [13, 14, 15],
          code: [
            "export function toRefund(form: ConsoleForm) {",
            "  const dto: CreateRefundDto = {",
            "    orderId: form.orderId, amount: form.amount,",
            "    operatorId: form.operator.id,",
            "  };",
            "  return dto;",
            "}",
          ],
        },
        { ...refundEvidence(generation)[1], id: 5 },
      ],
      partialReasons: [
        "Falkon hit the 4,000-token evidence budget before reading the console’s form validation, so differences in validated values aren’t covered. Ask about the console form specifically to continue.",
      ],
      suggestions: [],
    };
  return {
    ...base,
    kind: "grounded",
    abstention: null,
    suggestions: [],
    paragraphs: [
      {
        text: "Two callers reach POST /v1/refunds: the checkout refund dialog [1] and the support console, which shares the same API client in checkout-web.",
        citations: [1],
      },
      {
        text: "The payments-api handler runs a fraud check, then delegates to RefundService.create [2]. That service posts a reversing entry to the ledger through ledger-service’s RefundPostingService [3]; nothing else in this Product is written.",
        citations: [2, 3],
      },
    ],
    evidence: refundEvidence(generation),
    gaps: [
      "1 unresolved target. The handler calls @acme/fraud-check, which is outside Payments Platform. Falkon can’t say whether it writes anything.",
    ],
  };
}
