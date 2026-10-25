// Writing documents: page work goes to Rust (lopdf), drawing to pdf-lib.
import type { Doc } from "./doc.svelte";
import { ipc, type AssembleResult, type CompressLevel, type PageSpec, type SourceSpec } from "./ipc";
import { baseName, joinPath, stripExt } from "./pagespec";

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

/** Sources and pages that produce the document as it looks now, including form values and drawings. */
async function prepare(doc: Doc, temps: string[]): Promise<Prepared> {
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
  if (!doc.needsDrawing) return { sources, pages };

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
  });
  const merged = await ipc.tempFile("pdf");
  temps.push(merged);
  await ipc.writeFile(merged, drawn);
  return { sources: [{ id: "drawn", path: merged }], pages: doc.pages.map((_, i) => ({ source: "drawn", index: i, rotate: 0 })) };
}

export interface WriteOptions {
  /** 0-based positions in the document; all pages when omitted. */
  pages?: number[];
  compress?: CompressLevel | null;
  /** Overrides the document's own protection setting (empty string = none). */
  password?: string | null;
}

export async function writePdf(doc: Doc, output: string, opts: WriteOptions = {}): Promise<AssembleResult> {
  const temps: string[] = [];
  try {
    const prepared = await prepare(doc, temps);
    const pages = opts.pages ? opts.pages.map((i) => prepared.pages[i]) : prepared.pages;
    const password = opts.password !== undefined ? opts.password : doc.protect;
    return await ipc.assemble({
      sources: prepared.sources,
      pages,
      output,
      options: {
        stripMetadata: doc.stripMetadata,
        compress: opts.compress ?? null,
        protect: password ? { userPassword: password } : null,
      },
    });
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
        options: { stripMetadata: doc.stripMetadata, protect: doc.protect ? { userPassword: doc.protect } : null },
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

export function defaultName(doc: Doc, suffix = ""): string {
  return `${stripExt(baseName(doc.name))}${suffix}.pdf`;
}
