// Actions the AI chat and external agents (over MCP) can take. One registry so both
// behave the same. Changes to open documents are ordinary edits: they show up
// live and can be undone. File tools never overwrite an existing file unless
// asked to, and only write PDF/PNG/JPEG files (the backend enforces this too).
import type { Corner, Doc, MarkupKind, Overlay, PageItem } from "./doc.svelte";
import { exportImages } from "./export";
import { errorText, ipc, type CompressLevel, type PageSize } from "./ipc";
import { baseName, formatPages, joinPath, parsePages, splitGroups, stripExt } from "./pagespec";
import { newId, settings } from "./settings.svelte";
import { displayRectToPage, displaySize, displayToPage, normRect, pageRectToDisplay, type Rect } from "./geometry";
import { normalizeImage } from "./images";
import { fonts, loadSystemFonts, showFont } from "./fonts.svelte";
import { textRects } from "./pdfjs";
import { DEFAULT_COLORS } from "./ui.svelte";
import { activate, activeDoc, closeDoc, insertFiles, openPaths, saveDoc, ws } from "./workspace.svelte";
import { writePdf } from "./save.svelte";
import { viewer } from "./viewer.svelte";

type Args = Record<string, unknown>;

export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  /** "app": the built-in chat only; "mcp": MCP clients only. */
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

/** 1-based page number → page, from `args.page`. */
function pageArg(doc: Doc, args: Args): { n: number; page: PageItem } {
  const n = Math.round(num(args, "page"));
  const page = doc.pages[n - 1];
  if (!page) throw new Error(`Page ${n} does not exist (the document has ${doc.pages.length})`);
  return { n, page };
}

function color(args: Args, key: string, fallback: string): string;
function color(args: Args, key: string, fallback: null): string | null;
function color(args: Args, key: string, fallback: string | null) {
  const v = String(args[key] ?? "");
  return /^#[0-9a-f]{6}$/i.test(v) ? v : fallback;
}

/** A display-space box (as the user sees the page) → page space, refusing boxes off the page. */
function boxOnPage(doc: Doc, page: PageItem, box: Rect): Rect {
  const rot = doc.rotation(page);
  const [dw, dh] = displaySize(page.w, page.h, rot);
  if (box.w <= 0 || box.h <= 0) throw new Error("width and height must be positive");
  if (box.x < 0 || box.y < 0 || box.x + box.w > dw + 0.5 || box.y + box.h > dh + 0.5)
    throw new Error(`The box is off the page (the page is ${Math.round(dw)}×${Math.round(dh)} pt as displayed)`);
  return displayRectToPage(box, rot, page.w, page.h);
}

function pointOnPage(doc: Doc, page: PageItem, x: number, y: number): [number, number] {
  const rot = doc.rotation(page);
  const [dw, dh] = displaySize(page.w, page.h, rot);
  if (x < 0 || y < 0 || x > dw + 0.5 || y > dh + 0.5) throw new Error(`(${x}, ${y}) is off the page (the page is ${Math.round(dw)}×${Math.round(dh)} pt as displayed)`);
  return displayToPage(x, y, rot, page.w, page.h);
}

/** Page-space bounds of an annotation. */
function bounds(o: Overlay): Rect {
  switch (o.kind) {
    case "text":
      return { x: o.x, y: o.y, w: o.w, h: o.size * 1.25 * Math.max(1, o.text.split("\n").length) };
    case "image":
    case "rect":
    case "ellipse":
      return { x: o.x, y: o.y, w: o.w, h: o.h };
    case "line":
    case "arrow":
      return normRect(o.x1, o.y1, o.x2, o.y2);
    case "ink": {
      const xs = o.points.filter((_, i) => i % 2 === 0);
      const ys = o.points.filter((_, i) => i % 2 === 1);
      return normRect(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys));
    }
    case "markup": {
      const x = Math.min(...o.rects.map((r) => r.x));
      const y = Math.min(...o.rects.map((r) => r.y));
      return normRect(x, y, Math.max(...o.rects.map((r) => r.x + r.w)), Math.max(...o.rects.map((r) => r.y + r.h)));
    }
  }
}

/** What list_annotations reports: the kind as the toolbar names it and where it sits as displayed. */
function describe(doc: Doc, o: Overlay) {
  const index = doc.pages.findIndex((p) => p.id === o.page);
  const page = doc.pages[index];
  const b = pageRectToDisplay(bounds(o), doc.rotation(page), page.w, page.h);
  const kind = o.kind === "markup" ? o.style : o.kind === "rect" && o.fill === "#ffffff" && o.width === 0 ? "whiteout" : o.kind;
  const round = (v: number) => Math.round(v * 10) / 10;
  return {
    id: o.id,
    page: index + 1,
    kind,
    x: round(b.x),
    y: round(b.y),
    width: round(b.w),
    height: round(b.h),
    ...("color" in o ? { color: o.color } : {}),
    ...(o.kind === "text" ? { text: o.text, size: o.size, font: o.font ?? "Liberation Sans" } : {}),
  };
}

/** An installed family by name (any case), checked to be embeddable. */
async function installedFont(name: string): Promise<string> {
  await loadSystemFonts();
  const family = fonts.list.find((f) => f.family.toLowerCase() === name.trim().toLowerCase())?.family;
  if (!family) throw new Error(`The font "${name}" is not installed; list_fonts lists the installed ones`);
  await showFont(family);
  return family;
}

const POS = "In points from the top-left corner of the page as displayed (1 inch = 72 points).";
const COLOR = { type: "string", description: "Hex color like #d92d20." };

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
        font: { type: "string", description: "An installed font family (see list_fonts). Default: Liberation Sans, which looks like Arial." },
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
      const font = typeof args.font === "string" && args.font.trim() ? await installedFont(args.font) : undefined;
      const id = newId("o");
      doc.addOverlay({ id, page: page.id, kind: "text", x, y, w: Math.max(40, dw - num(args, "x") - 24), text: str(args, "text"), size, color, rot, ...(font ? { font } : {}) });
      return `Added text on page ${n} (id ${id})`;
    },
  },
  {
    name: "list_fonts",
    description: "Lists the font families installed on this computer, for add_text. Pass query to filter by name.",
    parameters: obj({ query: { type: "string" } }),
    scope: "both",
    async run(args) {
      const q = typeof args.query === "string" ? args.query.trim().toLowerCase() : "";
      const list = (await loadSystemFonts()).map((f) => f.family).filter((f) => f.toLowerCase().includes(q));
      return list.length ? list : `No installed font matches "${args.query}"`;
    },
  },
  {
    name: "highlight_text",
    description:
      "Highlights, underlines or strikes through every occurrence of a phrase on the given pages (all pages by default), like selecting the text in the app. Matching ignores case and spacing. Only works on pages with a text layer (not scans). Undoable; saved when the user saves.",
    parameters: obj(
      {
        doc: DOC,
        text: { type: "string", description: "The phrase to mark, as it reads on the page." },
        pages: PAGES,
        style: { type: "string", enum: ["highlight", "underline", "strike"], description: "Default highlight." },
        color: COLOR,
      },
      ["text"],
    ),
    scope: "both",
    async run(args) {
      const doc = findDoc(args);
      const text = str(args, "text");
      const style = (["highlight", "underline", "strike"].includes(String(args.style)) ? args.style : "highlight") as MarkupKind;
      const fill = color(args, "color", settings.colors[style] ?? DEFAULT_COLORS[style]);
      const ids = args.pages ? pageIds(doc, str(args, "pages")) : doc.pages.map((p) => p.id);
      const added: Overlay[] = [];
      let matches = 0;
      for (const id of ids) {
        const page = doc.pageById(id)!;
        const hits = await textRects(await doc.pdfPage(page), text);
        if (!hits.length) continue;
        matches += hits.length;
        added.push({ id: newId("o"), page: page.id, kind: "markup", style, rects: hits.flat(), color: fill });
      }
      if (!added.length) return `"${text}" was not found${args.pages ? " on those pages" : ""}`;
      doc.change(() => doc.overlays.push(...added));
      const pages = added.map((o) => doc.pages.findIndex((p) => p.id === o.page) + 1);
      return { matches, pages, ids: added.map((o) => o.id) };
    },
  },
  {
    name: "add_shape",
    description: `Draws on a page. rect, ellipse and whiteout (an opaque white box that hides what is under it) take x, y, width, height; line and arrow go from (x, y) to (x2, y2); ink is a freehand stroke through \`points\`. ${POS} Undoable; saved when the user saves.`,
    parameters: obj(
      {
        doc: DOC,
        page: { type: "integer", minimum: 1 },
        kind: { type: "string", enum: ["rect", "ellipse", "whiteout", "line", "arrow", "ink"] },
        x: { type: "number" },
        y: { type: "number" },
        width: { type: "number" },
        height: { type: "number" },
        x2: { type: "number" },
        y2: { type: "number" },
        points: { type: "array", items: { type: "number" }, description: "For ink: x1, y1, x2, y2, ... (at least two points)." },
        color: COLOR,
        fill: { type: "string", description: "Fill color for rect and ellipse (default: none)." },
        stroke_width: { type: "number", description: "Line width in points (default 2)." },
      },
      ["page", "kind"],
    ),
    scope: "both",
    async run(args) {
      const doc = findDoc(args);
      const { n, page } = pageArg(doc, args);
      const kind = str(args, "kind");
      const stroke = color(args, "color", settings.colors[kind] ?? DEFAULT_COLORS[kind] ?? "#d92d20");
      const width = Math.min(48, Math.max(0.5, num(args, "stroke_width", 2)));
      const id = newId("o");
      let o: Overlay;
      switch (kind) {
        case "rect":
        case "ellipse":
        case "whiteout": {
          const r = boxOnPage(doc, page, { x: num(args, "x"), y: num(args, "y"), w: num(args, "width"), h: num(args, "height") });
          o =
            kind === "whiteout"
              ? { id, page: page.id, kind: "rect", ...r, color: "#ffffff", fill: "#ffffff", width: 0 }
              : { id, page: page.id, kind, ...r, color: stroke, fill: color(args, "fill", null), width };
          break;
        }
        case "line":
        case "arrow": {
          const [x1, y1] = pointOnPage(doc, page, num(args, "x"), num(args, "y"));
          const [x2, y2] = pointOnPage(doc, page, num(args, "x2"), num(args, "y2"));
          if (Math.hypot(x2 - x1, y2 - y1) < 1) throw new Error("The start and end points are the same");
          o = { id, page: page.id, kind, x1, y1, x2, y2, color: stroke, width };
          break;
        }
        case "ink": {
          const raw = Array.isArray(args.points) ? args.points.map(Number) : [];
          if (raw.length < 4 || raw.length % 2 || raw.some((v) => !Number.isFinite(v))) throw new Error("points needs at least two x, y pairs");
          const points: number[] = [];
          for (let i = 0; i < raw.length; i += 2) points.push(...pointOnPage(doc, page, raw[i], raw[i + 1]));
          o = { id, page: page.id, kind: "ink", points, color: stroke, width };
          break;
        }
        default:
          throw new Error(`Unknown kind "${kind}"`);
      }
      doc.addOverlay(o);
      return `Added ${kind} on page ${n} (id ${id})`;
    },
  },
  {
    name: "add_image",
    description: `Places an image file (PNG, JPEG, WebP, GIF, BMP) or one of the user's saved signatures on a page, with its top-left corner at (x, y). ${POS} Undoable; saved when the user saves.`,
    parameters: obj(
      {
        doc: DOC,
        page: { type: "integer", minimum: 1 },
        x: { type: "number" },
        y: { type: "number" },
        path: { type: "string", description: "Absolute path of the image." },
        signature: { type: "integer", minimum: 1, description: "Instead of path: the user's saved signature to use, 1 = the first one." },
        width: { type: "number", description: "Width in points; the height follows the image's proportions. Default: the image's natural size, at most 220 pt." },
      },
      ["page", "x", "y"],
    ),
    scope: "mcp",
    async run(args) {
      const doc = findDoc(args);
      const { n, page } = pageArg(doc, args);
      let img: { src: string; width: number; height: number };
      if (args.signature !== undefined) {
        const k = Math.round(num(args, "signature"));
        const sig = settings.signatures[k - 1];
        if (!sig) throw new Error(settings.signatures.length ? `There are only ${settings.signatures.length} saved signature(s)` : "The user has no saved signatures (they add them with the Sign tool)");
        img = sig;
      } else {
        const path = str(args, "path");
        const ext = path.split(".").pop()!.toLowerCase();
        const mime = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", bmp: "image/bmp" }[ext];
        if (!mime) throw new Error("path must be a PNG, JPEG, WebP, GIF or BMP image");
        img = await normalizeImage(await ipc.readFile(path), mime);
      }
      const w = args.width !== undefined ? Math.max(4, num(args, "width")) : img.width;
      const h = (w * img.height) / img.width;
      const x = num(args, "x");
      const y = num(args, "y");
      // Checks the whole image fits as displayed; it is drawn upright on screen, anchored at its top-left.
      boxOnPage(doc, page, { x, y, w, h });
      const rot = doc.rotation(page);
      const [px, py] = displayToPage(x, y, rot, page.w, page.h);
      const id = newId("o");
      doc.addOverlay({ id, page: page.id, kind: "image", x: px, y: py, w, h, src: img.src, rot });
      return `Added image on page ${n} (id ${id}, ${Math.round(w)}×${Math.round(h)} pt)`;
    },
  },
  {
    name: "list_annotations",
    description: "Lists the annotations added since the document was opened or last saved (text boxes, highlights, shapes, ink, images), with ids for remove_annotations. Positions are as displayed, in points from the top-left. Saving draws them into the PDF for good, so they are no longer listed afterwards.",
    parameters: obj({ doc: DOC, pages: PAGES }),
    scope: "both",
    async run(args) {
      const doc = findDoc(args);
      const ids = args.pages ? new Set(pageIds(doc, str(args, "pages"))) : null;
      const list = doc.overlays.filter((o) => !ids || ids.has(o.page)).map((o) => describe(doc, o));
      list.sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x);
      return list.length ? list : "No annotations";
    },
  },
  {
    name: "remove_annotations",
    description: "Removes annotations by id (from list_annotations or the add_* tools), or every annotation on the given pages. Undoable.",
    parameters: obj({ doc: DOC, ids: { type: "array", items: { type: "string" } }, pages: PAGES }),
    scope: "both",
    async run(args) {
      const doc = findDoc(args);
      const ids = Array.isArray(args.ids) ? args.ids.map(String) : [];
      const pages = args.pages ? new Set(pageIds(doc, str(args, "pages"))) : null;
      if (!ids.length && !pages) throw new Error("Give ids or pages");
      const unknown = ids.filter((id) => !doc.overlay(id));
      if (unknown.length) throw new Error(`No annotation with id ${unknown.join(", ")}`);
      const gone = doc.overlays.filter((o) => ids.includes(o.id) || pages?.has(o.page));
      if (!gone.length) return "Nothing to remove";
      doc.change(() => {
        doc.overlays = doc.overlays.filter((o) => !gone.includes(o));
      });
      if (doc.selectedOverlay && gone.some((o) => o.id === doc.selectedOverlay)) doc.selectedOverlay = null;
      return `Removed ${gone.length} annotation(s)`;
    },
  },
  {
    name: "duplicate_pages",
    description: "Duplicates pages (with their annotations); each copy comes right after its original. Undoable; saved when the user saves.",
    parameters: obj({ doc: DOC, pages: PAGES }, ["pages"]),
    scope: "both",
    async run(args) {
      const doc = findDoc(args);
      const ids = pageIds(doc, str(args, "pages"));
      doc.duplicatePages(ids);
      return `Duplicated ${ids.length} page(s); ${doc.pages.length} pages now`;
    },
  },
  {
    name: "undo",
    description: "Undoes the last changes to an open document (yours or the user's: they share one history).",
    parameters: obj({ doc: DOC, steps: { type: "integer", minimum: 1, description: "Default 1." } }),
    scope: "both",
    async run(args) {
      const doc = findDoc(args);
      const steps = Math.min(Math.max(1, Math.round(num(args, "steps", 1))), doc.history.undo);
      for (let i = 0; i < steps; i++) doc.undo();
      return { undone: steps, canUndo: doc.history.undo, canRedo: doc.history.redo };
    },
  },
  {
    name: "redo",
    description: "Redoes changes undone with undo.",
    parameters: obj({ doc: DOC, steps: { type: "integer", minimum: 1, description: "Default 1." } }),
    scope: "both",
    async run(args) {
      const doc = findDoc(args);
      const steps = Math.min(Math.max(1, Math.round(num(args, "steps", 1))), doc.history.redo);
      for (let i = 0; i < steps; i++) doc.redo();
      return { redone: steps, canUndo: doc.history.undo, canRedo: doc.history.redo };
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
    name: "close_document",
    description: "Closes an open document's tab. Refuses when it has unsaved changes unless discard is true (then they are lost); save_document first to keep them.",
    parameters: obj({ doc: DOC, discard: { type: "boolean" } }),
    scope: "mcp",
    async run(args) {
      const doc = findDoc(args);
      if (doc.dirty && args.discard !== true) throw new Error(`${doc.name} has unsaved changes; save_document first, or pass discard: true to drop them`);
      // Already decided above, so the close doesn't ask the user.
      doc.dirty = false;
      await closeDoc(doc);
      return `Closed ${doc.name}`;
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
