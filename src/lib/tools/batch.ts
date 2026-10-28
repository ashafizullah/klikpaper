// Processing many PDFs for agents, like "Process many files" in the app: new
// files in an output folder, the originals untouched, a report per file.
import { runBatch, writesFiles, type BatchActions } from "../batch";
import { ipc, type CompressLevel } from "../ipc";
import { PII_KINDS, type PiiKind } from "../pii";
import { obj, requirePdf, str, type Args, type ToolSpec } from "./args";

async function inputs(args: Args): Promise<string[]> {
  const list = Array.isArray(args.files) ? args.files.map(String) : [];
  for (const f of list) requirePdf(f, "each file");
  const folder = str(args, "folder", "");
  if (folder) list.push(...(await ipc.listPdfs(folder)));
  const unique = [...new Set(list)];
  if (!unique.length) throw new Error("No PDFs: pass files (absolute .pdf paths) or a folder that holds some");
  return unique;
}

function actions(args: Args): BatchActions {
  const kinds = args.black_out_personal_data === true ? PII_KINDS : Array.isArray(args.black_out_personal_data) ? args.black_out_personal_data.map(String).filter((k): k is PiiKind => (PII_KINDS as string[]).includes(k)) : [];
  const watermark = typeof args.watermark === "string" ? args.watermark.trim() : "";
  const numbers = typeof args.page_numbers === "string" ? args.page_numbers.trim() : args.page_numbers === true ? "{n}" : "";
  const clean = args.clean_scans;
  return {
    cleanup: clean === true ? { deskew: true, borders: true, blackWhite: true } : clean && typeof clean === "object" ? { deskew: (clean as Args).deskew !== false, borders: (clean as Args).remove_borders !== false, blackWhite: (clean as Args).black_and_white !== false } : null,
    ocr: args.recognize_text === true,
    personal: kinds.length ? kinds : null,
    watermark: watermark ? { text: watermark, size: 64, opacity: 0.18, color: "#7a7a7a", angle: 45 } : null,
    pageNumbers: numbers ? { format: numbers, position: "bottom-center", start: 1, size: 10, margin: 28, color: "#1b1916" } : null,
    compress: (["low", "medium", "high"].includes(String(args.compress)) ? args.compress : null) as CompressLevel | null,
    password: typeof args.password === "string" && args.password ? args.password : null,
    stripMetadata: args.remove_metadata === true,
    checkSignatures: args.check_signatures === true,
  };
}

export const BATCH_TOOLS: ToolSpec[] = [
  {
    name: "process_files",
    description:
      "Processes many PDFs at once, like Process many files in the app. For each file it can clean up scanned pages (straighten, whiten dark edges, black and white), recognize text on scanned pages, black out personal data (found items are blacked out without a review, so tell the user to check the results), add a watermark or page numbers, compress, protect with a password and remove metadata, writing a new file to output_folder (the originals are never changed; names get `suffix`, and a number when taken). check_signatures alone only reports. Returns one line per file: output path, sizes, pages recognized, personal data blacked out, signature status, or the error (password-protected files are skipped). Processing a digitally signed file makes its signatures not valid in the new file.",
    parameters: obj({
      files: { type: "array", items: { type: "string" }, description: "Absolute paths of PDFs." },
      folder: { type: "string", description: "Absolute path of a folder: its PDFs (not subfolders) are added." },
      output_folder: { type: "string", description: "Absolute path of the folder for the new files. Required unless only check_signatures is asked." },
      suffix: { type: "string", description: 'Added to each file name. Default "-processed"; in the input folder an empty suffix becomes "-processed".' },
      clean_scans: {
        description: "Clean up scanned pages first: true for all of straighten, whiten dark edges and black and white, or an object choosing them (black and white makes files much smaller but drops color).",
        anyOf: [{ type: "boolean" }, { type: "object", properties: { deskew: { type: "boolean" }, remove_borders: { type: "boolean" }, black_and_white: { type: "boolean" } }, additionalProperties: false }],
      },
      recognize_text: { type: "boolean" },
      black_out_personal_data: { description: "true for every kind, or a list of: nik, npwp, phone, email, account, birthdate.", anyOf: [{ type: "boolean" }, { type: "array", items: { type: "string", enum: PII_KINDS } }] },
      watermark: { type: "string", description: "Watermark text." },
      page_numbers: { description: 'true for "1, 2, 3", or a format with {n} and {total}, e.g. "Page {n} of {total}".', anyOf: [{ type: "boolean" }, { type: "string" }] },
      compress: { type: "string", enum: ["low", "medium", "high"] },
      password: { type: "string" },
      remove_metadata: { type: "boolean" },
      check_signatures: { type: "boolean" },
    }),
    scope: "mcp",
    async run(args) {
      const files = await inputs(args);
      const plan = actions(args);
      const writes = writesFiles(plan);
      if (!writes && !plan.checkSignatures) throw new Error("Nothing to do: pass at least one step");
      const outDir = str(args, "output_folder", "");
      if (writes && !/^(\/|[A-Za-z]:[\\/]|\\\\)/.test(outDir)) throw new Error("output_folder must be an absolute path");
      const suffix = typeof args.suffix === "string" ? args.suffix : "-processed";
      const reports = await runBatch(files, plan, outDir, suffix, () => {}, () => false);
      return {
        done: reports.filter((r) => !r.error).length,
        failed: reports.filter((r) => r.error).length,
        files: reports.map((r) => ({
          input: r.input,
          output: r.output,
          error: r.error === "password" ? "protected with a password; skipped" : r.error,
          pages: r.pages,
          bytesBefore: r.bytesBefore,
          bytesAfter: r.bytesAfter,
          pagesCleanedUp: r.cleaned || undefined,
          pagesRecognized: r.ocrPages || undefined,
          personalDataBlackedOut: Object.keys(r.personal).length ? r.personal : undefined,
          pagesSavedAsPictures: r.pictures || undefined,
          // A file that couldn't be opened couldn't be checked either.
          signatures: r.error ? undefined : (r.signatures ?? (plan.checkSignatures ? "unsigned" : undefined)),
        })),
      };
    },
  },
];
