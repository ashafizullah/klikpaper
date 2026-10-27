// Right-click menus. A component builds the items for what was clicked and
// calls openMenu; ContextMenu.svelte shows them at the pointer. Text fields
// keep the system menu (cut, copy, paste, spelling); everywhere else the web
// view's own menu (Reload, Inspect) is never shown.
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { isMac } from "./ui.svelte";

export interface MenuAction {
  label: string;
  icon?: string;
  /** Shown on the right, e.g. "⌘C". */
  shortcut?: string;
  disabled?: boolean;
  danger?: boolean;
  run: () => unknown;
}
export type MenuItem = MenuAction | "sep";

export const contextMenu = $state({ open: null as { x: number; y: number; items: MenuItem[] } | null });

/** Shows `items` at the pointer; separators at the ends or next to each other are dropped. */
export function openMenu(e: MouseEvent, items: (MenuItem | false | null | undefined | "")[]) {
  e.preventDefault();
  e.stopPropagation();
  const out: MenuItem[] = [];
  for (const item of items) {
    if (!item) continue;
    if (item === "sep" && (!out.length || out[out.length - 1] === "sep")) continue;
    out.push(item);
  }
  if (out[out.length - 1] === "sep") out.pop();
  contextMenu.open = out.length ? { x: e.clientX, y: e.clientY, items: out } : null;
}

export function closeMenu() {
  contextMenu.open = null;
}

/** Whether a right-click there should get the system menu (text fields). */
export function wantsSystemMenu(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el?.closest) return false;
  if (el.closest(".xterm")) return true;
  const field = el.closest("input, textarea, [contenteditable='true']") as HTMLInputElement | null;
  return !!field && !(field instanceof HTMLInputElement && /^(checkbox|radio|range|color|button|submit)$/.test(field.type));
}

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Older web views: copy through a hidden field.
    const area = document.createElement("textarea");
    area.value = text;
    area.style.cssText = "position:fixed;opacity:0";
    document.body.append(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
}

/** "Show in Finder" on a Mac, "Show in folder" elsewhere. */
export const revealLabel = isMac ? "ctx.revealMac" : "ctx.reveal";

export function revealFile(path: string) {
  return revealItemInDir(path);
}
