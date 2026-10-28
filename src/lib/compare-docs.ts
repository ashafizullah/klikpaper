// The two versions being compared, from an open document or a file, and
// their words page by page (see compare.ts for the comparing itself).
import { diffWords, pageWords, type Change, type Word } from "./compare";
import type { Doc } from "./doc.svelte";
import { ipc } from "./ipc";
import { baseName } from "./pagespec";
import { closePdf, fontShare, openPdf, type PDFPageProxy } from "./pdfjs";
import type { TextItem } from "./textmatch";

/** One version: how many pages it has and each page, in reading order. */
export interface Version {
  /** Tells versions apart where their names are the same. */
  id: string;
  name: string;
  count: number;
  page(i: number): Promise<PDFPageProxy>;
  close(): void;
}

export function versionOf(doc: Doc): Version {
  return { id: `doc:${doc.id}`, name: doc.name, count: doc.pages.length, page: (i) => doc.pdfPage(doc.pages[i]), close: () => {} };
}

export async function versionFromFile(path: string): Promise<Version> {
  const pdf = await openPdf(await ipc.readFile(path));
  return { id: `file:${Math.random().toString(36).slice(2)}`, name: baseName(path), count: pdf.numPages, page: (i) => pdf.getPage(i + 1), close: () => closePdf(pdf) };
}

/** A version's words, and how many of its pages have no text (scans). */
export async function versionWords(v: Version): Promise<{ words: Word[]; empty: number }> {
  const words: Word[] = [];
  let empty = 0;
  for (let i = 0; i < v.count; i++) {
    const page = await v.page(i);
    const content = await page.getTextContent();
    const items = content.items.filter((it) => "str" in it) as TextItem[];
    const found = pageWords(items, page.getViewport({ scale: 1, rotation: 0 }).transform, i, fontShare(content));
    if (!found.length) empty++;
    words.push(...found);
  }
  return { words, empty };
}

export interface Comparison {
  /** Null when the versions are too different to compare word by word. */
  changes: Change[] | null;
  /** Pages without text in each version: they can't be compared until their text is recognized. */
  emptyBefore: number;
  emptyAfter: number;
}

export async function compareVersions(before: Version, after: Version): Promise<Comparison> {
  const [a, b] = [await versionWords(before), await versionWords(after)];
  return { changes: diffWords(a.words, b.words), emptyBefore: a.empty, emptyAfter: b.empty };
}

/** A change as one line of text: what went out, what came in. */
export function changeText(c: Change): { before: string; after: string } {
  const text = (ws: Word[]) => ws.map((w) => w.text).join(" ");
  return { before: text(c.before), after: text(c.after) };
}
