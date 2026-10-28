// The text selection on a page, as page-space rectangles (for highlights and redaction).
import type { PageItem } from "./doc.svelte";
import { displayRectToPage, type Rect, type Rotation } from "./geometry";

/** The pieces of the window's text selection that lie on the page shown in `pageEl`. */
export function selectionRects(pageEl: HTMLElement, page: PageItem, scale: number, rotation: Rotation): Rect[] {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return [];
  const bounds = pageEl.getBoundingClientRect();
  const rects: Rect[] = [];
  for (let i = 0; i < sel.rangeCount; i++) {
    for (const cr of sel.getRangeAt(i).getClientRects()) {
      if (cr.width < 1 || cr.height < 1) continue;
      // Only the parts of the selection on this page.
      if (cr.right < bounds.left || cr.left > bounds.right || cr.bottom < bounds.top || cr.top > bounds.bottom) continue;
      const display = { x: (cr.left - bounds.left) / scale, y: (cr.top - bounds.top) / scale, w: cr.width / scale, h: cr.height / scale };
      const r = displayRectToPage(display, rotation, page.w, page.h);
      // Skip pieces fully inside one already taken (nested spans report twice).
      if (rects.some((q) => r.x >= q.x - 0.5 && r.y >= q.y - 0.5 && r.x + r.w <= q.x + q.w + 0.5 && r.y + r.h <= q.y + q.h + 0.5)) continue;
      rects.push(r);
    }
  }
  return rects;
}

/**
 * A text box grown so a redaction box also hides accents, descenders and the
 * ends of words whose letters are placed by estimate (text read by OCR). Going
 * a little into a neighbouring letter is the safe side.
 */
export function padForRedaction(r: Rect): Rect {
  const dx = Math.max(1, r.h * 0.3);
  const dy = r.h * 0.12;
  return { x: r.x - dx, y: r.y - dy, w: r.w + 2 * dx, h: r.h + 2 * dy };
}
