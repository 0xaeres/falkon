import type { ReactNode } from "react";
import { AlertTriangle, Info, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Mark } from "./brand";
import { Alert, AlertDescription, AlertTitle } from "./alert";
import { Button } from "./button";

export type Tone = "green" | "blue" | "amber" | "red" | "";

const DOT: Record<Tone, string> = {
  green:
    "bg-success shadow-[0_0_0_3px_color-mix(in_srgb,var(--success)_18%,transparent)]",
  blue: "bg-info shadow-[0_0_0_3px_color-mix(in_srgb,var(--info)_22%,transparent)] animate-blink",
  amber:
    "bg-warning shadow-[0_0_0_3px_color-mix(in_srgb,var(--warning)_18%,transparent)]",
  red: "bg-destructive shadow-[0_0_0_3px_color-mix(in_srgb,var(--destructive)_18%,transparent)]",
  "": "bg-faint",
};
/** A state colour; always rendered next to its label. */
export function StateDot({
  tone,
  className,
}: {
  tone: Tone;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-block size-1.5 shrink-0 rounded-full",
        DOT[tone],
        className,
      )}
    />
  );
}

/** Inline notice: info, warning, or error. Errors are announced. */
export function Notice({
  children,
  title,
  tone = "",
  className,
}: {
  children?: ReactNode;
  title?: ReactNode;
  tone?: "" | "warn" | "err";
  className?: string;
}) {
  const Icon =
    tone === "err" ? XCircle : tone === "warn" ? AlertTriangle : Info;
  return (
    <Alert
      variant={
        tone === "err" ? "destructive" : tone === "warn" ? "warning" : "default"
      }
      role={tone === "err" ? "alert" : undefined}
      className={className}
    >
      <Icon />
      {title && <AlertTitle className="line-clamp-none">{title}</AlertTitle>}
      {children && <AlertDescription>{children}</AlertDescription>}
    </Alert>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="col-span-12 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl leading-tight font-semibold tracking-[-0.02em] text-balance">
          {title}
        </h1>
        {description && (
          <div className="mt-1.5 text-[0.8125rem] text-muted-foreground">
            {description}
          </div>
        )}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}

/** The workspace page frame: one 12-column grid every page aligns to. */
export function Page({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mx-auto grid w-full max-w-[1200px] grid-cols-12 content-start gap-x-6 gap-y-6 px-4 py-6 md:px-8 md:py-8",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Route-level boot only: the Falkon mark, wings sweeping. Containers use content-shaped skeletons. */
export function LoadingMark({
  label = "Loading Product context",
}: {
  label?: string;
}) {
  return (
    <div
      className="flex min-h-[180px] w-full flex-1 items-center justify-center self-stretch p-8 text-foreground [body>&]:min-h-dvh [&_path]:animate-wing [&_path:nth-child(2)]:[animation-delay:120ms] [&_path:nth-child(3)]:[animation-delay:240ms]"
      role="status"
      aria-label={label}
    >
      <Mark size={44} />
    </div>
  );
}

export function ErrorState({
  error,
  retry,
}: {
  error: unknown;
  retry?: () => void;
}) {
  return (
    <div className="flex w-full max-w-[720px] flex-col items-start gap-4 p-6 md:p-8">
      <Notice tone="err" title="Couldn’t load this view.">
        <p>
          {error instanceof Error
            ? error.message
            : "Falkon is unavailable. Try again."}
        </p>
      </Notice>
      {retry && (
        <Button variant="outline" onClick={retry}>
          Try again
        </Button>
      )}
    </div>
  );
}
