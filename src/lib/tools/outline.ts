// Tools for bookmarks (the outline): listing them, adding one for a page and
// removing them. Like the Bookmarks panel, they change the open document;
// saving writes them into the PDF.
import type { Doc } from "../doc.svelte";
import { bookmarkId, find, flatten, insertionIndex, remove, type Bookmark } from "../outline";
import { DOC, obj, str, findDoc, pageArg, type ToolSpec } from "./args";

function describe(doc: Doc, list: Bookmark[], depth = 0): unknown[] {
  return list.map((b) => {
    const page = b.page ? doc.pages.findIndex((p) => p.id === b.page) + 1 : null;
    return { id: b.id, title: b.title, page: page || null, ...(b.url ? { url: b.url } : {}), level: depth + 1, children: describe(doc, b.children, depth + 1) };
  });
}

const BOOKMARK = { type: "string", description: "Bookmark id from list_bookmarks." };

export const OUTLINE_TOOLS: ToolSpec[] = [
  {
    name: "list_bookmarks",
    description: "Lists the document's bookmarks (its outline, the table of contents readers show beside the pages), nested as in the file, with the page each opens.",
    parameters: obj({ doc: DOC }),
    scope: "both",
    async run(args) {
      const doc = findDoc(args);
      return { doc: doc.name, bookmarks: describe(doc, doc.outline) };
    },
  },
  {
    name: "add_bookmark",
    description:
      "Adds a bookmark that opens a page, placed in page order; with `parent`, as a sub-bookmark of that one. Undoable; saving writes it into the PDF, where Acrobat, Preview and browsers show it too.",
    parameters: obj({ doc: DOC, page: { type: "integer", minimum: 1 }, title: { type: "string" }, parent: BOOKMARK }, ["page", "title"]),
    scope: "both",
    async run(args) {
      const doc = findDoc(args);
      const { n, page } = pageArg(doc, args);
      const parentId = str(args, "parent", "");
      if (parentId && !find(doc.outline, parentId)) throw new Error(`No bookmark "${parentId}"; list_bookmarks lists them`);
      const b: Bookmark = { id: bookmarkId(), title: str(args, "title"), page: page.id, y: null, open: true, children: [] };
      doc.editOutline((list) => {
        const parent = parentId ? find(list, parentId) : null;
        const into = parent ? parent.children : list;
        into.splice(insertionIndex(into, doc.pages, n), 0, b);
        if (parent) parent.open = true;
      });
      return { added: { id: b.id, title: b.title, page: n } };
    },
  },
  {
    name: "remove_bookmarks",
    description: "Removes bookmarks by id (their sub-bookmarks go too), or all of them with all: true. Undoable; saved when the user saves.",
    parameters: obj({ doc: DOC, ids: { type: "array", items: { type: "string" } }, all: { type: "boolean" } }),
    scope: "both",
    async run(args) {
      const doc = findDoc(args);
      const ids = args.all === true ? doc.outline.map((b) => b.id) : Array.isArray(args.ids) ? args.ids.map(String) : [];
      const known = ids.filter((id) => find(doc.outline, id));
      if (!known.length) throw new Error("No matching bookmarks; list_bookmarks lists them");
      const count = known.reduce((sum, id) => sum + flatten([find(doc.outline, id)!]).length, 0);
      doc.editOutline((list) => known.forEach((id) => remove(list, id)));
      return `Removed ${count} bookmark(s)`;
    },
  },
];
