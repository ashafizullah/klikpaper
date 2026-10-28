// Comparing two versions of a document by their text: the words of every page
// in reading order, diffed across the whole document (so text that moved to
// another page doesn't count as changed), then grouped into changes with the
// words' places on their pages for highlighting. Pictures, colors and layout
// aren't compared. Kept free of pdf.js and the app's state so it can be tested.
import type { Rect } from "./geometry";
import { evenShare, itemRect, type Share, type TextItem } from "./textmatch";

export interface Word {
  text: string;
  /** 0-based page in its document. */
  page: number;
  /** Page space; a word drawn in pieces has one box per piece. */
  rects: Rect[];
}

export interface Change {
  kind: "added" | "removed" | "changed";
  /** Words of the old version taken out (empty when only added). */
  before: Word[];
  /** Words of the new version put in (empty when only removed). */
  after: Word[];
  /** Where it is, for showing it: the page in each version. */
  pageBefore: number;
  pageAfter: number;
}

/** The words of one page's text items, in their order; pieces of one word drawn as separate items are joined. */
export function pageWords(items: TextItem[], toPage: number[], page: number, share: Share = evenShare): Word[] {
  const words: Word[] = [];
  let open: Word | null = null;
  let prev: TextItem | null = null;
  for (const item of items) {
    const size = item.height || Math.hypot(item.transform[2], item.transform[3]) || 1;
    // Glued to the previous item: same line, no gap and no space between them.
    const glued =
      !!open &&
      !!prev &&
      !/^\s/.test(item.str) &&
      !/\s$/.test(prev.str) &&
      Math.abs(item.transform[5] - prev.transform[5]) < size * 0.3 &&
      Math.abs(item.transform[4] - (prev.transform[4] + prev.width)) < size * 0.15;
    const re = /\S+/g;
    let first = true;
    for (let m = re.exec(item.str); m; m = re.exec(item.str)) {
      const rect = itemRect(item, m.index, m.index + m[0].length, toPage, share);
      if (first && glued && m.index === 0 && open) {
        open.text += m[0];
        open.rects.push(rect);
      } else {
        open = { text: m[0], page, rects: [rect] };
        words.push(open);
      }
      first = false;
    }
    if (/\s$/.test(item.str) || !item.str) open = null;
    prev = item;
  }
  return words.map((w) => ({ ...w, text: w.text.normalize("NFKC") }));
}

/** An edit script between two lists: for each step, keep (both), remove (old) or add (new). */
type Step = { op: "keep" | "remove" | "add"; a: number; b: number };

/** Myers' O((N+M)D) diff. Gives up (null) beyond `limit` edits, to stay quick on unrelated files. */
function myers(a: string[], b: string[], limit: number): Step[] | null {
  const n = a.length;
  const m = b.length;
  const max = n + m;
  const offset = max + 1;
  let v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  for (let d = 0; d <= Math.min(max, limit); d++) {
    trace.push(v.slice());
    const next = v.slice();
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]) ? v[offset + k + 1] : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      next[offset + k] = x;
      if (x >= n && y >= m) {
        // Walk back through the snapshots for the path.
        const steps: Step[] = [];
        let cx = n;
        let cy = m;
        for (let dd = d; dd > 0; dd--) {
          const vv = trace[dd];
          const kk = cx - cy;
          const prevK = kk === -dd || (kk !== dd && vv[offset + kk - 1] < vv[offset + kk + 1]) ? kk + 1 : kk - 1;
          const px = vv[offset + prevK];
          const py = px - prevK;
          while (cx > px && cy > py) steps.push({ op: "keep", a: --cx, b: --cy });
          if (cx === px) steps.push({ op: "add", a: cx, b: --cy });
          else steps.push({ op: "remove", a: --cx, b: cy });
        }
        while (cx > 0 && cy > 0) steps.push({ op: "keep", a: --cx, b: --cy });
        return steps.reverse();
      }
    }
    v = next;
  }
  return null;
}

/** The changes from `before` to `after`; null when the versions differ too much to compare word by word. */
export function diffWords(before: Word[], after: Word[], limit = 5000): Change[] | null {
  // Common start and end are skipped, so the search covers only what differs.
  let start = 0;
  while (start < before.length && start < after.length && before[start].text === after[start].text) start++;
  let endA = before.length;
  let endB = after.length;
  while (endA > start && endB > start && before[endA - 1].text === after[endB - 1].text) {
    endA--;
    endB--;
  }
  const a = before.slice(start, endA);
  const b = after.slice(start, endB);
  const steps = myers(
    a.map((w) => w.text),
    b.map((w) => w.text),
    limit,
  );
  if (!steps) return null;
  const changes: Change[] = [];
  let open: Change | null = null;
  // Where a change sits in the other version: the page of the last kept word before it.
  let lastA = start > 0 ? before[start - 1].page : (before[0]?.page ?? 0);
  let lastB = start > 0 ? after[start - 1].page : (after[0]?.page ?? 0);
  for (const s of steps) {
    if (s.op === "keep") {
      open = null;
      lastA = a[s.a].page;
      lastB = b[s.b].page;
      continue;
    }
    if (!open) {
      open = { kind: "changed", before: [], after: [], pageBefore: lastA, pageAfter: lastB };
      changes.push(open);
    }
    if (s.op === "remove") open.before.push(a[s.a]);
    else open.after.push(b[s.b]);
  }
  for (const c of changes) {
    c.kind = !c.before.length ? "added" : !c.after.length ? "removed" : "changed";
    if (c.before.length) c.pageBefore = c.before[0].page;
    if (c.after.length) c.pageAfter = c.after[0].page;
  }
  return changes;
}
