"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { useWorkspace } from "@/components/layout/workspace-shell";
import {
  Alert,
  Button,
  ErrorState,
  LoadingMark,
} from "@/components/ui/primitives";
import { api } from "@/lib/api/client";
import { knowledgeLine } from "@/lib/knowledge";
import { generationAge } from "@/lib/format";
import { useMinute } from "@/lib/use-minute";
import { repoState } from "./repo-state";

export function StatusView() {
  const { product, status, statusError, refreshStatus, refresh } =
    useWorkspace();
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  useMinute(); // re-renders each minute; the age itself reads the real clock
  if (statusError)
    return (
      <ErrorState error={statusError} retry={() => void refreshStatus()} />
    );
  if (!status) return <LoadingMark />;
  const building = status.build === "building";
  const kbLine = knowledgeLine(status.knowledge);
  async function syncNow() {
    setBusy(true);
    setActionError("");
    try {
      await api.sync(product.id, { action: "retry" });
      await refresh();
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : "The sync could not be started. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="page">
      <header className="status-head">
        <div>
          <h1 className="vh">{status.verdict}</h1>
          <p className="vs">
            {status.generation ? (
              <>
                <span className="mono">{status.generation}</span>{status.generationAt !== null &&
                  ` · published ${generationAge(status.generationAt)}`}
              </>
            ) : (
              "No generation published yet"
            )}
          </p>
        </div>
        <Button variant="primary" busy={busy} onClick={() => void syncNow()}>
          <RefreshCw size={16} />
          Sync now
        </Button>
      </header>
      {building && (
        <progress
          className="progress"
          max={100}
          value={status.progress}
          aria-label="Build progress"
        />
      )}
      {actionError && <Alert tone="err">{actionError}</Alert>}
      <table className="repo-table">
        <thead>
          <tr>
            <th>Repository</th>
            <th>Branch</th>
            <th>State</th>
          </tr>
        </thead>
        <tbody>
          {product.repositories.map((repo) => {
            const state = repoState(repo, status);
            return (
              <tr key={repo.id}>
                <td title={repo.id}>{repo.name}</td>
                <td className="mono">{repo.branch}</td>
                <td>
                  <span className={`state ${state.tone}`}>
                    <span className="pdot" />
                    {state.label}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {kbLine && <p className="vs">{kbLine}</p>}
      {status.gaps.length > 0 && (
        <section className="gaps">
          <h2>Gaps</h2>
          {status.gaps.map((gap) => (
            <div className="rw" key={`${gap.title}:${gap.detail}`}>
              <span className="num">{gap.count}</span>
              <div className="t">
                {gap.title}
                <small>{gap.detail}</small>
              </div>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
