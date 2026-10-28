// Text recognition for agents: makes scanned pages readable (read_pages,
// search_text) and redactable word by word, like Recognize text in the app.
import { needsOcr, recognize } from "../ocr";
import { cleanScans, isScan } from "../scan";
import { DOC, PAGES, obj, str, findDoc, pageIds, type ToolSpec } from "./args";

export const OCR_TOOLS: ToolSpec[] = [
  {
    name: "recognize_text",
    description:
      "Runs OCR (Tesseract, Indonesian and English, on this computer) on scanned pages and adds their text to the document as an invisible layer, so read_pages, search_text, highlight_text and redact_text work on them. By default only pages without text; with `pages`, those pages even if they have text (it may then appear twice). Takes about a second per page. Saved into the PDF when the user saves.",
    parameters: obj({ doc: DOC, pages: PAGES }),
    scope: "both",
    async run(args) {
      const doc = findDoc(args);
      const chosen = args.pages ? pageIds(doc, str(args, "pages")).map((id) => doc.pageById(id)!) : [];
      if (!args.pages) for (const p of doc.pages) if (await needsOcr(doc, p)) chosen.push(p);
      if (!chosen.length) return "Every page already has text; pass pages to read some again";
      const result = await recognize(doc, chosen, () => {}, () => false);
      return { pagesRead: chosen.length, pagesWithText: result.pages, words: result.words };
    },
  },
];

OCR_TOOLS.push({
  name: "clean_scans",
  description:
    "Cleans up scanned pages of an open document: straightens tilted pages, whitens dark bands along the edges (scanner lid, table under a phone photo) and, by default, makes them black and white, which makes the file much smaller but drops color (turn it off for photos and color documents such as ID cards). Each page becomes its cleaned picture, so text recognized on it before goes; recognize_text runs again afterwards unless recognize_text: false. By default the pages that are scans; with `pages`, those pages. Undoable; saved when the user saves.",
  parameters: obj({
    doc: DOC,
    pages: PAGES,
    deskew: { type: "boolean" },
    remove_borders: { type: "boolean" },
    black_and_white: { type: "boolean" },
    recognize_text: { type: "boolean" },
  }),
  scope: "both",
  async run(args) {
    const doc = findDoc(args);
    const chosen = args.pages ? pageIds(doc, str(args, "pages")).map((id) => doc.pageById(id)!) : [];
    if (!args.pages) for (const p of doc.pages) if (await isScan(await doc.pdfPage(p)).catch(() => false)) chosen.push(p);
    if (!chosen.length) return "No scanned pages found; pass pages to clean up particular ones";
    const r = await cleanScans(
      doc,
      chosen,
      { deskew: args.deskew !== false, borders: args.remove_borders !== false, blackWhite: args.black_and_white !== false, ocr: args.recognize_text !== false },
      () => {},
      () => false,
    );
    return { pagesCleanedUp: r.pages, straightenedDegrees: r.straightened.map((a) => Math.round(a * 10) / 10), pagesRecognized: r.recognized };
  },
});
