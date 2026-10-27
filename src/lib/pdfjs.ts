// pdf.js setup: rendering, text and form layers. Scripts embedded in PDFs
// never run: scripting is off and the JavaScript sandbox is not shipped.
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist/types/src/display/api";
import type { PageViewport } from "pdfjs-dist/types/src/display/page_viewport";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import { findTextRects, groupLines, type TextItem, type TextLine } from "./textmatch";
import type { Rect } from "./geometry";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export type { PDFDocumentProxy, PDFPageProxy, PageViewport };
export { pdfjs };

/** CSS pixels per PDF point at 100% zoom (96 / 72), so 100% is the paper's real size. */
export const CSS_UNITS = 96 / 72;

/** Frees a document and its worker. */
export function closePdf(pdf: PDFDocumentProxy) {
  pdf.loadingTask.destroy().catch(() => {});
}

export class PasswordNeeded extends Error {
  constructor(public readonly retry: boolean) {
    super(retry ? "Wrong password" : "Password required");
  }
}

/** Opens a PDF from bytes. Throws PasswordNeeded when it is protected. */
export async function openPdf(data: Uint8Array, password?: string): Promise<PDFDocumentProxy> {
  const task = pdfjs.getDocument({
    data,
    password,
    cMapUrl: "/pdfjs/cmaps/",
    cMapPacked: true,
    standardFontDataUrl: "/pdfjs/standard_fonts/",
    wasmUrl: "/pdfjs/wasm/",
    iccUrl: "/pdfjs/iccs/",
    enableXfa: false,
    // Keeps each font's name (and data) after loading, so Edit text can match the original font.
    fontExtraProperties: true,
  });
  try {
    return await task.promise;
  } catch (e) {
    // Without an onPassword handler pdf.js rejects: code 1 = needs a password, 2 = wrong password.
    const err = e as { name?: string; code?: number };
    if (err?.name === "PasswordException") throw new PasswordNeeded(err.code === 2);
    throw e;
  }
}

/** Renders a page into a canvas at `scale` (CSS px per point), sharp on HiDPI screens. */
export async function renderToCanvas(
  page: PDFPageProxy,
  canvas: HTMLCanvasElement,
  scale: number,
  rotation: number,
  opts: { maxPixels?: number; printForms?: boolean } = {},
): Promise<{ cancel(): void; done: Promise<void> }> {
  const viewport = page.getViewport({ scale, rotation });
  let ratio = window.devicePixelRatio || 1;
  const max = opts.maxPixels ?? 16_000_000;
  if (viewport.width * viewport.height * ratio * ratio > max) ratio = Math.sqrt(max / (viewport.width * viewport.height));
  canvas.width = Math.max(1, Math.floor(viewport.width * ratio));
  canvas.height = Math.max(1, Math.floor(viewport.height * ratio));
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;
  const task = page.render({
    canvas,
    viewport,
    transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
    // Form fields are drawn by the annotation layer on screen; when exporting images, paint their values.
    annotationMode: opts.printForms ? pdfjs.AnnotationMode.ENABLE_STORAGE : pdfjs.AnnotationMode.ENABLE_FORMS,
  });
  return {
    cancel: () => task.cancel(),
    done: task.promise.catch((e: { name?: string }) => {
      if (e?.name !== "RenderingCancelledException") throw e;
    }),
  };
}

/** Renders a page to an image blob, e.g. for thumbnails or "export as images". */
export async function renderToBlob(
  page: PDFPageProxy,
  scale: number,
  rotation: number,
  type: "image/png" | "image/jpeg" = "image/png",
  quality = 0.92,
): Promise<Blob> {
  const viewport = page.getViewport({ scale, rotation });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(viewport.width));
  canvas.height = Math.max(1, Math.round(viewport.height));
  const ctx = canvas.getContext("2d")!;
  // JPEG has no transparency; pages are white paper.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // The print intent renders without requestAnimationFrame, which the webview
  // pauses while the window is hidden; it also paints filled-in form values.
  await page.render({ canvas, viewport, intent: "print", annotationMode: pdfjs.AnnotationMode.ENABLE_STORAGE }).promise;
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
  canvas.width = canvas.height = 0;
  if (!blob) throw new Error("Couldn't encode the image");
  return blob;
}

/** Plain text of a page; items on the same line are joined with spaces. */
export async function pageText(page: PDFPageProxy): Promise<string> {
  const content = await page.getTextContent();
  let out = "";
  for (const item of content.items) {
    if (!("str" in item)) continue;
    out += item.str;
    out += item.hasEOL ? "\n" : item.str && !item.str.endsWith(" ") ? " " : "";
  }
  return out.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Page-space rectangles of each occurrence of `query` on the page (unrotated, top-left origin). */
export async function textRects(page: PDFPageProxy, query: string): Promise<Rect[][]> {
  const content = await page.getTextContent();
  const items = content.items.filter((i) => "str" in i) as (TextItem & { fontName: string })[];
  // Where a match starts inside an item, measured with the PDF's own font: pdf.js
  // registers it under the item's fontName once the page has been drawn. Until then
  // the generic family it reports is still closer than equal-width characters.
  const ctx = document.createElement("canvas").getContext("2d");
  const share = (item: TextItem, chars: number) => {
    const { str, fontName } = item as TextItem & { fontName: string };
    if (!ctx || !str) return chars / (str.length || 1);
    ctx.font = `100px "${fontName}", ${content.styles[fontName]?.fontFamily ?? "sans-serif"}`;
    const whole = ctx.measureText(str).width;
    return whole > 0 ? ctx.measureText(str.slice(0, chars)).width / whole : chars / str.length;
  };
  return findTextRects(items, query, page.getViewport({ scale: 1, rotation: 0 }).transform, share);
}

/** A line of the page's text with what is known about its font. */
export interface PageLine extends TextLine {
  /** The PDF's font name, e.g. "ABCDEF+Georgia-Bold" (empty until the page has been drawn). */
  pdfFont: string;
  /** CSS generic family pdf.js guessed: "serif", "sans-serif" or "monospace". */
  generic: string;
  /** pdf.js read the font as bold (or black). */
  bold: boolean;
}

/** The page's horizontal lines of text, in page space (unrotated, top-left origin). */
export async function textLines(page: PDFPageProxy): Promise<PageLine[]> {
  const content = await page.getTextContent();
  const items = content.items.filter((i) => "str" in i) as (TextItem & { fontName: string })[];
  return groupLines(items, page.getViewport({ scale: 1, rotation: 0 }).transform).map((line) => {
    let font: { name?: string; bold?: boolean; black?: boolean } | undefined;
    try {
      // Loaded while drawing the page; asking before that throws.
      font = page.commonObjs.get(line.fontName) as typeof font;
    } catch {}
    return { ...line, pdfFont: font?.name ?? "", bold: !!(font?.bold || font?.black), generic: content.styles[line.fontName]?.fontFamily ?? "sans-serif" };
  });
}

export interface LinkHandlers {
  goToPage(index: number): void;
  openUrl(url: string): void;
}

/** The part of pdf.js's link service the annotation layer uses: links inside the document and to the web. */
export function linkService(doc: PDFDocumentProxy, handlers: LinkHandlers) {
  const goTo = async (dest: unknown) => {
    const explicit = typeof dest === "string" ? await doc.getDestination(dest) : dest;
    if (!Array.isArray(explicit)) return;
    const ref = explicit[0];
    const index = typeof ref === "object" && ref ? await doc.getPageIndex(ref) : Number(ref);
    if (Number.isInteger(index)) handlers.goToPage(index);
  };
  return {
    externalLinkEnabled: true,
    externalLinkTarget: 0,
    externalLinkRel: "noopener noreferrer nofollow",
    isInPresentationMode: false,
    get pagesCount() {
      return doc.numPages;
    },
    addLinkAttributes(link: HTMLAnchorElement, url: string) {
      link.href = url;
      link.title = url;
      link.rel = "noopener noreferrer nofollow";
      link.onclick = (e) => {
        e.preventDefault();
        // Only web and mail links leave the app.
        if (/^(https?|mailto):/i.test(url)) handlers.openUrl(url);
      };
    },
    getDestinationHash: () => "#",
    getAnchorUrl: () => "#",
    goToDestination: goTo,
    goToPage: (n: number) => handlers.goToPage(n - 1),
    goToXY: (n: number) => handlers.goToPage(n - 1),
    executeNamedAction(action: string) {
      if (action === "FirstPage") handlers.goToPage(0);
      if (action === "LastPage") handlers.goToPage(doc.numPages - 1);
    },
    executeSetOCGState() {},
    setHash() {},
    navigateTo: goTo,
  };
}
