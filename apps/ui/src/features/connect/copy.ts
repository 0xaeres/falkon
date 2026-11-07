/** Copies to the clipboard; "failed" when the Clipboard API is missing or refuses. */
export async function tryCopy(text: string): Promise<"copied" | "failed"> {
  try {
    await navigator.clipboard.writeText(text);
    return "copied";
  } catch {
    return "failed";
  }
}
