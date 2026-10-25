<script lang="ts">
  import { open as openFileDialog, save as saveFileDialog } from "@tauri-apps/plugin-dialog";
  import { untrack } from "svelte";
  import Dialog from "../Dialog.svelte";
  import Icon from "../Icon.svelte";
  import { errorText, ipc, type Orientation, type PageSize } from "../../lib/ipc";
  import { baseName, stripExt } from "../../lib/pagespec";
  import { closeDialog } from "../../lib/ui.svelte";
  import { IMAGE_FILTER, openPaths, PDF_FILTER } from "../../lib/workspace.svelte";
  import { t } from "../../lib/i18n/index.svelte";

  let { images: initial }: { images: string[] } = $props();
  let images = $state(untrack(() => [...initial]));
  let pageSize = $state<PageSize>("a4");
  let orientation = $state<Orientation>("auto");
  let margin = $state(0);
  let working = $state(false);
  let error = $state<string | null>(null);

  function move(i: number, d: number) {
    const j = i + d;
    if (j < 0 || j >= images.length) return;
    [images[i], images[j]] = [images[j], images[i]];
  }

  async function addMore() {
    const picked = await openFileDialog({ multiple: true, filters: IMAGE_FILTER });
    const paths = Array.isArray(picked) ? picked : picked ? [picked] : [];
    images = [...images, ...paths.filter((p) => !images.includes(p))];
  }

  async function run() {
    const chosen = await saveFileDialog({ defaultPath: `${stripExt(baseName(images[0] ?? "images"))}.pdf`, filters: PDF_FILTER });
    if (!chosen) return;
    const output = chosen.toLowerCase().endsWith(".pdf") ? chosen : `${chosen}.pdf`;
    working = true;
    error = null;
    try {
      await ipc.imagesToPdf({ images, output, pageSize, orientation, margin });
      closeDialog(output);
      await openPaths([output]);
    } catch (e) {
      error = errorText(e);
    } finally {
      working = false;
    }
  }
</script>

<Dialog title={t("images.title")} width={520}>
  <ol class="list">
    {#each images as img, i (img)}
      <li>
        <span class="n muted">{i + 1}</span>
        <span class="name" title={img}>{baseName(img)}</span>
        <button class="icon-btn" disabled={i === 0} onclick={() => move(i, -1)} aria-label={t("images.up")}><Icon name="up" /></button>
        <button class="icon-btn" disabled={i === images.length - 1} onclick={() => move(i, 1)} aria-label={t("images.down")}><Icon name="down" /></button>
        <button class="icon-btn" onclick={() => (images = images.filter((x) => x !== img))} aria-label={t("common.remove")}><Icon name="close" /></button>
      </li>
    {/each}
  </ol>
  <div><button class="btn" onclick={addMore}><Icon name="plus" />{t("images.add")}</button></div>
  <label class="form-row">
    <span>{t("images.pageSize")}</span>
    <select class="field" bind:value={pageSize}>
      <option value="a4">A4</option>
      <option value="letter">Letter</option>
      <option value="fit">{t("images.fit")}</option>
    </select>
  </label>
  {#if pageSize !== "fit"}
    <label class="form-row">
      <span>{t("images.orientation")}</span>
      <select class="field" bind:value={orientation}>
        <option value="auto">{t("images.auto")}</option>
        <option value="portrait">{t("images.portrait")}</option>
        <option value="landscape">{t("images.landscape")}</option>
      </select>
    </label>
  {/if}
  <label class="form-row">
    <span>{t("images.margin")}</span>
    <select class="field" bind:value={margin}>
      <option value={0}>{t("images.none")}</option>
      <option value={18}>{t("images.small")}</option>
      <option value={36}>{t("images.normal")}</option>
    </select>
  </label>
  {#if error}<p class="error-text">{error}</p>{/if}
  {#snippet footer()}
    <button class="btn" onclick={() => closeDialog(null)}>{t("common.cancel")}</button>
    <button class="btn primary" disabled={!images.length || working} onclick={run}>{working ? t("common.working") : t("images.run")}</button>
  {/snippet}
</Dialog>

<style>
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    max-height: 240px;
    overflow-y: auto;
    border: 1px solid var(--border);
    border-radius: 8px;
  }
  li {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 2px 6px 2px 10px;
    border-bottom: 1px solid var(--border);
  }
  li:last-child {
    border-bottom: none;
  }
  .n {
    width: 22px;
    font-variant-numeric: tabular-nums;
  }
  .name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
