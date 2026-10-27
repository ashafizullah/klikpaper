<script lang="ts">
  // Resize pages: put them on another paper size. The content is scaled to fit
  // inside the margin (never stretched) and centered; the change shows at once,
  // can be undone and is written when the document is saved.
  import Dialog from "../Dialog.svelte";
  import type { Doc } from "../../lib/doc.svelte";
  import { mmToPt, sheetFor, type PaperOrientation, type PaperSize } from "../../lib/paper";
  import { closeDialog, toast } from "../../lib/ui.svelte";
  import { t } from "../../lib/i18n/index.svelte";

  let { doc }: { doc: Doc } = $props();

  const SIZES: { id: PaperSize; label: string; dims: string }[] = [
    { id: "a4", label: "A4", dims: "210 × 297 mm" },
    { id: "letter", label: "Letter", dims: "8.5 × 11 in" },
    { id: "legal", label: "Legal", dims: "8.5 × 14 in" },
    { id: "a3", label: "A3", dims: "297 × 420 mm" },
    { id: "a5", label: "A5", dims: "148 × 210 mm" },
  ];
  const ORIENTATIONS: { id: PaperOrientation; label: "resize.auto" | "resize.portrait" | "resize.landscape" }[] = [
    { id: "auto", label: "resize.auto" },
    { id: "portrait", label: "resize.portrait" },
    { id: "landscape", label: "resize.landscape" },
  ];

  // The selection when the dialog opens; it can't change while it is open.
  // svelte-ignore state_referenced_locally
  const selected = doc.selectedPages.filter((id) => doc.pages.some((p) => p.id === id));
  let size = $state<PaperSize | "original">("a4");
  let orientation = $state<PaperOrientation>("auto");
  let marginMm = $state(0);
  // svelte-ignore state_referenced_locally
  let scope = $state<"all" | "selected">(selected.length && selected.length < doc.pages.length ? "selected" : "all");

  function apply() {
    const ids = scope === "selected" ? selected : doc.pages.map((p) => p.id);
    const margin = mmToPt(Math.min(50, Math.max(0, Number(marginMm) || 0)));
    const paper = size;
    doc.resizePages(ids, (p) => (paper === "original" ? undefined : sheetFor(p.w, p.h, doc.rotation(p), paper, orientation, margin)));
    const label = SIZES.find((s) => s.id === paper)?.label ?? "";
    toast(paper === "original" ? t("resize.doneOriginal", { n: ids.length }) : t("resize.done", { n: ids.length, size: label }), "ok");
    closeDialog(true);
  }
</script>

<Dialog title={t("resize.title")} width={480}>
  <div class="sizes" role="radiogroup" aria-label={t("resize.size")}>
    {#each SIZES as s (s.id)}
      <button class="size" class:on={size === s.id} role="radio" aria-checked={size === s.id} onclick={() => (size = s.id)}>
        <strong>{s.label}</strong><span>{s.dims}</span>
      </button>
    {/each}
    <button class="size" class:on={size === "original"} role="radio" aria-checked={size === "original"} onclick={() => (size = "original")}>
      <strong>{t("resize.original")}</strong><span>{t("resize.originalHint")}</span>
    </button>
  </div>

  {#if size !== "original"}
    <div class="form-row">
      <span>{t("resize.orientation")}</span>
      <div class="segmented" role="radiogroup" aria-label={t("resize.orientation")}>
        {#each ORIENTATIONS as o (o.id)}
          <button class:on={orientation === o.id} role="radio" aria-checked={orientation === o.id} onclick={() => (orientation = o.id)}>{t(o.label)}</button>
        {/each}
      </div>
    </div>
    <label class="form-row">
      <span>{t("resize.margin")}</span>
      <span class="margin"><input class="field" type="number" min="0" max="50" step="1" bind:value={marginMm} /> mm</span>
    </label>
  {/if}

  {#if selected.length && selected.length < doc.pages.length}
    <div class="form-row">
      <span>{t("resize.pages")}</span>
      <div class="segmented" role="radiogroup" aria-label={t("resize.pages")}>
        <button class:on={scope === "all"} role="radio" aria-checked={scope === "all"} onclick={() => (scope = "all")}>{t("resize.allPages", { n: doc.pages.length })}</button>
        <button class:on={scope === "selected"} role="radio" aria-checked={scope === "selected"} onclick={() => (scope = "selected")}>{t("resize.selectedPages", { n: selected.length })}</button>
      </div>
    </div>
  {/if}

  <p class="note">{t(size === "original" ? "resize.noteOriginal" : "resize.note")}</p>

  {#snippet footer()}
    <button class="btn" onclick={() => closeDialog(null)}>{t("common.cancel")}</button>
    <button class="btn primary" onclick={apply}>{t("common.apply")}</button>
  {/snippet}
</Dialog>

<style>
  .sizes {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 6px;
  }
  .size {
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: none;
    text-align: left;
    color: var(--text);
  }
  .size strong {
    font-size: 13px;
  }
  .size span {
    font: 10.5px var(--mono);
    color: var(--muted);
  }
  .size.on {
    border-color: var(--accent);
    background: var(--selection);
  }
  .segmented {
    display: flex;
    gap: 2px;
    padding: 2px;
    border: 1px solid var(--line);
    border-radius: 8px;
    width: fit-content;
  }
  .segmented button {
    padding: 5px 10px;
    border: none;
    border-radius: 6px;
    background: none;
    color: var(--muted);
    font-size: 12px;
  }
  .segmented button.on {
    background: var(--panel-2);
    color: var(--text);
  }
  .margin {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--muted);
  }
  .margin input {
    width: 72px;
  }
</style>
