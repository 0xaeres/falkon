"use client";
import Link from "next/link";
import { useState } from "react";
import type { KnowledgeActionRequest } from "@falkon/contracts";
import { useWorkspace } from "@/components/layout/workspace-shell";
import { Alert, Button } from "@/components/ui/primitives";
import { api } from "@/lib/api/client";
import { knowledgeLine } from "@/lib/knowledge";

const ACTIONS = [
  ["scan", "Scan"],
  ["delete", "Delete"],
  ["include", "Include"],
] as const;

/** Delete destroys generated docs (regenerating costs model tokens): its first press only arms a confirmation. */
export function press(
  armed: string,
  repo: string,
  action: KnowledgeActionRequest["action"],
) {
  return action === "delete" && armed !== repo
    ? { armed: repo, send: false }
    : { armed: "", send: true };
}

export function SettingsView() {
  const { product, status, refresh } = useWorkspace();
  const [busy, setBusy] = useState("");
  const [armed, setArmed] = useState("");
  const [actionError, setActionError] = useState("");
  const kb = status?.knowledge;
  const kbLine = knowledgeLine(kb);
  // One request at a time: a double click cannot send the same action twice.
  async function ask(repo: string, action: KnowledgeActionRequest["action"]) {
    const step = press(armed, repo, action);
    setArmed(step.armed);
    if (!step.send) return;
    setBusy(repo);
    setActionError("");
    try {
      await api.knowledge(product.id, { repo, action });
      await refresh();
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : "The request could not be sent. Try again.",
      );
    } finally {
      setBusy("");
    }
  }
  return (
    <div className="page">
      <h1>Settings</h1>
      <p className="muted">{product.name}</p>
      <section className="page-section">
        <h2>Product</h2>
        <dl className="review-dl">
          <dt>productId</dt>
          <dd className="mono">{product.id}</dd>
          <dt>Code host</dt>
          <dd>{product.host}</dd>
          <dt>Repositories</dt>
          <dd>{product.repositories.length} connected</dd>
        </dl>
        <Link className="btn" href={`/setup?edit=${product.id}`}>
          Edit repositories
        </Link>
      </section>
      {kb && (
        <section className="page-section">
          <h2>Knowledge base</h2>
          {kb.state === "off" ? (
            <p className="muted">
              The knowledge base is turned off in the config.
            </p>
          ) : (
            <>
              {kbLine && <p className="muted">{kbLine}</p>}
              {actionError && <Alert tone="err">{actionError}</Alert>}
              <table className="repo-table">
                <tbody>
                  {product.repositories.map((repo) => (
                    <tr key={repo.id}>
                      <td title={repo.id}>{repo.name}</td>
                      <td>
                        {ACTIONS.map(([action, label]) => (
                          <Button
                            key={action}
                            disabled={busy !== ""}
                            busy={busy === repo.id}
                            onClick={() => void ask(repo.id, action)}
                          >
                            {armed === repo.id && action === "delete"
                              ? "Confirm delete"
                              : label}
                          </Button>
                        ))}
                        {armed === repo.id && (
                          <Button onClick={() => setArmed("")}>Cancel</Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </section>
      )}
    </div>
  );
}
