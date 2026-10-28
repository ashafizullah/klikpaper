// App commands, shared by the menu bar, keyboard shortcuts and toolbar buttons.
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { settings, persist } from "./settings.svelte";
import { closeDialog, openDialog, toast, ui } from "./ui.svelte";
import { viewer } from "./viewer.svelte";
import { activeDoc, closeDoc, closeHomeTab, IMAGE_FILTER, openHomeTab, pickAndOpen, saveDoc, ws } from "./workspace.svelte";
import { t } from "./i18n/index.svelte";
import { ipc } from "./ipc";
import { checkForUpdates } from "./updates.svelte";
import { printDoc } from "./print";

export const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];

export function zoomBy(dir: 1 | -1) {
  const doc = activeDoc();
  if (!doc) return;
  const z = doc.zoom;
  const next = dir > 0 ? ZOOM_STEPS.find((s) => s > z + 0.001) : [...ZOOM_STEPS].reverse().find((s) => s < z - 0.001);
  doc.fitWidth = false;
  doc.zoom = next ?? z;
}

function editing(): boolean {
  const el = document.activeElement as HTMLElement | null;
  return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
}

export async function imagesToPdf(paths?: string[]) {
  if (!paths) {
    const picked = await openFileDialog({ multiple: true, filters: IMAGE_FILTER });
    paths = Array.isArray(picked) ? picked : picked ? [picked] : [];
  }
  if (paths.length) await openDialog("images", { images: paths });
}

export async function command(id: string) {
  // A dialog on top owns the keyboard.
  if (ui.dialogs.length && id !== "close-dialog") return;
  const doc = activeDoc();
  switch (id) {
    case "open":
      return pickAndOpen();
    case "new-tab":
      return openHomeTab();
    case "merge":
      return pickAndOpen(true);
    case "images-to-pdf":
      return imagesToPdf();
    case "batch":
      return openDialog("batch");
    case "settings":
      return openDialog("settings");
    case "licenses":
      return openDialog("licenses");
    case "check-updates":
      return checkForUpdates();
    case "close-dialog":
      return closeDialog(null);
    case "toggle-ai":
      settings.showChat = !settings.showChat;
      return persist();
    case "toggle-comments":
      settings.showComments = !settings.showComments;
      return persist();
    case "toggle-sidebar":
      settings.showSidebar = !settings.showSidebar;
      return persist();
    case "toggle-outline":
      // Shows the bookmarks, or hides the sidebar when they are already shown.
      settings.showSidebar = !(settings.showSidebar && settings.sidebarTab === "outline");
      settings.sidebarTab = "outline";
      return persist();
    case "toggle-terminal":
      ui.terminal = !ui.terminal;
      return;
  }
  if (!doc) {
    if (id === "close-tab" && ws.homeTab) closeHomeTab();
    return;
  }
  switch (id) {
    case "save":
      return saveDoc(doc);
    case "save-as":
      return saveDoc(doc, true);
    case "print":
      return printDoc(doc);
    case "close-tab":
      return closeDoc(doc);
    case "compress":
      return openDialog("compress", { doc });
    case "export-images":
      return openDialog("export-images", { doc });
    case "split":
      return openDialog("split", { doc });
    case "resize":
      return openDialog("resize", { doc });
    case "security":
      return openDialog("security", { doc });
    case "watermark":
      return openDialog("watermark", { doc });
    case "page-numbers":
      return openDialog("page-numbers", { doc });
    case "info":
      return openDialog("info", { doc });
    case "ocr":
      return openDialog("ocr", { doc });
    case "personal":
      return openDialog("personal", { doc });
    case "undo":
      if (editing()) return document.execCommand("undo");
      return doc.undo();
    case "redo":
      if (editing()) return document.execCommand("redo");
      return doc.redo();
    case "zoom-in":
      return zoomBy(1);
    case "zoom-out":
      return zoomBy(-1);
    case "zoom-fit":
      doc.fitWidth = true;
      return;
    case "find":
      ui.findOpen = true;
      setTimeout(() => document.querySelector<HTMLInputElement>("#find-input")?.select(), 0);
      return;
    case "next-page":
      return viewer.goTo(doc.current + 1);
    case "prev-page":
      return viewer.goTo(doc.current - 1);
    case "first-page":
      return viewer.goTo(0);
    case "last-page":
      return viewer.goTo(doc.pages.length - 1);
    case "delete": {
      if (editing()) return;
      if (doc.selectedOverlay) return doc.removeOverlay(doc.selectedOverlay);
      if (doc.selectedRedaction) return doc.removeRedactions([doc.selectedRedaction]);
      return;
    }
    case "escape":
      if (ui.findOpen) {
        ui.findOpen = false;
        return;
      }
      ui.pendingImage = null;
      ui.commentDraft = null;
      if (ui.tool !== "select") ui.tool = "select";
      else {
        doc.selectedOverlay = null;
        doc.selectedRedaction = null;
      }
      return;
  }
}

/** Keyboard shortcuts; menu accelerators send the same ids. */
export function onKeydown(e: KeyboardEvent) {
  const mod = e.metaKey || e.ctrlKey;
  const key = e.key.toLowerCase();
  let id: string | null = null;
  if (e.ctrlKey && e.key === "`") id = "toggle-terminal";
  // Everything else typed in the terminal belongs to the shell.
  else if ((e.target as HTMLElement | null)?.closest?.(".xterm")) return;
  else if (e.key === "Escape") id = ui.dialogs.length ? "close-dialog" : "escape";
  else if (mod && !e.altKey) {
    if (e.shiftKey) id = { s: "save-as", z: "redo", k: "toggle-comments" }[key] ?? null;
    else
      id =
        {
          o: "open",
          t: "new-tab",
          s: "save",
          p: "print",
          w: "close-tab",
          z: "undo",
          y: "redo",
          f: "find",
          b: "toggle-sidebar",
          j: "toggle-ai",
          "=": "zoom-in",
          "+": "zoom-in",
          "-": "zoom-out",
          "0": "zoom-fit",
          ",": "settings",
        }[key] ?? null;
    // Inside text fields, undo/redo are the field's own.
    if ((id === "undo" || id === "redo") && editing()) return;
  } else if (!editing() && !ui.dialogs.length) {
    if (e.key === "Delete" || e.key === "Backspace") id = "delete";
    else if (e.key === "PageDown" || (e.key === "ArrowRight" && !activeDoc()?.selectedOverlay)) id = "next-page";
    else if (e.key === "PageUp" || (e.key === "ArrowLeft" && !activeDoc()?.selectedOverlay)) id = "prev-page";
    else if (e.key === "Home") id = "first-page";
    else if (e.key === "End") id = "last-page";
  }
  if (!id) return;
  e.preventDefault();
  command(id).catch((err) => toast(String(err), "error"));
}

export function hasDocs() {
  return ws.docs.length > 0;
}

export { t };
