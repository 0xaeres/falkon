import type { Status } from "@sbc/contracts";

/** The generation that just went current, when the page watched the build of one Product move from building to idle; null otherwise (a Product switch is not a transition). */
export const completedGeneration = (
  previous: Status | undefined,
  next: Status | undefined,
) =>
  previous?.build === "building" &&
  previous.productId === next?.productId &&
  next.build === "idle"
    ? next.generation
    : null;

/** Calls `onDismiss` after `ms`; the returned cleanup cancels it (use as a `useEffect` body). */
export const startDismiss = (onDismiss: () => void, ms = 5000) => {
  const timer = setTimeout(onDismiss, ms);
  return () => clearTimeout(timer);
};
