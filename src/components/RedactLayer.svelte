<script lang="ts">
  // Areas marked for redaction on one page, and the Redact tool that draws
  // them. Until the document is saved they are only marks (shaded, so what
  // they cover can still be checked); saving removes that content for good.
  import type { Doc, PageItem, Redaction } from "../lib/doc.svelte";
  import { displayToPage, layerTransform, normRect, type Rect, type Rotation } from "../lib/geometry";
  import { newId } from "../lib/settings.svelte";
  import { padForRedaction, selectionRects } from "../lib/selection";
  import { isMac, ui } from "../lib/ui.svelte";
  import { openMenu } from "../lib/contextmenu.svelte";
  import { t } from "../lib/i18n/index.svelte";

  let { doc, page, scale, rotation, pageEl }: { doc: Doc; page: PageItem; scale: number; rotation: Rotation; pageEl: HTMLDivElement } = $props();

  const marks = $derived(doc.redactions.filter((r) => r.page === page.id));
  let start: [number, number] | null = null;
  let draft = $state<Rect | null>(null);

  function toPage(e: { clientX: number; clientY: number }): [number, number] {
    const r = pageEl.getBoundingClientRect();
    const [x, y] = displayToPage((e.clientX - r.left) / scale, (e.clientY - r.top) / scale, rotation, page.w, page.h);
    return [Math.max(0, Math.min(page.w, x)), Math.max(0, Math.min(page.h, y))];
  }

  function onDown(e: PointerEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    doc.selectedRedaction = null;
    start = toPage(e);
    draft = { x: start[0], y: start[1], w: 0, h: 0 };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onMove(e: PointerEvent) {
    if (!start) return;
    const [x, y] = toPage(e);
    draft = normRect(start[0], start[1], x, y);
  }

  function onUp() {
    const d = draft;
    draft = null;
    start = null;
    if (!d || d.w < 3 || d.h < 3) return;
    const mark: Redaction = { id: newId("x"), page: page.id, rects: [d] };
    doc.addRedactions([mark]);
    doc.selectedRedaction = mark.id;
  }

  // "Redact" on selected text: every page marks its part of the selection.
  $effect(() => {
    const onRedact = () => {
      const rects = selectionRects(pageEl, page, scale, rotation);
      if (!rects.length) return;
      doc.addRedactions([{ id: newId("x"), page: page.id, rects: rects.map(padForRedaction) }]);
      setTimeout(() => window.getSelection()?.removeAllRanges(), 0);
    };
    window.addEventListener("klikpaper:redact", onRedact);
    return () => window.removeEventListener("klikpaper:redact", onRedact);
  });

  function onMarkDown(e: PointerEvent, r: Redaction) {
    if (ui.tool !== "select" || e.button !== 0) return;
    e.stopPropagation();
    doc.selectedOverlay = null;
    doc.selectedRedaction = r.id;
  }

  function onMarkMenu(e: MouseEvent, r: Redaction) {
    doc.selectedRedaction = r.id;
    openMenu(e, [
      { label: t("redact.remove"), icon: "trash", shortcut: isMac ? "⌫" : "Del", danger: true, run: () => doc.removeRedactions([r.id]) },
      marks.length > 1 && { label: t("redact.removePage"), icon: "trash", danger: true, run: () => doc.removeRedactions(marks.map((m) => m.id)) },
    ]);
  }
</script>

{#if marks.length || draft}
  <div class="layer" style:width="{page.w * scale}px" style:height="{page.h * scale}px" style:transform={layerTransform(rotation, page.w, page.h, scale)}>
    <svg width={page.w * scale} height={page.h * scale} viewBox="0 0 {page.w} {page.h}">
      {#each marks as r (r.id)}
        <g
          class="mark"
          class:live={ui.tool === "select"}
          class:selected={doc.selectedRedaction === r.id}
          role="button"
          tabindex="-1"
          onpointerdown={(e) => onMarkDown(e, r)}
          oncontextmenu={(e) => onMarkMenu(e, r)}
        >
          <title>{t("redact.mark")}</title>
          {#each r.rects as q, i (i)}
            <rect x={q.x} y={q.y} width={q.w} height={q.h} />
          {/each}
        </g>
      {/each}
      {#if draft}
        <rect class="draft" x={draft.x} y={draft.y} width={draft.w} height={draft.h} />
      {/if}
    </svg>
  </div>
{/if}

{#if ui.tool === "redact"}
  <div class="surface" role="application" onpointerdown={onDown} onpointermove={onMove} onpointerup={onUp}></div>
{/if}

<style>
  .layer {
    position: absolute;
    left: 0;
    top: 0;
    transform-origin: 0 0;
    z-index: 4;
    pointer-events: none;
  }
  svg {
    position: absolute;
    left: 0;
    top: 0;
    overflow: visible;
  }
  rect {
    fill: rgb(20 18 16 / 0.55);
    stroke: #d92d20;
    stroke-width: 1.25;
    vector-effect: non-scaling-stroke;
  }
  .mark.live {
    pointer-events: visiblePainted;
    cursor: pointer;
  }
  .mark.selected rect {
    stroke: var(--accent);
    stroke-width: 2;
    stroke-dasharray: 4 2;
  }
  .draft {
    stroke-dasharray: 4 2;
  }
  .surface {
    position: absolute;
    inset: 0;
    z-index: 5;
    cursor: crosshair;
  }
</style>
