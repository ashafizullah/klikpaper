// What a document's digital signatures amount to, in one word for the toolbar
// badge and in sentences for the Signatures dialog.
import type { SignatureReport } from "./ipc";

/**
 * "invalid": some signature doesn't match the document; "unknown": one couldn't
 * be checked; "changed": all match, but something was added after the last
 * one; "valid": all match and cover the whole file.
 */
export type SignatureSummary = "valid" | "changed" | "invalid" | "unknown";

export function summarize(list: SignatureReport[]): SignatureSummary | null {
  if (!list.length) return null;
  if (list.some((s) => s.status === "invalid")) return "invalid";
  if (list.some((s) => s.status === "unknown")) return "unknown";
  return list.some((s) => s.coversAll) ? "valid" : "changed";
}
