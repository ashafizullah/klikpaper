// Tools for redaction: marking text or areas whose content is removed from
// the file when the user saves (not just covered), and taking marks off again.
import type { Redaction } from "../doc.svelte";
import { textRects } from "../pdfjs";
import { padForRedaction } from "../selection";
import { newId } from "../settings.svelte";
import { DOC, PAGES, obj, str, num, findDoc, pageIds, pageArg, boxOnPage, type ToolSpec } from "./args";

const SAVE =
  "Nothing is removed until the user saves; then the text, image pixels, shapes and annotations under the marks are taken out of the file for good and the areas are painted black. Marks show shaded on the page until then and can be undone.";

export const REDACT_TOOLS: ToolSpec[] = [
  {
    name: "redact_text",
    description: `Marks every occurrence of a phrase (a name, an ID number, an account number…) for redaction on the given pages (all by default). Matching ignores case and spacing. Only finds text the page has as text (not in scans; use redact_area there). ${SAVE}`,
    parameters: obj({ doc: DOC, text: { type: "string" }, pages: PAGES }, ["text"]),
    scope: "both",
    async run(args) {
      const doc = findDoc(args);
      const text = str(args, "text");
      const ids = args.pages ? pageIds(doc, str(args, "pages")) : doc.pages.map((p) => p.id);
      const marks: Redaction[] = [];
      for (const id of ids) {
        const page = doc.pageById(id)!;
        for (const match of await textRects(await doc.pdfPage(page), text)) marks.push({ id: newId("x"), page: id, rects: match.map(padForRedaction) });
      }
      if (!marks.length) return `"${text}" was not found${args.pages ? " on those pages" : ""}`;
      doc.addRedactions(marks);
      const pages = [...new Set(marks.map((m) => doc.pages.findIndex((p) => p.id === m.page) + 1))];
      return { marked: marks.length, pages, ids: marks.map((m) => m.id) };
    },
  },
  {
    name: "redact_area",
    description: `Marks a rectangle on a page for redaction. x, y, width and height are in points from the top-left corner of the page as displayed (1 inch = 72 points). ${SAVE}`,
    parameters: obj({ doc: DOC, page: { type: "integer", minimum: 1 }, x: { type: "number" }, y: { type: "number" }, width: { type: "number" }, height: { type: "number" } }, ["page", "x", "y", "width", "height"]),
    scope: "both",
    async run(args) {
      const doc = findDoc(args);
      const { n, page } = pageArg(doc, args);
      const rect = boxOnPage(doc, page, { x: num(args, "x"), y: num(args, "y"), w: num(args, "width"), h: num(args, "height") });
      const mark: Redaction = { id: newId("x"), page: page.id, rects: [rect] };
      doc.addRedactions([mark]);
      return { marked: mark.id, page: n };
    },
  },
  {
    name: "remove_redactions",
    description: "Takes redaction marks off (before saving) by id, or all of them with all: true. Undoable.",
    parameters: obj({ doc: DOC, ids: { type: "array", items: { type: "string" } }, all: { type: "boolean" } }),
    scope: "both",
    async run(args) {
      const doc = findDoc(args);
      const ids = args.all === true ? doc.redactions.map((r) => r.id) : Array.isArray(args.ids) ? args.ids.map(String).filter((id) => doc.redactions.some((r) => r.id === id)) : [];
      if (!ids.length) return "No matching redaction marks";
      doc.removeRedactions(ids);
      return `Removed ${ids.length} redaction mark(s)`;
    },
  },
];
