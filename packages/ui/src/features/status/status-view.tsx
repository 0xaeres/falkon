"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  Check,
  FileText,
  Folder,
  Info,
  MessageCircle,
  Pencil,
  RefreshCw,
  X,
} from "lucide-react";
import { useWorkspace } from "@/components/layout/workspace-shell";
import {
  Alert,
  Badge,
  Button,
  ErrorState,
  LoadingMark,
} from "@/components/ui/primitives";
import { Select } from "@/components/ui/select";
import { ProviderLogo } from "@/components/ui/brand";
import { api } from "@/lib/api/client";
import { useDismissed } from "@/lib/dismissed";
import type { Status } from "@sbc/contracts";
import { knowledgeLine } from "@/lib/knowledge";

type Layer = "generation" | "sync" | "repositories";
const names: Record<Layer, string> = {
  generation: "Evidence Generation",
  sync: "Sync",
  repositories: "Repositories",
};
const icons = {
  generation: FileText,
  sync: RefreshCw,
  repositories: Folder,
};
const stages = ["Acquire", "Extract", "Index", "Validate", "Publish"];
function Stages({ status }: { status: Status }) {
  return (
    <>
      <ol className="stages" aria-label="Generation progress">
        {stages.map((stage, index) => (
          <li
            key={stage}
            className={`sg ${index < status.stage ? "d" : index === status.stage ? (status.build === "failed" ? "f" : "n") : "w"}`}
          >
            <span className="pdot" />
            {stage}
          </li>
        ))}
      </ol>
      {status.build === "building" && (
        <>
          <progress
            className="progress"
            max={100}
            value={status.progress}
            aria-label="Generation build progress"
          />
          <small className="build-description">
            {status.scenario === "building"
              ? `${stages[status.stage]} stage · ${status.progress}% complete`
              : "Indexing 822 of 1,284 changed units"}
          </small>
        </>
      )}
    </>
  );
}

export function StatusView() {
  const { product, status, statusError, refreshStatus, refresh } =
    useWorkspace();
  const searchParams = useSearchParams();
  const [chosen, setChosen] = useState<Layer | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [toast, setToast] = useState(searchParams.get("queued") === "1");
  const [dismissed, setDismissed] = useDismissed(product.id);
  if (statusError)
    return (
      <ErrorState error={statusError} retry={() => void refreshStatus()} />
    );
  if (!status) return <LoadingMark />;
  const selected = chosen ?? (status.sync === "failed" ? "sync" : "generation");
  const count = product.repositories.length;
  const generationTone =
    status.build === "failed"
      ? "red"
      : status.build === "building"
        ? "blue"
        : "green";
  const generationLabel =
    status.build === "failed"
      ? "Build failed"
      : status.build === "building"
        ? status.generation
          ? "Updating"
          : "Building"
        : "Current";
  const syncTone =
    status.sync === "failed" ? "red" : status.sync === "current" ? "green" : "";
  const syncLabel =
    status.sync === "failed"
      ? "1 failed"
      : status.sync === "pinned"
        ? "Pinned"
        : "Current";
  const layers: { id: Layer; summary: string; tone: string; label: string }[] =
    [
      {
        id: "generation",
        summary: status.generation
          ? `${status.generation} active · ${status.nextGeneration ? `${status.nextGeneration} ${status.build === "failed" ? "failed validation" : "building, index stage"}` : `published ${status.generationAge}`}`
          : `${status.nextGeneration} building, ${stages[status.stage].toLowerCase()} stage`,
        tone: generationTone,
        label: generationLabel,
      },
      {
        id: "sync",
        summary:
          status.sync === "failed"
            ? `${Math.max(0, count - 1)} current · payments-infra failed since 09:12`
            : status.sync === "pinned"
              ? `${count} repositories pinned for the first build`
              : `${count} repositories current`,
        tone: syncTone,
        label: syncLabel,
      },
      {
        id: "repositories",
        summary: `${count} on ${product.host}`,
        tone: "",
        label: String(count),
      },
    ];
  const kbLine = knowledgeLine(status.knowledge);
  const selectedLayer = layers.find((layer) => layer.id === selected)!;
  const navigationLayers = layers;
  async function retry() {
    setBusy(true);
    setActionError("");
    try {
      await api.sync(product.id, { action: "retry" });
      setDismissed(false);
      await refresh();
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : "The sync could not be retried. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  const coverage = (
    <section className="sec">
      <h3>
        Coverage gaps <span className="hint">in {status.generation}</span>
      </h3>
      {status.gaps.length ? (
        status.gaps.map((gap) => (
          <div className="rw" key={gap.title}>
            <span className="num">{gap.count}</span>
            <div className="t">
              {gap.title}
              <small>{gap.detail}</small>
            </div>
          </div>
        ))
      ) : (
        <p className="muted">No coverage gaps reported for this generation.</p>
      )}
    </section>
  );
  const selectedIcon = icons[selected];
  const Icon = selectedIcon;
  return (
    <>
      {toast && (
        <div className="toast" role="status">
          <Check size={16} className="green" />
          Ingestion queued. You can follow the build here.
          <button
            className="icon-btn"
            aria-label="Dismiss notification"
            onClick={() => setToast(false)}
          >
            <X size={14} />
          </button>
        </div>
      )}
      <div className="status-layout">
        <nav className="status-nav" aria-label="Context status sections">
          <h2 className="status-nav-title">Context status</h2>
          <div className="status-nav-items">
            {navigationLayers.map((layer) => {
              const Icon = icons[layer.id];
              return (
                <button
                  key={layer.id}
                  className={`status-nav-item`}
                  aria-current={layer.id === selected ? "true" : undefined}
                  aria-controls="status-detail"
                  onClick={() => setChosen(layer.id)}
                >
                  <Icon size={17} aria-hidden="true" />
                  <span>
                    <strong>{names[layer.id]}</strong>
                    <small className={layer.tone}>
                      <span className="pdot" />
                      {layer.label}
                    </small>
                  </span>
                </button>
              );
            })}
          </div>
          <label className="sr-only" htmlFor="status-section">
            Status section
          </label>
          <Select
            id="status-section"
            label="Status section"
            className="status-section-select"
            value={selected}
            onValueChange={(value) => {
              const layer = layers.find((layer) => layer.id === value);
              if (layer) setChosen(layer.id);
            }}
            options={navigationLayers.map((layer) => ({
              value: layer.id,
              label: `${names[layer.id]} · ${layer.label}`,
            }))}
          />
          <div className="status-nav-footer">
            <span>Active evidence</span>
            <strong className="mono">{status.generation ?? "None yet"}</strong>
            <small>
              {status.generation
                ? `Published ${status.generationAge}`
                : "First generation building"}
            </small>
          </div>
        </nav>
        <div className="status-workspace">
          <header className="status-overview">
            <div>
              <h1 className="vh">{status.verdict}</h1>
              <p className="vs">{status.sentence}</p>
              {kbLine && <p className="vs">{kbLine}</p>}
            </div>
            <div className="acts">
              {status.generation ? (
                <Link className="btn pri" href={`/${product.id}/chat`}>
                  <MessageCircle size={16} />
                  Open chat
                </Link>
              ) : (
                <Button variant="primary" disabled>
                  <MessageCircle size={16} />
                  Open chat
                </Button>
              )}
              <Link className="btn" href={`/setup?edit=${product.id}`}>
                <Pencil size={16} />
                Edit repositories
              </Link>
            </div>
          </header>
          {!status.generation && (
            <p className="dis-note">
              <Info size={14} />
              Chat opens when the first Evidence Generation is published.
            </p>
          )}
          <section
            id="status-detail"
            className="status-pane"
            aria-label={`${names[selected]} detail`}
          >
            <header className="ph">
              <Icon size={17} className={selectedLayer.tone} />
              <div className="status-section-heading">
                <h2>{names[selected]}</h2>
                <p>{selectedLayer.summary}</p>
              </div>
              <Badge tone={selectedLayer.tone} dot>
                {selectedLayer.label}
              </Badge>
              {selected === "repositories" && (
                <Link
                  className="btn sm pane-edit"
                  href={`/setup?edit=${product.id}`}
                >
                  <Pencil size={14} />
                  Edit
                </Link>
              )}
            </header>
            {selected === "sync" && (
              <>
                {status.sync === "failed" ? (
                  <section className="sec first">
                    <Alert tone="err">
                      <strong>payments-infra hasn’t synced since 09:12</strong>
                      <br />5 of 5 attempts failed. {product.host} returned{" "}
                      <code>502 Bad Gateway</code> while Falkon fetched revision{" "}
                      <code>8e1c2f4</code>. Answers still use the last synced
                      state, <code>5d7713a</code>.
                    </Alert>
                    <div className="acts compact">
                      <Button
                        variant="primary"
                        className="sm"
                        busy={busy}
                        onClick={() => void retry()}
                      >
                        <RefreshCw size={14} />
                        Retry sync
                      </Button>
                      {!dismissed && (
                        <Button
                          variant="ghost"
                          className="sm"
                          disabled={busy}
                          onClick={() => setDismissed(true)}
                        >
                          Dismiss
                        </Button>
                      )}
                    </div>
                    {dismissed && (
                      <p className="dis-note">
                        Failure highlight dismissed. The repository is still
                        behind.
                      </p>
                    )}
                  </section>
                ) : (
                  <div className="calm">
                    <div className="ok">
                      <Check size={22} />
                    </div>
                    <strong>
                      {status.sync === "pinned"
                        ? "All repositories pinned"
                        : "All repositories current"}
                    </strong>
                    <p className="muted">
                      {status.sync === "pinned"
                        ? "The first build is reading the pinned source revisions."
                        : "Nothing waiting to sync."}
                    </p>
                  </div>
                )}
                <section className="sec">
                  <h3>Repositories</h3>
                  {product.repositories.map((repo) => (
                    <div className="rw" key={repo.id}>
                      <span
                        className={`pdot ${repo.id === "payments-infra" && status.sync === "failed" ? "red" : "green"}`}
                      />
                      <div className="t">
                        {repo.name}
                        <small>
                          {repo.id === "payments-infra" &&
                          status.sync === "failed"
                            ? "Failed since 09:12"
                            : status.sync === "pinned"
                              ? "Pinned for first build"
                              : "Synced 14 min ago"}
                        </small>
                      </div>
                      <span className="mono revision">{repo.revision}</span>
                    </div>
                  ))}
                </section>
              </>
            )}
            {selected === "generation" && (
              <>
                {status.build === "failed" && (
                  <section className="sec first">
                    <Alert tone="err">
                      <strong>
                        {status.nextGeneration} failed validation and was not
                        published
                      </strong>
                      <br />
                      Its graph for checkout-web was missing 3 declaration units
                      present in the revision manifest. Nothing changed for
                      answers: they still use <code>{status.generation}</code>.
                      Falkon builds again on the next change.
                    </Alert>
                    <Button
                      className="sm retry-build"
                      onClick={() => void retry()}
                      busy={busy}
                    >
                      <RefreshCw size={14} />
                      Retry build
                    </Button>
                  </section>
                )}
                <dl className="kv">
                  <dt>Active</dt>
                  <dd>
                    {status.generation ? (
                      <>
                        <span className="mono">{status.generation}</span> ·
                        published {status.generationAge}
                      </>
                    ) : (
                      <span className="muted">None yet</span>
                    )}
                  </dd>
                  <dt>
                    {status.build === "failed"
                      ? "Failed"
                      : status.generation
                        ? "In flight"
                        : "Building"}
                  </dt>
                  <dd>
                    {status.nextGeneration ? (
                      <>
                        <span className="mono">{status.nextGeneration}</span> ·{" "}
                        {status.build === "failed"
                          ? "validate stage"
                          : status.generation
                            ? "started 2 min ago · routine edit"
                            : "queued just now"}
                        <Stages status={status} />
                      </>
                    ) : (
                      <span className="muted">Nothing waiting</span>
                    )}
                  </dd>
                  <dt>Freshness target</dt>
                  <dd>
                    Routine edits answerable within 5 min
                    {status.verdict === "Behind" && (
                      <span className="amber"> · missed by 36 min</span>
                    )}
                  </dd>
                </dl>
                {status.generation ? (
                  coverage
                ) : (
                  <section className="sec">
                    <Alert>
                      A first build reads every file, so it takes longer than
                      routine updates. You can leave this page; the status is
                      kept.
                    </Alert>
                  </section>
                )}
              </>
            )}
            {selected === "repositories" && (
              <>
                <section className="sec first">
                  {product.repositories.map((repo) => (
                    <div className="repo-r" key={repo.id}>
                      <ProviderLogo provider={product.provider} size={14} />
                      <strong>{repo.name}</strong>
                      <span className="sp" />
                      <span className="mono muted">{repo.branch}</span>
                    </div>
                  ))}
                </section>
                <section className="sec">
                  <Alert>
                    Adding a repository or changing a branch pins new revisions
                    and builds a replacement generation. Answers keep using the
                    current one until it publishes.
                  </Alert>
                </section>
              </>
            )}
            {actionError && (
              <section className="sec">
                <Alert tone="err">{actionError}</Alert>
              </section>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
