import Image from "next/image";
import type { Product } from "@falkon/contracts";
import { cn } from "@/lib/utils";
export function Mark({ size = 24 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M5 5h22l-4.5 6H5z" />
      <path d="M5 13.5h15l-4.5 6H5z" />
      <path d="M5 22h8l-4.5 5H5z" />
    </svg>
  );
}
export function Logo({ wordmark = true }: { wordmark?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2 text-[0.9375rem] font-semibold tracking-[-0.02em] text-foreground">
      <Mark size={22} />
      {wordmark && "Falkon"}
    </span>
  );
}
export function ProviderLogo({
  provider,
  size = 20,
  className,
}: {
  provider: Product["provider"] | "jira" | "confluence";
  size?: number;
  className?: string;
}) {
  const asset = provider === "github-enterprise" ? "github" : provider;
  return (
    <span
      className={cn(
        "inline-grid shrink-0 place-items-center rounded-md bg-white p-1.5",
        className,
      )}
    >
      <Image src={`/brand/${asset}.svg`} alt="" width={size} height={size} />
    </span>
  );
}
