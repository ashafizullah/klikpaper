<script lang="ts">
  import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
  import { revealItemInDir } from "@tauri-apps/plugin-opener";
  import Dialog from "../Dialog.svelte";
  import type { Doc } from "../../lib/doc.svelte";
  import { errorText, ipc } from "../../lib/ipc";
  import { exportImages } from "../../lib/export";
  import { snapshotFile } from "../../lib/save.svelte";
  import { joinPath, parsePages, stripExt } from "../../lib/pagespec";
  import { closeDialog, toast } from "../../lib/ui.svelte";
  import { t } from "../../lib/i18n/index.svelte";

  let { doc }: { doc: Doc } = $props();
  let which = $state<"all" | "current" | "range">("all");
  let range = $state("");
  let dpi = $state(150);
  let format = $state<"png" | "jpg">("png");
  let progress = $state<string | null>(null);
  let error = $state<string | null>(null);

  const pages = $derived(
    which === "all" ? doc.pages.map((_, i) => i + 1) : which === "current" ? [doc.current + 1] : parsePages(range, doc.pages.length),
  );

  async function run() {
    if (!pages) return;
    const dir = await openFileDialog({ directory: true, multiple: false });
    if (!dir || Array.isArray(dir)) return;
    const base = stripExt(doc.name);
    const width = String(doc.pages.length).length;
    const planned = pages.map((n) => joinPath(dir, `${base}-${String(n).padStart(width, "0")}.${format}`));
    const clash = (await ipc.fileStats(planned)).find((s) => s.exists);
    if (clash) {
      error = t("split.exists", { file: clash.path });
      return;
    }
    error = null;
    progress = t("common.working");
    let snapshot: string | null = null;
    try {
      // Rendered from the document as it looks now, including annotations.
      snapshot = await snapshotFile(doc);
      const files = await exportImages(snapshot, null, {
        pages: pages.map((n) => n - 1),
        dpi,
        format,
        dir,
        base,
        onProgress: (d, total) => (progress = t("export.progress", { done: d, total })),
      });
      toast(t("export.done", { n: files.length }), "ok", { label: t("common.showInFolder"), run: () => revealItemInDir(files[0]) });
      closeDialog(files);
    } catch (e) {
      error = errorText(e);
    } finally {
      progress = null;
      if (snapshot) ipc.discardTemp(snapshot).catch(() => {});
    }
  }
</script>

<Dialog title={t("export.title")} width={440}>
  <div class="form-row">
    <span>{t("export.pages")}</span>
    <div class="choice">
      <label class="row"><input type="radio" bind:group={which} value="all" />{t("export.all")}</label>
      <label class="row"><input type="radio" bind:group={which} value="current" />{t("export.current")}</label>
      <label class="row"><input type="radio" bind:group={which} value="range" />{t("export.range")}</label>
    </div>
  </div>
  {#if which === "range"}<input class="field" placeholder="1-3, 5" bind:value={range} />{/if}
  <label class="form-row">
    <span>{t("export.quality")}</span>
    <select class="field" bind:value={dpi}>
      <option value={72}>72 DPI · {t("export.screen")}</option>
      <option value={150}>150 DPI · {t("export.standard")}</option>
      <option value={300}>300 DPI · {t("export.print")}</option>
    </select>
  </label>
  <label class="form-row">
    <span>{t("export.format")}</span>
    <select class="field" bind:value={format}>
      <option value="png">PNG</option>
      <option value="jpg">JPEG</option>
    </select>
  </label>
  {#if !pages}<p class="error-text">{t("split.invalid")}</p>{/if}
  {#if progress}<p class="note">{progress}</p>{/if}
  {#if error}<p class="error-text">{error}</p>{/if}
  {#snippet footer()}
    <button class="btn" onclick={() => closeDialog(null)}>{t("common.cancel")}</button>
    <button class="btn primary" disabled={!pages || !!progress} onclick={run}>{t("export.run")}</button>
  {/snippet}
</Dialog>
