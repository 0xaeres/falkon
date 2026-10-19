"use client";
import { useState } from "react";
import Link from "next/link";
import { useWorkspace } from "@/components/layout/workspace-shell";
import { Select } from "@/components/ui/select";
import { Alert } from "@/components/ui/primitives";
import { api } from "@/lib/api/client";
import { scenarioSchema, type Scenario } from "@/lib/contracts";
const scenarios: Record<Scenario, string> = {
  "partly-behind": "Partly behind — failed sync",
  current: "Current",
  updating: "Updating",
  building: "Building first generation",
  behind: "Behind — freshness target missed",
  failed: "New generation failed",
  "overlay-unavailable": "Overlay unavailable",
};
export function SettingsView() {
  const { product, status, refresh } = useWorkspace();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function change(value: string) {
    setBusy(true);
    setError("");
    try {
      await api.sync(product.id, {
        action: "scenario",
        scenario: scenarioSchema.parse(value),
      });
      await refresh();
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Couldn’t change the mock scenario.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="settings-page">
      <h1>Settings</h1>
      <p className="muted">{product.name}</p>
      <section className="settings-section">
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
      <section className="settings-section">
        <h2>Preview data</h2>
        <p className="muted">
          This app uses synthetic data from the local Next.js API. Choose a
          status scenario to inspect its UI.
        </p>
        <div className="settings-row">
          <label htmlFor="scenario">Status scenario</label>
          <Select
            id="scenario"
            label="Status scenario"
            disabled={busy}
            value={status?.scenario ?? product.scenario}
            onValueChange={(value) => void change(value)}
            options={scenarioSchema.options.map((value) => ({
              value,
              label: scenarios[value],
            }))}
          />
        </div>
        <p className="help settings-note">
          New Product builds publish after 15 seconds. Scenario previews remain
          fixed until changed. Threads and Product choices persist in the local
          mock store.
        </p>
        {error && <Alert tone="err">{error}</Alert>}
      </section>
    </div>
  );
}
