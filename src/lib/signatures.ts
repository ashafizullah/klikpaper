// What a document's digital signatures amount to, in one word for the toolbar
// badge and in sentences for the Signatures dialog.
import { errorText, ipc, type SignatureReport } from "./ipc";

/**
 * A file's signatures. A file whose structure KlikPaper can't take apart may
 * still be signed: then it says so (one signature that couldn't be checked)
 * rather than reading as unsigned.
 */
export async function readSignatures(path: string, password?: string | null): Promise<SignatureReport[]> {
  try {
    return await ipc.pdfSignatures(path, password);
  } catch (e) {
    const bytes = await ipc.readFile(path).catch(() => null);
    if (!bytes || !new TextDecoder("latin1").decode(bytes).includes("/ByteRange")) return [];
    return [
      { field: null, page: null, timestamp: false, subFilter: null, name: null, reason: null, location: null, contact: null, signedAt: null, signer: null, chain: [], status: "unknown", intact: null, verified: null, coversAll: false, certValidWhenSigned: null, problem: errorText(e) },
    ];
  }
}

/**
 * "invalid": some signature doesn't match the document; "unknown": one couldn't
 * be checked; "changed": all match, but something was added after one of them
 * (even if a later signature covers it: that signer may not be the first);
 * "selfSigned": all match the whole file, but a signer made their own
 * certificate; "valid": all match the whole file, with issued certificates.
 * Whether an issuer is trusted is never checked.
 */
export type SignatureSummary = "valid" | "selfSigned" | "changed" | "invalid" | "unknown";

export function summarize(list: SignatureReport[]): SignatureSummary | null {
  if (!list.length) return null;
  if (list.some((s) => s.status === "invalid")) return "invalid";
  if (list.some((s) => s.status === "unknown")) return "unknown";
  if (list.some((s) => !s.coversAll)) return "changed";
  return list.some((s) => !s.timestamp && s.signer?.selfSigned) ? "selfSigned" : "valid";
}
