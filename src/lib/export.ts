// Pages to image files, rendered by pdf.js.
import { ipc } from "./ipc";
import { joinPath } from "./pagespec";
import { CSS_UNITS, closePdf, openPdf, renderToBlob } from "./pdfjs";

export interface ImageExport {
  /** 0-based page indices of the file. */
  pages: number[];
  dpi: number;
  format: "png" | "jpg";
  dir: string;
  base: string;
  onProgress?: (done: number, total: number) => void;
}

/** Renders pages of a PDF file to images in `dir`; returns the written paths. */
export async function exportImages(path: string, password: string | null, opts: ImageExport): Promise<string[]> {
  const pdf = await openPdf(await ipc.readFile(path), password ?? undefined);
  try {
    const dpi = Math.min(600, Math.max(36, opts.dpi));
    const scale = dpi / 72;
    const width = String(pdf.numPages).length;
    const written: string[] = [];
    for (let n = 0; n < opts.pages.length; n++) {
      const index = opts.pages[n];
      const page = await pdf.getPage(index + 1);
      // Very large pages at high DPI would exceed canvas limits; cap at ~40 megapixels.
      const [x0, y0, x1, y1] = page.view;
      const pixels = (x1 - x0) * (y1 - y0) * scale * scale;
      const fit = pixels > 40e6 ? Math.sqrt(40e6 / pixels) : 1;
      const blob = await renderToBlob(page, scale * fit, page.rotate, opts.format === "png" ? "image/png" : "image/jpeg");
      const out = joinPath(opts.dir, `${opts.base}-${String(index + 1).padStart(width, "0")}.${opts.format}`);
      await ipc.writeFile(out, new Uint8Array(await blob.arrayBuffer()));
      written.push(out);
      page.cleanup();
      opts.onProgress?.(n + 1, opts.pages.length);
    }
    return written;
  } finally {
    closePdf(pdf);
  }
}

export { CSS_UNITS };
