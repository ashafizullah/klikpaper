// Tools that add to pages: text in any installed font, highlights, shapes,
// images and signatures, watermarks and page numbers, and listing or removing them.
import type { Corner, Doc, MarkupKind, Overlay } from "../doc.svelte";
import { ipc } from "../ipc";
import { newId, settings } from "../settings.svelte";
import { displaySize, displayToPage, normRect, pageRectToDisplay, type Rect } from "../geometry";
import { normalizeImage } from "../images";
import { fonts, loadSystemFonts, showFont } from "../fonts.svelte";
import { textLines, textRects } from "../pdfjs";
import { replaceLine } from "../edittext";
import { DEFAULT_COLORS } from "../ui.svelte";
import { DOC, PAGES, obj, str, num, findDoc, pageIds, pageArg, color, boxOnPage, pointOnPage, type ToolSpec } from "./args";

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

export const ANNOTATION_TOOLS: ToolSpec[] = [
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
    name: "replace_text",
    description:
      "Changes words already printed in the PDF. Each line containing `text` is covered with a box in the page's background color and written again with `text` replaced, in the same size and color and the closest installed font. The original stays in the file underneath (covered, not removed), so never use this to hide sensitive information (use redact_text for that). Saving adds a line to the file's edit history saying text was changed on that page. Matching is exact (case-sensitive) within a line. Works best on pages the user has scrolled to. Undoable; saved when the user saves.",
    parameters: obj({ doc: DOC, text: { type: "string" }, replacement: { type: "string" }, pages: PAGES }, ["text", "replacement"]),
    scope: "both",
    async run(args) {
      const doc = findDoc(args);
      const find = str(args, "text");
      const replacement = typeof args.replacement === "string" ? args.replacement : "";
      const ids = args.pages ? pageIds(doc, str(args, "pages")) : doc.pages.map((p) => p.id);
      const changed: { page: number; id: string; text: string; font: string }[] = [];
      for (const id of ids) {
        const page = doc.pageById(id)!;
        for (const line of await textLines(await doc.pdfPage(page))) {
          if (!line.text.includes(find)) continue;
          const box = await replaceLine(doc, page, line, line.text.split(find).join(replacement));
          changed.push({ page: doc.pages.indexOf(page) + 1, id: box.id, text: box.text, font: `${box.font ?? "Liberation Sans"}${box.bold ? " Bold" : ""}` });
        }
      }
      if (!changed.length) return `"${find}" was not found as printed text${args.pages ? " on those pages" : ""}`;
      return changed;
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
];
