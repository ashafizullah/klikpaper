<script lang="ts">
  // Each choice is compressed to a temporary file in the background so its size shows
  // before the user decides; saving moves the chosen one into place.
  import { onDestroy, onMount } from "svelte";
  import { save as saveFileDialog } from "@tauri-apps/plugin-dialog";
  import Dialog from "../Dialog.svelte";
  import Icon from "../Icon.svelte";
  import type { Doc } from "../../lib/doc.svelte";
  import { errorText, ipc, type CompressLevel, type Compression } from "../../lib/ipc";
  import { writePdf, defaultName } from "../../lib/save.svelte";
  import { baseName, formatBytes } from "../../lib/pagespec";
  import { closeDialog, toast } from "../../lib/ui.svelte";
  import { PDF_FILTER } from "../../lib/workspace.svelte";
  import { t } from "../../lib/i18n/index.svelte";

  let { doc }: { doc: Doc } = $props();

  interface Result {
    path: string;
    bytes: number;
    images: number;
  }

  const PRESETS: { id: CompressLevel; label: "compress.low" | "compress.medium" | "compress.high"; hint: "compress.lowHint" | "compress.mediumHint" | "compress.highHint" }[] = [
    { id: "low", label: "compress.low", hint: "compress.lowHint" },
    { id: "medium", label: "compress.medium", hint: "compress.mediumHint" },
    { id: "high", label: "compress.high", hint: "compress.highHint" },
  ];

  let choice = $state<Compression>("medium");
  /** The slider's value; the custom choice uses it once the slider is released. */
  let custom = $state(60);
  let before = $state<number | null>(null);
  let results = $state<Record<string, Result>>({});
  let errors = $state<Record<string, string>>({});
  let running = $state<string | null>(null);
  let queue: Compression[] = [];
  let closed = false;

  const keyOf = (c: Compression) => String(c);
  const current = $derived(results[keyOf(choice)]);

  onMount(() => {
    if (doc.path && !doc.dirty) ipc.fileStats([doc.path]).then(([s]) => (before = s.exists ? s.bytes : null));
    // The selected choice first, then the other presets.
    want(choice);
    for (const p of PRESETS) want(p.id);
  });

  onDestroy(() => {
    closed = true;
    for (const r of Object.values(results)) ipc.discardTemp(r.path).catch(() => {});
  });

  /** Queues a choice for compressing (first in line when `now`), unless it is done or under way. */
  function want(c: Compression, now = false) {
    const key = keyOf(c);
    if (results[key] || errors[key] || running === key) return;
    // Only the latest custom value is worth computing.
    queue = queue.filter((q) => keyOf(q) !== key && (typeof c !== "number" || typeof q !== "number"));
    if (now) queue.unshift(c);
    else queue.push(c);
    pump();
  }

  async function pump() {
    if (running || closed) return;
    const next = queue.shift();
    if (next === undefined) return;
    const key = keyOf(next);
    running = key;
    try {
      const path = await ipc.tempFile("pdf");
      const res = await writePdf(doc, path, { compress: next });
      if (closed) ipc.discardTemp(path).catch(() => {});
      else {
        // Keep one custom result: the slider can produce many.
        if (typeof next === "number") dropCustom(key);
        results[key] = { path, bytes: res.bytes, images: res.images };
      }
    } catch (e) {
      errors[key] = errorText(e);
    } finally {
      running = null;
      pump();
    }
  }

  function dropCustom(except: string) {
    for (const [key, r] of Object.entries(results)) {
      if (key === except || PRESETS.some((p) => p.id === key)) continue;
      ipc.discardTemp(r.path).catch(() => {});
      delete results[key];
    }
  }

  function choose(c: Compression) {
    choice = c;
    want(c, true);
  }

  async function saveResult() {
    const result = current;
    if (!result) return;
    const chosen = await saveFileDialog({ defaultPath: defaultName(doc, "-compressed"), filters: PDF_FILTER });
    if (!chosen) return;
    const target = chosen.toLowerCase().endsWith(".pdf") ? chosen : `${chosen}.pdf`;
    try {
      await ipc.moveFile(result.path, target);
      delete results[keyOf(choice)];
      toast(t("save.saved", { file: baseName(target) }), "ok");
      closeDialog(target);
    } catch (e) {
      errors[keyOf(choice)] = errorText(e);
    }
  }

  function smaller(r: Result): number | null {
    return before == null ? null : Math.round((1 - r.bytes / before) * 100);
  }
</script>

{#snippet size(c: Compression)}
  {@const key = keyOf(c)}
  {@const r = results[key]}
  <span class="size">
    {#if r}
      <strong>{formatBytes(r.bytes)}</strong>
      {#if smaller(r) != null}
        {@const pct = smaller(r)!}
        <span class:good={pct > 0}>{pct > 0 ? `−${pct}%` : t("compress.same")}</span>
      {/if}
    {:else if errors[key]}
      <span class="error-text">{t("compress.failed")}</span>
    {:else}
      <span class="muted"><Icon name="loader" size={12} class="spin" />{t("compress.measuring")}</span>
    {/if}
  </span>
{/snippet}

<Dialog title={t("compress.title")} width={500}>
  <div class="levels">
    {#each PRESETS as p (p.id)}
      <label class="level" class:on={choice === p.id}>
        <input type="radio" name="level" checked={choice === p.id} onchange={() => choose(p.id)} />
        <span class="text"><strong>{t(p.label)}</strong><span class="note">{t(p.hint)}</span></span>
        {@render size(p.id)}
      </label>
    {/each}
    <label class="level" class:on={typeof choice === "number"}>
      <input type="radio" name="level" checked={typeof choice === "number"} onchange={() => choose(custom)} />
      <span class="text">
        <strong>{t("compress.custom")}</strong>
        <span class="slider">
          <span class="note">{t("compress.smallest")}</span>
          <input
            type="range"
            min="10"
            max="100"
            step="5"
            bind:value={custom}
            onchange={() => choose(custom)}
            aria-label={t("compress.quality")}
          />
          <span class="note">{t("compress.best")}</span>
        </span>
        <span class="note">{t("compress.qualityValue", { n: custom })}</span>
      </span>
      {#if typeof choice === "number"}{@render size(choice)}{/if}
    </label>
  </div>
  {#if before != null}<p class="note">{t("compress.current", { size: formatBytes(before) })}</p>{/if}
  {#if current}
    <p class="note">
      {current.images ? t("compress.images", { n: current.images }) : t("compress.noImages")}
    </p>
  {/if}
  {#if errors[keyOf(choice)]}<p class="error-text">{errors[keyOf(choice)]}</p>{/if}
  <p class="note">{t("compress.note")}</p>
  {#snippet footer()}
    <button class="btn" onclick={() => closeDialog(null)}>{t("common.cancel")}</button>
    <button class="btn primary" disabled={!current} onclick={saveResult}>{current ? t("compress.save") : t("common.working")}</button>
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
  .text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .size {
    flex: none;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 2px;
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .size strong {
    font-size: 14px;
  }
  .size .muted {
    display: flex;
    align-items: center;
    gap: 5px;
  }
  .slider {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 4px;
  }
  .slider input {
    flex: 1;
    accent-color: var(--accent);
  }
  .good {
    color: var(--ok);
    font-weight: 600;
  }
</style>
