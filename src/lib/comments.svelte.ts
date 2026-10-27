// Comments live in the PDF as standard notes (with replies), so whoever opens
// the file, in KlikPaper, Acrobat or Preview, sees them and can answer. They
// travel with the file: send it, or keep it in a shared folder, where KlikPaper
// picks up what others wrote as soon as the file changes.
import type { Comment, Doc, PageItem } from "./doc.svelte";
import { ipc } from "./ipc";
import { newId, persist, settings } from "./settings.svelte";

/** The threads in a source's file, attached to its page items (pages not in `items` are skipped). */
export async function readComments(doc: Doc, sourceId: string, items: PageItem[]): Promise<Comment[]> {
  const src = doc.sources.get(sourceId);
  if (!src) return [];
  const pages = await ipc.pdfComments(src.path, src.password);
  const out: Comment[] = [];
  for (const { index, threads } of pages) {
    const item = items.find((p) => p.source === sourceId && p.index === index);
    if (item) out.push(...threads.map((t) => ({ ...t, page: item.id })));
  }
  return out;
}

/**
 * Adds the comments of a source just added to `doc`. When they can't be read,
 * its pages keep the file's comments as they are when saved.
 */
export async function loadComments(doc: Doc, sourceId: string, items: PageItem[]) {
  try {
    const found = await readComments(doc, sourceId, items);
    // The same file added twice gets its own copy of each thread.
    const taken = new Set(doc.comments.flatMap((c) => [c.id, ...c.replies.map((r) => r.id)]));
    for (const c of found) {
      if (taken.has(c.id)) c.id = newId("c");
      for (const r of c.replies) if (taken.has(r.id)) r.id = newId("r");
    }
    doc.comments.push(...found);
    doc.commentSources.add(sourceId);
  } catch {}
}

/** Adds threads and replies written elsewhere that `doc` doesn't have yet; returns how many arrived. */
export function mergeComments(doc: Doc, incoming: Comment[]): number {
  let added = 0;
  for (const c of incoming) {
    const mine = doc.comment(c.id);
    if (!mine) {
      doc.comments.push(c);
      added += 1 + c.replies.length;
      continue;
    }
    for (const r of c.replies) {
      if (mine.replies.some((x) => x.id === r.id)) continue;
      mine.replies.push(r);
      added++;
    }
    mine.replies.sort((a, b) => a.date.localeCompare(b.date));
  }
  return added;
}

let osName: Promise<string> | null = null;

/** The name new comments are signed with: the one set in Settings, else the computer account's. */
export async function commentAuthor(): Promise<string> {
  if (settings.commentAuthor.trim()) return settings.commentAuthor.trim();
  osName ??= ipc.userName().catch(() => "");
  return (await osName) || "KlikPaper";
}

export async function suggestedAuthor(): Promise<string> {
  osName ??= ipc.userName().catch(() => "");
  return settings.commentAuthor.trim() || (await osName);
}

export function setCommentAuthor(name: string) {
  settings.commentAuthor = name.trim();
  persist();
}

/** Threads in page order, then top to bottom. */
export function sortedThreads(doc: Doc, list: Comment[] = doc.comments): Comment[] {
  const order = new Map(doc.pages.map((p, i) => [p.id, i]));
  return list.filter((c) => order.has(c.page)).sort((a, b) => order.get(a.page)! - order.get(b.page)! || a.y - b.y || a.x - b.x);
}
