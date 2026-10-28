<script lang="ts">
  import { onDestroy } from "svelte";
  import Dialog from "../Dialog.svelte";
  import type { Doc, PageItem } from "../../lib/doc.svelte";
  import { errorText } from "../../lib/ipc";
  import { needsOcr, recognize, type OcrProgress } from "../../lib/ocr";
  import { closeDialog, toast } from "../../lib/ui.svelte";
  import { t } from "../../lib/i18n/index.svelte";

  let { doc, which: initial = "scans" }: { doc: Doc; which?: "scans" | "current" | "selected" | "all" } = $props();
  // The choice starts from the one asked for; later changes are the user's.
  // svelte-ignore state_referenced_locally
  let which = $state(initial);
  let scans = $state<PageItem[] | null>(null);
  let progress = $state<OcrProgress | null>(null);
  let starting = $state(false);
  let error = $state<string | null>(null);
  let cancelled = false;

  // Which pages have no text of their own.
  (async () => {
    const found: PageItem[] = [];
    for (const p of doc.pages) if (await needsOcr(doc, p)) found.push(p);
    scans = found;
    if (initial === "scans" && !found.length) which = "current";
  })();

  const selected = $derived(doc.pages.filter((p) => doc.selectedPages.includes(p.id)));
  const pages = $derived(
    which === "scans" ? (scans ?? []) : which === "current" ? (doc.pages[doc.current] ? [doc.pages[doc.current]] : []) : which === "selected" ? selected : doc.pages,
  );

  async function run() {
    error = null;
    starting = true;
    try {
      const result = await recognize(doc, pages, (p) => ((progress = p), (starting = false)), () => cancelled);
      if (cancelled && !result.pages) return closeDialog(null);
      toast(result.pages ? t("ocr.done", { n: result.pages, words: result.words }) : t("ocr.nothing"), result.pages ? "ok" : "info", undefined, 7000);
      closeDialog(result);
    } catch (e) {
      error = errorText(e);
    } finally {
      progress = null;
      starting = false;
    }
  }

  // Closing the dialog stops after the page being read.
  onDestroy(() => (cancelled = true));
</script>

<Dialog title={t("ocr.title")} width={460}>
  <p class="note">{t("ocr.intro")}</p>
  <div class="form-row">
    <span>{t("ocr.pages")}</span>
    <div class="choice">
      <label class="row">
        <input type="radio" bind:group={which} value="scans" disabled={!scans?.length} />
        {scans ? t("ocr.scans", { n: scans.length }) : t("ocr.checking")}
      </label>
      <label class="row"><input type="radio" bind:group={which} value="current" />{t("ocr.current", { n: doc.current + 1 })}</label>
      {#if selected.length > 1}
        <label class="row"><input type="radio" bind:group={which} value="selected" />{t("ocr.selected", { n: selected.length })}</label>
      {/if}
      <label class="row"><input type="radio" bind:group={which} value="all" />{t("ocr.all", { n: doc.pages.length })}</label>
    </div>
  </div>
  {#if which !== "scans" && scans && pages.some((p) => !scans!.includes(p))}
    <p class="note">{t("ocr.hasText")}</p>
  {/if}
  <p class="note muted">{t("ocr.language")}</p>
  {#if starting}
    <p class="note">{t("ocr.starting")}</p>
  {:else if progress}
    <div class="progress" role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done}>
      <div class="bar" style:width="{(progress.done / Math.max(1, progress.total)) * 100}%"></div>
    </div>
    <p class="note">{t("ocr.progress", { i: Math.min(progress.done + 1, progress.total), n: progress.total })}</p>
  {/if}
  {#if error}<p class="error-text">{error}</p>{/if}
  {#snippet footer()}
    <button
      class="btn"
      onclick={() => {
        cancelled = true;
        if (!progress && !starting) closeDialog(null);
      }}>{t("common.cancel")}</button
    >
    <button class="btn primary" disabled={!pages.length || !!progress || starting} onclick={run}>{t("ocr.run")}</button>
  {/snippet}
</Dialog>

<style>
  .progress {
    height: 6px;
    border-radius: 999px;
    background: var(--line);
    overflow: hidden;
  }
  .bar {
    height: 100%;
    background: var(--accent);
    transition: width 0.2s;
  }
</style>
