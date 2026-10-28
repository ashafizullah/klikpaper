// Bookmarks (the PDF outline): read from each file with pdf.js, edited in the
// Bookmarks panel, and written into the saved file when they changed. A
// bookmark points at a page item, so it follows the page when pages move.
import type { PageItem } from "./doc.svelte";
import type { BookmarkSpec } from "./ipc";
import type { PDFDocumentProxy } from "./pdfjs";

/** Kept free of the app's state modules so it can be tested on its own. */
export function bookmarkId(): string {
  return "b" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export interface Bookmark {
  id: string;
  title: string;
  /** The page it opens (a page item id); null for a heading or a web link. */
  page: string | null;
  /** Where on the page, in points from its top (page space); null shows the whole page. */
  y: number | null;
  url?: string;
  bold?: boolean;
  italic?: boolean;
  /** RGB, each from 0 to 1. */
  color?: [number, number, number] | null;
  /** Shown with its children unfolded. */
  open: boolean;
  children: Bookmark[];
}

/** Deeper nesting in a file is flattened into the last level kept. */
const MAX_DEPTH = 32;

interface PdfOutlineItem {
  title: string;
  bold?: boolean;
  italic?: boolean;
  color?: Uint8ClampedArray | number[] | null;
  dest?: unknown;
  url?: string | null;
  count?: number;
  items?: PdfOutlineItem[];
}

/** A file's outline as bookmarks on `pages`, that file's page items. */
export async function readOutline(pdf: PDFDocumentProxy, pages: PageItem[]): Promise<Bookmark[]> {
  const items = (await pdf.getOutline().catch(() => null)) as PdfOutlineItem[] | null;
  if (!items?.length) return [];
  const byIndex = new Map<number, PageItem>();
  for (const p of [...pages].reverse()) byIndex.set(p.index, p);

  async function target(dest: unknown): Promise<{ page: string | null; y: number | null }> {
    const none = { page: null, y: null };
    try {
      const explicit = typeof dest === "string" ? await pdf.getDestination(dest) : dest;
      if (!Array.isArray(explicit)) return none;
      const ref = explicit[0];
      const index = typeof ref === "object" && ref ? await pdf.getPageIndex(ref) : Number(ref);
      const item = byIndex.get(index);
      if (!item) return none;
      // The top edge to scroll to, for the kinds of destination that have one.
      const mode = (explicit[1] as { name?: string } | undefined)?.name;
      const top = mode === "XYZ" ? explicit[3] : mode === "FitH" || mode === "FitBH" ? explicit[2] : mode === "FitR" ? explicit[5] : null;
      if (typeof top !== "number") return { page: item.id, y: null };
      const view = (await pdf.getPage(index + 1)).view;
      return { page: item.id, y: Math.max(0, Math.min(item.h, view[3] - top)) };
    } catch {
      return none;
    }
  }

  async function convert(list: PdfOutlineItem[], depth: number): Promise<Bookmark[]> {
    const out: Bookmark[] = [];
    for (const it of list) {
      const { page, y } = await target(it.dest);
      const children = it.items?.length ? await convert(it.items, depth + 1) : [];
      const color = it.color && Array.from(it.color).some((v) => v > 0) ? (Array.from(it.color).slice(0, 3).map((v) => v / 255) as [number, number, number]) : null;
      const b: Bookmark = { id: bookmarkId(), title: (it.title ?? "").trim(), page, y, open: (it.count ?? 0) > 0, children: depth < MAX_DEPTH ? children : [] };
      if (it.url) b.url = it.url;
      if (it.bold) b.bold = true;
      if (it.italic) b.italic = true;
      if (color) b.color = color;
      out.push(b);
      if (depth >= MAX_DEPTH) out.push(...children);
    }
    return out;
  }
  return convert(items, 0);
}

// ---- the tree -------------------------------------------------------------

/** Where a bookmark sits: the list holding it and its index there. */
export function locate(list: Bookmark[], id: string): { list: Bookmark[]; index: number; parent: Bookmark | null } | null {
  const walk = (items: Bookmark[], parent: Bookmark | null): ReturnType<typeof locate> => {
    for (let i = 0; i < items.length; i++) {
      if (items[i].id === id) return { list: items, index: i, parent };
      const hit = walk(items[i].children, items[i]);
      if (hit) return hit;
    }
    return null;
  };
  return walk(list, null);
}

export function find(list: Bookmark[], id: string): Bookmark | null {
  const at = locate(list, id);
  return at ? at.list[at.index] : null;
}

/** Every bookmark, parents before their children. */
export function flatten(list: Bookmark[]): Bookmark[] {
  return list.flatMap((b) => [b, ...flatten(b.children)]);
}

export function remove(list: Bookmark[], id: string): Bookmark | null {
  const at = locate(list, id);
  return at ? at.list.splice(at.index, 1)[0] : null;
}

/** Moves a bookmark up (-1) or down (1) among its siblings. */
export function move(list: Bookmark[], id: string, dir: -1 | 1): boolean {
  const at = locate(list, id);
  if (!at) return false;
  const to = at.index + dir;
  if (to < 0 || to >= at.list.length) return false;
  [at.list[at.index], at.list[to]] = [at.list[to], at.list[at.index]];
  return true;
}

/** Makes a bookmark the last child of the one above it. */
export function indent(list: Bookmark[], id: string): boolean {
  const at = locate(list, id);
  if (!at || at.index === 0) return false;
  const above = at.list[at.index - 1];
  const [b] = at.list.splice(at.index, 1);
  above.children.push(b);
  above.open = true;
  return true;
}

/** Moves a bookmark out of its parent, to just after it. */
export function outdent(list: Bookmark[], id: string): boolean {
  const at = locate(list, id);
  if (!at?.parent) return false;
  const outer = locate(list, at.parent.id)!;
  const [b] = at.list.splice(at.index, 1);
  outer.list.splice(outer.index + 1, 0, b);
  return true;
}

/** Takes out bookmarks pointing at `gone` pages; their children take their place. Returns whether any went. */
export function dropPages(list: Bookmark[], gone: Set<string>): boolean {
  let changed = false;
  for (let i = 0; i < list.length; i++) {
    const b = list[i];
    changed = dropPages(b.children, gone) || changed;
    if (b.page && gone.has(b.page)) {
      list.splice(i, 1, ...b.children);
      i += b.children.length - 1;
      changed = true;
    }
  }
  return changed;
}

/** Copies bookmarks with fresh ids. */
export function cloneTree(list: Bookmark[]): Bookmark[] {
  return list.map((b) => ({ ...b, id: bookmarkId(), children: cloneTree(b.children) }));
}

/** Where to put the bookmarks of pages inserted at `at`: before the first top-level bookmark of a later page. */
export function insertionIndex(list: Bookmark[], pages: PageItem[], at: number): number {
  const position = (b: Bookmark): number => {
    if (b.page) return pages.findIndex((p) => p.id === b.page);
    for (const c of b.children) {
      const n = position(c);
      if (n >= 0) return n;
    }
    return -1;
  };
  const i = list.findIndex((b) => position(b) >= at);
  return i < 0 ? list.length : i;
}

/** The bookmark for the page being read: the last one, in reading order, at or before it. */
export function currentBookmark(list: Bookmark[], pages: PageItem[], current: number): string | null {
  let best: { id: string; at: number } | null = null;
  for (const b of flatten(list)) {
    const at = b.page ? pages.findIndex((p) => p.id === b.page) : -1;
    if (at >= 0 && at <= current && (!best || at >= best.at)) best = { id: b.id, at };
  }
  return best?.id ?? null;
}

/**
 * The outline as the backend writes it, for a file made of `positions` (indexes
 * into `pages`, in output order). Bookmarks of pages left out go; their children
 * take their place.
 */
export function outlineSpec(list: Bookmark[], pages: PageItem[], positions: number[]): BookmarkSpec[] {
  const out = new Map<string, number>();
  positions.forEach((pos, i) => {
    const p = pages[pos];
    if (p && !out.has(p.id)) out.set(p.id, i);
  });
  const convert = (items: Bookmark[]): BookmarkSpec[] =>
    items.flatMap((b) => {
      const children = convert(b.children);
      if (b.page && !out.has(b.page)) return children;
      const page = b.page ? pages.find((p) => p.id === b.page) : undefined;
      return [
        {
          title: b.title,
          page: b.page ? out.get(b.page)! : null,
          // On new paper the content moved; the whole page is shown instead.
          y: page && !page.sheet ? b.y : null,
          url: b.url ?? null,
          bold: !!b.bold,
          italic: !!b.italic,
          color: b.color ?? null,
          open: b.open,
          children,
        },
      ];
    });
  return convert(list);
}
