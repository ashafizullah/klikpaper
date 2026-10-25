<script lang="ts">
  import { untrack } from "svelte";
  import Dialog from "../Dialog.svelte";
  import type { Doc } from "../../lib/doc.svelte";
  import { closeDialog } from "../../lib/ui.svelte";
  import { t } from "../../lib/i18n/index.svelte";

  let { doc }: { doc: Doc } = $props();
  const start = untrack(() => doc.watermark) ?? { text: t("watermark.default"), size: 64, opacity: 0.18, color: "#7a7a7a", angle: 45 };
  let text = $state(start.text);
  let size = $state(start.size);
  let opacity = $state(start.opacity);
  let color = $state(start.color);
  let angle = $state(start.angle);

  function apply() {
    doc.change(() => (doc.watermark = text.trim() ? { text, size, opacity, color, angle } : null));
    closeDialog(true);
  }

  function remove() {
    doc.change(() => (doc.watermark = null));
    closeDialog(true);
  }
</script>

<Dialog title={t("watermark.title")} width={440}>
  <label class="form-row"><span>{t("watermark.text")}</span><input class="field" bind:value={text} /></label>
  <label class="form-row"><span>{t("watermark.size")}</span><input type="range" min="16" max="160" bind:value={size} /></label>
  <label class="form-row"><span>{t("watermark.opacity")}</span><input type="range" min="0.05" max="0.8" step="0.01" bind:value={opacity} /></label>
  <label class="form-row">
    <span>{t("watermark.angle")}</span>
    <select class="field" bind:value={angle}>
      <option value={45}>45°</option>
      <option value={0}>0°</option>
      <option value={-45}>-45°</option>
      <option value={90}>90°</option>
    </select>
  </label>
  <label class="form-row"><span>{t("watermark.color")}</span><input type="color" bind:value={color} /></label>
  <p class="note">{t("watermark.note")}</p>
  {#snippet footer()}
    {#if doc.watermark}<button class="btn danger" onclick={remove}>{t("common.remove")}</button><span style="flex:1"></span>{/if}
    <button class="btn" onclick={() => closeDialog(null)}>{t("common.cancel")}</button>
    <button class="btn primary" disabled={!text.trim()} onclick={apply}>{t("common.apply")}</button>
  {/snippet}
</Dialog>
