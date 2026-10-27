// Automatic updates: the Rust side checks and downloads as the user's choice
// says (Settings → General); this tells it the choice and offers the restart.
import { listen } from "@tauri-apps/api/event";
import { errorText, ipc, type UpdateReady } from "./ipc";
import { persist, settings, type UpdateMode } from "./settings.svelte";
import { toast } from "./ui.svelte";
import { closeDoc, ws } from "./workspace.svelte";
import { t } from "./i18n/index.svelte";

export const updates = $state({ ready: null as UpdateReady | null });

function announce(ready: UpdateReady) {
  updates.ready = ready;
  toast(t("update.ready", { version: ready.version }), "ok", { label: t("update.restart"), run: restartToUpdate }, 0);
}

/** Sends the saved choice to the backend and listens for downloaded updates. */
export async function initUpdates() {
  await ipc.setUpdateMode(settings.updateMode);
  listen<UpdateReady>("update-ready", (e) => announce(e.payload));
  const ready = await ipc.pendingUpdate();
  if (ready) announce(ready);
}

export async function setUpdateMode(mode: UpdateMode) {
  settings.updateMode = mode;
  persist();
  await ipc.setUpdateMode(mode);
  // Leaving "auto" drops a downloaded update (the backend won't install it on quit).
  if (mode !== "auto") updates.ready = null;
}

/** Closes the documents (asking about unsaved changes), then installs and restarts. */
export async function restartToUpdate() {
  for (const doc of [...ws.docs]) if (!(await closeDoc(doc))) return;
  try {
    await ipc.installUpdate();
  } catch (e) {
    toast(errorText(e), "error");
  }
}
