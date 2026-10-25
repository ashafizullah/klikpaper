<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { save as saveFileDialog } from "@tauri-apps/plugin-dialog";
  import Dialog from "../Dialog.svelte";
  import type { Doc } from "../../lib/doc.svelte";
  import { errorText, ipc, type CompressLevel } from "../../lib/ipc";
  import { writePdf, defaultName } from "../../lib/save.svelte";
  import { baseName, formatBytes } from "../../lib/pagespec";
  import { closeDialog, toast } from "../../lib/ui.svelte";
  import { PDF_FILTER } from "../../lib/workspace.svelte";
  import { t } from "../../lib/i18n/index.svelte";

  let { doc }: { doc: Doc } = $props();
  let level = $state<CompressLevel>("medium");
  let working = $state(false);
  let result = $state<{ path: string; bytes: number; images: number; level: CompressLevel } | null>(null);
  let before = $state<number | null>(null);
  let error = $state<string | null>(null);

  onMount(() => {
    if (doc.path && !doc.dirty) ipc.fileStats([doc.path]).then(([s]) => (before = s.exists ? s.bytes : null));
  });

  function discard() {
    if (result) ipc.discardTemp(result.path).catch(() => {});
    result = null;
  }
  onDestroy(discard);

  async function run() {
    discard();
    working = true;
    error = null;
    try {
      const path = await ipc.tempFile("pdf");
      const res = await writePdf(doc, path, { compress: level });
      result = { path, bytes: res.bytes, images: res.images, level };
    } catch (e) {
      error = errorText(e);
    } finally {
      working = false;
    }
  }

  async function saveResult() {
    if (!result) return;
    const chosen = await saveFileDialog({ defaultPath: defaultName(doc, "-compressed"), filters: PDF_FILTER });
    if (!chosen) return;
    const target = chosen.toLowerCase().endsWith(".pdf") ? chosen : `${chosen}.pdf`;
    try {
      await ipc.moveFile(result.path, target);
      result = null;
      toast(t("save.saved", { file: baseName(target) }), "ok");
      closeDialog(target);
    } catch (e) {
      error = errorText(e);
    }
  }

  const LEVELS: { id: CompressLevel; label: "compress.low" | "compress.medium" | "compress.high"; hint: "compress.lowHint" | "compress.mediumHint" | "compress.highHint" }[] = [
    { id: "low", label: "compress.low", hint: "compress.lowHint" },
    { id: "medium", label: "compress.medium", hint: "compress.mediumHint" },
    { id: "high", label: "compress.high", hint: "compress.highHint" },
  ];
</script>

<Dialog title={t("compress.title")} width={460}>
  <div class="levels">
    {#each LEVELS as l (l.id)}
      <label class="level" class:on={level === l.id}>
        <input type="radio" name="level" value={l.id} bind:group={level} onchange={discard} />
        <span><strong>{t(l.label)}</strong><span class="note">{t(l.hint)}</span></span>
      </label>
    {/each}
  </div>
  {#if before != null}<p class="note">{t("compress.current", { size: formatBytes(before) })}</p>{/if}
  {#if result}
    <div class="result">
      <strong>{formatBytes(result.bytes)}</strong>
      {#if before != null}
        <span class:good={result.bytes < before}>
          {result.bytes < before ? t("compress.smaller", { pct: Math.round((1 - result.bytes / before) * 100) }) : t("compress.notSmaller")}
        </span>
      {/if}
      <span class="note">{t("compress.images", { n: result.images })}</span>
    </div>
  {/if}
  {#if error}<p class="error-text">{error}</p>{/if}
  <p class="note">{t("compress.note")}</p>
  {#snippet footer()}
    <button class="btn" onclick={() => closeDialog(null)}>{t("common.cancel")}</button>
    {#if result && result.level === level}
      <button class="btn primary" onclick={saveResult}>{t("compress.save")}</button>
    {:else}
      <button class="btn primary" disabled={working} onclick={run}>{working ? t("common.working") : t("compress.run")}</button>
    {/if}
  {/snippet}
</Dialog>

<style>
  .levels {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .level {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: 8px;
    cursor: pointer;
  }
  .level.on {
    border-color: var(--accent);
    background: var(--selection);
  }
  .level > span {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .result {
    display: flex;
    align-items: baseline;
    gap: 10px;
    flex-wrap: wrap;
    padding: 10px 12px;
    background: var(--bg);
    border-radius: 8px;
  }
  .result strong {
    font-size: 18px;
  }
  .good {
    color: var(--ok);
    font-weight: 600;
  }
</style>
