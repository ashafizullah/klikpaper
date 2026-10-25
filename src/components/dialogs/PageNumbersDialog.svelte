<script lang="ts">
  import { untrack } from "svelte";
  import Dialog from "../Dialog.svelte";
  import type { Corner, Doc } from "../../lib/doc.svelte";
  import { pageLabel } from "../../lib/layout";
  import { closeDialog } from "../../lib/ui.svelte";
  import { t } from "../../lib/i18n/index.svelte";

  let { doc }: { doc: Doc } = $props();
  const start0 = untrack(() => doc.pageNumbers) ?? { format: "{n}", position: "bottom-center" as Corner, start: 1, size: 10, margin: 28, color: "#1b1916" };
  let format = $state(start0.format);
  let position = $state<Corner>(start0.position);
  let start = $state(start0.start);
  let size = $state(start0.size);
  let margin = $state(start0.margin);

  const PRESETS = ["{n}", "{n} / {total}", t("pageNumbers.presetPage"), "- {n} -"];
  const POSITIONS: Corner[] = ["top-left", "top-center", "top-right", "bottom-left", "bottom-center", "bottom-right"];
  const preview = $derived(pageLabel({ format, position, start, size, margin, color: "#000" }, 0, doc.pages.length));

  function apply() {
    doc.change(() => (doc.pageNumbers = format.trim() ? { format, position, start, size, margin, color: start0.color } : null));
    closeDialog(true);
  }

  function remove() {
    doc.change(() => (doc.pageNumbers = null));
    closeDialog(true);
  }
</script>

<Dialog title={t("pageNumbers.title")} width={460}>
  <label class="form-row">
    <span>{t("pageNumbers.format")}</span>
    <input class="field" bind:value={format} list="pn-presets" />
    <datalist id="pn-presets">{#each PRESETS as p (p)}<option value={p}></option>{/each}</datalist>
  </label>
  <p class="note">{t("pageNumbers.formatHint")} → <strong>{preview}</strong></p>
  <div class="form-row">
    <span>{t("pageNumbers.position")}</span>
    <div class="grid">
      {#each POSITIONS as p (p)}
        <button class="pos" class:on={position === p} onclick={() => (position = p)} aria-label={p} title={p}><span class="mark {p}"></span></button>
      {/each}
    </div>
  </div>
  <label class="form-row"><span>{t("pageNumbers.start")}</span><input class="field" type="number" min="0" bind:value={start} /></label>
  <label class="form-row"><span>{t("pageNumbers.size")}</span><input class="field" type="number" min="6" max="36" bind:value={size} /></label>
  <label class="form-row"><span>{t("pageNumbers.margin")}</span><input class="field" type="number" min="6" max="100" bind:value={margin} /></label>
  {#snippet footer()}
    {#if doc.pageNumbers}<button class="btn danger" onclick={remove}>{t("common.remove")}</button><span style="flex:1"></span>{/if}
    <button class="btn" onclick={() => closeDialog(null)}>{t("common.cancel")}</button>
    <button class="btn primary" disabled={!format.trim()} onclick={apply}>{t("common.apply")}</button>
  {/snippet}
</Dialog>

<style>
  .grid {
    display: grid;
    grid-template-columns: repeat(3, 44px);
    gap: 4px;
  }
  .pos {
    height: 34px;
    border: 1px solid var(--border);
    background: var(--bg);
    border-radius: 6px;
    position: relative;
  }
  .pos.on {
    border-color: var(--accent);
    background: var(--selection);
  }
  .mark {
    position: absolute;
    width: 10px;
    height: 3px;
    background: var(--text);
    border-radius: 2px;
  }
  .mark[class*="top"] {
    top: 6px;
  }
  .mark[class*="bottom"] {
    bottom: 6px;
  }
  .mark[class*="left"] {
    left: 6px;
  }
  .mark[class*="right"] {
    right: 6px;
  }
  .mark[class*="center"] {
    left: calc(50% - 5px);
  }
</style>
