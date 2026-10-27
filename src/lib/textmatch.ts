// Where text sits on a page, from pdf.js text items, so tools can highlight a
// phrase without a mouse selection. Matching ignores case and whitespace: the
// spaces pdf.js reports between items don't reliably match the visible text.
import type { Rect } from "./geometry";

/** The fields of a pdf.js TextItem this needs. */
export interface TextItem {
  str: string;
  /** Text-space to user-space matrix, font size included. */
  transform: number[];
  /** Advance width and height in user space. */
  width: number;
  height: number;
}

type Matrix = number[];

const apply = (m: Matrix, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/** Box of characters [from, to) of an item, mapped by `toPage` (user space → page space). */
function itemRect(item: TextItem, from: number, to: number, toPage: Matrix): Rect {
  const [a, b, c, d, e, f] = item.transform;
  const len = Math.hypot(a, b) || 1;
  const [ux, uy] = [a / len, b / len];
  const vlen = Math.hypot(c, d) || 1;
  const [vx, vy] = [c / vlen, d / vlen];
  const h = item.height || vlen;
  const n = item.str.length || 1;
  const s = (item.width * from) / n;
  const t = (item.width * to) / n;
  // From just below the baseline (descenders) to the top of capitals.
  const corners = [s, t].flatMap((along) =>
    [-0.22, 0.9].map((up) => apply(toPage, e + ux * along + vx * up * h, f + uy * along + vy * up * h)),
  );
  const xs = corners.map((p) => p[0]);
  const ys = corners.map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/** Rectangles (page space) covering each occurrence of `query`; one list per occurrence. */
export function findTextRects(items: TextItem[], query: string, toPage: Matrix): Rect[][] {
  const needle = query.replace(/\s+/g, "").toLowerCase();
  if (!needle) return [];
  const chars: { item: number; index: number }[] = [];
  let hay = "";
  items.forEach((item, i) => {
    [...item.str].forEach((ch, k) => {
      if (/\s/.test(ch)) return;
      // Lowercasing can change length (e.g. "İ"); keep one char per source char.
      hay += ch.toLowerCase()[0] ?? ch;
      chars.push({ item: i, index: k });
    });
  });
  const out: Rect[][] = [];
  for (let at = hay.indexOf(needle); at >= 0; at = hay.indexOf(needle, at + needle.length)) {
    const rects: Rect[] = [];
    let from = at;
    while (from < at + needle.length) {
      const item = chars[from].item;
      let to = from;
      while (to + 1 < at + needle.length && chars[to + 1].item === item) to++;
      rects.push(itemRect(items[item], chars[from].index, chars[to].index + 1, toPage));
      from = to + 1;
    }
    out.push(rects);
  }
  return out;
}
