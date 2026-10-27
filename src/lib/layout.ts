// Layout rules shared by the on-screen annotations and the saved file, so
// both place text, page numbers and arrow heads the same way. No pdf-lib here:
// this module loads with the app, pdf-lib only when saving.
import type { Corner, PageNumbers } from "./doc.svelte";

// Line layout shared with the on-screen text boxes (font-size based, line-height 1.2).
export const LINE_HEIGHT = 1.2;
/** Baseline of the first line below the box top, for Liberation Sans/Arial at line-height 1.2. */
export const FIRST_BASELINE = 0.9465;

/** Baseline of the first line below the box top for a font's hhea metrics (as browsers lay it out). */
export function firstBaseline(ascent: number, descent: number, unitsPerEm: number): number {
  return (LINE_HEIGHT - (ascent - descent) / unitsPerEm) / 2 + ascent / unitsPerEm;
}

export function wrapLines(text: string, measure: (s: string) => number, width: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    if (width <= 0) {
      out.push(para);
      continue;
    }
    let line = "";
    for (const tok of para.split(/(\s+)/)) {
      if (measure(line + tok) <= width) {
        line += tok;
        continue;
      }
      if (/^\s+$/.test(tok)) {
        out.push(line.trimEnd());
        line = "";
        continue;
      }
      if (line.trim()) out.push(line.trimEnd());
      line = "";
      if (measure(tok) <= width) {
        line = tok;
        continue;
      }
      // A single word wider than the box: break it by characters.
      for (const ch of tok) {
        if (line && measure(line + ch) > width) {
          out.push(line);
          line = "";
        }
        line += ch;
      }
    }
    out.push(line.trimEnd());
  }
  return out;
}

export function pageLabel(pn: PageNumbers, index: number, total: number): string {
  return pn.format.replace(/\{n\}/g, String(pn.start + index)).replace(/\{total\}/g, String(pn.start + total - 1));
}

/** Baseline-left of a page number in display space. */
export function numberAnchor(pos: Corner, [dw, dh]: [number, number], textWidth: number, size: number, margin: number): [number, number] {
  const x = pos.endsWith("left") ? margin : pos.endsWith("right") ? dw - margin - textWidth : (dw - textWidth) / 2;
  const y = pos.startsWith("top") ? margin + size * 0.8 : dh - margin;
  return [x, y];
}

/** The two barb ends of an arrow pointing at (x2, y2). */
export function arrowHead(x1: number, y1: number, x2: number, y2: number, width: number): [number, number][] {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const len = Math.max(8, width * 4);
  return [-1, 1].map((s) => [x2 - len * Math.cos(angle + (s * Math.PI) / 7), y2 - len * Math.sin(angle + (s * Math.PI) / 7)] as [number, number]);
}
