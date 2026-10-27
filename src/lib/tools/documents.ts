// Tools for open documents: finding, reading and searching them, page changes,
// undo and redo, saving and closing.
import { ipc } from "../ipc";
import { parsePages } from "../pagespec";
import { activate, closeDoc, insertFiles, openPaths, saveDoc, ws } from "../workspace.svelte";
import { viewer } from "../viewer.svelte";
import { DOC, PAGES, obj, str, num, findDoc, pageIds, requirePdf, checkOutput, type ToolSpec } from "./args";

const MAX_TEXT = 60_000;

export const DOCUMENT_TOOLS: ToolSpec[] = [
  {
    name: "list_documents",
    description: "Lists the PDFs open in KlikPaper.",
    parameters: obj({}),
    scope: "mcp",
    async run() {
      return ws.docs.map((d) => ({ id: d.id, name: d.name, path: d.path, pages: d.pages.length, unsaved: d.dirty, active: d.id === ws.activeId }));
    },
  },
  {
    name: "open_document",
    description: "Opens a PDF file in KlikPaper (as a new tab) and makes it active.",
    parameters: obj({ path: { type: "string", description: "Absolute path of the PDF." } }, ["path"]),
    scope: "mcp",
    async run(args) {
      const path = str(args, "path");
      requirePdf(path);
      const errors = await openPaths([path]);
      const doc = ws.docs.find((d) => d.path === path);
      if (!doc) throw new Error(errors[0] ?? `Couldn't open ${path} (it may need a password; open it in the app first)`);
      return { id: doc.id, name: doc.name, pages: doc.pages.length };
    },
  },
  {
    name: "document_info",
    description: "Page count, page sizes, unsaved changes and metadata of an open document.",
    parameters: obj({ doc: DOC }),
    scope: "both",
    async run(args) {
      const doc = findDoc(args);
      const sizes = [...new Set(doc.pages.map((p) => `${Math.round(p.w)}×${Math.round(p.h)} pt`))];
      const info = doc.path ? await ipc.pdfInfo(doc.path, doc.sources.values().next().value?.password).catch(() => null) : null;
      return {
        id: doc.id,
        name: doc.name,
        path: doc.path,
        pages: doc.pages.length,
        currentPage: doc.current + 1,
        pageSizes: sizes,
        unsaved: doc.dirty,
        annotations: doc.overlays.length,
        passwordOnSave: !!doc.protect,
        metadata: info && { title: info.title, author: info.author, subject: info.subject, producer: info.producer, created: info.created },
      };
    },
  },
  {
    name: "read_pages",
    description: "Returns the text of pages of an open document, each page marked with its number. Scanned pages without a text layer come back empty.",
    parameters: obj({ doc: DOC, pages: PAGES }, ["pages"]),
    scope: "both",
    async run(args) {
      const doc = findDoc(args);
      const nums = parsePages(str(args, "pages"), doc.pages.length);
      if (!nums) throw new Error(`Invalid page list for a ${doc.pages.length}-page document`);
      let out = "";
      for (const n of nums) {
        const text = await doc.text(doc.pages[n - 1]);
        out += `--- Page ${n} ---\n${text || "(no text on this page)"}\n\n`;
        if (out.length > MAX_TEXT) {
          out = out.slice(0, MAX_TEXT) + `\n[truncated: read fewer pages at a time]`;
          break;
        }
      }
      return out.trim();
    },
  },
  {
    name: "search_text",
    description: "Finds text (case-insensitive) in an open document; returns page numbers with a snippet around each match.",
    parameters: obj({ doc: DOC, query: { type: "string" } }, ["query"]),
    scope: "both",
    async run(args) {
      const doc = findDoc(args);
      const q = str(args, "query").toLowerCase();
      const hits: { page: number; snippet: string }[] = [];
      for (let i = 0; i < doc.pages.length && hits.length < 50; i++) {
        const text = await doc.text(doc.pages[i]);
        const lower = text.toLowerCase();
        for (let at = lower.indexOf(q); at >= 0 && hits.length < 50; at = lower.indexOf(q, at + q.length)) {
          hits.push({ page: i + 1, snippet: text.slice(Math.max(0, at - 60), at + q.length + 60).replace(/\s+/g, " ") });
        }
      }
      return hits.length ? hits : "No matches";
    },
  },
  {
    name: "go_to_page",
    description: "Scrolls the document to a page so the user sees it.",
    parameters: obj({ doc: DOC, page: { type: "integer", minimum: 1 } }, ["page"]),
    scope: "both",
    async run(args) {
      const doc = findDoc(args);
      const page = Math.round(num(args, "page"));
      if (page < 1 || page > doc.pages.length) throw new Error(`Page ${page} does not exist`);
      activate(doc);
      viewer.goTo(page - 1);
      return `Showing page ${page}`;
    },
  },
  {
    name: "rotate_pages",
    description: "Rotates pages clockwise by 90, 180 or 270 degrees (negative = counter-clockwise). Undoable; saved when the user saves.",
    parameters: obj({ doc: DOC, pages: PAGES, degrees: { type: "integer", enum: [90, 180, 270, -90] } }, ["pages", "degrees"]),
    scope: "both",
    async run(args) {
      const doc = findDoc(args);
      const deg = num(args, "degrees");
      if (deg % 90 !== 0) throw new Error("degrees must be a multiple of 90");
      const ids = pageIds(doc, str(args, "pages"));
      doc.rotatePages(ids, deg);
      return `Rotated ${ids.length} page(s)`;
    },
  },
  {
    name: "delete_pages",
    description: "Removes pages from an open document. Undoable; saved when the user saves.",
    parameters: obj({ doc: DOC, pages: PAGES }, ["pages"]),
    scope: "both",
    async run(args) {
      const doc = findDoc(args);
      const ids = pageIds(doc, str(args, "pages"));
      doc.deletePages(ids);
      return `Deleted ${ids.length} page(s); ${doc.pages.length} left`;
    },
  },
  {
    name: "move_pages",
    description: "Moves pages (keeping their order) so they come right before page `before` of the current document; use before = page count + 1 to move them to the end.",
    parameters: obj({ doc: DOC, pages: PAGES, before: { type: "integer", minimum: 1 } }, ["pages", "before"]),
    scope: "both",
    async run(args) {
      const doc = findDoc(args);
      const ids = pageIds(doc, str(args, "pages"));
      const before = Math.round(num(args, "before"));
      if (before < 1 || before > doc.pages.length + 1) throw new Error(`before must be between 1 and ${doc.pages.length + 1}`);
      const target = doc.pages.slice(0, before - 1).filter((p) => !ids.includes(p.id)).length;
      doc.movePages(ids, target);
      return `Moved ${ids.length} page(s)`;
    },
  },
  {
    name: "insert_pdf",
    description: "Inserts all pages of another PDF file into an open document after page `after` (0 = at the start; default: at the end).",
    parameters: obj({ doc: DOC, path: { type: "string" }, after: { type: "integer", minimum: 0 } }, ["path"]),
    scope: "mcp",
    async run(args) {
      const doc = findDoc(args);
      const path = str(args, "path");
      requirePdf(path);
      const after = Math.round(num(args, "after", doc.pages.length));
      const before = doc.pages.length;
      await insertFiles(doc, Math.max(0, Math.min(after, before)), [path]);
      return `Inserted ${doc.pages.length - before} page(s)`;
    },
  },
  {
    name: "duplicate_pages",
    description: "Duplicates pages (with their annotations); each copy comes right after its original. Undoable; saved when the user saves.",
    parameters: obj({ doc: DOC, pages: PAGES }, ["pages"]),
    scope: "both",
    async run(args) {
      const doc = findDoc(args);
      const ids = pageIds(doc, str(args, "pages"));
      doc.duplicatePages(ids);
      return `Duplicated ${ids.length} page(s); ${doc.pages.length} pages now`;
    },
  },
  {
    name: "undo",
    description: "Undoes the last changes to an open document (yours or the user's: they share one history).",
    parameters: obj({ doc: DOC, steps: { type: "integer", minimum: 1, description: "Default 1." } }),
    scope: "both",
    async run(args) {
      const doc = findDoc(args);
      const steps = Math.min(Math.max(1, Math.round(num(args, "steps", 1))), doc.history.undo);
      for (let i = 0; i < steps; i++) doc.undo();
      return { undone: steps, canUndo: doc.history.undo, canRedo: doc.history.redo };
    },
  },
  {
    name: "redo",
    description: "Redoes changes undone with undo.",
    parameters: obj({ doc: DOC, steps: { type: "integer", minimum: 1, description: "Default 1." } }),
    scope: "both",
    async run(args) {
      const doc = findDoc(args);
      const steps = Math.min(Math.max(1, Math.round(num(args, "steps", 1))), doc.history.redo);
      for (let i = 0; i < steps; i++) doc.redo();
      return { redone: steps, canUndo: doc.history.undo, canRedo: doc.history.redo };
    },
  },
  {
    name: "save_document",
    description: "Saves an open document with all its changes. Without `path` it saves in place (an unsaved new document needs a path).",
    parameters: obj({ doc: DOC, path: { type: "string", description: "Absolute .pdf path to save to (Save As)." }, overwrite: { type: "boolean" } }),
    scope: "mcp",
    async run(args) {
      const doc = findDoc(args);
      const path = typeof args.path === "string" && args.path.trim() ? args.path.trim() : doc.path;
      if (!path) throw new Error("This document has not been saved yet; pass a path");
      if (path !== doc.path) await checkOutput(path, args.overwrite === true);
      else requirePdf(path);
      const prev = doc.path;
      doc.path = path;
      const ok = await saveDoc(doc);
      if (!ok) {
        doc.path = prev;
        throw new Error("Saving failed (see the app for details)");
      }
      return `Saved ${path}`;
    },
  },
  {
    name: "close_document",
    description: "Closes an open document's tab. Refuses when it has unsaved changes unless discard is true (then they are lost); save_document first to keep them.",
    parameters: obj({ doc: DOC, discard: { type: "boolean" } }),
    scope: "mcp",
    async run(args) {
      const doc = findDoc(args);
      if (doc.dirty && args.discard !== true) throw new Error(`${doc.name} has unsaved changes; save_document first, or pass discard: true to drop them`);
      // Already decided above, so the close doesn't ask the user.
      doc.dirty = false;
      await closeDoc(doc);
      return `Closed ${doc.name}`;
    },
  },
];
