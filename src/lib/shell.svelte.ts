// Explorer right-click actions on Windows ("Merge with KlikPaper", ...). Explorer
// starts KlikPaper once per selected file, so files that arrive close together
// are batched into one action: merging five PDFs makes one document.
import { listen } from "@tauri-apps/api/event";
import { errorText, ipc, type ShellAction } from "./ipc";
import { persist, settings } from "./settings.svelte";
import { openDialog, toast } from "./ui.svelte";
import { activate, mergePaths, openPaths, ws } from "./workspace.svelte";
import { imagesToPdf } from "./commands.svelte";
import { t } from "./i18n/index.svelte";

/** Whether this system has the menu (Windows only). */
export const shellMenu = $state({ available: false });

const BATCH_MS = 700;
const pending = new Map<string, Set<string>>();
let timer: ReturnType<typeof setTimeout> | undefined;
let running = Promise.resolve();

function labels() {
  return { merge: t("shell.merge"), compress: t("shell.compress"), images: t("shell.images"), toPdf: t("shell.toPdf") };
}

/** Takes actions from launch, listens for more, and keeps the registry entries in step with the setting. */
export async function initShell() {
  listen<ShellAction>("shell-action", (e) => queue(e.payload));
  (await ipc.takeShellActions()).forEach(queue);
  shellMenu.available = (await ipc.shellMenu()) !== null;
  // Rewritten at every launch: the app may have moved (update, reinstall) or changed language.
  if (shellMenu.available && settings.shellMenu) await ipc.setShellMenu(true, labels()).catch(() => {});
}

export async function setShellMenu(enabled: boolean) {
  try {
    await ipc.setShellMenu(enabled, labels());
    settings.shellMenu = enabled;
    persist();
  } catch (e) {
    toast(errorText(e), "error");
  }
}

/** Updates the menu's labels after the interface language changes. */
export function relabelShellMenu() {
  if (shellMenu.available && settings.shellMenu) ipc.setShellMenu(true, labels()).catch(() => {});
}

function queue(a: ShellAction) {
  if (!a.paths.length) return;
  const set = pending.get(a.action) ?? new Set<string>();
  a.paths.forEach((p) => set.add(p));
  pending.set(a.action, set);
  clearTimeout(timer);
  timer = setTimeout(flush, BATCH_MS);
}

function flush() {
  const jobs = [...pending];
  pending.clear();
  // Name order (file 2 before file 10), as Explorer lists them.
  const byName = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
  running = running.then(async () => {
    for (const [action, paths] of jobs) await run(action, [...paths].sort(byName)).catch((e) => toast(errorText(e), "error"));
  });
}

async function run(action: string, paths: string[]) {
  switch (action) {
    case "merge":
      return mergePaths(paths);
    case "to-pdf":
      return imagesToPdf(paths);
    case "compress":
    case "images":
      // One dialog after another, each for its own file.
      for (const path of paths) {
        await openPaths([path]);
        const doc = ws.docs.find((d) => d.path === path);
        if (!doc) continue;
        activate(doc);
        await openDialog(action === "compress" ? "compress" : "export-images", { doc });
      }
  }
}
