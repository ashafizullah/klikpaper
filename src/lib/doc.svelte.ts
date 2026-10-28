// An open document: an ordered list of pages taken from one or more source
// files, plus the annotations drawn on them. Nothing touches the files until
// the user saves; every edit can be undone.
import { displaySize, normRotation, type Rect, type Rotation } from "./geometry";
import type { CommentReply, CommentThread } from "./ipc";
import { dropPages, insertionIndex, type Bookmark } from "./outline";
import type { Sheet } from "./paper";
import { newId } from "./settings.svelte";
import { closePdf, pageText, type PDFDocumentProxy } from "./pdfjs";
import { dropThumbnails } from "./thumbs";

export interface Source {
  id: string;
  path: string;
  password?: string;
  pdf: PDFDocumentProxy;
}

export interface PageItem {
  id: string;
  source: string;
  /** 0-based page index in the source. */
  index: number;
  /** The page's own rotation from the file. */
  own: number;
  /** Clockwise rotation added in KlikPaper. */
  rotate: number;
  /** Unrotated size in points. */
  w: number;
  h: number;
  /** Another paper size the page is put on when saved (Resize pages); its content is scaled to fit and centered. */
  sheet?: Sheet;
}

export type MarkupKind = "highlight" | "underline" | "strike";

/** Coordinates are in page space: points from the unrotated page's top-left, y down. */
export type Overlay =
  | { id: string; page: string; kind: "text"; x: number; y: number; w: number; text: string; size: number; color: string; rot: number; bold?: boolean; font?: string }
  | { id: string; page: string; kind: "image"; x: number; y: number; w: number; h: number; src: string; rot: number }
  | { id: string; page: string; kind: "rect" | "ellipse"; x: number; y: number; w: number; h: number; color: string; fill: string | null; width: number }
  | { id: string; page: string; kind: "line" | "arrow"; x1: number; y1: number; x2: number; y2: number; color: string; width: number }
  | { id: string; page: string; kind: "ink"; points: number[]; color: string; width: number }
  | { id: string; page: string; kind: "markup"; style: MarkupKind; rects: { x: number; y: number; w: number; h: number }[]; color: string };

export type OverlayKind = Overlay["kind"];

/** A comment thread on a page: a note and its replies, kept in the PDF as standard notes. */
export type Comment = CommentThread & { page: string };

/** Areas marked for redaction on a page (page space); their content is removed when saving. */
export interface Redaction {
  id: string;
  page: string;
  rects: Rect[];
}

export interface Watermark {
  text: string;
  size: number;
  opacity: number;
  color: string;
  /** Degrees counter-clockwise. */
  angle: number;
}

export type Corner = "bottom-center" | "bottom-right" | "bottom-left" | "top-center" | "top-right" | "top-left";

export interface PageNumbers {
  /** {n} is the page number, {total} the page count. */
  format: string;
  position: Corner;
  start: number;
  size: number;
  margin: number;
  color: string;
}

interface Snapshot {
  pages: PageItem[];
  overlays: Overlay[];
  watermark: Watermark | null;
  pageNumbers: PageNumbers | null;
  comments: Comment[];
  redactions: Redaction[];
  outline: Bookmark[];
}

const MAX_HISTORY = 100;

export class Doc {
  readonly id = newId("d");
  /** Where Save writes; null for a document built from images or merged files that has not been saved yet. */
  path = $state<string | null>(null);
  name = $state("");
  sources = new Map<string, Source>();
  pages = $state<PageItem[]>([]);
  overlays = $state<Overlay[]>([]);
  comments = $state<Comment[]>([]);
  /** Sources whose comments were read; pages of the others keep the file's comments untouched when saved. */
  commentSources = new Set<string>();
  redactions = $state<Redaction[]>([]);
  /** Bookmarks of the document (from the first file, or all of them when merged). */
  outline = $state<Bookmark[]>([]);
  /** The bookmarks were edited or combined: saving writes them instead of keeping the file's own. */
  outlineChanged = $state(false);
  /** When the file at `path` last changed, as last seen (to notice changes made elsewhere). */
  stamp = 0;
  watermark = $state<Watermark | null>(null);
  pageNumbers = $state<PageNumbers | null>(null);
  /** The password Save protects with; prefilled with the file's own password. */
  protect = $state<string | null>(null);
  stripMetadata = $state(false);
  flattenForms = $state(false);
  dirty = $state(false);
  /** Form fields typed into (pdf.js keeps the values until saving). */
  formsEdited = $state(false);

  zoom = $state(1);
  fitWidth = $state(true);
  current = $state(0);
  selectedPages = $state<string[]>([]);
  selectedOverlay = $state<string | null>(null);
  selectedComment = $state<string | null>(null);
  selectedRedaction = $state<string | null>(null);

  #undo: Snapshot[] = [];
  #redo: Snapshot[] = [];
  history = $state({ undo: 0, redo: 0 });
  #text = new Map<string, Promise<string>>();
  /** Goes up when a source file is replaced (after OCR), so pages and thumbnails are drawn again. */
  revision = $state(0);

  constructor(name: string, path: string | null) {
    this.name = name;
    this.path = path;
  }

  addSource(source: Source) {
    this.sources.set(source.id, source);
  }

  /** Page items for every page of a source, in order. */
  async pagesOf(sourceId: string): Promise<PageItem[]> {
    const src = this.sources.get(sourceId)!;
    const items: PageItem[] = [];
    for (let i = 0; i < src.pdf.numPages; i++) {
      const page = await src.pdf.getPage(i + 1);
      const [x0, y0, x1, y1] = page.view;
      items.push({ id: newId("pg"), source: sourceId, index: i, own: page.rotate, rotate: 0, w: x1 - x0, h: y1 - y0 });
    }
    return items;
  }

  rotation(p: PageItem): Rotation {
    return normRotation(p.own + p.rotate);
  }

  /** The page's size as shown: its paper when resized, else its own, turned by its rotation. */
  shownSize(p: PageItem): [number, number] {
    return displaySize(p.sheet?.w ?? p.w, p.sheet?.h ?? p.h, this.rotation(p));
  }

  pageById(id: string): PageItem | undefined {
    return this.pages.find((p) => p.id === id);
  }

  async pdfPage(p: PageItem) {
    return this.sources.get(p.source)!.pdf.getPage(p.index + 1);
  }

  /** Text of a page (cached per source page). */
  text(p: PageItem): Promise<string> {
    const key = `${p.source}:${p.index}`;
    let hit = this.#text.get(key);
    if (!hit) {
      hit = this.pdfPage(p).then(pageText);
      this.#text.set(key, hit);
    }
    return hit;
  }

  /**
   * Puts another file in place of a source with the same pages (the source with
   * recognized text added). Page items, annotations and comments stay as they are.
   */
  replaceSource(id: string, path: string, pdf: PDFDocumentProxy) {
    const src = this.sources.get(id);
    if (!src) return;
    closePdf(src.pdf);
    this.sources.set(id, { id, path, pdf });
    for (const key of [...this.#text.keys()]) if (key.startsWith(`${id}:`)) this.#text.delete(key);
    dropThumbnails(this);
    this.revision++;
    this.dirty = true;
  }

  // ---- history ------------------------------------------------------------

  #snapshot(): Snapshot {
    return $state.snapshot({
      pages: this.pages,
      overlays: this.overlays,
      watermark: this.watermark,
      pageNumbers: this.pageNumbers,
      comments: this.comments,
      redactions: this.redactions,
      outline: this.outline,
    });
  }

  #restore(s: Snapshot) {
    this.pages = s.pages;
    this.overlays = s.overlays;
    this.watermark = s.watermark;
    this.pageNumbers = s.pageNumbers;
    this.comments = s.comments;
    this.redactions = s.redactions;
    this.outline = s.outline;
    this.current = Math.min(this.current, Math.max(0, this.pages.length - 1));
    this.selectedPages = this.selectedPages.filter((id) => this.pages.some((p) => p.id === id));
    if (this.selectedOverlay && !this.overlays.some((o) => o.id === this.selectedOverlay)) this.selectedOverlay = null;
    if (this.selectedComment && !this.comments.some((c) => c.id === this.selectedComment)) this.selectedComment = null;
    if (this.selectedRedaction && !this.redactions.some((r) => r.id === this.selectedRedaction)) this.selectedRedaction = null;
  }

  /** Records the current state so the next change can be undone. */
  checkpoint() {
    this.#undo.push(this.#snapshot());
    if (this.#undo.length > MAX_HISTORY) this.#undo.shift();
    this.#redo = [];
    this.history = { undo: this.#undo.length, redo: 0 };
    this.dirty = true;
  }

  /** Runs one undoable change. */
  change(fn: () => void) {
    this.checkpoint();
    fn();
  }

  undo() {
    const s = this.#undo.pop();
    if (!s) return;
    this.#redo.push(this.#snapshot());
    this.#restore(s);
    this.history = { undo: this.#undo.length, redo: this.#redo.length };
    this.dirty = true;
  }

  redo() {
    const s = this.#redo.pop();
    if (!s) return;
    this.#undo.push(this.#snapshot());
    this.#restore(s);
    this.history = { undo: this.#undo.length, redo: this.#redo.length };
    this.dirty = true;
  }

  clearHistory() {
    this.#undo = [];
    this.#redo = [];
    this.history = { undo: 0, redo: 0 };
  }

  // ---- pages --------------------------------------------------------------

  rotatePages(ids: string[], deg: number) {
    this.change(() => {
      for (const p of this.pages) if (ids.includes(p.id)) p.rotate = normRotation(p.rotate + deg);
    });
  }

  deletePages(ids: string[]) {
    if (ids.length >= this.pages.length) throw new Error("A PDF needs at least one page");
    this.change(() => {
      this.pages = this.pages.filter((p) => !ids.includes(p.id));
      this.overlays = this.overlays.filter((o) => !ids.includes(o.page));
      this.comments = this.comments.filter((c) => !ids.includes(c.page));
      this.redactions = this.redactions.filter((r) => !ids.includes(r.page));
      if (dropPages(this.outline, new Set(ids))) this.outlineChanged = true;
      this.selectedPages = [];
      this.current = Math.min(this.current, this.pages.length - 1);
    });
  }

  /** Moves the pages (keeping their order) so they start at `to` in the remaining list. */
  movePages(ids: string[], to: number) {
    this.change(() => {
      const moving = this.pages.filter((p) => ids.includes(p.id));
      const rest = this.pages.filter((p) => !ids.includes(p.id));
      const at = Math.max(0, Math.min(to, rest.length));
      this.pages = [...rest.slice(0, at), ...moving, ...rest.slice(at)];
    });
  }

  /** Adds pages at `at`, with the bookmarks of the file they come from. */
  insertPages(items: PageItem[], at: number, bookmarks: Bookmark[] = []) {
    this.change(() => {
      const i = Math.max(0, Math.min(at, this.pages.length));
      if (bookmarks.length) {
        this.outline.splice(insertionIndex(this.outline, this.pages, i), 0, ...bookmarks);
        this.outlineChanged = true;
      }
      this.pages = [...this.pages.slice(0, i), ...items, ...this.pages.slice(i)];
    });
  }

  /** Puts pages on new paper (or back on their own when `sheetFor` gives undefined). */
  resizePages(ids: string[], sheetFor: (p: PageItem) => Sheet | undefined) {
    this.change(() => {
      for (const p of this.pages) {
        if (!ids.includes(p.id)) continue;
        const sheet = sheetFor(p);
        if (sheet) p.sheet = sheet;
        else delete p.sheet;
      }
    });
  }

  duplicatePages(ids: string[]) {
    this.change(() => {
      const out: PageItem[] = [];
      for (const p of this.pages) {
        out.push(p);
        if (ids.includes(p.id)) {
          const copy = { ...$state.snapshot(p), id: newId("pg") };
          out.push(copy);
          for (const o of this.overlays.filter((o) => o.page === p.id)) this.overlays.push({ ...$state.snapshot(o), id: newId("o"), page: copy.id });
          for (const r of this.redactions.filter((r) => r.page === p.id)) this.redactions.push({ ...$state.snapshot(r), id: newId("x"), page: copy.id });
        }
      }
      this.pages = out;
    });
  }

  // ---- overlays -----------------------------------------------------------

  addOverlay(o: Overlay) {
    this.change(() => {
      this.overlays.push(o);
    });
    this.selectedOverlay = o.id;
  }

  overlay(id: string): Overlay | undefined {
    return this.overlays.find((o) => o.id === id);
  }

  removeOverlay(id: string) {
    this.change(() => {
      this.overlays = this.overlays.filter((o) => o.id !== id);
    });
    if (this.selectedOverlay === id) this.selectedOverlay = null;
  }

  // ---- redaction ----------------------------------------------------------

  addRedactions(list: Redaction[]) {
    if (!list.length) return;
    this.change(() => {
      this.redactions.push(...list);
    });
  }

  removeRedactions(ids: string[]) {
    this.change(() => {
      this.redactions = this.redactions.filter((r) => !ids.includes(r.id));
    });
    if (this.selectedRedaction && ids.includes(this.selectedRedaction)) this.selectedRedaction = null;
  }

  /** Areas marked on a page, for saving. */
  redactedAreas(page: string): Rect[] {
    return this.redactions.filter((r) => r.page === page).flatMap((r) => $state.snapshot(r.rects));
  }

  // ---- bookmarks ----------------------------------------------------------

  /** One undoable change to the bookmarks. */
  editOutline(fn: (list: Bookmark[]) => void) {
    this.change(() => {
      fn(this.outline);
      this.outlineChanged = true;
    });
  }

  // ---- comments -----------------------------------------------------------

  comment(id: string): Comment | undefined {
    return this.comments.find((c) => c.id === id);
  }

  addComment(page: string, x: number, y: number, text: string, author: string): Comment {
    const c: Comment = { id: newId("c"), page, x, y, author, date: new Date().toISOString(), text, replies: [], resolved: false };
    this.change(() => {
      this.comments.push(c);
    });
    this.selectedComment = c.id;
    return c;
  }

  reply(threadId: string, text: string, author: string): CommentReply {
    const r: CommentReply = { id: newId("r"), author, date: new Date().toISOString(), text };
    const c = this.comment(threadId);
    if (!c) throw new Error("That comment no longer exists");
    this.change(() => {
      c.replies.push(r);
    });
    return r;
  }

  /** Changes a thread's first note, or one of its replies. */
  editComment(threadId: string, replyId: string | null, text: string) {
    const c = this.comment(threadId);
    const target = replyId ? c?.replies.find((r) => r.id === replyId) : c;
    if (!target || target.text === text) return;
    this.change(() => {
      target.text = text;
    });
  }

  /** Removes a whole thread, or one reply. */
  deleteComment(threadId: string, replyId: string | null = null) {
    this.change(() => {
      if (replyId) {
        const c = this.comment(threadId);
        if (c) c.replies = c.replies.filter((r) => r.id !== replyId);
      } else this.comments = this.comments.filter((c) => c.id !== threadId);
    });
    if (!replyId && this.selectedComment === threadId) this.selectedComment = null;
  }

  setResolved(threadId: string, resolved: boolean) {
    const c = this.comment(threadId);
    if (!c || c.resolved === resolved) return;
    this.change(() => {
      c.resolved = resolved;
    });
  }

  moveComment(threadId: string, x: number, y: number) {
    const c = this.comment(threadId);
    if (!c) return;
    this.change(() => {
      c.x = x;
      c.y = y;
    });
  }

  // ---- saving -------------------------------------------------------------

  /** True when saving must draw something with pdf-lib, not only rearrange pages. */
  get needsDrawing(): boolean {
    return this.overlays.length > 0 || !!this.watermark || !!this.pageNumbers || this.flattenForms;
  }

  destroy() {
    dropThumbnails(this);
    for (const s of this.sources.values()) closePdf(s.pdf);
    this.sources.clear();
  }
}
