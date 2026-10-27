// Editing a PDF's own text the simple way: the line is covered with a box in
// the page's background color and a text box with the same words, size, color
// and closest installed font is laid over it. The original text stays in the
// file underneath (covered, not removed), so this is not a way to redact.
import type { Doc, Overlay, PageItem } from "./doc.svelte";
import { displaySize, pageRectToDisplay, type Rect } from "./geometry";
import { baselineShare, matchFont } from "./fonts.svelte";
import type { PageLine } from "./pdfjs";
import { newId } from "./settings.svelte";

type TextOverlay = Extract<Overlay, { kind: "text" }>;

const hex = (rgb: number[]) => `#${rgb.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
const FALLBACK = { bg: "#ffffff", fg: "#1b1916" };

/** The background and text colors in a page-space box, read from the page as drawn on screen. */
function sampleColors(doc: Doc, page: PageItem, box: Rect): { bg: string; fg: string } {
  const canvas = document.querySelector<HTMLCanvasElement>(`[data-page-id="${page.id}"] canvas`);
  const ctx = canvas?.getContext("2d");
  if (!canvas || !ctx || !canvas.width) return FALLBACK;
  const rot = doc.rotation(page);
  const [dw] = displaySize(page.w, page.h, rot);
  const px = canvas.width / dw;
  const d = pageRectToDisplay(box, rot, page.w, page.h);
  const x = Math.max(0, Math.floor(d.x * px));
  const y = Math.max(0, Math.floor(d.y * px));
  const w = Math.min(canvas.width - x, Math.ceil(d.w * px));
  const h = Math.min(canvas.height - y, Math.ceil(d.h * px));
  if (w < 3 || h < 3) return FALLBACK;
  const data = ctx.getImageData(x, y, w, h).data;
  const at = (i: number) => [data[i], data[i + 1], data[i + 2]];
  // Background: the most common color along the box's edge.
  const counts = new Map<string, { n: number; rgb: number[] }>();
  for (let i = 0; i < w * h; i++) {
    const cx = i % w;
    const cy = Math.floor(i / w);
    if (cx > 0 && cx < w - 1 && cy > 0 && cy < h - 1) continue;
    const rgb = at(i * 4);
    const key = rgb.map((v) => v >> 3).join();
    const c = counts.get(key) ?? { n: 0, rgb };
    c.n++;
    counts.set(key, c);
  }
  const bg = [...counts.values()].sort((a, b) => b.n - a.n)[0]?.rgb ?? [255, 255, 255];
  // Text: the pixel farthest from the background (glyph cores, not their soft edges).
  let fg = [27, 25, 22];
  let far = 0;
  for (let i = 0; i < data.length; i += 4) {
    const rgb = at(i);
    const dist = Math.abs(rgb[0] - bg[0]) + Math.abs(rgb[1] - bg[1]) + Math.abs(rgb[2] - bg[2]);
    if (dist > far) {
      far = dist;
      fg = rgb;
    }
  }
  return { bg: hex(bg), fg: far > 60 ? hex(fg) : FALLBACK.fg };
}

/**
 * Covers a line and puts a text box over it saying `text` (the line's own words
 * by default). One undo step removes both. Returns the new text box.
 */
export async function replaceLine(doc: Doc, page: PageItem, line: PageLine, text = line.text): Promise<TextOverlay> {
  const { family, bold } = await matchFont(line.pdfFont, line.generic, line.bold);
  const size = Math.round(line.size * 10) / 10;
  const pad = size * 0.08;
  const cover = { x: line.rect.x - pad, y: line.rect.y - pad, w: line.rect.w + pad * 2, h: line.rect.h + pad * 2 };
  const { bg, fg } = sampleColors(doc, page, cover);
  const box: TextOverlay = {
    id: newId("o"),
    page: page.id,
    kind: "text",
    x: line.x,
    y: line.baseline - size * baselineShare(family, bold),
    // Room to grow a little before wrapping; a substitute font can run wider.
    w: Math.min(page.w - line.x - 4, Math.max(line.rect.w * 1.25, line.rect.w + size * 3)),
    text,
    size,
    color: fg,
    rot: 0,
    ...(bold ? { bold: true } : {}),
    ...(family ? { font: family } : {}),
  };
  doc.change(() => {
    doc.overlays.push({ id: newId("o"), page: page.id, kind: "rect", ...cover, color: bg, fill: bg, width: 0 }, box);
  });
  return box;
}
