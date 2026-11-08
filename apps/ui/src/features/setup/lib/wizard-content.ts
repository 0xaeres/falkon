import type { Provider } from "@falkon/contracts";

export const providers: {
  id: Provider;
  name: string;
  description: string;
  host: string;
}[] = [
  {
    id: "github",
    name: "GitHub",
    description: "github.com",
    host: "https://github.com",
  },
  {
    id: "github-enterprise",
    name: "GitHub Enterprise",
    description: "Self-hosted",
    host: "",
  },
];
export const steps = ["Connect", "Name", "Repositories", "Review"];
export const stepNotes = [
  "Code host and token",
  "How teams refer to it",
  "What Falkon reads",
  "Confirm and index",
];
export const titles = [
  "Connect a code host",
  "Name the Product",
  "Choose repositories",
  "Review and start indexing",
];
export const descriptions = [
  "Falkon reads repositories through this connection. Use a token with read-only access to the repositories you want.",
  "A Product groups the repositories Falkon answers questions about together. Name it the way your teams already refer to it.",
  "Falkon pins each repository at the head of its branch and builds evidence from what it contains.",
  "Falkon clones each repository, indexes it, and shows progress on the status page.",
];
export function slug(name: string) {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64)
    .replace(/-$/g, "");
}
