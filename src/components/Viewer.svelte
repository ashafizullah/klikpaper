<script lang="ts">
  import { onMount, tick } from "svelte";
  import type { Doc } from "../lib/doc.svelte";
  import { displaySize } from "../lib/geometry";
  import { CSS_UNITS } from "../lib/pdfjs";
  import { viewer } from "../lib/viewer.svelte";
  import { ZOOM_STEPS } from "../lib/commands.svelte";
  import PageView from "./PageView.svelte";
  import StyleBar from "./StyleBar.svelte";

  let { doc }: { doc: Doc } = $props();
  let el: HTMLDivElement;
  let width = $state(0);
  let visible = $state(new Set<string>());
  const GAP = 16;

  const maxWidth = $derived(Math.max(1, ...doc.pages.map((p) => displaySize(p.w, p.h, doc.rotation(p))[0])));

  // Fit width keeps the widest page filling the view.
  $effect(() => {
    if (doc.fitWidth && width > 0) {
      const z = (width - 48) / (maxWidth * CSS_UNITS);
      doc.zoom = Math.max(ZOOM_STEPS[0], Math.min(ZOOM_STEPS[ZOOM_STEPS.length - 1], z));
    }
  });
  const scale = $derived(doc.zoom * CSS_UNITS);

  // Keep the current page in place when zooming.
  let anchor: { index: number; frac: number } | null = null;
  let lastScale = 0;
  $effect.pre(() => {
    const s = scale;
    if (el && lastScale && s !== lastScale) {
      const page = el.querySelector<HTMLElement>(`[data-page-index="${doc.current}"]`);
      anchor = page ? { index: doc.current, frac: (el.scrollTop - page.offsetTop) / Math.max(1, page.offsetHeight) } : null;
      tick().then(() => {
        const a = anchor;
        anchor = null;
        const p = a && el.querySelector<HTMLElement>(`[data-page-index="${a.index}"]`);
        if (a && p) el.scrollTop = p.offsetTop + a.frac * p.offsetHeight;
      });
    }
    lastScale = s;
  });

  let observer: IntersectionObserver;
  onMount(() => {
    viewer.el = el;
    // Ignore the few pixels a scrollbar takes or gives back: fitting the width
    // can show or hide the scrollbar, which would otherwise refit in a loop.
    const ro = new ResizeObserver(() => {
      if (Math.abs(el.clientWidth - width) > 20) width = el.clientWidth;
    });
    ro.observe(el);
    observer = new IntersectionObserver(
      (entries) => {
        const next = new Set(visible);
        for (const e of entries) {
          const id = (e.target as HTMLElement).dataset.pageId!;
          if (e.isIntersecting) next.add(id);
          else next.delete(id);
        }
        visible = next;
      },
      { root: el, rootMargin: "120% 0px" },
    );
    tick().then(() => {
      el.querySelectorAll("[data-page-id]").forEach((n) => observer.observe(n));
      viewer.goTo(doc.current);
    });
    return () => {
      ro.disconnect();
      observer.disconnect();
      if (viewer.el === el) viewer.el = null;
    };
  });

  /** Registers a page element with the visibility observer. */
  function observe(node: HTMLElement) {
    observer?.observe(node);
    return { destroy: () => observer?.unobserve(node) };
  }

  let frame = 0;
  function onScroll() {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const mid = el.scrollTop + el.clientHeight * 0.35;
      const nodes = el.querySelectorAll<HTMLElement>("[data-page-index]");
      let current = 0;
      for (const n of nodes) {
        if (n.offsetTop <= mid) current = Number(n.dataset.pageIndex);
        else break;
      }
      if (current !== doc.current) doc.current = current;
    });
  }

  // Pinch or ctrl/cmd + wheel zooms.
  function onWheel(e: WheelEvent) {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const factor = Math.exp(-e.deltaY * 0.01);
    doc.fitWidth = false;
    doc.zoom = Math.max(ZOOM_STEPS[0], Math.min(ZOOM_STEPS[ZOOM_STEPS.length - 1], doc.zoom * factor));
  }
</script>

<div class="viewer grain-free" bind:this={el} onscroll={onScroll} onwheel={onWheel}>
  <div class="pages" style:gap="{GAP}px">
    {#each doc.pages as page, i (page.id)}
      <div class="slot" data-page-index={i} data-page-id={page.id} use:observe>
        <PageView {doc} {page} index={i} {scale} visible={visible.has(page.id)} />
      </div>
    {/each}
  </div>
</div>
<StyleBar {doc} />

<style>
  .viewer {
    flex: 1;
    overflow: auto;
    background-color: var(--canvas);
    background-image: radial-gradient(#2a251d 1px, transparent 1px);
    background-size: 18px 18px;
    background-attachment: local;
  }
  .pages {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 20px 24px 40px;
    min-width: fit-content;
  }
  .slot {
    flex: none;
  }
</style>
