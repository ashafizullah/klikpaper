// Text recognition (OCR) for scanned pages, on this computer: Tesseract runs
// as WebAssembly in a worker, with the engine and the Indonesian and English
// language data shipped in /ocr (see vite.config.ts). Each page is drawn as
// a picture, read, and Tesseract's invisible words are laid over the page by
// the backend; the document then uses that file, so the words can be found,
// selected, copied, read by the AI and redacted right away.
import type { Worker } from "tesseract.js";
import type { Doc, PageItem } from "./doc.svelte";
import { ipc } from "./ipc";
import { openPdf, renderToBlob } from "./pdfjs";

/** Resolution of the page pictures Tesseract reads. */
const DPI = 300;
/** Pages with fewer letters than this count as having no text (a scan, maybe with a page number). */
const MIN_TEXT = 12;

let worker: Promise<Worker> | null = null;

/** A tiny module using SIMD instructions (from wasm-feature-detect): valid where the faster engine runs. */
function hasSimd(): boolean {
  try {
    return WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]));
  } catch {
    return false;
  }
}

function ocrWorker(): Promise<Worker> {
  worker ??= (async () => {
    const { createWorker, OEM } = await import("tesseract.js");
    const w = await createWorker(["ind", "eng"], OEM.LSTM_ONLY, {
      workerPath: "/ocr/worker.min.js",
      workerBlobURL: false,
      corePath: hasSimd() ? "/ocr/tesseract-core-simd-lstm.js" : "/ocr/tesseract-core-lstm.js",
      langPath: "/ocr",
      // The data is local already; no copy in the browser's storage.
      cacheMethod: "none",
    });
    // Pages are drawn at a known resolution; telling Tesseract helps it judge letter sizes.
    await w.setParameters({ user_defined_dpi: String(DPI) });
    return w;
  })().catch((e) => {
    worker = null;
    throw e;
  });
  return worker;
}

/** Whether a page has (almost) no text of its own, as scanned pages do. */
export async function needsOcr(doc: Doc, p: PageItem): Promise<boolean> {
  const text = await doc.text(p).catch(() => "");
  return text.replace(/\s+/g, "").length < MIN_TEXT;
}

export interface OcrProgress {
  /** Pages read so far, of `total`. */
  done: number;
  total: number;
}

export interface OcrResult {
  /** Pages where words were found. */
  pages: number;
  words: number;
}

/**
 * Reads the text of `pages` and adds it to the document. `cancelled` is
 * checked between pages; what was read until then is still added.
 */
export async function recognize(doc: Doc, pages: PageItem[], onProgress: (p: OcrProgress) => void, cancelled: () => boolean): Promise<OcrResult> {
  const w = await ocrWorker();
  const temps: string[] = [];
  // Per source, the text layer for each of its page indexes.
  const layers = new Map<string, Map<number, { path: string; rotation: number }>>();
  let found = 0;
  let words = 0;
  try {
    for (let i = 0; i < pages.length && !cancelled(); i++) {
      onProgress({ done: i, total: pages.length });
      const p = pages[i];
      const page = await doc.pdfPage(p);
      // Upright as the user sees it, so the letters are the right way up.
      const rotation = doc.rotation(p);
      const [x0, y0, x1, y1] = page.view;
      const scale = Math.min(DPI / 72, Math.sqrt(30e6 / Math.max(1, (x1 - x0) * (y1 - y0))));
      const picture = await renderToBlob(page, scale, rotation, "image/png", undefined, false);
      const { data } = await w.recognize(picture, { pdfTextOnly: true }, { pdf: true, text: true });
      const count = data.text.split(/\s+/).filter(Boolean).length;
      if (!count || !data.pdf) continue;
      const path = await ipc.tempFile("pdf");
      temps.push(path);
      await ipc.writeFile(path, new Uint8Array(data.pdf));
      if (!layers.has(p.source)) layers.set(p.source, new Map());
      layers.get(p.source)!.set(p.index, { path, rotation });
      found++;
      words += count;
    }
    onProgress({ done: pages.length, total: pages.length });
    for (const [sourceId, byIndex] of layers) await addText(doc, sourceId, byIndex);
    return { pages: found, words };
  } finally {
    for (const t of temps) ipc.discardTemp(t).catch(() => {});
  }
}

/** Writes the source again with the text layers, and makes the document use it. */
async function addText(doc: Doc, sourceId: string, byIndex: Map<number, { path: string; rotation: number }>) {
  const src = doc.sources.get(sourceId)!;
  const discard: string[] = [];
  let input = src.path;
  if (doc.formsEdited) {
    // Typed form values live in pdf.js until saved; keep them in the new file.
    input = await ipc.tempFile("pdf");
    discard.push(input);
    await ipc.writeFile(input, await src.pdf.saveDocument());
  }
  const output = await ipc.tempFile("pdf");
  try {
    await ipc.assemble({
      sources: [{ id: sourceId, path: input, password: input === src.path ? (src.password ?? null) : null }],
      pages: Array.from({ length: src.pdf.numPages }, (_, index) => ({ source: sourceId, index, rotate: 0, ocr: byIndex.get(index) ?? null })),
      output,
    });
    const pdf = await openPdf(await ipc.readFile(output));
    doc.replaceSource(sourceId, output, pdf);
  } catch (e) {
    ipc.discardTemp(output).catch(() => {});
    throw e;
  } finally {
    for (const t of discard) ipc.discardTemp(t).catch(() => {});
  }
}
