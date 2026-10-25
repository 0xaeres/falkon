"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import useSWR, { useSWRConfig } from "swr";
import { Check, Clock, GitBranch, Info, LockKeyhole } from "lucide-react";
import { Mark, ProviderLogo } from "@/components/ui/brand";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
} from "@/components/ui/card";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { ErrorState, LoadingMark, Notice } from "@/components/ui/primitives";
import { api, keys } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import type { Product, Provider } from "@falkon/contracts";
import { RepositoryPickerSkeleton } from "./repository-picker";
const RepositoryPicker = dynamic(() => import("./repository-picker"), {
  loading: () => <RepositoryPickerSkeleton />,
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
    host: "",
  },
];
const steps = ["Connect", "Name", "Repositories", "Review"];
const stepNotes = [
  "Code host and token",
  "How teams refer to it",
  "What Falkon reads",
  "Confirm and index",
];
const titles = [
  "Connect a code host",
  "Name the Product",
  "Choose repositories",
  "Review and start indexing",
];
const descriptions = [
  "Falkon reads repositories through this connection. Use a token with read-only access to the repositories you want.",
  "A Product groups the repositories Falkon answers questions about together. Name it the way your teams already refer to it.",
  "Falkon pins each repository at the head of its branch and builds evidence from what it contains.",
  "Falkon clones each repository, indexes it, and shows progress on the status page.",
];
function slug(name: string) {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
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
    (edit?.provider === "git" ? undefined : edit?.provider) ?? "github", // config Products over plain git are never edited here
  );
  const [host, setHost] = useState(
    edit ? `https://${edit.host}` : "https://github.com",
  );
  const [token, setToken] = useState("");
  const [name, setName] = useState(edit?.name ?? "");
  const [selected, setSelected] = useState<Record<string, string>>(
    edit
      ? Object.fromEntries(
          edit.repositories.map((repo) => [repo.id, repo.branch]),
        )
      : {},
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
    (step === 0 && !token) ||
    (step === 1 && (!id || !name.trim() || !available || !products)) ||
    (step === 2 && (!picked.length || !!repoError || !catalog));
  function nextStep(value: number) {
    setError("");
    setStep(value);
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (disabled) return;
    setError("");
    if (step === 0) {
      setBusy(true);
      try {
        const connected = await api.connect({
          provider,
          host,
          method: "token",
          token,
        });
        setConnection(connected);
        setToken("");
        setStep(1);
      } catch (error) {
        setError(
          error instanceof Error
            ? error.message
            : "Connection failed. Try again.",
        );
      } finally {
        setBusy(false);
      }
    } else if (step < 3) setStep(step + 1);
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
        router.push(`/${id}/status`);
      } catch (error) {
        setError(
          error instanceof Error
            ? error.message
            : "Indexing could not be started. Your choices are kept; try again.",
        );
        setBusy(false);
      }
    }
  }
  const providerName = providers.find((item) => item.id === provider)?.name;
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b bg-sidebar px-4">
        <Link
          href="/"
          aria-label="Falkon home"
          className="grid size-8 place-items-center text-foreground"
        >
          <Mark size={22} />
        </Link>
        <span className="text-input" aria-hidden="true">
          /
        </span>
        <span className="text-[0.8125rem] font-medium">
          {edit ? "Edit repositories" : "New Product"}
        </span>
        {name && (
          <>
            <span className="hidden text-input sm:inline" aria-hidden="true">
              /
            </span>
            <span className="hidden truncate text-[0.8125rem] text-muted-foreground sm:inline">
              {name}
            </span>
          </>
        )}
      </header>
      <main
        id="main"
        className="flex-1 bg-[radial-gradient(ellipse_80%_50%_at_50%_-10%,#16161a,transparent)]"
      >
        <div className="mx-auto grid w-full max-w-[1120px] grid-cols-12 gap-x-6 gap-y-6 px-4 py-6 md:px-8 md:py-12">
          <div className="col-span-12 flex flex-col gap-2 lg:hidden">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>
                Step {step + 1} of {steps.length}
              </span>
              <span className="font-medium text-foreground">{steps[step]}</span>
            </div>
            <Progress
              value={((step + 1) / steps.length) * 100}
              aria-label={`Step ${step + 1} of ${steps.length}`}
              className="h-1"
            />
          </div>
          <aside className="col-span-3 hidden lg:block">
            <div className="sticky top-12 flex flex-col gap-6">
              <div>
                <h2 className="text-[0.9375rem] font-semibold tracking-[-0.01em]">
                  {edit ? `Edit ${edit.name}` : "Set up a Product"}
                </h2>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {edit
                    ? "Change which repositories and branches it reads."
                    : "Four steps. Indexing starts when you confirm."}
                </p>
              </div>
              <ol aria-label="Product setup steps" className="flex flex-col">
                {steps.map((label, index) => {
                  const done = index < step;
                  const now = index === step;
                  return (
                    <li
                      key={label}
                      aria-current={now ? "step" : undefined}
                      className="relative grid grid-cols-[24px_1fr] gap-x-3 pb-6 last:pb-0"
                    >
                      {index < steps.length - 1 && (
                        <span
                          aria-hidden="true"
                          className={cn(
                            "absolute top-7 bottom-1 left-[11.5px] w-px bg-border",
                            done && "bg-foreground/40",
                          )}
                        />
                      )}
                      <span
                        className={cn(
                          "z-10 grid size-6 place-items-center rounded-full border bg-background font-mono text-[0.6875rem] text-faint transition-colors",
                          now &&
                            "border-foreground bg-foreground text-background",
                          done &&
                            "border-foreground/40 bg-secondary text-foreground",
                        )}
                      >
                        {done ? <Check className="size-3" /> : index + 1}
                      </span>
                      <div className="pt-0.5">
                        <div
                          className={cn(
                            "text-[0.8125rem] font-medium",
                            !now && !done && "text-muted-foreground",
                          )}
                        >
                          {label}
                        </div>
                        <div className="text-xs text-faint">
                          {stepNotes[index]}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>
          </aside>
          <form
            className="col-span-12 lg:col-span-9"
            onSubmit={(event) => void submit(event)}
          >
            <Card>
              <CardHeader className="border-b px-6 pt-6 pb-5">
                <h1
                  ref={heading}
                  tabIndex={-1}
                  key={step}
                  className="text-xl font-semibold tracking-[-0.015em] outline-none"
                >
                  {titles[step]}
                </h1>
                <CardDescription className="max-w-[62ch] text-[0.8125rem] leading-relaxed">
                  {descriptions[step]}
                </CardDescription>
              </CardHeader>
              <CardContent className="px-6 py-6">
                {step === 0 && (
                  <FieldGroup>
                    <RadioGroup
                      aria-label="Code host"
                      value={provider}
                      onValueChange={(value) => {
                        const item = providers.find(
                          (entry) => entry.id === value,
                        )!;
                        setProvider(item.id);
                        setHost(item.host);
                        setError("");
                      }}
                      className="grid grid-cols-1 gap-3 sm:grid-cols-2"
                    >
                      {providers.map((item) => (
                        <FieldLabel
                          key={item.id}
                          htmlFor={`provider-${item.id}`}
                          className="has-data-[state=checked]:border-foreground/50 has-data-[state=checked]:bg-accent/40"
                        >
                          <Field
                            orientation="horizontal"
                            className="items-center"
                          >
                            <ProviderLogo provider={item.id} size={18} />
                            <FieldContent>
                              <FieldTitle>{item.name}</FieldTitle>
                              <FieldDescription className="text-xs">
                                {item.description}
                              </FieldDescription>
                            </FieldContent>
                            <RadioGroupItem
                              value={item.id}
                              id={`provider-${item.id}`}
                            />
                          </Field>
                        </FieldLabel>
                      ))}
                    </RadioGroup>
                    <Field>
                      <FieldLabel htmlFor="server-url">Server URL</FieldLabel>
                      <Input
                        id="server-url"
                        autoFocus
                        type="url"
                        required
                        value={host}
                        placeholder="https://github.example.com"
                        onChange={(event) => setHost(event.target.value)}
                      />
                    </Field>
                    <Field data-invalid={!!error || undefined}>
                      <FieldLabel htmlFor="token">
                        Personal access token
                      </FieldLabel>
                      <Input
                        id="token"
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
                      <FieldDescription id="token-help">
                        Read-only access is enough. Falkon stores the token
                        encrypted.
                      </FieldDescription>
                    </Field>
                  </FieldGroup>
                )}
                {step === 1 && (
                  <FieldGroup>
                    <Field>
                      <FieldLabel htmlFor="product-name">
                        Product name
                      </FieldLabel>
                      <Input
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
                    </Field>
                    <Field data-invalid={(!!id && !available) || undefined}>
                      <FieldLabel htmlFor="product-id">productId</FieldLabel>
                      <InputGroup>
                        <InputGroupInput
                          id="product-id"
                          className="font-mono"
                          value={id}
                          readOnly
                          aria-invalid={!!id && !available}
                        />
                        <InputGroupAddon align="inline-end">
                          <Badge
                            variant={
                              id ? (available ? "success" : "danger") : "muted"
                            }
                          >
                            {id
                              ? available
                                ? "Available"
                                : "Already in use"
                              : "Enter a name"}
                          </Badge>
                        </InputGroupAddon>
                      </InputGroup>
                      <FieldDescription>
                        Used in API calls and by coding agents. It can’t be
                        changed after setup.
                      </FieldDescription>
                    </Field>
                    <Field>
                      <FieldTitle>Connected as</FieldTitle>
                      <div className="flex items-center gap-3 rounded-md border bg-secondary/40 px-3 py-2.5">
                        <ProviderLogo provider={provider} size={14} />
                        <span className="flex-1 text-[0.8125rem] text-muted-foreground">
                          Token connection on{" "}
                          <strong className="font-medium text-foreground">
                            {connection?.host}
                          </strong>
                        </span>
                        <Badge variant="success">
                          <Check />
                          Connected
                        </Badge>
                      </div>
                    </Field>
                  </FieldGroup>
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
                    <RepositoryPickerSkeleton />
                  ))}
                {step === 3 && (
                  <div className="flex flex-col gap-5">
                    <dl className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-2">
                      <div className="bg-card px-4 py-3">
                        <dt className="text-xs text-muted-foreground">
                          Product
                        </dt>
                        <dd className="mt-1 flex items-baseline gap-2">
                          <strong className="font-medium">{name}</strong>
                          <span className="font-mono text-xs text-faint">
                            {id}
                          </span>
                        </dd>
                      </div>
                      <div className="bg-card px-4 py-3">
                        <dt className="text-xs text-muted-foreground">
                          Code host
                        </dt>
                        <dd className="mt-1 flex items-center gap-2 text-[0.8125rem]">
                          <ProviderLogo
                            provider={provider}
                            size={12}
                            className="p-1"
                          />
                          {providerName} · {connection?.host}
                        </dd>
                      </div>
                    </dl>
                    <div>
                      <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                        Repositories
                        <Badge variant="muted" className="font-mono">
                          {picked.length}
                        </Badge>
                      </div>
                      <ul className="divide-y overflow-hidden rounded-lg border">
                        {picked.map((repo) => (
                          <li
                            key={repo.id}
                            className="flex items-center gap-3 bg-card px-4 py-2.5"
                          >
                            <span className="min-w-0 flex-1 truncate text-[0.8125rem] font-medium">
                              {repo.name}
                            </span>
                            <span className="inline-flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
                              <GitBranch
                                className="size-3.5"
                                aria-hidden="true"
                              />
                              {selected[repo.id]}
                            </span>
                            <Separator
                              orientation="vertical"
                              className="h-3.5"
                            />
                            <span className="font-mono text-xs text-faint">
                              {repo.revision}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}
                {error && (
                  <Notice
                    tone="err"
                    className="mt-5"
                    title={
                      step === 3
                        ? "Indexing wasn’t started."
                        : "Connection not confirmed."
                    }
                  >
                    <p>{error}</p>
                  </Notice>
                )}
              </CardContent>
              <CardFooter className="flex-wrap gap-3 bg-background/40 px-6 py-4">
                <span className="flex flex-1 items-center gap-2 text-xs text-muted-foreground [&_svg]:size-3.5 [&_svg]:shrink-0">
                  {step === 0 ? (
                    <>
                      <LockKeyhole aria-hidden="true" />
                      Falkon only reads from your code host.
                    </>
                  ) : step === 2 ? (
                    <>
                      <Info className="text-warning" aria-hidden="true" />
                      <span className="hidden sm:inline">
                        Each repository is read at the head of its chosen
                        branch.
                      </span>
                      <span className="font-medium text-foreground sm:hidden">
                        {picked.length} selected
                      </span>
                    </>
                  ) : step === 3 ? (
                    <>
                      <Clock aria-hidden="true" />
                      Revisions are pinned when indexing starts.
                    </>
                  ) : null}
                </span>
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
                  <Button asChild variant="ghost">
                    <Link href={`/${edit.id}/settings`}>Cancel</Link>
                  </Button>
                )}
                <Button
                  type="submit"
                  disabled={disabled}
                  aria-busy={busy || undefined}
                >
                  {busy && <Spinner data-icon="inline-start" />}
                  {step === 0
                    ? "Check connection"
                    : step === 3
                      ? edit
                        ? "Save and re-index"
                        : "Start indexing"
                      : step === 2 && picked.length
                        ? `Continue with ${picked.length}`
                        : "Continue"}
                </Button>
              </CardFooter>
            </Card>
          </form>
        </div>
      </main>
    </div>
  );
}
