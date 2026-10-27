// Open documents (tabs) and the file-level actions on them.
import { open as openFileDialog, save as saveFileDialog } from "@tauri-apps/plugin-dialog";
import { Doc } from "./doc.svelte";
import { t } from "./i18n/index.svelte";
import { errorText, ipc } from "./ipc";
import { baseName, stripExt } from "./pagespec";
import { PasswordNeeded, closePdf, openPdf, type PDFDocumentProxy } from "./pdfjs";
import { defaultName, writePdf } from "./save.svelte";
import { addRecent, newId, removeRecent } from "./settings.svelte";
import { busy, openDialog, toast } from "./ui.svelte";

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
      doc.pages = [...doc.pages, ...(await doc.pagesOf(id))];
    }
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
    doc.insertPages(items, pos);
    pos += items.length;
  }
}

/** Reopens `doc` from the file it was just saved to: one source, no pending edits. */
async function reload(doc: Doc, path: string, password: string | null) {
  const bytes = await ipc.readFile(path);
  const pdf = await openPdf(bytes, password ?? undefined);
  for (const s of doc.sources.values()) closePdf(s.pdf);
  doc.sources.clear();
  const id = newId("s");
  doc.addSource({ id, path, password: password ?? undefined, pdf });
  const current = doc.current;
  doc.pages = await doc.pagesOf(id);
  doc.overlays = [];
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

export async function saveDoc(doc: Doc, as = false): Promise<boolean> {
  let path = doc.path;
  if (as || !path) {
    const chosen = await saveFileDialog({ defaultPath: path ?? defaultName(doc), filters: PDF_FILTER });
    if (!chosen) return false;
    path = chosen.toLowerCase().endsWith(".pdf") ? chosen : `${chosen}.pdf`;
  }
  const target = path;
  const ok = await busy(t("save.saving"), async () => {
    await writePdf(doc, target);
    await reload(doc, target, doc.protect);
    addRecent(target);
    return true;
  });
  if (ok) toast(t("save.saved", { file: baseName(target) }), "ok");
  return !!ok;
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

export function docTitle(doc: Doc): string {
  return stripExt(doc.name);
}
