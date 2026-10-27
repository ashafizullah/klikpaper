<script lang="ts">
  import { onDestroy } from "svelte";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import type { Doc, PageItem } from "../lib/doc.svelte";
  import { displaySize } from "../lib/geometry";
  import { fitOnSheet } from "../lib/paper";
  import { linkService, pdfjs, renderToCanvas, type PDFPageProxy } from "../lib/pdfjs";
  import { ui } from "../lib/ui.svelte";
  import { viewer } from "../lib/viewer.svelte";
  import { numberAnchor, pageLabel } from "../lib/layout";
  import OverlayLayer from "./OverlayLayer.svelte";
  import CommentLayer from "./CommentLayer.svelte";

  let { doc, page, index, scale, visible }: { doc: Doc; page: PageItem; index: number; scale: number; visible: boolean } = $props();

  let canvas: HTMLCanvasElement;
  let textDiv: HTMLDivElement;
  let annotDiv: HTMLDivElement;
  let pageEl = $state<HTMLDivElement>() as HTMLDivElement;

  const rotation = $derived(doc.rotation(page));
  const size = $derived(displaySize(page.w, page.h, rotation));
  // Resized pages show their paper, with the page's content scaled to fit and centered on it.
  const paper = $derived(doc.shownSize(page));
  const fit = $derived(page.sheet ? fitOnSheet(page.w, page.h, page.sheet).s : 1);
  /** CSS pixels per point for the page's content (the zoom, times the fit onto new paper). */
  const contentScale = $derived(scale * fit);
  const cssW = $derived(size[0] * contentScale);
  const cssH = $derived(size[1] * contentScale);

  let rendered = $state<{ scale: number; rotation: number } | null>(null);
  let cancelRender: (() => void) | null = null;
  let textLayer: InstanceType<typeof pdfjs.TextLayer> | null = null;
  let pdfPage: PDFPageProxy | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let generation = 0;

  function clearLayers() {
    cancelRender?.();
    cancelRender = null;
    textLayer?.cancel();
    textLayer = null;
    if (textDiv) textDiv.replaceChildren();
    if (annotDiv) annotDiv.replaceChildren();
  }

  function release() {
    clearLayers();
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
    rendered = null;
    pdfPage?.cleanup();
  }

  async function render(s: number, rot: number) {
    const gen = ++generation;
    clearLayers();
    const source = doc.sources.get(page.source);
    if (!source) return;
    pdfPage ??= await doc.pdfPage(page);
    if (gen !== generation) return;
    const p = pdfPage;
    // Annotations drawn on canvases of their own (notes, some form fields) are
    // put in place by the annotation layer; notes are left out there, since
    // KlikPaper shows them as comment pins.
    const ownCanvases = new Map<string, HTMLCanvasElement>();
    const task = await renderToCanvas(p, canvas, s, rot, { ownCanvases });
    cancelRender = task.cancel;
    try {
      await task.done;
    } catch {
      return;
    }
    if (gen !== generation) return;
    rendered = { scale: s, rotation: rot };

    const viewport = p.getViewport({ scale: s, rotation: rot });
    textLayer = new pdfjs.TextLayer({ textContentSource: p.streamTextContent(), container: textDiv, viewport });
    await textLayer.render().catch(() => {});
    if (gen !== generation) return;
    markHits();

    // Links and form fields. Typed form values live in pdf.js until the document is saved.
    const storage = source.pdf.annotationStorage;
    (storage as unknown as { onSetModified: (() => void) | null }).onSetModified = () => {
      doc.formsEdited = true;
      doc.dirty = true;
    };
    const annotations = (await p.getAnnotations({ intent: "display" })).filter(
      (a: { annotationType: number; parentType?: string }) => a.annotationType !== pdfjs.AnnotationType.TEXT && !(a.annotationType === pdfjs.AnnotationType.POPUP && a.parentType === "Text"),
    );
    if (gen !== generation || !annotations.length) return;
    const links = linkService(source.pdf, {
      goToPage: (i) => {
        const target = doc.pages.findIndex((x) => x.source === page.source && x.index === i);
        if (target >= 0) viewer.goTo(target);
      },
      openUrl: (url) => openUrl(url),
    });
    const params = {
      div: annotDiv,
      accessibilityManager: null,
      annotationCanvasMap: ownCanvases,
      annotationEditorUIManager: null,
      page: p,
      viewport: viewport.clone({ dontFlip: true }),
      structTreeLayer: null,
      commentManager: null,
      linkService: links,
      annotationStorage: storage,
    };
    const layer = new pdfjs.AnnotationLayer(params as never);
    await layer
      .render({
        viewport: viewport.clone({ dontFlip: true }),
        div: annotDiv,
        annotations,
        page: p,
        linkService: links as never,
        annotationStorage: storage,
        renderForms: true,
        enableScripting: false,
        hasJSActions: false,
        fieldObjects: null,
      })
      .catch(() => {});
  }

  // Render when on screen; re-render (debounced) after zoom or rotation changes.
  $effect(() => {
    const s = contentScale;
    const rot = rotation;
    if (!visible) {
      clearTimeout(timer);
      if (rendered) release();
      return;
    }
    if (rendered && rendered.scale === s && rendered.rotation === rot) return;
    clearTimeout(timer);
    timer = setTimeout(() => render(s, rot), rendered ? 140 : 0);
  });

  /** Marks text-layer pieces containing the search text. */
  function markHits() {
    if (!textDiv) return;
    const q = ui.findOpen ? ui.findQuery.trim().toLowerCase() : "";
    for (const span of textDiv.querySelectorAll<HTMLElement>("span")) {
      const hit = !!q && (span.textContent ?? "").toLowerCase().includes(q);
      span.classList.toggle("hit", hit);
      span.classList.toggle("current", hit && ui.findPage === index);
    }
  }
  $effect(() => {
    void ui.findQuery;
    void ui.findOpen;
    void ui.findPage;
    if (rendered) markHits();
  });

  onDestroy(() => {
    clearTimeout(timer);
    generation++;
    release();
  });

  // Watermark and page-number previews (drawn into the file on save).
  const wm = $derived(doc.watermark);
  const pn = $derived(doc.pageNumbers);
  const numberLabel = $derived(pn ? pageLabel(pn, index, doc.pages.length) : "");
  const numberPos = $derived.by(() => {
    if (!pn) return null;
    // Approximate width for placement; the saved file measures the real font.
    const approx = numberLabel.length * pn.size * 0.55;
    const [x, y] = numberAnchor(pn.position, size, approx, pn.size, pn.margin);
    return { left: x * contentScale, top: (y - pn.size * 0.905) * contentScale };
  });
  const textSelectable = $derived(ui.tool === "select" || ui.tool === "highlight" || ui.tool === "underline" || ui.tool === "strike");
</script>

<div class="page" data-page-id={page.id} class:current={doc.current === index} style:width="{paper[0] * scale}px" style:height="{paper[1] * scale}px">
  <div
    class="content"
    bind:this={pageEl}
    style:left="{(paper[0] * scale - cssW) / 2}px"
    style:top="{(paper[1] * scale - cssH) / 2}px"
    style:width="{cssW}px"
    style:height="{cssH}px"
    style="--total-scale-factor: {contentScale}; --scale-round-x: 1px; --scale-round-y: 1px;"
  >
    <canvas bind:this={canvas} style:width="{cssW}px" style:height="{cssH}px"></canvas>
    {#if !rendered}
      <div class="placeholder">{index + 1}</div>
    {/if}
    <div class="textLayer" class:off={!textSelectable} bind:this={textDiv}></div>
    <div class="annotationLayer" class:off={ui.tool !== "select"} bind:this={annotDiv}></div>
    {#if wm && wm.text.trim()}
      <div class="wm" style:font-size="{wm.size * contentScale}px" style:opacity={wm.opacity} style:color={wm.color} style:transform="translate(-50%, -50%) rotate({-wm.angle}deg)">
        {wm.text}
      </div>
    {/if}
    {#if pn && numberPos}
      <div class="pn" style:left="{numberPos.left}px" style:top="{numberPos.top}px" style:font-size="{pn.size * contentScale}px" style:color={pn.color}>{numberLabel}</div>
    {/if}
    <OverlayLayer {doc} {page} scale={contentScale} {rotation} {pageEl} />
    <CommentLayer {doc} {page} scale={contentScale} {rotation} />
  </div>
</div>

<style>
  .page {
    position: relative;
    background: #fff;
    box-shadow: 0 2px 6px rgb(0 0 0 / 0.5), 0 14px 32px -10px rgb(0 0 0 / 0.65);
    overflow: hidden;
  }
  .content {
    position: absolute;
  }
  canvas {
    position: absolute;
    left: 0;
    top: 0;
    display: block;
  }
  .placeholder {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #b8b0a6;
    font-size: 28px;
    font-family: var(--serif);
  }
  .textLayer.off {
    pointer-events: none;
  }
  .annotationLayer.off :global(section) {
    pointer-events: none;
  }
  .wm {
    position: absolute;
    left: 50%;
    top: 50%;
    white-space: nowrap;
    font-family: var(--page-font);
    font-weight: 700;
    pointer-events: none;
    z-index: 3;
  }
  .pn {
    position: absolute;
    white-space: nowrap;
    font-family: var(--page-font);
    line-height: 1;
    pointer-events: none;
    z-index: 3;
  }
</style>
