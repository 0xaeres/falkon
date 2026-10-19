import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/ui/brand";
export const metadata: Metadata = { title: "Docs" };
export default function DocsPage() {
  return (
    <main id="main" className="document-page">
      <Link href="/">
        <Logo />
      </Link>
      <h1>Working with Product context</h1>
      <p>
        Falkon answers questions about one Product at a time. A Product groups
        its repositories; the visible Product switcher sets the scope for
        status, chat, and threads.
      </p>
      <h2>Set up a Product</h2>
      <p>
        Connect a code host, name the Product, choose repositories and branches,
        then queue ingestion. Jira and Confluence are not yet available.
      </p>
      <h2>Read the status</h2>
      <p>
        An Evidence Generation publishes only when it is coherent and validated.
        Until its replacement publishes, answers use the previous active
        generation. The status view distinguishes failed sync, delayed
        publication, and coverage gaps.
      </p>
      <h2>Verify an answer</h2>
      <p>
        Each answer records its generation and numbered citations. Select a
        citation to read the exact source excerpt at its pinned revision.
        Partial results name their limits. Abstentions explain what evidence is
        missing. Semantic predictions are hints, never source evidence.
      </p>
      <h2>Local demo</h2>
      <p>
        All Products, repositories, answers, and excerpts in this app are
        synthetic. No real code host, identity provider, or ingestion service is
        connected. The demo token is <code>demo-readonly</code>; never enter
        real credentials here. Mock source excerpts are not hosted on GitHub.
      </p>
      <p>
        Try a refund question for a grounded answer, a support-console payload
        question for a partial answer, or an overnight settlement schedule
        question for an abstention. Other questions abstain. Append{" "}
        <code>[network-error]</code> or <code>[access-error]</code> to a
        question to preview those failure states.
      </p>
      <Link href="/setup" className="btn pri">
        Set up a Product
      </Link>{" "}
      <Link href="/" className="btn">
        Open status
      </Link>
    </main>
  );
}
