"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import useSWR, { useSWRConfig } from "swr";
import { Check, Clock, Info, LockKeyhole } from "lucide-react";
import { Logo, ProviderLogo } from "@/components/ui/brand";
import {
  Alert,
  Badge,
  Button,
  ErrorState,
  LoadingMark,
} from "@/components/ui/primitives";
import { api, keys } from "@/lib/api/client";
import type { Product, Provider } from "@sbc/contracts";
import { connectReady, connectRequest, type Method } from "./connect-method";
const RepositoryPicker = dynamic(() => import("./repository-picker"), {
  loading: () => <LoadingMark label="Loading repository picker" />,
});
const providers: {
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
    host: "https://github.acme.internal",
  },
];
const steps = ["Connect", "Name", "Repositories", "Sources", "Queue"];
const titles = [
  "Connect a code host",
  "Name the Product",
  "Choose repositories",
  "Other sources",
  "Review and queue ingestion",
];
const descriptions = [
  "Falkon reads repositories through this connection. This local demo simulates a connection; use demo values only.",
  "A Product groups the repositories Falkon answers questions about together. Name it the way your teams already refer to it.",
  "Falkon pins each repository at the head of its branch and builds evidence from what it contains.",
  "This release builds evidence from repository contents only. These sources are planned; nothing is connected or read from them.",
  "Falkon acquires each repository at its pinned revision, extracts evidence, and publishes the first Evidence Generation. You can follow it on the status page.",
];
function slug(name: string) {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64)
    .replace(/-$/g, "");
}
export function SetupWizard() {
  const searchParams = useSearchParams();
  const editId = searchParams.get("edit");
  const {
    data: edit,
    error,
    mutate,
  } = useSWR(editId ? keys.product(editId) : null, api.product);
  if (error) return <ErrorState error={error} retry={() => void mutate()} />;
  if (editId && !edit) return <LoadingMark label="Loading Product setup" />;
  return <Wizard key={editId ?? "new"} edit={edit} />;
}
function Wizard({ edit }: { edit?: Product }) {
  const router = useRouter();
  const { mutate } = useSWRConfig();
  const { data: products } = useSWR(keys.products, api.products);
  const [connection, setConnection] = useState(
    edit?.connectionId ? { id: edit.connectionId, host: edit.host } : null,
  );
  const {
    data: catalog,
    error: repoError,
    mutate: reloadRepos,
  } = useSWR(
    connection ? keys.repositories(connection.id) : null,
    api.repositories,
  );
  const [step, setStep] = useState(edit ? 2 : 0);
  const [provider, setProvider] = useState<Provider>(
    edit?.provider ?? "github-enterprise",
  );
  const [host, setHost] = useState(
    edit ? `https://${edit.host}` : "https://github.acme.internal",
  );
  const [token, setToken] = useState("");
  const [method, setMethod] = useState<Method>("token");
  const [appId, setAppId] = useState("");
  // Held in memory only; cleared once the connection is created. Never stored client-side or logged.
  const [privateKey, setPrivateKey] = useState("");
  const [installations, setInstallations] = useState<
    { id: string; account: string }[] | null
  >(null);
  const [installationId, setInstallationId] = useState("");
  const [name, setName] = useState(edit?.name ?? "");
  const [selected, setSelected] = useState<Record<string, string>>(
    edit
      ? Object.fromEntries(
          edit.repositories.map((repo) => [repo.id, repo.branch]),
        )
      : {
          "payments-api": "main",
          "ledger-service": "main",
          "checkout-web": "release/2026.10",
          "payments-infra": "main",
        },
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  const previousStep = useRef(step);
  useEffect(() => {
    if (step !== previousStep.current && step !== 1)
      heading.current?.focus({ preventScroll: true });
    previousStep.current = step;
  }, [step]);
  const id = edit?.id ?? slug(name);
  const available = !products?.some(
    (product) => product.id === id && product.id !== edit?.id,
  );
  const repositories = [
    ...(edit?.repositories ?? []),
    ...(catalog ?? []).filter(
      (repo) => !edit?.repositories.some((item) => item.id === repo.id),
    ),
  ];
  const picked = repositories.filter((repo) => selected[repo.id]);
  const disabled =
    busy ||
    (step === 0 &&
      !connectReady(method, { token, appId, privateKey, installationId })) ||
    (step === 1 && (!id || !name.trim() || !available || !products)) ||
    (step === 2 && (!picked.length || !!repoError || !catalog));
  function nextStep(value: number) {
    setError("");
    setStep(value);
  }
  function resetInstallations() {
    setInstallations(null);
    setInstallationId("");
    setError("");
  }
  function readKeyFile(file: File | undefined) {
    if (!file) return;
    const reader = new FileReader();
    if (file.size > 16_000) {
      setError("That file is too large for a private key.");
      return;
    }
    reader.onerror = () => setError("Could not read that file. Try again.");
    reader.onload = () => {
      setPrivateKey(String(reader.result));
      resetInstallations();
    };
    reader.readAsText(file);
  }
  async function findInstallations() {
    setBusy(true);
    setError("");
    try {
      const found = await api.installations({ host, appId, privateKey });
      setInstallations(found);
      setInstallationId(found.length === 1 ? found[0]!.id : "");
      if (!found.length)
        setError(
          "This GitHub App has no installations. Install it on the account that owns the repositories.",
        );
    } catch (error) {
      // The key stays in state so the user can retry.
      setInstallations(null);
      setError(
        error instanceof Error
          ? error.message
          : "Could not list installations. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (disabled) return;
    setError("");
    if (step === 0) {
      setBusy(true);
      try {
        const connected = await api.connect(
          connectRequest(method, {
            provider,
            host,
            token,
            appId,
            privateKey,
            installationId,
          }),
        );
        setConnection(connected);
        setToken("");
        setPrivateKey("");
        resetInstallations();
        setStep(1);
      } catch (error) {
        // The key stays in state so the user can retry.
        setError(
          error instanceof Error
            ? error.message
            : "Connection failed. Try again.",
        );
      } finally {
        setBusy(false);
      }
    } else if (step < 4) setStep(step + 1);
    else {
      setBusy(true);
      try {
        const repositories = picked.map((repo) => ({
          id: repo.id,
          branch: selected[repo.id],
        }));
        if (edit) await api.edit(id, { name: name.trim(), repositories });
        else
          await api.setup({
            id,
            name: name.trim(),
            provider,
            host: connection?.host ?? new URL(host).host,
            connectionId: connection!.id,
            repositories,
          });
        await mutate(keys.products);
        if (edit) await mutate(keys.product(id));
        router.push(`/${id}/status?queued=1`);
      } catch (error) {
        setError(
          error instanceof Error
            ? error.message
            : "Ingestion could not be queued. Your choices are kept; try again.",
        );
        setBusy(false);
      }
    }
  }
  return (
    <>
      <header className="top">
        <Link href="/" aria-label="Falkon home">
          <Logo />
        </Link>
        <span className="slash">/</span>
        <span className="crumb">
          {edit ? "Edit repositories" : "New Product"}
        </span>
        {name && (
          <>
            <span className="slash product-crumb">/</span>
            <span className="crumb product-crumb">{name}</span>
          </>
        )}
        <span className="sp" />
        <Link href="/docs">Docs</Link>
        <span className="avatar">SS</span>
      </header>
      <main id="main" className="setup-body">
        <div className={`setup-wrap ${step === 2 ? "wide" : ""}`}>
          <div className="mobile-stepper">
            <div>
              <span>Step {step + 1} of 5</span>
              <span>{steps[step]}</span>
            </div>
            <progress
              max={5}
              value={step + 1}
              aria-label={`Step ${step + 1} of 5`}
            />
          </div>
          <ol className="stepper" aria-label="Product setup steps">
            {steps.map((label, index) => (
              <li
                className={index < step ? "done" : index === step ? "now" : ""}
                key={label}
                aria-current={index === step ? "step" : undefined}
              >
                <span className="n">
                  {index < step ? <Check size={12} /> : index + 1}
                </span>
                <span className="step-label">{label}</span>
              </li>
            ))}
          </ol>
          <form className="card" onSubmit={(event) => void submit(event)}>
            <header className="card-h">
              <h1 ref={heading} tabIndex={-1} key={step}>
                {titles[step]}
              </h1>
              <p className="desktop-description">{descriptions[step]}</p>
              <p className="mobile-description">
                {step === 2
                  ? "Pinned at the head of each branch."
                  : descriptions[step]}
              </p>
            </header>
            <div className="card-b">
              {step === 0 && (
                <>
                  <div className="prov" role="group" aria-label="Code host">
                    {providers.map((item) => (
                      <button
                        type="button"
                        key={item.id}
                        className={`pv ${provider === item.id ? "on" : ""}`}
                        aria-pressed={provider === item.id}
                        onClick={() => {
                          setProvider(item.id);
                          setHost(item.host);
                          setError("");
                        }}
                      >
                        <span className="radio" />
                        <ProviderLogo provider={item.id} />
                        <strong>{item.name}</strong>
                        <small>{item.description}</small>
                      </button>
                    ))}
                  </div>
                  <div className="field">
                    <label htmlFor="server-url">Server URL</label>
                    <input
                      className="input"
                      id="server-url"
                      disabled={busy}
                      autoFocus
                      type="url"
                      required
                      value={host}
                      onChange={(event) => {
                        setHost(event.target.value);
                        resetInstallations();
                      }}
                    />
                  </div>
                  <fieldset className="connection-method">
                    <legend>Connect with</legend>
                    <div
                      className="prov"
                      role="group"
                      aria-label="Connect with"
                    >
                      {(
                        [
                          ["token", "Personal access token"],
                          ["app", "GitHub App"],
                        ] as const
                      ).map(([id, label]) => (
                        <button
                          type="button"
                          key={id}
                          className={`pv ${method === id ? "on" : ""}`}
                          aria-pressed={method === id}
                          onClick={() => {
                            setMethod(id);
                            // The key must not survive a switch to token.
                            setPrivateKey("");
                            setAppId("");
                            resetInstallations();
                          }}
                        >
                          <span className="radio" />
                          <strong>{label}</strong>
                        </button>
                      ))}
                    </div>
                    {method === "token" ? (
                      <div className="field token-field">
                        <label htmlFor="demo-token">
                          Personal access token
                        </label>
                        <input
                          className={`input ${error ? "err" : ""}`}
                          id="demo-token"
                          type="password"
                          autoComplete="off"
                          value={token}
                          aria-invalid={!!error}
                          aria-describedby="token-help"
                          onChange={(event) => {
                            setToken(event.target.value);
                            setError("");
                          }}
                        />
                        <p className="help" id="token-help">
                          Use <code>demo-readonly</code>. No real token is
                          needed or stored.
                        </p>
                      </div>
                    ) : (
                      <>
                        <div className="field">
                          <label htmlFor="app-id">App ID</label>
                          <input
                            className="input"
                            id="app-id"
                            disabled={busy}
                            inputMode="numeric"
                            pattern="[0-9]{1,20}"
                            autoComplete="off"
                            value={appId}
                            onChange={(event) => {
                              setAppId(event.target.value.trim());
                              resetInstallations();
                            }}
                          />
                        </div>
                        <div className="field">
                          <label htmlFor="app-key">Private key (PEM)</label>
                          <textarea
                            className="input mono"
                            id="app-key"
                            disabled={busy}
                            rows={4}
                            autoComplete="off"
                            spellCheck={false}
                            aria-describedby="app-help"
                            style={{ height: "auto", padding: 12 }}
                            value={privateKey}
                            onChange={(event) => {
                              setPrivateKey(event.target.value);
                              resetInstallations();
                            }}
                          />
                          <input
                            type="file"
                            disabled={busy}
                            accept=".pem,text/plain"
                            aria-label="Load private key from a file"
                            onChange={(event) => {
                              readKeyFile(event.target.files?.[0]);
                              event.target.value = "";
                            }}
                          />
                          <p className="help" id="app-help">
                            The App needs read-only Contents and Metadata
                            permissions and must be installed on the
                            repositories to search. The key is sent once to
                            create the connection and is not kept in your
                            browser.
                          </p>
                        </div>
                        <Button
                          type="button"
                          disabled={busy || !appId || !privateKey}
                          onClick={() => void findInstallations()}
                        >
                          Find installations
                        </Button>
                        {!!installations?.length && (
                          <div
                            className="field"
                            role="radiogroup"
                            aria-label="Installation"
                          >
                            {installations.map((item) => (
                              <label key={item.id}>
                                <input
                                  type="radio"
                                  name="installation"
                                  checked={installationId === item.id}
                                  onChange={() => setInstallationId(item.id)}
                                />{" "}
                                {item.account}
                              </label>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </fieldset>
                </>
              )}
              {step === 1 && (
                <>
                  <div className="field">
                    <label htmlFor="product-name">Product name</label>
                    <input
                      className="input"
                      id="product-name"
                      autoFocus
                      placeholder="Payments Platform"
                      required
                      maxLength={80}
                      value={name}
                      onChange={(event) => {
                        setName(event.target.value);
                        setError("");
                      }}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="product-id">productId</label>
                    <div className="id-field input">
                      <input
                        id="product-id"
                        className="mono"
                        value={id}
                        readOnly
                      />
                      <Badge tone={id ? (available ? "green" : "red") : ""}>
                        {id
                          ? available
                            ? "Available"
                            : "Already in use"
                          : "Enter a name"}
                      </Badge>
                    </div>
                    <span className="help">
                      Used in API calls and by coding agents. It can’t be
                      changed after setup.
                    </span>
                  </div>
                  <div className="field last">
                    <span className="field-label">Connected as</span>
                    <div className="connected input">
                      <ProviderLogo provider={provider} size={14} />
                      <span>
                        {method === "app" ? "GitHub App" : "Token"} connection
                        on <strong>{connection?.host}</strong>
                      </span>
                      <Badge tone="green">
                        <Check size={12} />
                        Connected
                      </Badge>
                    </div>
                  </div>
                </>
              )}
              {step === 2 &&
                (repoError ? (
                  <ErrorState
                    error={repoError}
                    retry={() => void reloadRepos()}
                  />
                ) : catalog ? (
                  <RepositoryPicker
                    repositories={repositories}
                    selected={selected}
                    onChange={setSelected}
                  />
                ) : (
                  <LoadingMark label="Loading repositories" />
                ))}
              {step === 3 && (
                <>
                  <div className="source-row included">
                    <ProviderLogo provider={provider} />
                    <div className="t">
                      <strong>Repositories</strong>
                      <p>
                        {picked.length} repositories on {connection?.host}
                      </p>
                    </div>
                    <Badge tone="green">
                      <Check size={12} />
                      Included
                    </Badge>
                  </div>
                  {[
                    {
                      name: "Jira",
                      id: "jira" as const,
                      detail: "Issues and epics linked to this Product’s code",
                    },
                    {
                      name: "Confluence",
                      id: "confluence" as const,
                      detail: "Design docs and runbooks for this Product",
                    },
                  ].map((source) => (
                    <div className="source-row" key={source.id}>
                      <ProviderLogo provider={source.id} />
                      <div className="t">
                        <strong>{source.name}</strong>
                        <p>{source.detail}</p>
                      </div>
                      <Badge>
                        <Clock size={12} />
                        Not yet
                      </Badge>
                    </div>
                  ))}
                </>
              )}
              {step === 4 && (
                <dl className="review-dl">
                  <dt>Product</dt>
                  <dd>
                    <strong>{name}</strong>{" "}
                    <span className="mono muted">{id}</span>
                  </dd>
                  <dt>Code host</dt>
                  <dd className="review-host">
                    <ProviderLogo provider={provider} size={14} />
                    {
                      providers.find((item) => item.id === provider)?.name
                    } · {connection?.host}
                  </dd>
                  <dt>Repositories</dt>
                  <dd className="review-repos">
                    {picked.map((repo) => (
                      <div key={repo.id}>
                        <span>{repo.name} </span>
                        <span className="mono">
                          {selected[repo.id]} · {repo.revision}
                        </span>
                      </div>
                    ))}
                  </dd>
                  <dt>Other sources</dt>
                  <dd className="muted">None</dd>
                </dl>
              )}
              {error && (
                <div className="setup-error">
                  <Alert tone="err">
                    <strong>
                      {step === 4
                        ? "Ingestion wasn’t queued."
                        : "Connection not confirmed."}
                    </strong>
                    <p>{error}</p>
                  </Alert>
                </div>
              )}
            </div>
            <footer className="card-f">
              <span className={`hint ${step === 2 ? "repository-hint" : ""}`}>
                {step === 0 ? (
                  <>
                    <LockKeyhole size={16} />
                    Read-only demo. No connection is made to your code host.
                  </>
                ) : step === 2 ? (
                  <>
                    <Info size={16} className="amber" />
                    Each repository is read at the head of its chosen branch.
                  </>
                ) : step === 4 ? (
                  <>
                    <Clock size={16} />
                    Revisions are pinned when you queue.
                  </>
                ) : null}
              </span>
              {step === 2 && (
                <span className="mobile-selected">
                  {picked.length} selected
                </span>
              )}
              {step > (edit ? 2 : 0) && (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => nextStep(step - 1)}
                >
                  Back
                </Button>
              )}
              {edit && step === 2 && (
                <Link href={`/${edit.id}/status`} className="btn ghost">
                  Cancel
                </Link>
              )}
              <Button
                variant="primary"
                type="submit"
                busy={busy}
                disabled={disabled}
              >
                {step === 0
                  ? "Check connection"
                  : step === 4
                    ? edit
                      ? "Queue replacement"
                      : "Queue ingestion"
                    : "Continue"}
              </Button>
            </footer>
          </form>
        </div>
      </main>
    </>
  );
}
