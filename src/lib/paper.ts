// Paper sizes for Resize pages. A page put on a sheet keeps its content, scaled
// to fit inside the margins (never stretched) and centered; the sheet is stored
// in the page's own, unrotated orientation, so rotating the page turns the paper too.
import { displaySize, normRotation } from "./geometry";

/** Width × height in points, portrait. */
export const PAPER = {
  a4: [595.28, 841.89],
  letter: [612, 792],
  legal: [612, 1008],
  a3: [841.89, 1190.55],
  a5: [419.53, 595.28],
} as const;

export type PaperSize = keyof typeof PAPER;
export type PaperOrientation = "auto" | "portrait" | "landscape";

export interface Sheet {
  w: number;
  h: number;
  margin: number;
}

export const mmToPt = (mm: number) => (mm * 72) / 25.4;

/** The sheet for a page of w × h shown at `rotation`: "auto" keeps each page's own orientation as displayed. */
export function sheetFor(w: number, h: number, rotation: number, size: PaperSize, orientation: PaperOrientation, marginPt: number): Sheet {
  const rot = normRotation(rotation);
  const [dw, dh] = displaySize(w, h, rot);
  const [short, long] = PAPER[size];
  const landscape = orientation === "landscape" || (orientation === "auto" && dw > dh);
  const [sw, sh] = landscape ? [long, short] : [short, long];
  // Back to the page's own orientation.
  return rot % 180 === 0 ? { w: sw, h: sh, margin: marginPt } : { w: sh, h: sw, margin: marginPt };
}

/** How content of w × h sits on a sheet: its scale and its offset from the sheet's top-left (same as the saved file). */
export function fitOnSheet(w: number, h: number, sheet: Sheet): { s: number; ox: number; oy: number } {
  const m = Math.min(Math.max(0, sheet.margin), Math.min(sheet.w, sheet.h) / 3);
  const s = Math.min((sheet.w - 2 * m) / w, (sheet.h - 2 * m) / h);
  return { s, ox: (sheet.w - w * s) / 2, oy: (sheet.h - h * s) / 2 };
}
