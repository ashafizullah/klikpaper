// Actions the AI chat and Claude Code (over MCP) can take. One registry so both
// behave the same. Changes to open documents are ordinary edits: they show up
// live and can be undone. File tools never overwrite an existing file unless
// asked to, and only write PDF/PNG/JPEG files (the backend enforces this too).
import type { Corner, Doc } from "./doc.svelte";
import { exportImages } from "./export";
import { errorText, ipc, type CompressLevel, type PageSize } from "./ipc";
import { baseName, formatPages, joinPath, parsePages, splitGroups, stripExt } from "./pagespec";
import { newId } from "./settings.svelte";
import { displaySize, displayToPage } from "./geometry";
import { activate, activeDoc, insertFiles, openPaths, saveDoc, ws } from "./workspace.svelte";
import { writePdf } from "./save.svelte";
import { viewer } from "./viewer.svelte";

type Args = Record<string, unknown>;

export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  /** "app": the built-in chat only; "mcp": Claude Code only. */
  scope: "both" | "mcp" | "app";
  run(args: Args): Promise<unknown>;
}

const DOC = { type: "string", description: "Document id, file name or path of an open document. Defaults to the active document." };
const PAGES = { type: "string", description: 'Pages as typed by a person, 1-based: "3", "1-4, 7", "10-" (to the end).' };

function obj(properties: Record<string, unknown>, required: string[] = []) {
  return { type: "object", properties, required, additionalProperties: false };
}

function str(args: Args, key: string, fallback?: string): string {
  const v = args[key];
  if (typeof v === "string" && v.trim()) return v.trim();
  if (typeof v === "number") return String(v);
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing "${key}"`);
}

function num(args: Args, key: string, fallback?: number): number {
  const v = typeof args[key] === "string" ? Number(args[key]) : args[key];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing number "${key}"`);
}

function findDoc(args: Args): Doc {
  const key = typeof args.doc === "string" ? args.doc.trim() : "";
  const doc = key ? ws.docs.find((d) => d.id === key || d.path === key || d.name === key || baseName(d.path ?? "") === key) : activeDoc();
  if (!doc) throw new Error(key ? `No open document matches "${key}"` : "No document is open");
  return doc;
}

/** 1-based page numbers → page ids. */
function pageIds(doc: Doc, spec: string): string[] {
  const nums = parsePages(spec, doc.pages.length);
  if (!nums) throw new Error(`"${spec}" is not a valid page list for a ${doc.pages.length}-page document`);
  return nums.map((n) => doc.pages[n - 1].id);
}

function requirePdf(path: string, what = "path") {
  if (!/\.pdf$/i.test(path)) throw new Error(`${what} must be a .pdf file`);
  if (!/^(\/|[A-Za-z]:[\\/]|\\\\)/.test(path)) throw new Error(`${what} must be an absolute path`);
}

async function checkOutput(output: string, overwrite: boolean, inputs: string[] = []) {
  requirePdf(output, "output");
  if (inputs.includes(output) && !overwrite) throw new Error("output is the same as an input file; pass overwrite: true to replace it");
  const [stat] = await ipc.fileStats([output]);
  if (stat.exists && !overwrite) throw new Error(`${output} already exists; pass overwrite: true to replace it`);
}

async function pageCount(path: string, password?: string): Promise<number> {
  const info = await ipc.pdfInfo(path, password);
  if (info.needsPassword) throw new Error(password ? `Wrong password for ${baseName(path)}` : `${baseName(path)} needs a password`);
  return info.pages;
}

const MAX_TEXT = 60_000;

export const TOOLS: ToolSpec[] = [
  {
    name: "list_documents",
    description: "Lists the PDFs open in KlikPaper.",
    parameters: obj({}),
    scope: "mcp",
    async run() {
      return ws.docs.map((d) => ({ id: d.id, name: d.name, path: d.path, pages: d.pages.length, unsaved: d.dirty, active: d.id === ws.activeId }));
    },
  },
  {
    name: "open_document",
    description: "Opens a PDF file in KlikPaper (as a new tab) and makes it active.",
    parameters: obj({ path: { type: "string", description: "Absolute path of the PDF." } }, ["path"]),
    scope: "mcp",
    async run(args) {
      const path = str(args, "path");
      requirePdf(path);
      const errors = await openPaths([path]);
      const doc = ws.docs.find((d) => d.path === path);
      if (!doc) throw new Error(errors[0] ?? `Couldn't open ${path} (it may need a password; open it in the app first)`);
      return { id: doc.id, name: doc.name, pages: doc.pages.length };
    },
  },
  {
    name: "document_info",
    description: "Page count, page sizes, unsaved changes and metadata of an open document.",
    parameters: obj({ doc: DOC }),
    scope: "both",
    async run(args) {
      const doc = findDoc(args);
      const sizes = [...new Set(doc.pages.map((p) => `${Math.round(p.w)}×${Math.round(p.h)} pt`))];
      const info = doc.path ? await ipc.pdfInfo(doc.path, doc.sources.values().next().value?.password).catch(() => null) : null;
      return {
        id: doc.id,
        name: doc.name,
        path: doc.path,
        pages: doc.pages.length,
        currentPage: doc.current + 1,
        pageSizes: sizes,
        unsaved: doc.dirty,
        annotations: doc.overlays.length,
        passwordOnSave: !!doc.protect,
        metadata: info && { title: info.title, author: info.author, subject: info.subject, producer: info.producer, created: info.created },
      };
    },
  },
  {
    name: "read_pages",
    description: "Returns the text of pages of an open document, each page marked with its number. Scanned pages without a text layer come back empty.",
    parameters: obj({ doc: DOC, pages: PAGES }, ["pages"]),
    scope: "both",
    async run(args) {
      const doc = findDoc(args);
      const nums = parsePages(str(args, "pages"), doc.pages.length);
      if (!nums) throw new Error(`Invalid page list for a ${doc.pages.length}-page document`);
      let out = "";
      for (const n of nums) {
        const text = await doc.text(doc.pages[n - 1]);
        out += `--- Page ${n} ---\n${text || "(no text on this page)"}\n\n`;
        if (out.length > MAX_TEXT) {
          out = out.slice(0, MAX_TEXT) + `\n[truncated: read fewer pages at a time]`;
          break;
        }
      }
      return out.trim();
    },
  },
  {
    name: "search_text",
    description: "Finds text (case-insensitive) in an open document; returns page numbers with a snippet around each match.",
    parameters: obj({ doc: DOC, query: { type: "string" } }, ["query"]),
    scope: "both",
    async run(args) {
      const doc = findDoc(args);
      const q = str(args, "query").toLowerCase();
      const hits: { page: number; snippet: string }[] = [];
      for (let i = 0; i < doc.pages.length && hits.length < 50; i++) {
        const text = await doc.text(doc.pages[i]);
        const lower = text.toLowerCase();
        for (let at = lower.indexOf(q); at >= 0 && hits.length < 50; at = lower.indexOf(q, at + q.length)) {
          hits.push({ page: i + 1, snippet: text.slice(Math.max(0, at - 60), at + q.length + 60).replace(/\s+/g, " ") });
        }
      }
      return hits.length ? hits : "No matches";
    },
  },
  {
    name: "go_to_page",
    description: "Scrolls the document to a page so the user sees it.",
    parameters: obj({ doc: DOC, page: { type: "integer", minimum: 1 } }, ["page"]),
    scope: "both",
    async run(args) {
      const doc = findDoc(args);
      const page = Math.round(num(args, "page"));
      if (page < 1 || page > doc.pages.length) throw new Error(`Page ${page} does not exist`);
      activate(doc);
      viewer.goTo(page - 1);
      return `Showing page ${page}`;
    },
  },
  {
    name: "rotate_pages",
    description: "Rotates pages clockwise by 90, 180 or 270 degrees (negative = counter-clockwise). Undoable; saved when the user saves.",
    parameters: obj({ doc: DOC, pages: PAGES, degrees: { type: "integer", enum: [90, 180, 270, -90] } }, ["pages", "degrees"]),
    scope: "both",
    async run(args) {
      const doc = findDoc(args);
      const deg = num(args, "degrees");
      if (deg % 90 !== 0) throw new Error("degrees must be a multiple of 90");
      const ids = pageIds(doc, str(args, "pages"));
      doc.rotatePages(ids, deg);
      return `Rotated ${ids.length} page(s)`;
    },
  },
  {
    name: "delete_pages",
    description: "Removes pages from an open document. Undoable; saved when the user saves.",
    parameters: obj({ doc: DOC, pages: PAGES }, ["pages"]),
    scope: "both",
    async run(args) {
      const doc = findDoc(args);
      const ids = pageIds(doc, str(args, "pages"));
      doc.deletePages(ids);
      return `Deleted ${ids.length} page(s); ${doc.pages.length} left`;
    },
  },
  {
    name: "move_pages",
    description: "Moves pages (keeping their order) so they come right before page `before` of the current document; use before = page count + 1 to move them to the end.",
    parameters: obj({ doc: DOC, pages: PAGES, before: { type: "integer", minimum: 1 } }, ["pages", "before"]),
    scope: "both",
    async run(args) {
      const doc = findDoc(args);
      const ids = pageIds(doc, str(args, "pages"));
      const before = Math.round(num(args, "before"));
      if (before < 1 || before > doc.pages.length + 1) throw new Error(`before must be between 1 and ${doc.pages.length + 1}`);
      const target = doc.pages.slice(0, before - 1).filter((p) => !ids.includes(p.id)).length;
      doc.movePages(ids, target);
      return `Moved ${ids.length} page(s)`;
    },
  },
  {
    name: "insert_pdf",
    description: "Inserts all pages of another PDF file into an open document after page `after` (0 = at the start; default: at the end).",
    parameters: obj({ doc: DOC, path: { type: "string" }, after: { type: "integer", minimum: 0 } }, ["path"]),
    scope: "mcp",
    async run(args) {
      const doc = findDoc(args);
      const path = str(args, "path");
      requirePdf(path);
      const after = Math.round(num(args, "after", doc.pages.length));
      const before = doc.pages.length;
      await insertFiles(doc, Math.max(0, Math.min(after, before)), [path]);
      return `Inserted ${doc.pages.length - before} page(s)`;
    },
  },
  {
    name: "add_text",
    description: "Adds a text box to a page. x and y are in points from the top-left corner of the page as displayed (1 inch = 72 points).",
    parameters: obj(
      {
        doc: DOC,
        page: { type: "integer", minimum: 1 },
        x: { type: "number" },
        y: { type: "number" },
        text: { type: "string" },
        size: { type: "number", description: "Font size in points (default 12)." },
        color: { type: "string", description: "Hex color like #1b1916." },
      },
      ["page", "x", "y", "text"],
    ),
    scope: "both",
    async run(args) {
      const doc = findDoc(args);
      const n = Math.round(num(args, "page"));
      const page = doc.pages[n - 1];
      if (!page) throw new Error(`Page ${n} does not exist`);
      const size = Math.min(144, Math.max(4, num(args, "size", 12)));
      const color = /^#[0-9a-f]{6}$/i.test(String(args.color ?? "")) ? String(args.color) : "#1b1916";
      const rot = doc.rotation(page);
      const [dw] = displaySize(page.w, page.h, rot);
      const [x, y] = displayToPage(num(args, "x"), num(args, "y"), rot, page.w, page.h);
      doc.addOverlay({ id: newId("o"), page: page.id, kind: "text", x, y, w: Math.max(40, dw - num(args, "x") - 24), text: str(args, "text"), size, color, rot });
      return `Added text on page ${n}`;
    },
  },
  {
    name: "set_watermark",
    description: "Sets a diagonal text watermark on every page (empty text removes it). Applied when the document is saved.",
    parameters: obj({ doc: DOC, text: { type: "string" }, opacity: { type: "number", minimum: 0.05, maximum: 1 }, size: { type: "number" } }, ["text"]),
    scope: "both",
    async run(args) {
      const doc = findDoc(args);
      const text = typeof args.text === "string" ? args.text : "";
      doc.change(() => {
        doc.watermark = text.trim()
          ? { text, size: Math.min(200, Math.max(12, num(args, "size", 64))), opacity: Math.min(1, Math.max(0.05, num(args, "opacity", 0.18))), color: "#7a7a7a", angle: 45 }
          : null;
      });
      return text.trim() ? "Watermark set" : "Watermark removed";
    },
  },
  {
    name: "set_page_numbers",
    description: "Adds page numbers to every page ({n} = number, {total} = count; empty format removes them). Applied when the document is saved.",
    parameters: obj(
      {
        doc: DOC,
        format: { type: "string", description: 'For example "{n}", "Page {n} of {total}".' },
        position: { type: "string", enum: ["bottom-center", "bottom-right", "bottom-left", "top-center", "top-right", "top-left"] },
      },
      ["format"],
    ),
    scope: "both",
    async run(args) {
      const doc = findDoc(args);
      const format = typeof args.format === "string" ? args.format : "";
      const position = (str(args, "position", "bottom-center") as Corner) ?? "bottom-center";
      doc.change(() => {
        doc.pageNumbers = format.trim() ? { format, position, start: 1, size: 10, margin: 28, color: "#1b1916" } : null;
      });
      return format.trim() ? "Page numbers set" : "Page numbers removed";
    },
  },
  {
    name: "save_document",
    description: "Saves an open document with all its changes. Without `path` it saves in place (an unsaved new document needs a path).",
    parameters: obj({ doc: DOC, path: { type: "string", description: "Absolute .pdf path to save to (Save As)." }, overwrite: { type: "boolean" } }),
    scope: "mcp",
    async run(args) {
      const doc = findDoc(args);
      const path = typeof args.path === "string" && args.path.trim() ? args.path.trim() : doc.path;
      if (!path) throw new Error("This document has not been saved yet; pass a path");
      if (path !== doc.path) await checkOutput(path, args.overwrite === true);
      else requirePdf(path);
      const prev = doc.path;
      doc.path = path;
      const ok = await saveDoc(doc);
      if (!ok) {
        doc.path = prev;
        throw new Error("Saving failed (see the app for details)");
      }
      return `Saved ${path}`;
    },
  },
  {
    name: "merge_pdfs",
    description: "Combines PDF files, in the given order, into one new file.",
    parameters: obj({ paths: { type: "array", items: { type: "string" }, minItems: 2 }, output: { type: "string" }, overwrite: { type: "boolean" } }, ["paths", "output"]),
    scope: "mcp",
    async run(args) {
      const paths = Array.isArray(args.paths) ? args.paths.map(String) : [];
      if (paths.length < 2) throw new Error("Give at least two files");
      paths.forEach((p) => requirePdf(p, "every path"));
      const output = str(args, "output");
      await checkOutput(output, args.overwrite === true, paths);
      const sources = paths.map((path, i) => ({ id: `s${i}`, path }));
      const pages = [];
      for (const [i, p] of paths.entries()) {
        const n = await pageCount(p);
        for (let k = 0; k < n; k++) pages.push({ source: `s${i}`, index: k, rotate: 0 });
      }
      const res = await ipc.assemble({ sources, pages, output });
      return `Wrote ${output} (${res.pages} pages)`;
    },
  },
  {
    name: "split_pdf",
    description: 'Splits a PDF file into several files: every N pages, or by ranges separated by semicolons ("1-3; 4-10").',
    parameters: obj({ path: { type: "string" }, every: { type: "integer", minimum: 1 }, ranges: { type: "string" }, output_dir: { type: "string" } }, ["path", "output_dir"]),
    scope: "mcp",
    async run(args) {
      const path = str(args, "path");
      requirePdf(path);
      const dir = str(args, "output_dir");
      const total = await pageCount(path);
      const groups = args.ranges ? splitGroups(total, { ranges: str(args, "ranges") }) : splitGroups(total, { every: num(args, "every", 1) });
      if (!groups) throw new Error("Invalid ranges");
      const base = stripExt(baseName(path));
      const width = String(groups.length).length;
      const outputs = groups.map((_, g) => joinPath(dir, `${base}-${String(g + 1).padStart(width, "0")}.pdf`));
      const stats = await ipc.fileStats(outputs);
      const clash = stats.find((s) => s.exists);
      if (clash) throw new Error(`${clash.path} already exists`);
      for (let g = 0; g < groups.length; g++) {
        await ipc.assemble({ sources: [{ id: "s", path }], pages: groups[g].map((n) => ({ source: "s", index: n - 1, rotate: 0 })), output: outputs[g] });
      }
      return { files: outputs };
    },
  },
  {
    name: "extract_pages",
    description: "Copies some pages of a PDF file into a new file.",
    parameters: obj({ path: { type: "string" }, pages: PAGES, output: { type: "string" }, overwrite: { type: "boolean" } }, ["path", "pages", "output"]),
    scope: "mcp",
    async run(args) {
      const path = str(args, "path");
      requirePdf(path);
      const output = str(args, "output");
      await checkOutput(output, args.overwrite === true, [path]);
      const nums = parsePages(str(args, "pages"), await pageCount(path));
      if (!nums) throw new Error("Invalid page list");
      await ipc.assemble({ sources: [{ id: "s", path }], pages: nums.map((n) => ({ source: "s", index: n - 1, rotate: 0 })), output });
      return `Wrote ${output} (pages ${formatPages(nums)})`;
    },
  },
  {
    name: "compress_pdf",
    description: "Makes a PDF smaller by downscaling and re-encoding its photos. low = best quality, high = smallest file.",
    parameters: obj({ path: { type: "string" }, level: { type: "string", enum: ["low", "medium", "high"] }, output: { type: "string" }, overwrite: { type: "boolean" } }, ["path", "output"]),
    scope: "mcp",
    async run(args) {
      const path = str(args, "path");
      requirePdf(path);
      const output = str(args, "output");
      await checkOutput(output, args.overwrite === true, [path]);
      const level = (["low", "medium", "high"].includes(String(args.level)) ? args.level : "medium") as CompressLevel;
      const n = await pageCount(path);
      const before = (await ipc.fileStats([path]))[0].bytes;
      const res = await ipc.assemble({
        sources: [{ id: "s", path }],
        pages: Array.from({ length: n }, (_, i) => ({ source: "s", index: i, rotate: 0 })),
        output,
        options: { compress: level },
      });
      return { output, before, after: res.bytes, imagesReencoded: res.images };
    },
  },
  {
    name: "protect_pdf",
    description: "Writes a copy of a PDF that needs a password to open (AES-256).",
    parameters: obj({ path: { type: "string" }, password: { type: "string" }, output: { type: "string" }, overwrite: { type: "boolean" } }, ["path", "password", "output"]),
    scope: "mcp",
    async run(args) {
      const path = str(args, "path");
      requirePdf(path);
      const output = str(args, "output");
      await checkOutput(output, args.overwrite === true, [path]);
      const password = str(args, "password");
      const n = await pageCount(path);
      await ipc.assemble({
        sources: [{ id: "s", path }],
        pages: Array.from({ length: n }, (_, i) => ({ source: "s", index: i, rotate: 0 })),
        output,
        options: { protect: { userPassword: password } },
      });
      return `Wrote ${output}`;
    },
  },
  {
    name: "unlock_pdf",
    description: "Writes a copy of a password-protected PDF without the password (you must know the password).",
    parameters: obj({ path: { type: "string" }, password: { type: "string" }, output: { type: "string" }, overwrite: { type: "boolean" } }, ["path", "password", "output"]),
    scope: "mcp",
    async run(args) {
      const path = str(args, "path");
      requirePdf(path);
      const output = str(args, "output");
      await checkOutput(output, args.overwrite === true, [path]);
      const password = str(args, "password");
      const n = await pageCount(path, password);
      await ipc.assemble({ sources: [{ id: "s", path, password }], pages: Array.from({ length: n }, (_, i) => ({ source: "s", index: i, rotate: 0 })), output });
      return `Wrote ${output}`;
    },
  },
  {
    name: "remove_metadata",
    description: "Writes a copy of a PDF without its document information (title, author, software, dates) and XMP metadata.",
    parameters: obj({ path: { type: "string" }, output: { type: "string" }, overwrite: { type: "boolean" } }, ["path", "output"]),
    scope: "mcp",
    async run(args) {
      const path = str(args, "path");
      requirePdf(path);
      const output = str(args, "output");
      await checkOutput(output, args.overwrite === true, [path]);
      const n = await pageCount(path);
      await ipc.assemble({
        sources: [{ id: "s", path }],
        pages: Array.from({ length: n }, (_, i) => ({ source: "s", index: i, rotate: 0 })),
        output,
        options: { stripMetadata: true },
      });
      return `Wrote ${output}`;
    },
  },
  {
    name: "images_to_pdf",
    description: "Creates a PDF with one image per page (JPEG, PNG, WebP, GIF, BMP, TIFF).",
    parameters: obj(
      {
        images: { type: "array", items: { type: "string" }, minItems: 1 },
        output: { type: "string" },
        page_size: { type: "string", enum: ["a4", "letter", "fit"] },
        margin: { type: "number", description: "Margin in points (default 0)." },
        overwrite: { type: "boolean" },
      },
      ["images", "output"],
    ),
    scope: "mcp",
    async run(args) {
      const images = Array.isArray(args.images) ? args.images.map(String) : [];
      const output = str(args, "output");
      await checkOutput(output, args.overwrite === true);
      const pageSize = (["a4", "letter", "fit"].includes(String(args.page_size)) ? args.page_size : "a4") as PageSize;
      const res = await ipc.imagesToPdf({ images, output, pageSize, orientation: "auto", margin: num(args, "margin", 0) });
      return `Wrote ${output} (${res.pages} pages)`;
    },
  },
  {
    name: "pdf_to_images",
    description: "Renders pages of a PDF file to PNG or JPEG images in a folder.",
    parameters: obj(
      { path: { type: "string" }, pages: PAGES, dpi: { type: "integer", minimum: 36, maximum: 600 }, format: { type: "string", enum: ["png", "jpg"] }, output_dir: { type: "string" } },
      ["path", "output_dir"],
    ),
    scope: "mcp",
    async run(args) {
      const path = str(args, "path");
      requirePdf(path);
      const total = await pageCount(path);
      const nums = args.pages ? parsePages(str(args, "pages"), total) : Array.from({ length: total }, (_, i) => i + 1);
      if (!nums) throw new Error("Invalid page list");
      const format = args.format === "jpg" ? "jpg" : "png";
      const dir = str(args, "output_dir");
      const base = stripExt(baseName(path));
      const width = String(total).length;
      const planned = nums.map((n) => joinPath(dir, `${base}-${String(n).padStart(width, "0")}.${format}`));
      const clash = (await ipc.fileStats(planned)).find((s) => s.exists);
      if (clash) throw new Error(`${clash.path} already exists`);
      const files = await exportImages(path, null, { pages: nums.map((n) => n - 1), dpi: num(args, "dpi", 150), format, dir, base });
      return { files };
    },
  },
  {
    name: "export_document",
    description: "Writes an open document as it looks now (with unsaved edits and annotations) to a new file, optionally only some pages, compressed or password protected. The open document stays as it is.",
    parameters: obj(
      {
        doc: DOC,
        output: { type: "string" },
        pages: PAGES,
        compress: { type: "string", enum: ["low", "medium", "high"] },
        password: { type: "string" },
        overwrite: { type: "boolean" },
      },
      ["output"],
    ),
    scope: "mcp",
    async run(args) {
      const doc = findDoc(args);
      const output = str(args, "output");
      await checkOutput(output, args.overwrite === true, doc.path ? [doc.path] : []);
      const nums = args.pages ? parsePages(str(args, "pages"), doc.pages.length) : null;
      if (args.pages && !nums) throw new Error("Invalid page list");
      const res = await writePdf(doc, output, {
        pages: nums?.map((n) => n - 1),
        compress: (["low", "medium", "high"].includes(String(args.compress)) ? args.compress : null) as CompressLevel | null,
        password: typeof args.password === "string" ? args.password : undefined,
      });
      return { output, pages: res.pages, bytes: res.bytes };
    },
  },
];

export function toolsFor(scope: "app" | "mcp"): ToolSpec[] {
  return TOOLS.filter((t) => t.scope === "both" || t.scope === scope);
}

export async function runTool(name: string, args: Args, scope: "app" | "mcp"): Promise<string> {
  const tool = toolsFor(scope).find((t) => t.name === name);
  if (!tool) throw new Error(`Unknown tool ${name}`);
  try {
    const out = await tool.run(args ?? {});
    return typeof out === "string" ? out : JSON.stringify(out, null, 2);
  } catch (e) {
    throw new Error(errorText(e));
  }
}
