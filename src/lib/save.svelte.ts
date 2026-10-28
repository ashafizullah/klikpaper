// Writing documents: page work goes to Rust (lopdf), drawing to pdf-lib.
import type { Doc, PageItem } from "./doc.svelte";
import { ipc, type AssembleOptions, type AssembleResult, type BookmarkSpec, type Compression, type PageSpec, type SourceSpec } from "./ipc";
import { baseName, joinPath, stripExt } from "./pagespec";
import { fontFile } from "./fonts.svelte";
import { outlineSpec } from "./outline";
import { closePdf, openPdf, renderToBlob } from "./pdfjs";

/** Resolution of the picture that replaces a redacted page whose content couldn't be taken apart. */
const PICTURE_DPI = 200;

let fontCache: Promise<{ regular: Uint8Array; bold: Uint8Array }> | null = null;

/** Liberation Sans 2 (SIL OFL-1.1, from assets/fonts/liberation, copied over pdf.js's 1.07 files by vite.config.ts); metric-compatible with Arial/Helvetica used on screen. */
export function loadFonts() {
  fontCache ??= Promise.all(
    ["LiberationSans-Regular.ttf", "LiberationSans-Bold.ttf"].map(async (f) => {
      const res = await fetch(`/pdfjs/standard_fonts/${f}`);
      if (!res.ok) throw new Error(`Missing font ${f}`);
      return new Uint8Array(await res.arrayBuffer());
    }),
  ).then(([regular, bold]) => ({ regular, bold }));
  return fontCache;
}

interface Prepared {
  sources: SourceSpec[];
  pages: PageSpec[];
}

/** Sources and pages that produce the document as it looks now, including form values, drawings and redactions. */
async function prepare(doc: Doc, temps: string[]): Promise<Prepared> {
  return withPictures(await arrange(doc, temps), temps);
}

async function arrange(doc: Doc, temps: string[]): Promise<Prepared> {
  const used = new Set(doc.pages.map((p) => p.source));
  const sources: SourceSpec[] = [];
  for (const id of used) {
    const src = doc.sources.get(id)!;
    let path = src.path;
    if (doc.formsEdited) {
      // pdf.js writes the typed form values into a copy of the file.
      const bytes = await src.pdf.saveDocument();
      path = await ipc.tempFile("pdf");
      temps.push(path);
      await ipc.writeFile(path, bytes);
    }
    sources.push({ id, path, password: src.password ?? null });
  }
  const pages = doc.pages.map((p) => ({ source: p.source, index: p.index, rotate: p.rotate }));
  // Comments are written as the file's own notes, replacing the ones it had.
  const comments = (p: PageItem) => (doc.commentSources.has(p.source) ? $state.snapshot(doc.comments.filter((c) => c.page === p.id)).map(({ page: _, ...thread }) => thread) : null);
  const redact = (p: PageItem) => doc.redactedAreas(p.id);
  if (!doc.needsDrawing) return { sources, pages: pages.map((spec, i) => ({ ...spec, comments: comments(doc.pages[i]), redact: redact(doc.pages[i]) })) };

  const plain = await ipc.tempFile("pdf");
  temps.push(plain);
  await ipc.assemble({ sources, pages, output: plain });
  const { drawOnPdf } = await import("./draw");
  const drawn = await drawOnPdf(await ipc.readFile(plain), {
    pages: doc.pages.map((p) => ({ overlays: $state.snapshot(doc.overlays.filter((o) => o.page === p.id)), rotation: doc.rotation(p) })),
    watermark: $state.snapshot(doc.watermark),
    pageNumbers: $state.snapshot(doc.pageNumbers),
    flattenForms: doc.flattenForms,
    fonts: loadFonts,
    systemFont: fontFile,
  });
  const merged = await ipc.tempFile("pdf");
  temps.push(merged);
  await ipc.writeFile(merged, drawn);
  return { sources: [{ id: "drawn", path: merged }], pages: doc.pages.map((p, i) => ({ source: "drawn", index: i, rotate: 0, comments: comments(p), redact: redact(p) })) };
}

/**
 * Redacted pages whose content can't be taken apart safely (a font without
 * glyph widths, an image encoding that can't be rewritten) are saved as a
 * picture of the page instead: a trial run finds them, and pdf.js draws them
 * from that run, black boxes and all.
 */
async function withPictures(prepared: Prepared, temps: string[]): Promise<Prepared> {
  if (!prepared.pages.some((p) => p.redact?.length)) return prepared;
  const trial = await ipc.tempFile("pdf");
  temps.push(trial);
  const { rasterNeeded } = await ipc.assemble({ sources: prepared.sources, pages: prepared.pages, output: trial });
  if (!rasterNeeded.length) return prepared;
  const pdf = await openPdf(await ipc.readFile(trial));
  try {
    const pages = [...prepared.pages];
    for (const i of rasterNeeded) {
      const page = await pdf.getPage(i + 1);
      const [x0, y0, x1, y1] = page.view;
      const scale = Math.min(PICTURE_DPI / 72, Math.sqrt(40e6 / Math.max(1, (x1 - x0) * (y1 - y0))));
      // Unrotated (the page keeps its rotation) and without annotations (they stay annotations).
      const blob = await renderToBlob(page, scale, 0, "image/jpeg", 0.9, false);
      page.cleanup();
      const path = await ipc.tempFile("jpg");
      temps.push(path);
      await ipc.writeFile(path, new Uint8Array(await blob.arrayBuffer()));
      pages[i] = { ...pages[i], raster: path };
    }
    return { ...prepared, pages };
  } finally {
    closePdf(pdf);
  }
}

/** What the file's edit history should get for a file of `positions` (indexes into the document's pages). */
function contentEdits(doc: Doc, positions: number[]): AssembleOptions["edits"] {
  const out = { textLines: 0, textPages: [] as number[], covers: 0, coverPages: [] as number[] };
  positions.forEach((pos, i) => {
    const { lines, covers } = doc.contentEdits(doc.pages[pos].id);
    out.textLines += lines;
    out.covers += covers;
    if (lines) out.textPages.push(i + 1);
    if (covers) out.coverPages.push(i + 1);
  });
  return out.textLines || out.covers ? out : null;
}

/** Bookmarks for a file of `positions` (indexes into the document's pages): written when edited, or when only some pages are saved. */
function bookmarks(doc: Doc, positions: number[] | undefined): BookmarkSpec[] | null {
  if (!doc.outlineChanged && !(positions && doc.outline.length)) return null;
  return outlineSpec($state.snapshot(doc.outline), doc.pages, positions ?? doc.pages.map((_, i) => i));
}

/** Whether every PDF app can open a file locked with `password`: keyboard letters without
 * accents, numbers, spaces and symbols. The standard refuses emoji, and macOS Preview doesn't
 * open files whose password has accented letters, even ones written by Acrobat. */
export const PASSWORD_HINT = "use only letters A-Z without accents, numbers, spaces and keyboard symbols, so every PDF app (Preview on Mac too) can open the file";
export function passwordFits(password: string): boolean {
  return /^[\x20-\x7e]*$/.test(password);
}

export interface WriteOptions {
  /** 0-based positions in the document; all pages when omitted. */
  pages?: number[];
  compress?: Compression | null;
  /** Overrides the document's own protection setting (empty string = none). */
  password?: string | null;
}

/** Writes the document; `pictures` counts redacted pages saved as pictures. */
export async function writePdf(doc: Doc, output: string, opts: WriteOptions = {}): Promise<AssembleResult & { pictures: number }> {
  const temps: string[] = [];
  try {
    const prepared = await prepare(doc, temps);
    // A new paper size applies last, so annotations drawn in the page's own space move with the content.
    const fitted = prepared.pages.map((p, i) => ({ ...p, sheet: doc.pages[i].sheet ?? null }));
    const pages = opts.pages ? opts.pages.map((i) => fitted[i]) : fitted;
    const password = opts.password !== undefined ? opts.password : doc.protect;
    const result = await ipc.assemble({
      sources: prepared.sources,
      pages,
      output,
      options: {
        stripMetadata: doc.stripMetadata,
        compress: opts.compress ?? null,
        protect: password ? { userPassword: password } : null,
        edits: contentEdits(doc, opts.pages ?? doc.pages.map((_, i) => i)),
      },
      outline: bookmarks(doc, opts.pages),
    });
    return { ...result, pictures: pages.filter((p) => p.raster).length };
  } finally {
    for (const t of temps) ipc.discardTemp(t).catch(() => {});
  }
}

/** One file per group of 1-based page positions; returns the written paths. */
export async function splitDoc(doc: Doc, groups: number[][], dir: string): Promise<string[]> {
  const temps: string[] = [];
  const base = stripExt(doc.name);
  try {
    const prepared = await prepare(doc, temps);
    const written: string[] = [];
    const width = String(groups.length).length;
    for (let g = 0; g < groups.length; g++) {
      const output = joinPath(dir, `${base}-${String(g + 1).padStart(width, "0")}.pdf`);
      await ipc.assemble({
        sources: prepared.sources,
        pages: groups[g].map((n) => prepared.pages[n - 1]),
        output,
        options: {
          stripMetadata: doc.stripMetadata,
          protect: doc.protect ? { userPassword: doc.protect } : null,
          edits: contentEdits(
            doc,
            groups[g].map((n) => n - 1),
          ),
        },
        outline: bookmarks(
          doc,
          groups[g].map((n) => n - 1),
        ),
      });
      written.push(output);
    }
    return written;
  } finally {
    for (const t of temps) ipc.discardTemp(t).catch(() => {});
  }
}

/** A temporary PDF of the document as it looks now (for rendering exports). */
export async function snapshotFile(doc: Doc): Promise<string> {
  const path = await ipc.tempFile("pdf");
  await writePdf(doc, path, { password: "" });
  return path;
}

export function defaultName(doc: Doc, suffix = doc.redactions.length ? "-redacted" : ""): string {
  return `${stripExt(baseName(doc.name))}${suffix}.pdf`;
}
