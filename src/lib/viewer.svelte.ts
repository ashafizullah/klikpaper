// The page view's scroll position, shared so toolbar, sidebar, search and AI tools can move it.
import { activeDoc } from "./workspace.svelte";

export const viewer = {
  el: null as HTMLElement | null,

  /** Shows a page; `at` is how far down it to start, as a share of its height. */
  goTo(index: number, smooth = false, at = 0) {
    const doc = activeDoc();
    if (!doc || index < 0 || index >= doc.pages.length) return;
    doc.current = index;
    const page = this.el?.querySelector<HTMLElement>(`[data-page-index="${index}"]`);
    if (page && this.el) this.el.scrollTo({ top: page.offsetTop + at * page.offsetHeight - 12, behavior: smooth ? "smooth" : "auto" });
  },

  /** How far down a page the view starts, as a share of its height (0 when the page starts lower). */
  scrolledInto(index: number): number {
    const page = this.el?.querySelector<HTMLElement>(`[data-page-index="${index}"]`);
    if (!page || !this.el) return 0;
    return Math.max(0, Math.min(1, (this.el.scrollTop + 12 - page.offsetTop) / Math.max(1, page.offsetHeight)));
  },
};
