<script lang="ts">
  // Resize pages: put them on another paper size. The content is scaled to fit
  // inside the margin (never stretched) and centered; the change shows at once,
  // can be undone and is written when the document is saved. A preview of one
  // page on the chosen paper follows every choice before it is applied.
  import Dialog from "../Dialog.svelte";
  import type { Doc } from "../../lib/doc.svelte";
  import { displaySize } from "../../lib/geometry";
  import { fitOnSheet, mmToPt, sheetFor, type PaperOrientation, type PaperSize } from "../../lib/paper";
  import { thumbnail } from "../../lib/thumbs";
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

  const margin = $derived(mmToPt(Math.min(50, Math.max(0, Number(marginMm) || 0))));

  // ---- preview: the page being looked at (or the first selected one) on the chosen paper ----

  const BOX_W = 210;
  const BOX_H = 250;
  const previewIndex = $derived(Math.max(0, scope === "selected" ? doc.pages.findIndex((p) => p.id === selected[0]) : Math.min(doc.current, doc.pages.length - 1)));
  const previewPage = $derived(doc.pages[previewIndex]);
  const preview = $derived.by(() => {
    const p = previewPage;
    const rot = doc.rotation(p);
    const sheet = size === "original" ? undefined : sheetFor(p.w, p.h, rot, size, orientation, margin);
    const [cw, ch] = displaySize(p.w, p.h, rot);
    const [pw, ph] = sheet ? displaySize(sheet.w, sheet.h, rot) : [cw, ch];
    const s = sheet ? fitOnSheet(p.w, p.h, sheet).s : 1;
    const k = Math.min(BOX_W / pw, BOX_H / ph);
    return {
      paper: [pw * k, ph * k],
      content: [cw * s * k, ch * s * k],
      margin: sheet ? Math.min(sheet.margin, Math.min(sheet.w, sheet.h) / 3) * k : 0,
      percent: Math.round(s * 100),
      mm: [pw, ph].map((v) => Math.round((v / 72) * 25.4)),
    };
  });
  let src = $state("");
  $effect(() => {
    const p = previewPage;
    let live = true;
    thumbnail(doc, p)
      .then((url) => live && (src = url))
      .catch(() => {});
    return () => {
      live = false;
    };
  });

  function apply() {
    const ids = scope === "selected" ? selected : doc.pages.map((p) => p.id);
    const paper = size;
    doc.resizePages(ids, (p) => (paper === "original" ? undefined : sheetFor(p.w, p.h, doc.rotation(p), paper, orientation, margin)));
    const label = SIZES.find((s) => s.id === paper)?.label ?? "";
    toast(paper === "original" ? t("resize.doneOriginal", { n: ids.length }) : t("resize.done", { n: ids.length, size: label }), "ok");
    closeDialog(true);
  }
</script>

<Dialog title={t("resize.title")} width={700}>
  <div class="cols">
    <div class="controls">
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
    </div>

    <figure class="preview" aria-label={t("resize.preview")}>
      <div class="stage">
        <div class="paper" style:width="{preview.paper[0]}px" style:height="{preview.paper[1]}px">
          {#if src}
            <img {src} alt="" style:width="{preview.content[0]}px" style:height="{preview.content[1]}px" />
          {/if}
          {#if preview.margin > 0.5}
            <div class="guide" style:inset="{preview.margin}px"></div>
          {/if}
        </div>
      </div>
      <figcaption>
        <strong>{preview.mm[0]} × {preview.mm[1]} mm</strong>
        <span>{t("resize.contentScale", { pct: preview.percent })} · {t("resize.previewPage", { n: previewIndex + 1 })}</span>
      </figcaption>
    </figure>
  </div>

  {#snippet footer()}
    <button class="btn" onclick={() => closeDialog(null)}>{t("common.cancel")}</button>
    <button class="btn primary" onclick={apply}>{t("common.apply")}</button>
  {/snippet}
</Dialog>

<style>
  .cols {
    display: grid;
    grid-template-columns: 1fr 230px;
    gap: 18px;
    align-items: start;
  }
  .controls {
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-width: 0;
  }
  .preview {
    margin: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
  }
  .stage {
    width: 230px;
    height: 270px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 8px;
    background-color: #13110d;
    background-image: radial-gradient(#2a251d 1px, transparent 1px);
    background-size: 14px 14px;
  }
  .paper {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #fff;
    box-shadow: 0 6px 18px rgb(0 0 0 / 0.55);
    transition:
      width 0.18s ease,
      height 0.18s ease;
  }
  .paper img {
    display: block;
    transition:
      width 0.18s ease,
      height 0.18s ease;
  }
  .guide {
    position: absolute;
    border: 1px dashed color-mix(in srgb, var(--accent) 80%, transparent);
    pointer-events: none;
  }
  figcaption {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    font: 11px var(--mono);
    color: var(--muted);
    text-align: center;
  }
  figcaption strong {
    font: 500 12px var(--mono);
    color: var(--text);
  }
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
