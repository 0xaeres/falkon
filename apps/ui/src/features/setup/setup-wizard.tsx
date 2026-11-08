"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import useSWR, { useSWRConfig } from "swr";
import { Clock, Info, LockKeyhole } from "lucide-react";
import { Mark } from "@/components/ui/brand";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
} from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { ErrorState, LoadingMark, Notice } from "@/components/ui/primitives";
import { api, keys } from "@/lib/api/client";
import type { Product, Provider } from "@falkon/contracts";
import { RepositoryPickerSkeleton } from "./components/repository-picker-skeleton";
import { ConnectStep } from "./components/connect-step";
import { NameStep } from "./components/name-step";
import { ReviewStep } from "./components/review-step";
import { WizardProgress } from "./components/wizard-progress";
import { descriptions, providers, slug, titles } from "./lib/wizard-content";
const RepositoryPicker = dynamic(() => import("./repository-picker"), {
  loading: () => <RepositoryPickerSkeleton />,
});
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
    (edit?.provider === "git" ? undefined : edit?.provider) ?? "github", // a Product over a plain git connection is never edited here
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
          <WizardProgress edit={edit} step={step} />
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
                  <ConnectStep
                    provider={provider}
                    host={host}
                    token={token}
                    error={error}
                    onProvider={(value) => {
                      setProvider(value);
                      setHost(
                        providers.find((item) => item.id === value)!.host,
                      );
                      setError("");
                    }}
                    onHost={setHost}
                    onToken={(value) => {
                      setToken(value);
                      setError("");
                    }}
                  />
                )}
                {step === 1 && (
                  <NameStep
                    name={name}
                    id={id}
                    available={available}
                    provider={provider}
                    connectionHost={connection?.host}
                    onName={(value) => {
                      setName(value);
                      setError("");
                    }}
                  />
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
                  <ReviewStep
                    name={name}
                    id={id}
                    provider={provider}
                    providerName={providerName}
                    connectionHost={connection?.host}
                    picked={picked}
                    selected={selected}
                  />
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
