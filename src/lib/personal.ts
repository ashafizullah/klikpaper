// Black out personal data in one go: find it in the document's pages (see
// pii.ts), let the user review the finds, then mark each occurrence for
// redaction. Saving removes it, as with any other black box.
import type { Doc, Redaction } from "./doc.svelte";
import { needsOcr } from "./ocr";
import { textRects } from "./pdfjs";
import { findPii, PII_KINDS, type PiiKind } from "./pii";
import { padForRedaction } from "./selection";
import { newId } from "./settings.svelte";

export interface PersonalFind {
  id: string;
  kind: PiiKind;
  value: string;
  /** 0-based position of the page in the document. */
  page: number;
}

/** The personal data on the document's pages (all of them, or `positions`), and how many pages have no text to search. */
export async function scanPersonal(doc: Doc, kinds: PiiKind[] = PII_KINDS, positions?: number[]): Promise<{ finds: PersonalFind[]; scans: number }> {
  const finds: PersonalFind[] = [];
  let scans = 0;
  for (const i of positions ?? doc.pages.map((_, n) => n)) {
    const p = doc.pages[i];
    if (await needsOcr(doc, p)) scans++;
    for (const m of findPii(await doc.text(p), kinds)) finds.push({ id: newId("p"), ...m, page: i });
  }
  return { finds, scans };
}

/** Marks every occurrence of each find on its page for redaction, as one undoable change; returns how many boxes. */
export async function markPersonal(doc: Doc, finds: PersonalFind[]): Promise<number> {
  const marks: Redaction[] = [];
  for (const f of finds) {
    const page = doc.pages[f.page];
    if (!page) continue;
    for (const match of await textRects(await doc.pdfPage(page), f.value)) marks.push({ id: newId("x"), page: page.id, rects: match.map(padForRedaction) });
  }
  doc.addRedactions(marks);
  return marks.length;
}
