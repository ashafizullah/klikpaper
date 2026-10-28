// Open documents (tabs) and the file-level actions on them.
import { open as openFileDialog, save as saveFileDialog } from "@tauri-apps/plugin-dialog";
import { Doc } from "./doc.svelte";
import { loadComments, mergeComments, readComments } from "./comments.svelte";
import { t } from "./i18n/index.svelte";
import { errorText, ipc } from "./ipc";
import { baseName, dirName, joinPath, stripExt } from "./pagespec";
import { PasswordNeeded, openPdf, type PDFDocumentProxy } from "./pdfjs";
import { defaultName, writePdf } from "./save.svelte";
import { readOutline } from "./outline";
import { readSignatures } from "./signatures";
import { addRecent, newId, removeRecent } from "./settings.svelte";
import { busy, openDialog, showAlert, toast, ui } from "./ui.svelte";

export const ws = $state({
  docs: [] as Doc[],
  activeId: null as string | null,
  /** A Home tab next to the documents, like a browser's new tab; it is the active one when activeId is null. */
  homeTab: false,
});

export function activeDoc(): Doc | undefined {
  return ws.docs.find((d) => d.id === ws.activeId);
}

export function activate(doc: Doc) {
  ws.activeId = doc.id;
}

/** Shows Home in a tab of its own. */
export function openHomeTab() {
  ws.homeTab = ws.docs.length > 0;
  ws.activeId = null;
}

export function closeHomeTab() {
  ws.homeTab = false;
  ws.activeId ??= ws.docs.at(-1)?.id ?? null;
}

/** Shows a document; opened from the Home tab, it takes that tab's place. */
function show(doc: Doc) {
  if (ws.activeId === null) ws.homeTab = false;
  if (!ws.docs.includes(doc)) ws.docs.push(doc);
  activate(doc);
}

/** Loads a PDF, asking for its password when needed. Null when the user gives up. */
async function loadPdf(path: string): Promise<{ pdf: PDFDocumentProxy; password?: string } | null> {
  const bytes = await ipc.readFile(path);
  let password: string | undefined;
  let retry = false;
  for (;;) {
    try {
      // pdf.js takes ownership of the buffer, so each attempt gets its own copy.
      const pdf = await openPdf(bytes.slice(), password);
      return { pdf, password };
    } catch (e) {
      if (!(e instanceof PasswordNeeded)) throw e;
      retry = e.retry;
      const given = await openDialog<string>("password", { file: baseName(path), retry });
      if (given == null) return null;
      password = given;
    }
  }
}

export const PDF_FILTER = [{ name: "PDF", extensions: ["pdf"] }];
export const IMAGE_FILTER = [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp", "tif", "tiff"] }];

/** Opens each file in its own tab (or focuses it when already open); returns the errors. */
export async function openPaths(paths: string[]): Promise<string[]> {
  const errors: string[] = [];
  for (const path of paths) {
    const existing = ws.docs.find((d) => d.path === path);
    if (existing) {
      show(existing);
      continue;
    }
    try {
      const loaded = await loadPdf(path);
      if (!loaded) continue;
      const doc = new Doc(baseName(path), path);
      const id = newId("s");
      doc.addSource({ id, path, password: loaded.password, pdf: loaded.pdf });
      doc.pages = await doc.pagesOf(id);
      doc.protect = loaded.password ?? null;
      doc.outline = await readOutline(loaded.pdf, doc.pages);
      await loadComments(doc, id, doc.pages);
      doc.stamp = await stampOf(path);
      readNotes(doc, path, loaded.password);
      show(doc);
      addRecent(path);
    } catch (e) {
      toast(t("open.failed", { file: baseName(path), error: errorText(e) }), "error");
      errors.push(errorText(e));
      if (/not found|No such file|os error 2/i.test(errorText(e))) removeRecent(path);
    }
  }
  return errors;
}

/** One new document with the pages of all the files, in order. */
export async function mergePaths(paths: string[]) {
  if (paths.length === 0) return;
  if (paths.length === 1) {
    await openPaths(paths);
    return;
  }
  const doc = new Doc(t("merge.name"), null);
  try {
    for (const path of paths) {
      const loaded = await loadPdf(path);
      if (!loaded) continue;
      const id = newId("s");
      doc.addSource({ id, path, password: loaded.password, pdf: loaded.pdf });
      const items = await doc.pagesOf(id);
      doc.pages = [...doc.pages, ...items];
      doc.outline.push(...(await readOutline(loaded.pdf, items)));
      await loadComments(doc, id, items);
    }
    // Each file's bookmarks go into the merged file.
    doc.outlineChanged = true;
  } catch (e) {
    doc.destroy();
    toast(errorText(e), "error");
    return;
  }
  if (doc.pages.length === 0) return doc.destroy();
  doc.dirty = true;
  show(doc);
}

export async function pickAndOpen(merge = false) {
  const picked = await openFileDialog({ multiple: true, filters: PDF_FILTER });
  const paths = Array.isArray(picked) ? picked : picked ? [picked] : [];
  if (merge) await mergePaths(paths);
  else await openPaths(paths);
}

/** Adds the pages of other PDFs to `doc` at position `at`. */
export async function insertFiles(doc: Doc, at: number, paths?: string[]) {
  if (!paths) {
    const picked = await openFileDialog({ multiple: true, filters: PDF_FILTER });
    paths = Array.isArray(picked) ? picked : picked ? [picked] : [];
  }
  let pos = at;
  for (const path of paths) {
    const loaded = await loadPdf(path);
    if (!loaded) continue;
    const id = newId("s");
    doc.addSource({ id, path, password: loaded.password, pdf: loaded.pdf });
    const items = await doc.pagesOf(id);
    doc.insertPages(items, pos, await readOutline(loaded.pdf, items));
    await loadComments(doc, id, items);
    pos += items.length;
  }
}

/** Reopens `doc` from the file it was just saved to: one source, no pending edits. */
async function reload(doc: Doc, path: string, password: string | null) {
  const bytes = await ipc.readFile(path);
  const pdf = await openPdf(bytes, password ?? undefined);
  doc.dropSources();
  const id = newId("s");
  doc.addSource({ id, path, password: password ?? undefined, pdf });
  const current = doc.current;
  doc.pages = await doc.pagesOf(id);
  doc.comments = [];
  doc.commentSources.clear();
  await loadComments(doc, id, doc.pages);
  doc.selectedComment = doc.selectedComment && doc.comment(doc.selectedComment) ? doc.selectedComment : null;
  doc.stamp = await stampOf(path);
  readNotes(doc, path, password ?? undefined);
  doc.overlays = [];
  doc.redactions = [];
  doc.selectedRedaction = null;
  doc.outline = await readOutline(pdf, doc.pages);
  doc.outlineChanged = false;
  doc.watermark = null;
  doc.pageNumbers = null;
  doc.flattenForms = false;
  doc.formsEdited = false;
  doc.selectedOverlay = null;
  doc.selectedPages = [];
  doc.current = Math.min(current, doc.pages.length - 1);
  doc.clearHistory();
  doc.path = path;
  doc.name = baseName(path);
  doc.dirty = false;
}

/** What the file says about itself: blacked-out parts, its edit history and its digital signatures (read in the background). */
function readNotes(doc: Doc, path: string, password?: string) {
  ipc
    .pdfInfo(path, password)
    .then((info) => {
      doc.redactedNote = info.redacted;
      doc.editHistory = info.history;
    })
    .catch(() => {});
  readSignatures(path, password).then((found) => (doc.signatures = found));
}

/** When the file last changed (0 when unknown). */
async function stampOf(path: string): Promise<number> {
  return (await ipc.fileStats([path]).catch(() => []))[0]?.modified ?? 0;
}

/**
 * The file of an open document was changed elsewhere (another KlikPaper on a
 * shared folder, Acrobat, a sync app). Without unsaved edits it is reopened;
 * with them, only the new comments are taken in, to be saved together.
 */
async function changedElsewhere(doc: Doc, path: string, stamp: number) {
  if (!doc.dirty) {
    await reload(doc, path, doc.protect);
    toast(t("comments.reloaded", { file: doc.name }), "info");
    return;
  }
  const main = [...doc.sources.values()].find((s) => s.path === path);
  if (!main || !doc.commentSources.has(main.id)) return;
  const incoming = await readComments(doc, main.id, doc.pages);
  doc.stamp = stamp;
  const isNew = (c: (typeof incoming)[number]) => {
    const mine = doc.comment(c.id);
    return !mine || c.replies.some((r) => !mine.replies.some((x) => x.id === r.id));
  };
  if (!incoming.some(isNew)) return;
  let added = 0;
  doc.change(() => (added = mergeComments(doc, incoming)));
  toast(t("comments.merged", { n: added, file: doc.name }), "info");
}

let watching = false;

/** Checks every few seconds whether open files changed on disk. */
export function watchFiles() {
  setInterval(async () => {
    if (watching || ui.busy) return;
    const docs = ws.docs.filter((d) => d.path && d.stamp);
    if (!docs.length) return;
    watching = true;
    try {
      const stats = await ipc.fileStats(docs.map((d) => d.path!));
      for (const doc of docs) {
        const st = stats.find((s) => s.path === doc.path);
        if (!st?.exists || !st.modified || st.modified === doc.stamp || ui.busy) continue;
        // A file still being written (by a sync app) fails to read; the next check retries.
        await changedElsewhere(doc, doc.path!, st.modified).catch(() => {});
      }
    } finally {
      watching = false;
    }
  }, 3000);
}

/** Saves `doc`; `newFile` says the caller already picked a new target, so there's no original to overwrite. */
export async function saveDoc(doc: Doc, as = false, newFile = false): Promise<boolean> {
  let path = doc.path;
  // Saving redactions over the original would leave no unredacted copy; a new file is the usual choice.
  // Saving rewrites the whole file, which breaks digital signatures; keeping the signed original is the usual choice.
  if (!as && !newFile && path && doc.signatures.some((s) => !s.timestamp)) {
    const choice = await showAlert({
      title: t("sig.saveTitle"),
      message: t("sig.saveMessage", { file: doc.name }),
      actions: [
        { label: t("common.cancel"), value: "cancel" },
        { label: t("redact.overwrite"), value: "overwrite", danger: true },
        { label: t("redact.saveCopy"), value: "copy", primary: true },
      ],
    });
    if (choice !== "overwrite" && choice !== "copy") return false;
    as = choice === "copy";
  }
  if (!as && !newFile && path && doc.redactions.length) {
    const choice = await showAlert({
      title: t("redact.saveTitle"),
      message: t("redact.saveMessage", { file: doc.name }),
      actions: [
        { label: t("common.cancel"), value: "cancel" },
        { label: t("redact.overwrite"), value: "overwrite", danger: true },
        { label: t("redact.saveCopy"), value: "copy", primary: true },
      ],
    });
    if (choice !== "overwrite" && choice !== "copy") return false;
    as = choice === "copy";
  }
  if (as || !path) {
    // A copy next to the original, named for what was done to it.
    const signed = doc.signatures.some((s) => !s.timestamp);
    const suggested = path && (doc.redactions.length || signed) ? joinPath(dirName(path), defaultName(doc, doc.redactions.length ? "-redacted" : "-edited")) : (path ?? defaultName(doc));
    const chosen = await saveFileDialog({ defaultPath: suggested, filters: PDF_FILTER });
    if (!chosen) return false;
    path = chosen.toLowerCase().endsWith(".pdf") ? chosen : `${chosen}.pdf`;
  }
  const target = path;
  const result = await busy(t("save.saving"), async () => {
    const written = await writePdf(doc, target);
    await reload(doc, target, doc.protect);
    addRecent(target);
    return written;
  });
  if (!result) return false;
  if (result.redacted) toast(t(result.pictures ? "redact.savedPictures" : "redact.saved", { file: baseName(target), n: result.redacted, pages: result.pictures }), "ok", undefined, 7000);
  else toast(t("save.saved", { file: baseName(target) }), "ok");
  return true;
}

/** Saves a copy (all pages or some) somewhere else without changing the open document. */
export async function exportCopy(doc: Doc, pages: number[] | undefined, suffix: string) {
  const chosen = await saveFileDialog({ defaultPath: defaultName(doc, suffix), filters: PDF_FILTER });
  if (!chosen) return;
  const target = chosen.toLowerCase().endsWith(".pdf") ? chosen : `${chosen}.pdf`;
  const done = await busy(t("save.saving"), () => writePdf(doc, target, { pages }));
  if (done) toast(t("save.saved", { file: baseName(target) }), "ok");
}

export async function closeDoc(doc: Doc): Promise<boolean> {
  if (doc.dirty) {
    const choice = await openDialog<"save" | "discard">("unsaved", { name: doc.name });
    if (!choice) return false;
    if (choice === "save" && !(await saveDoc(doc))) return false;
  }
  const i = ws.docs.indexOf(doc);
  ws.docs = ws.docs.filter((d) => d !== doc);
  if (ws.activeId === doc.id) ws.activeId = ws.docs[Math.min(i, ws.docs.length - 1)]?.id ?? null;
  if (!ws.docs.length) ws.homeTab = false;
  doc.destroy();
  return true;
}

/** Closes the other tabs (or only those after `doc`), stopping if one is kept open. */
export async function closeOthers(doc: Doc, onlyAfter = false) {
  const i = ws.docs.indexOf(doc);
  const others = ws.docs.filter((d, j) => d !== doc && (!onlyAfter || j > i));
  activate(doc);
  for (const d of others) if (!(await closeDoc(d))) return;
}

export function docTitle(doc: Doc): string {
  return stripExt(doc.name);
}
