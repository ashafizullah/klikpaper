// Updates: the Rust side checks and downloads as the user's choice says
// (Settings → General); every message about them is an in-app alert here, with
// the changelog in the interface language.
import { listen } from "@tauri-apps/api/event";
import { getVersion } from "@tauri-apps/api/app";
import { errorText, ipc, type Release } from "./ipc";
import { hadSettings, persist, settings, type UpdateMode } from "./settings.svelte";
import { showAlert, toast } from "./ui.svelte";
import { closeDoc, ws } from "./workspace.svelte";
import { changelogSection } from "./changelog";
import { i18n, t } from "./i18n/index.svelte";
import changelogEn from "../../CHANGELOG.md?raw";
import changelogId from "../../CHANGELOG.id.md?raw";

export const updates = $state({ ready: null as Release | null, checking: false });

/** The running version's changes, from the changelog shipped with the app. */
function bundledNotes(version: string): string {
  return changelogSection(i18n.locale === "id" ? changelogId : changelogEn, version) || changelogSection(changelogEn, version);
}

/** A newer version's changes in the interface language, from the repository at its tag; the (English) release notes if that fails. */
async function releaseNotes(release: Release): Promise<string> {
  try {
    return changelogSection(await ipc.updateChangelog(release.version, i18n.locale), release.version) || release.notes;
  } catch {
    return release.notes;
  }
}

/** Shows what a new version brings and installs it when the user agrees. */
async function offer(release: Release) {
  const downloaded = updates.ready?.version === release.version;
  const choice = await showAlert({
    tone: "update",
    title: t("update.availableTitle"),
    message: t("update.availableBody", { version: release.version, current: release.current }),
    markdown: await releaseNotes(release),
    actions: [
      { label: t("update.later"), value: "later" },
      { label: t(downloaded ? "update.restart" : "update.install"), value: "install", primary: true },
    ],
  });
  if (choice === "install") await installUpdate();
}

/** A check the user asked for (menu, Settings): the outcome is always shown. */
export async function checkForUpdates() {
  if (updates.checking) return;
  updates.checking = true;
  try {
    const result = await ipc.checkUpdates();
    if (result.status === "available") await offer(result);
    else if (result.status === "upToDate")
      await showAlert({ tone: "success", title: t("update.latestTitle"), message: t("update.latestBody", { version: result.current }) });
    else toast(t("update.busy"));
  } catch (e) {
    await showAlert({ tone: "error", title: t("update.errorTitle"), message: errorText(e) });
  } finally {
    updates.checking = false;
  }
}

/** Closes the documents (asking about unsaved changes), then installs and restarts. */
export async function installUpdate() {
  for (const doc of [...ws.docs]) if (!(await closeDoc(doc))) return;
  try {
    await ipc.installAvailableUpdate();
  } catch (e) {
    await showAlert({ tone: "error", title: t("update.installFailed"), message: errorText(e) });
  }
}

function announce(release: Release) {
  updates.ready = release;
  toast(t("update.ready", { version: release.version }), "ok", { label: t("update.whatsNew"), run: () => offer(release) }, 0);
}

/** After an update, once: what changed in the version now running. */
async function showWhatsNew() {
  const current = await getVersion();
  const last = settings.lastVersion;
  if (last === current) return;
  settings.lastVersion = current;
  persist();
  // A fresh install has nothing to compare with. Versions before 0.1.6 didn't
  // record lastVersion, so saved settings without one mean an update from them.
  const notes = last || hadSettings ? bundledNotes(current) : "";
  if (notes)
    await showAlert({ tone: "update", title: t("update.whatsNewTitle", { version: current }), message: t("update.whatsNewBody"), markdown: notes });
}

/** Sends the saved choice to the backend and listens for what it finds. */
export async function initUpdates() {
  await ipc.setUpdateMode(settings.updateMode);
  listen<Release>("update-ready", (e) => announce(e.payload));
  listen<Release>("update-available", (e) => offer(e.payload));
  const ready = await ipc.pendingUpdate();
  if (ready) announce(ready);
  await showWhatsNew();
}

export async function setUpdateMode(mode: UpdateMode) {
  settings.updateMode = mode;
  persist();
  await ipc.setUpdateMode(mode);
  // Leaving "auto" drops a downloaded update (the backend won't install it on quit).
  if (mode !== "auto") updates.ready = null;
}
