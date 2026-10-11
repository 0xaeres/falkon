import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Mark } from "./brand";
import { AlertTriangle, Info, LoaderCircle, XCircle } from "lucide-react";

export function Button({
  children,
  className = "",
  variant = "default",
  busy,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "primary" | "ghost";
  busy?: boolean;
}) {
  return (
    <button
      className={`btn ${variant === "primary" ? "pri" : variant === "ghost" ? "ghost" : ""} ${className}`}
      aria-busy={busy || undefined}
      {...props}
      disabled={props.disabled || busy}
    >
      {busy && <LoaderCircle className="spin" size={16} />}
      {children}
    </button>
  );
}
export function Badge({
  children,
  tone = "",
  dot = false,
}: {
  children: ReactNode;
  tone?: string;
  dot?: boolean;
}) {
  return (
    <span className={`badge ${tone}`}>
      {dot && <span className="pdot" />}
      {children}
    </span>
  );
}
export function Alert({
  children,
  tone = "",
  className = "",
}: {
  children: ReactNode;
  tone?: "" | "warn" | "err";
  className?: string;
}) {
  const Icon =
    tone === "err" ? XCircle : tone === "warn" ? AlertTriangle : Info;
  return (
    <div
      className={`alert ${tone} ${className}`}
      role={tone === "err" ? "alert" : undefined}
    >
      <Icon size={16} />
      <div>{children}</div>
    </div>
  );
}
export function LoadingMark({
  label = "Loading Product context",
}: {
  label?: string;
}) {
  return (
    <div className="loading-mark" role="status" aria-label={label}>
      <Mark size={48} />
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
    <div className="error-state">
      <Alert tone="err">
        <strong>Couldn’t load this view.</strong>
        <p>
          {error instanceof Error
            ? error.message
            : "Falkon is unavailable. Try again."}
        </p>
      </Alert>
      {retry && <Button onClick={retry}>Try again</Button>}
    </div>
  );
}
