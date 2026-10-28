// Cleaning up scanned pages: each page is drawn as a picture and the backend
// straightens it, whitens dark bands along its edges and, if asked, makes it
// black and white (much smaller). The cleaned pages come from a new file, so
// Undo takes them back; recognized text on them goes with their old content,
// so it is recognized again afterwards when asked.
import type { Doc, PageItem } from "./doc.svelte";
import { ipc } from "./ipc";
import { recognize } from "./ocr";
import { openPdf, pdfjs, renderToBlob, type PDFPageProxy } from "./pdfjs";
import { newId } from "./settings.svelte";

const DPI = 300;

export interface CleanupOptions {
  deskew: boolean;
  borders: boolean;
  blackWhite: boolean;
  /** Recognize the text of the cleaned pages afterwards. */
  ocr: boolean;
}

/** Whether a page is a scan: a picture covers most of it. */
export async function isScan(page: PDFPageProxy): Promise<boolean> {
  const ops = await page.getOperatorList();
  const [x0, y0, x1, y1] = page.view;
  const area = Math.abs((x1 - x0) * (y1 - y0)) || 1;
  const O = pdfjs.OPS;
  const images = new Set<number>([O.paintImageXObject, O.paintInlineImageXObject, O.paintImageXObjectRepeat].filter((v) => v !== undefined));
  type M = number[];
  let ctm: M = [1, 0, 0, 1, 0, 0];
  const stack: M[] = [];
  const times = (m: M, n: M): M => [m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3], m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3], m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5]];
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    if (fn === O.save) stack.push(ctm);
    else if (fn === O.restore) ctm = stack.pop() ?? ctm;
    else if (fn === O.transform) ctm = times(ops.argsArray[i] as M, ctm);
    else if (images.has(fn) && Math.abs(ctm[0] * ctm[3] - ctm[1] * ctm[2]) >= area * 0.6) return true;
  }
  return false;
}

export interface CleanupResult {
  pages: number;
  /** The skew undone on each page, in degrees. */
  straightened: number[];
  /** Pages whose text was recognized afterwards. */
  recognized: number;
}

/**
 * Pages with black-out marks or annotations not saved yet: straightening turns
 * the picture under them, so they would no longer cover what they were put on.
 */
export function pagesWithMarks(doc: Doc, pages: PageItem[]): PageItem[] {
  return pages.filter((p) => doc.redactions.some((r) => r.page === p.id) || doc.overlays.some((o) => o.page === p.id));
}

export async function cleanScans(doc: Doc, pages: PageItem[], opts: CleanupOptions, onProgress: (done: number, total: number) => void, cancelled: () => boolean): Promise<CleanupResult> {
  const marked = pagesWithMarks(doc, pages);
  if (marked.length) {
    const numbers = marked.map((p) => doc.pages.indexOf(p) + 1).join(", ");
    throw new Error(`Page ${numbers} has black-out marks or annotations that aren't saved; save or remove them before cleaning up the page`);
  }
  const temps: string[] = [];
  // Per source: the picture of each page index to clean.
  const pictures = new Map<string, Map<number, string>>();
  const done: PageItem[] = [];
  try {
    for (let i = 0; i < pages.length && !cancelled(); i++) {
      onProgress(i, pages.length);
      const p = pages[i];
      const page = await doc.pdfPage(p);
      const [x0, y0, x1, y1] = page.view;
      // Up to 16 megapixels: an A4 page at 300 DPI is under 9; larger paper gets less.
      const scale = Math.min(DPI / 72, Math.sqrt(16e6 / Math.max(1, (x1 - x0) * (y1 - y0))));
      const blob = await renderToBlob(page, scale, 0, "image/png", undefined, false);
      const path = await ipc.tempFile("png");
      temps.push(path);
      await ipc.writeFile(path, new Uint8Array(await blob.arrayBuffer()));
      if (!pictures.has(p.source)) pictures.set(p.source, new Map());
      pictures.get(p.source)!.set(p.index, path);
      done.push(p);
    }
    onProgress(pages.length, pages.length);
    const straightened: number[] = [];
    // Each source is written again with its cleaned pages; those page items then read from the new file.
    const moves: { item: PageItem; source: string }[] = [];
    for (const [sourceId, byIndex] of pictures) {
      const src = doc.sources.get(sourceId)!;
      const output = await ipc.tempFile("pdf");
      const result = await ipc.assemble({
        sources: [{ id: sourceId, path: src.path, password: src.password ?? null }],
        pages: Array.from({ length: src.pdf.numPages }, (_, index) => {
          const picture = byIndex.get(index);
          return { source: sourceId, index, rotate: 0, scan: picture ? { path: picture, deskew: opts.deskew, borders: opts.borders, blackWhite: opts.blackWhite } : null };
        }),
        output,
      });
      straightened.push(...result.straightened);
      const id = newId("s");
      doc.addSource({ id, path: output, pdf: await openPdf(await ipc.readFile(output)), temp: true });
      if (doc.commentSources.has(sourceId)) doc.commentSources.add(id);
      for (const item of done) if (item.source === sourceId) moves.push({ item, source: id });
    }
    doc.change(() => {
      for (const { item, source } of moves) {
        const live = doc.pageById(item.id);
        if (live) live.source = source;
      }
    });
    let recognized = 0;
    if (opts.ocr && !cancelled()) {
      const cleaned = done.map((p) => doc.pageById(p.id)).filter((p): p is PageItem => !!p);
      recognized = (await recognize(doc, cleaned, () => {}, cancelled)).pages;
    }
    return { pages: done.length, straightened, recognized };
  } finally {
    for (const t of temps) ipc.discardTemp(t).catch(() => {});
  }
}
