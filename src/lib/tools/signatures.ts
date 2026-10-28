// Digital signatures for agents: what check_signatures reports is what the
// Signatures dialog shows.
import { ipc } from "../ipc";
import { summarize } from "../signatures";
import { DOC, obj, findDoc, requirePdf, type ToolSpec } from "./args";

export const SIGNATURE_TOOLS: ToolSpec[] = [
  {
    name: "check_signatures",
    description:
      "Checks a PDF's digital (certificate-based) signatures: for each, whether the signed content is unchanged, whether the signature matches the signer's certificate, whether anything was added after signing, and the signer, certificate issuer, validity dates, time, reason and place. It doesn't check whether the issuer is trusted or the certificate revoked. Pass `path` for a file that isn't open. Saving a signed document in KlikPaper invalidates its signatures.",
    parameters: obj({ doc: DOC, path: { type: "string", description: "Absolute path of a PDF to check instead of an open document." } }),
    scope: "both",
    async run(args) {
      if (typeof args.path === "string" && args.path.trim()) {
        const path = args.path.trim();
        requirePdf(path);
        const list = await ipc.pdfSignatures(path);
        return { file: path, summary: summarize(list) ?? "unsigned", signatures: list };
      }
      const doc = findDoc(args);
      if (!doc.path) return { doc: doc.name, summary: "unsigned", signatures: [] };
      const source = [...doc.sources.values()].find((s) => s.path === doc.path);
      const list = await ipc.pdfSignatures(doc.path, source?.password ?? doc.protect);
      return { doc: doc.name, summary: summarize(list) ?? "unsigned", unsavedChanges: doc.dirty, signatures: list };
    },
  },
];
