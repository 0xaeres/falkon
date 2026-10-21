import Image from "next/image";
import type { Product } from "@falkon/contracts";
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
export function Logo() {
  return (
    <span className="logo">
      <Mark />
      Falkon
    </span>
  );
}
export function ProviderLogo({
  provider,
  size = 20,
}: {
  provider: Product["provider"] | "jira" | "confluence";
  size?: number;
}) {
  const asset = provider === "github-enterprise" ? "github" : provider;
  return (
    <span className="tile">
      <Image src={`/brand/${asset}.svg`} alt="" width={size} height={size} />
    </span>
  );
}
