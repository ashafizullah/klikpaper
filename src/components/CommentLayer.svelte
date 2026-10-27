<script lang="ts">
  // Comment pins on one page. With the comment tool a click places a new one
  // (written in the Comments panel); a pin can be dragged to another spot, and
  // clicking it opens its thread. Pins stay upright and the same size at any
  // zoom, like notes in other PDF readers.
  import type { Doc, PageItem } from "../lib/doc.svelte";
  import { displayToPage, pageToDisplay, type Rotation } from "../lib/geometry";
  import { sortedThreads } from "../lib/comments.svelte";
  import { persist, settings } from "../lib/settings.svelte";
  import { ui } from "../lib/ui.svelte";
  import { t } from "../lib/i18n/index.svelte";
  import Icon from "./Icon.svelte";

  let { doc, page, scale, rotation }: { doc: Doc; page: PageItem; scale: number; rotation: Rotation } = $props();

  /** The note icon's size in points, as written to the file. */
  const ICON = 20;
  let layer: HTMLDivElement;

  // Numbered in the same order as the Comments panel.
  const numbers = $derived(new Map(sortedThreads(doc).map((c, i) => [c.id, i + 1])));
  const pins = $derived(doc.comments.filter((c) => c.page === page.id && (settings.showComments || !c.resolved)));
  const draft = $derived(ui.commentDraft?.page === page.id ? ui.commentDraft : null);

  function place(x: number, y: number) {
    const [dx, dy] = pageToDisplay(x, y, rotation, page.w, page.h);
    return `left: ${dx * scale}px; top: ${dy * scale}px`;
  }

  function toPage(e: PointerEvent): [number, number] {
    const r = layer.getBoundingClientRect();
    const [x, y] = displayToPage((e.clientX - r.left) / scale, (e.clientY - r.top) / scale, rotation, page.w, page.h);
    return [Math.max(0, Math.min(page.w - ICON, x)), Math.max(0, Math.min(page.h - ICON, y))];
  }

  function onSurfaceDown(e: PointerEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    const [x, y] = toPage(e);
    ui.commentDraft = { page: page.id, x, y };
    ui.tool = "select";
    doc.selectedComment = null;
    if (!settings.showComments) {
      settings.showComments = true;
      persist();
    }
  }

  // ---- dragging a pin ----
  let drag = $state<{ id: string; sx: number; sy: number; x: number; y: number; moved: boolean } | null>(null);

  function onPinDown(e: PointerEvent, id: string) {
    if (e.button !== 0) return;
    e.stopPropagation();
    const c = doc.comment(id);
    if (!c) return;
    drag = { id, sx: e.clientX, sy: e.clientY, x: c.x, y: c.y, moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onPinMove(e: PointerEvent) {
    if (!drag) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 4) return;
    drag.moved = true;
    // The pin's corner follows the pointer, keeping where it was grabbed.
    const c = doc.comment(drag.id)!;
    const [ox, oy] = pageToDisplay(c.x, c.y, rotation, page.w, page.h);
    const r = layer.getBoundingClientRect();
    const dx = ox + (e.clientX - drag.sx) / scale;
    const dy = oy + (e.clientY - drag.sy) / scale;
    const [x, y] = displayToPage(Math.max(0, Math.min(r.width / scale, dx)), Math.max(0, Math.min(r.height / scale, dy)), rotation, page.w, page.h);
    drag.x = Math.max(0, Math.min(page.w - ICON, x));
    drag.y = Math.max(0, Math.min(page.h - ICON, y));
  }

  function onPinUp() {
    const d = drag;
    drag = null;
    if (!d) return;
    if (d.moved) doc.moveComment(d.id, d.x, d.y);
    doc.selectedComment = d.id;
    ui.commentDraft = null;
    if (!settings.showComments) {
      settings.showComments = true;
      persist();
    }
  }
</script>

<div class="comments" bind:this={layer}>
  {#each pins as c (c.id)}
    {@const at = drag?.id === c.id && drag.moved ? drag : c}
    <button
      class="pin"
      class:on={doc.selectedComment === c.id}
      class:done={c.resolved}
      class:dragging={drag?.id === c.id && drag.moved}
      style={place(at.x, at.y)}
      title={`${c.author}: ${c.text}`}
      aria-label={t("comments.title") + " " + (numbers.get(c.id) ?? "")}
      onpointerdown={(e) => onPinDown(e, c.id)}
      onpointermove={onPinMove}
      onpointerup={onPinUp}
      onpointercancel={() => (drag = null)}
    >
      {#if c.resolved}<Icon name="check" size={11} />{:else}{numbers.get(c.id) ?? ""}{/if}
    </button>
  {/each}
  {#if draft}
    <span class="pin draft" style={place(draft.x, draft.y)}><Icon name="plus" size={12} /></span>
  {/if}
</div>

{#if ui.tool === "comment"}
  <div class="surface" role="application" aria-label={t("comments.tool")} onpointerdown={onSurfaceDown}></div>
{/if}

<style>
  .comments {
    position: absolute;
    inset: 0;
    z-index: 6;
    pointer-events: none;
  }
  .pin {
    position: absolute;
    width: 22px;
    height: 22px;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1.5px solid #fff;
    border-radius: 11px 11px 11px 2px;
    background: #f5b82e;
    color: #2b2412;
    font: 600 10.5px var(--mono);
    box-shadow: 0 2px 6px rgb(0 0 0 / 0.35);
    pointer-events: auto;
    cursor: grab;
    transition:
      transform 0.12s ease,
      box-shadow 0.12s ease;
    touch-action: none;
  }
  .pin:hover {
    transform: translateY(-1px);
  }
  .pin.on {
    background: var(--accent);
    color: #fff;
    box-shadow:
      0 0 0 3px color-mix(in srgb, var(--accent) 35%, transparent),
      0 2px 6px rgb(0 0 0 / 0.35);
  }
  .pin.done {
    background: #9ca3af;
    color: #fff;
  }
  .pin.dragging {
    cursor: grabbing;
    transition: none;
    transform: scale(1.1);
  }
  .pin.draft {
    background: var(--accent);
    color: #fff;
    animation: pop 0.18s ease-out;
  }
  @keyframes pop {
    from {
      transform: scale(0.4);
      opacity: 0;
    }
  }
  .surface {
    position: absolute;
    inset: 0;
    z-index: 7;
    cursor: crosshair;
  }
</style>
