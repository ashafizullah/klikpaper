<script lang="ts">
  import type { Doc, PageItem } from "../lib/doc.svelte";
  import { thumbnail, THUMB_WIDTH } from "../lib/thumbs";
  import { viewer } from "../lib/viewer.svelte";
  import { exportCopy, insertFiles } from "../lib/workspace.svelte";
  import { toast } from "../lib/ui.svelte";
  import { t } from "../lib/i18n/index.svelte";
  import Icon from "./Icon.svelte";

  let { doc }: { doc: Doc } = $props();
  let list: HTMLDivElement;
  let anchorId: string | null = null;

  const selection = $derived(doc.selectedPages);
  const targets = $derived(selection.length ? selection : doc.pages[doc.current] ? [doc.pages[doc.current].id] : []);

  let justDragged = false;

  function select(e: MouseEvent, p: PageItem, i: number) {
    // The click that ends a drag is not a selection.
    if (justDragged) {
      justDragged = false;
      return;
    }
    if (e.shiftKey && anchorId) {
      const a = doc.pages.findIndex((x) => x.id === anchorId);
      const [lo, hi] = a < i ? [a, i] : [i, a];
      doc.selectedPages = doc.pages.slice(lo, hi + 1).map((x) => x.id);
    } else if (e.metaKey || e.ctrlKey) {
      doc.selectedPages = selection.includes(p.id) ? selection.filter((id) => id !== p.id) : [...selection, p.id];
      anchorId = p.id;
    } else {
      doc.selectedPages = [p.id];
      anchorId = p.id;
      viewer.goTo(i);
    }
  }

  function remove() {
    try {
      doc.deletePages(targets);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    }
  }

  function extract() {
    const ids = new Set(targets);
    const positions = doc.pages.flatMap((p, i) => (ids.has(p.id) ? [i] : []));
    exportCopy(doc, positions, "-pages");
  }

  // ---- reordering by dragging (pointer events; HTML5 drag and drop clashes with file drops on Windows)

  let drag = $state<{ ids: string[]; startY: number; active: boolean; insert: number } | null>(null);

  function onPointerDown(e: PointerEvent, p: PageItem) {
    if (e.button !== 0) return;
    const ids = selection.includes(p.id) ? doc.pages.filter((x) => selection.includes(x.id)).map((x) => x.id) : [p.id];
    drag = { ids, startY: e.clientY, active: false, insert: -1 };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp, { once: true });
  }

  let scrollTimer: ReturnType<typeof setInterval> | undefined;
  function onPointerMove(e: PointerEvent) {
    if (!drag) return;
    if (!drag.active && Math.abs(e.clientY - drag.startY) < 6) return;
    drag.active = true;
    const items = [...list.querySelectorAll<HTMLElement>("[data-thumb-index]")];
    let insert = items.length;
    for (const item of items) {
      const r = item.getBoundingClientRect();
      if (e.clientY < r.top + r.height / 2) {
        insert = Number(item.dataset.thumbIndex);
        break;
      }
    }
    drag.insert = insert;
    // Scroll the list while dragging near its edges.
    const box = list.getBoundingClientRect();
    clearInterval(scrollTimer);
    const edge = e.clientY < box.top + 40 ? -1 : e.clientY > box.bottom - 40 ? 1 : 0;
    if (edge) scrollTimer = setInterval(() => (list.scrollTop += edge * 14), 16);
  }

  function onPointerUp() {
    window.removeEventListener("pointermove", onPointerMove);
    clearInterval(scrollTimer);
    const d = drag;
    drag = null;
    if (!d?.active || d.insert < 0) return;
    justDragged = true;
    setTimeout(() => (justDragged = false), 0);
    // Position among the pages that are not moving.
    const to = doc.pages.slice(0, d.insert).filter((p) => !d.ids.includes(p.id)).length;
    const before = doc.pages.map((p) => p.id).join();
    const rest = doc.pages.filter((p) => !d.ids.includes(p.id)).map((p) => p.id);
    const after = [...rest.slice(0, to), ...d.ids, ...rest.slice(to)].join();
    if (before !== after) doc.movePages(d.ids, to);
  }

  // Keep the current page's thumbnail in view.
  $effect(() => {
    const i = doc.current;
    const el = list?.querySelector<HTMLElement>(`[data-thumb-index="${i}"]`);
    if (!el || drag) return;
    const r = el.getBoundingClientRect();
    const box = list.getBoundingClientRect();
    if (r.top < box.top || r.bottom > box.bottom) el.scrollIntoView({ block: "nearest" });
  });

  function lazyThumb(img: HTMLImageElement, p: PageItem) {
    let current = p;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        io.disconnect();
        thumbnail(doc, current).then((url) => (img.src = url)).catch(() => {});
      }
    }, { root: list, rootMargin: "300px 0px" });
    io.observe(img);
    return {
      update(next: PageItem) {
        current = next;
        thumbnail(doc, next).then((url) => (img.src = url)).catch(() => {});
      },
      destroy: () => io.disconnect(),
    };
  }
</script>

<aside class="sidebar">
  <div class="head">
    <span class="title">{t("pages.title", { n: doc.pages.length })}</span>
    <button class="icon-btn" onclick={() => insertFiles(doc, selection.length ? doc.pages.findLastIndex((p) => selection.includes(p.id)) + 1 : doc.pages.length)} title={t("pages.insert")} aria-label={t("pages.insert")}>
      <Icon name="insert" />
    </button>
  </div>
  <div class="actions">
    <button class="icon-btn" onclick={() => doc.rotatePages(targets, -90)} title={t("pages.rotateLeft")} aria-label={t("pages.rotateLeft")}><Icon name="rotate-ccw" /></button>
    <button class="icon-btn" onclick={() => doc.rotatePages(targets, 90)} title={t("pages.rotateRight")} aria-label={t("pages.rotateRight")}><Icon name="rotate-cw" /></button>
    <button class="icon-btn" onclick={() => doc.duplicatePages(targets)} title={t("pages.duplicate")} aria-label={t("pages.duplicate")}><Icon name="duplicate" /></button>
    <button class="icon-btn" onclick={extract} title={t("pages.extract")} aria-label={t("pages.extract")}><Icon name="export" /></button>
    <button class="icon-btn danger" onclick={remove} title={t("pages.delete")} aria-label={t("pages.delete")}><Icon name="trash" /></button>
    <span class="count muted">{selection.length > 1 ? t("pages.selected", { n: selection.length }) : ""}</span>
  </div>
  <div class="list" bind:this={list} class:dragging={drag?.active}>
    {#each doc.pages as p, i (p.id)}
      {#if drag?.active && drag.insert === i}<div class="insert-line"></div>{/if}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <div
        class="thumb"
        class:current={doc.current === i}
        class:selected={selection.includes(p.id)}
        class:moving={drag?.active && drag.ids.includes(p.id)}
        data-thumb-index={i}
        role="option"
        tabindex="-1"
        aria-selected={selection.includes(p.id)}
        onclick={(e) => select(e, p, i)}
        onpointerdown={(e) => onPointerDown(e, p)}
      >
        <div class="frame" style:width="{THUMB_WIDTH}px" style:aspect-ratio={doc.rotation(p) % 180 === 0 ? `${p.w} / ${p.h}` : `${p.h} / ${p.w}`}>
          <img use:lazyThumb={p} alt={t("pages.page", { n: i + 1 })} draggable="false" />
          {#if doc.overlays.some((o) => o.page === p.id)}<span class="badge" title={t("pages.hasAnnotations")}></span>{/if}
        </div>
        <span class="num">{i + 1}</span>
      </div>
    {/each}
    {#if drag?.active && drag.insert === doc.pages.length}<div class="insert-line"></div>{/if}
  </div>
</aside>

<style>
  .sidebar {
    width: 184px;
    flex: none;
    display: flex;
    flex-direction: column;
    background: var(--sidebar);
    border-right: 1px solid var(--border);
    min-height: 0;
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 6px 2px 12px;
  }
  .title {
    font: 500 10px var(--mono);
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.12em;
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 0;
    padding: 2px 6px 6px;
    border-bottom: 1px solid var(--border);
  }
  .actions .danger:hover {
    color: var(--danger);
  }
  .count {
    font: 10.5px var(--mono);
    margin-left: 4px;
  }
  .list {
    flex: 1;
    overflow-y: auto;
    padding: 10px 0 24px;
    display: flex;
    flex-direction: column;
    align-items: center;
  }
  .list.dragging {
    cursor: grabbing;
  }
  .thumb {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 6px 8px;
    border-radius: 8px;
    cursor: pointer;
  }
  .thumb:hover {
    background: var(--hover);
  }
  .thumb.selected {
    background: color-mix(in srgb, var(--accent) 10%, transparent);
  }
  .thumb.moving {
    opacity: 0.4;
  }
  .frame {
    position: relative;
    background: #fff;
    box-shadow: 0 4px 12px rgb(0 0 0 / 0.45);
    outline: 2px solid transparent;
    outline-offset: 2px;
    border-radius: 2px;
    transition: outline-color 0.15s;
  }
  .thumb:hover .frame {
    outline-color: var(--line);
  }
  .thumb.current .frame {
    outline-color: var(--accent);
  }
  .frame img {
    width: 100%;
    height: 100%;
    display: block;
    object-fit: contain;
  }
  .frame img:not([src]) {
    visibility: hidden;
  }
  .badge {
    position: absolute;
    right: 4px;
    top: 4px;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--accent);
  }
  .num {
    font: 10.5px var(--mono);
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  .thumb.current .num {
    color: var(--accent);
    font-weight: 600;
  }
  .insert-line {
    width: 140px;
    height: 3px;
    border-radius: 2px;
    background: var(--accent);
    margin: -2px 0;
    flex: none;
  }
</style>
