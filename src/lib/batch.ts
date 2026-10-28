// Processing many PDFs at once: each file is opened as a document no one
// sees, gets the chosen steps (recognize text, black out personal data,
// watermark, page numbers) and is written as a new file with the chosen
// options (compression, password, metadata), through the same code as an
// open document. Originals are never replaced, and every file gets a line in
// the report, whether it worked or not.
import { Doc, type PageNumbers, type Watermark } from "./doc.svelte";
import { errorText, ipc, type Compression } from "./ipc";
import { needsOcr, recognize } from "./ocr";
import { baseName, dirName, joinPath, stripExt } from "./pagespec";
import { markPersonal, scanPersonal } from "./personal";
import { cleanScans, isScan } from "./scan";
import type { PiiKind } from "./pii";
import { PasswordNeeded, openPdf } from "./pdfjs";
import { writePdf } from "./save.svelte";
import { newId } from "./settings.svelte";
import { summarize, type SignatureSummary } from "./signatures";

export interface BatchActions {
  /** Clean up scanned pages (straighten, whiten edges, black and white), before recognizing text. */
  cleanup?: { deskew: boolean; borders: boolean; blackWhite: boolean } | null;
  /** Recognize text on pages that have none. */
  ocr?: boolean;
  /** Black out these kinds of personal data (found ones are marked without review). */
  personal?: PiiKind[] | null;
  watermark?: Watermark | null;
  pageNumbers?: PageNumbers | null;
  compress?: Compression | null;
  password?: string | null;
  stripMetadata?: boolean;
  /** Report each file's digital signatures. */
  checkSignatures?: boolean;
}

/** Whether the actions write new files (checking signatures alone only reports). */
export function writesFiles(a: BatchActions): boolean {
  return !!(a.cleanup || a.ocr || a.personal?.length || a.watermark || a.pageNumbers || a.compress || a.password || a.stripMetadata);
}

export interface BatchReport {
  input: string;
  output: string | null;
  /** Null when it worked. */
  error: string | null;
  pages: number;
  bytesBefore: number;
  bytesAfter: number | null;
  /** Scanned pages cleaned up. */
  cleaned: number;
  /** Pages whose text was recognized. */
  ocrPages: number;
  /** Personal data blacked out, by kind. */
  personal: Partial<Record<PiiKind, number>>;
  /** Pages saved as pictures to black out safely. */
  pictures: number;
  signatures: SignatureSummary | null;
}

export interface BatchProgress {
  /** Files finished so far, of `total`. */
  done: number;
  total: number;
  file: string;
  /** What is happening to it: "open", "clean", "ocr", "personal" or "write". */
  stage: string;
}

/** A path in `dir` for `input`, with `suffix`, that names no existing file and isn't the input itself. */
async function outputPath(dir: string, input: string, suffix: string, taken: Set<string>): Promise<string> {
  const base = stripExt(baseName(input));
  const sameFolder = dirName(input) === dir;
  const ending = suffix || (sameFolder ? "-processed" : "");
  for (let n = 1; n < 1000; n++) {
    const path = joinPath(dir, `${base}${ending}${n > 1 ? ` (${n})` : ""}.pdf`);
    if (path === input || taken.has(path)) continue;
    const [stat] = await ipc.fileStats([path]);
    if (!stat?.exists) {
      taken.add(path);
      return path;
    }
  }
  throw new Error("No free file name in the output folder");
}

/** Runs `actions` on each file; `outDir` gets the new files. */
export async function runBatch(
  files: string[],
  actions: BatchActions,
  outDir: string,
  suffix: string,
  onProgress: (p: BatchProgress) => void,
  cancelled: () => boolean,
): Promise<BatchReport[]> {
  const reports: BatchReport[] = [];
  const taken = new Set<string>();
  const writes = writesFiles(actions);
  for (let i = 0; i < files.length && !cancelled(); i++) {
    const input = files[i];
    const stage = (s: string) => onProgress({ done: i, total: files.length, file: input, stage: s });
    stage("open");
    const report: BatchReport = { input, output: null, error: null, pages: 0, bytesBefore: 0, bytesAfter: null, cleaned: 0, ocrPages: 0, personal: {}, pictures: 0, signatures: null };
    reports.push(report);
    let doc: Doc | null = null;
    try {
      report.bytesBefore = (await ipc.fileStats([input]))[0]?.bytes ?? 0;
      if (actions.checkSignatures || writes) report.signatures = summarize(await ipc.pdfSignatures(input).catch(() => []));
      let pdf;
      try {
        pdf = await openPdf(await ipc.readFile(input));
      } catch (e) {
        if (e instanceof PasswordNeeded) throw new Error("password");
        throw e;
      }
      doc = new Doc(baseName(input), input);
      const id = newId("s");
      doc.addSource({ id, path: input, pdf });
      doc.pages = await doc.pagesOf(id);
      report.pages = doc.pages.length;
      if (!writes) continue;

      if (actions.cleanup) {
        const scans = [];
        for (const p of doc.pages) if (await isScan(await doc.pdfPage(p)).catch(() => false)) scans.push(p);
        if (scans.length) {
          stage("clean");
          // Text is recognized below for the whole document when asked.
          report.cleaned = (await cleanScans(doc, scans, { ...actions.cleanup, ocr: false }, () => {}, cancelled)).pages;
        }
      }
      if (actions.ocr) {
        const scans = [];
        for (const p of doc.pages) if (await needsOcr(doc, p)) scans.push(p);
        if (scans.length) {
          stage("ocr");
          report.ocrPages = (await recognize(doc, scans, () => {}, cancelled)).pages;
        }
      }
      if (actions.personal?.length) {
        stage("personal");
        const { finds } = await scanPersonal(doc, actions.personal);
        for (const f of finds) report.personal[f.kind] = (report.personal[f.kind] ?? 0) + 1;
        if (finds.length) await markPersonal(doc, finds);
      }
      doc.watermark = actions.watermark ?? null;
      doc.pageNumbers = actions.pageNumbers ?? null;
      doc.stripMetadata = !!actions.stripMetadata;
      doc.protect = actions.password || null;

      stage("write");
      const output = await outputPath(outDir, input, suffix, taken);
      const result = await writePdf(doc, output, { compress: actions.compress ?? null });
      report.output = output;
      report.bytesAfter = result.bytes;
      report.pictures = result.pictures;
    } catch (e) {
      report.error = errorText(e);
    } finally {
      doc?.destroy();
    }
  }
  onProgress({ done: reports.length, total: files.length, file: "", stage: "done" });
  return reports;
}
