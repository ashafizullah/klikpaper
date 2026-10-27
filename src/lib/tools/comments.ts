// Tools for comments: reading the threads in a document, adding notes and
// replies, marking them done and removing them. Like the Comments panel, they
// change the open document; saving writes them into the PDF as standard notes.
import type { Comment, Doc } from "../doc.svelte";
import { commentAuthor, sortedThreads } from "../comments.svelte";
import { pageToDisplay } from "../geometry";
import { DOC, obj, str, num, findDoc, pageArg, pointOnPage, type Args, type ToolSpec } from "./args";

function describe(doc: Doc, c: Comment) {
  const index = doc.pages.findIndex((p) => p.id === c.page);
  const page = doc.pages[index];
  const [x, y] = pageToDisplay(c.x, c.y, doc.rotation(page), page.w, page.h);
  return {
    id: c.id,
    page: index + 1,
    x: Math.round(x),
    y: Math.round(y),
    author: c.author,
    date: c.date,
    text: c.text,
    resolved: c.resolved,
    replies: c.replies.map((r) => ({ id: r.id, author: r.author, date: r.date, text: r.text })),
  };
}

function thread(doc: Doc, args: Args): Comment {
  const id = str(args, "comment");
  const c = doc.comment(id);
  if (!c) throw new Error(`No comment "${id}" in ${doc.name}; list_comments lists them`);
  return c;
}

async function author(args: Args): Promise<string> {
  return str(args, "author", "") || (await commentAuthor());
}

const COMMENT = { type: "string", description: "Comment (thread) id from list_comments." };
const AUTHOR = { type: "string", description: "Name to sign with. Defaults to the name set in KlikPaper." };
const SAVE = "Saving the document writes comments into the PDF as standard notes that other readers (Acrobat, Preview) show too.";

export const COMMENT_TOOLS: ToolSpec[] = [
  {
    name: "list_comments",
    description: "Lists the comment threads in a document (sticky notes with their replies), in page order. Positions are in points from the top-left of the page as displayed.",
    parameters: obj({ doc: DOC, include_resolved: { type: "boolean", description: "Include threads marked done. Default true." } }),
    scope: "both",
    async run(args) {
      const doc = findDoc(args);
      const all = sortedThreads(doc);
      const list = args.include_resolved === false ? all.filter((c) => !c.resolved) : all;
      return { doc: doc.name, comments: list.map((c) => describe(doc, c)) };
    },
  },
  {
    name: "add_comment",
    description: `Adds a comment (a sticky note) at a point on a page. x and y are in points from the top-left corner of the page as displayed (1 inch = 72 points). ${SAVE}`,
    parameters: obj({ doc: DOC, page: { type: "integer", minimum: 1 }, x: { type: "number" }, y: { type: "number" }, text: { type: "string" }, author: AUTHOR }, ["page", "text"]),
    scope: "both",
    async run(args) {
      const doc = findDoc(args);
      const { page } = pageArg(doc, args);
      const [x, y] = pointOnPage(doc, page, num(args, "x", 36), num(args, "y", 36));
      const c = doc.addComment(page.id, Math.min(x, page.w - 20), Math.min(y, page.h - 20), str(args, "text"), await author(args));
      return { added: describe(doc, c) };
    },
  },
  {
    name: "reply_comment",
    description: `Replies to a comment thread. ${SAVE}`,
    parameters: obj({ doc: DOC, comment: COMMENT, text: { type: "string" }, author: AUTHOR }, ["comment", "text"]),
    scope: "both",
    async run(args) {
      const doc = findDoc(args);
      const c = thread(doc, args);
      doc.reply(c.id, str(args, "text"), await author(args));
      return { thread: describe(doc, doc.comment(c.id)!) };
    },
  },
  {
    name: "resolve_comment",
    description: "Marks a comment thread as done, or reopens it (resolved: false).",
    parameters: obj({ doc: DOC, comment: COMMENT, resolved: { type: "boolean", description: "Default true." } }, ["comment"]),
    scope: "both",
    async run(args) {
      const doc = findDoc(args);
      const c = thread(doc, args);
      doc.setResolved(c.id, args.resolved !== false);
      return { thread: describe(doc, doc.comment(c.id)!) };
    },
  },
  {
    name: "delete_comment",
    description: "Deletes a whole comment thread, or one reply in it (pass reply). Can be undone in the app.",
    parameters: obj({ doc: DOC, comment: COMMENT, reply: { type: "string", description: "Reply id; omit to delete the whole thread." } }, ["comment"]),
    scope: "both",
    async run(args) {
      const doc = findDoc(args);
      const c = thread(doc, args);
      const reply = str(args, "reply", "") || null;
      if (reply && !c.replies.some((r) => r.id === reply)) throw new Error(`No reply "${reply}" in comment ${c.id}`);
      doc.deleteComment(c.id, reply);
      return { deleted: reply ?? c.id };
    },
  },
];
