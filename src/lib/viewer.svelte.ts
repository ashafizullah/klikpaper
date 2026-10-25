// The page view's scroll position, shared so toolbar, sidebar, search and AI tools can move it.
import { activeDoc } from "./workspace.svelte";

export const viewer = {
  el: null as HTMLElement | null,

  goTo(index: number, smooth = false) {
    const doc = activeDoc();
    if (!doc || index < 0 || index >= doc.pages.length) return;
    doc.current = index;
    const page = this.el?.querySelector<HTMLElement>(`[data-page-index="${index}"]`);
    if (page && this.el) this.el.scrollTo({ top: page.offsetTop - 12, behavior: smooth ? "smooth" : "auto" });
  },
};
