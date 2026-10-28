<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import Dialog from "../Dialog.svelte";
  import type { Doc, PageItem } from "../../lib/doc.svelte";
  import { errorText } from "../../lib/ipc";
  import { cleanScans, isScan, pagesWithMarks } from "../../lib/scan";
  import { closeDialog, toast } from "../../lib/ui.svelte";
  import { t } from "../../lib/i18n/index.svelte";

  let { doc }: { doc: Doc } = $props();
  let which = $state<"scans" | "current" | "selected" | "all">("scans");
  let scans = $state<PageItem[] | null>(null);
  let deskew = $state(true);
  let borders = $state(true);
  let blackWhite = $state(true);
  let ocr = $state(true);
  let progress = $state<{ done: number; total: number } | null>(null);
  let error = $state<string | null>(null);
  let cancelled = false;
  onDestroy(() => (cancelled = true));

  onMount(async () => {
    const found: PageItem[] = [];
    for (const p of doc.pages) if (await isScan(await doc.pdfPage(p)).catch(() => false)) found.push(p);
    scans = found;
    if (!found.length) which = "current";
  });

  const selected = $derived(doc.pages.filter((p) => doc.selectedPages.includes(p.id)));
  const chosen = $derived(
    which === "scans" ? (scans ?? []) : which === "current" ? (doc.pages[doc.current] ? [doc.pages[doc.current]] : []) : which === "selected" ? selected : doc.pages,
  );
  // Pages with marks not saved yet are left out: straightening would move the picture from under them.
  const marked = $derived(pagesWithMarks(doc, chosen));
  const pages = $derived(chosen.filter((p) => !marked.includes(p)));

  async function run() {
    error = null;
    progress = { done: 0, total: pages.length };
    try {
      const r = await cleanScans(doc, pages, { deskew, borders, blackWhite, ocr }, (done, total) => (progress = { done, total }), () => cancelled);
      const tilted = r.straightened.filter((a) => a !== 0);
      const avg = tilted.length ? (tilted.reduce((s, a) => s + Math.abs(a), 0) / tilted.length).toFixed(1) : null;
      toast(
        [t("clean.done", { n: r.pages }), avg ? t("clean.doneStraight", { n: tilted.length, deg: avg }) : "", r.recognized ? t("clean.doneOcr", { n: r.recognized }) : ""].filter(Boolean).join(" "),
        "ok",
        undefined,
        8000,
      );
      closeDialog(r);
    } catch (e) {
      error = errorText(e);
    } finally {
      progress = null;
    }
  }
</script>

<Dialog title={t("clean.title")} width={480}>
  <p class="note">{t("clean.intro")}</p>
  <div class="form-row">
    <span>{t("ocr.pages")}</span>
    <div class="choice">
      <label class="row"><input type="radio" bind:group={which} value="scans" disabled={!scans?.length} />{scans ? t("clean.scans", { n: scans.length }) : t("ocr.checking")}</label>
      <label class="row"><input type="radio" bind:group={which} value="current" />{t("ocr.current", { n: doc.current + 1 })}</label>
      {#if selected.length > 1}<label class="row"><input type="radio" bind:group={which} value="selected" />{t("ocr.selected", { n: selected.length })}</label>{/if}
      <label class="row"><input type="radio" bind:group={which} value="all" />{t("ocr.all", { n: doc.pages.length })}</label>
    </div>
  </div>
  <div class="opts">
    <label class="row"><input type="checkbox" bind:checked={deskew} />{t("clean.deskew")}</label>
    <label class="row"><input type="checkbox" bind:checked={borders} />{t("clean.borders")}</label>
    <label class="row"><input type="checkbox" bind:checked={blackWhite} />{t("clean.blackWhite")}</label>
    {#if blackWhite}<p class="hint">{t("clean.blackWhiteHint")}</p>{/if}
    <label class="row"><input type="checkbox" bind:checked={ocr} />{t("clean.ocr")}</label>
  </div>
  {#if marked.length}<p class="warn">{t("clean.marked", { pages: marked.map((p) => doc.pages.indexOf(p) + 1).join(", ") })}</p>{/if}
  <p class="note muted">{t("clean.undo")}</p>
  {#if progress}
    <div class="progress"><div class="bar" style:width="{(progress.done / Math.max(1, progress.total)) * 100}%"></div></div>
    <p class="note">{t("clean.progress", { i: Math.min(progress.done + 1, progress.total), n: progress.total })}</p>
  {/if}
  {#if error}<p class="error-text">{error}</p>{/if}
  {#snippet footer()}
    <button
      class="btn"
      onclick={() => {
        cancelled = true;
        if (!progress) closeDialog(null);
      }}>{t("common.cancel")}</button
    >
    <button class="btn primary" disabled={!pages.length || !!progress || !(deskew || borders || blackWhite)} onclick={run}>{t("clean.run", { n: pages.length })}</button>
  {/snippet}
</Dialog>

<style>
  .opts {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 12.5px;
  }
  .warn {
    margin: 0;
    font-size: 12px;
    color: var(--accent);
  }
  .hint {
    margin: 0 0 2px 24px;
    font-size: 11.5px;
    color: var(--muted);
  }
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
