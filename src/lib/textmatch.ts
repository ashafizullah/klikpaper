// Where text sits on a page, from pdf.js text items, so tools can highlight a
// phrase without a mouse selection and the Edit text tool can pick a line. Matching ignores case and whitespace: the
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

/** Advance of an item's first `chars` characters as a share of the whole item (0..1). */
export type Share = (item: TextItem, chars: number) => number;

/** Without font metrics: every character equally wide. */
const evenShare: Share = (item, chars) => chars / (item.str.length || 1);

const apply = (m: Matrix, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/** Box of characters [from, to) of an item, mapped by `toPage` (user space → page space). */
function itemRect(item: TextItem, from: number, to: number, toPage: Matrix, share: Share): Rect {
  const [a, b, c, d, e, f] = item.transform;
  const len = Math.hypot(a, b) || 1;
  const [ux, uy] = [a / len, b / len];
  const vlen = Math.hypot(c, d) || 1;
  const [vx, vy] = [c / vlen, d / vlen];
  const h = item.height || vlen;
  const s = item.width * share(item, from);
  const t = item.width * share(item, to);
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
export function findTextRects(items: TextItem[], query: string, toPage: Matrix, share: Share = evenShare): Rect[][] {
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
      rects.push(itemRect(items[item], chars[from].index, chars[to].index + 1, toPage, share));
      from = to + 1;
    }
    out.push(rects);
  }
  return out;
}

/** One line of text as drawn: what it says, where it sits (page space) and how big it is. */
export interface TextLine {
  text: string;
  /** From the top of capitals to below descenders. */
  rect: Rect;
  /** Left end of the baseline. */
  x: number;
  baseline: number;
  /** Font size in points. */
  size: number;
  /** pdf.js font id of its first item. */
  fontName: string;
}

/**
 * Horizontal text items joined into lines: same baseline and close together.
 * A wide gap (a table column, say) starts a new line. Rotated text is left out.
 */
export function groupLines(items: (TextItem & { fontName?: string })[], toPage: Matrix): TextLine[] {
  type Run = { items: (TextItem & { fontName?: string })[]; base: number; end: number; size: number };
  const flat = items.filter((i) => i.str.trim() && Math.abs(i.transform[1]) < 1e-6 && Math.abs(i.transform[2]) < 1e-6 && i.transform[0] > 0 && i.transform[3] > 0);
  // Top to bottom (user space y goes up), then left to right.
  flat.sort((a, b) => b.transform[5] - a.transform[5] || a.transform[4] - b.transform[4]);
  const runs: Run[] = [];
  for (const item of flat) {
    const size = item.height || item.transform[3];
    const [, , , , x, base] = item.transform;
    const run = runs.find((r) => Math.abs(r.base - base) < Math.max(r.size, size) * 0.3 && x - r.end > -size * 0.5 && x - r.end < size * 1.5);
    if (run) {
      run.items.push(item);
      run.end = Math.max(run.end, x + item.width);
      run.size = Math.max(run.size, size);
    } else runs.push({ items: [item], base, end: x + item.width, size });
  }
  return runs.map((run) => {
    run.items.sort((a, b) => a.transform[4] - b.transform[4]);
    let text = "";
    let prevEnd = -Infinity;
    for (const item of run.items) {
      const x = item.transform[4];
      // A visible gap with no space character in either item reads as a space.
      if (text && x - prevEnd > run.size * 0.15 && !text.endsWith(" ") && !item.str.startsWith(" ")) text += " ";
      text += item.str;
      prevEnd = x + item.width;
    }
    const x0 = run.items[0].transform[4];
    const [ax, ay] = apply(toPage, x0, run.base + run.size * 0.9);
    const [bx, by] = apply(toPage, run.end, run.base - run.size * 0.22);
    const [px, py] = apply(toPage, x0, run.base);
    return {
      text: text.trim(),
      rect: { x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(bx - ax), h: Math.abs(by - ay) },
      x: px,
      baseline: py,
      size: run.size,
      fontName: run.items[0].fontName ?? "",
    };
  });
}
