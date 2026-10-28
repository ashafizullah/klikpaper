// Text recognition for agents: makes scanned pages readable (read_pages,
// search_text) and redactable word by word, like Recognize text in the app.
import { needsOcr, recognize } from "../ocr";
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
