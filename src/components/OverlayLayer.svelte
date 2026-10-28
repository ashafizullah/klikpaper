<script lang="ts">
  // KlikPaper's own annotations on one page, and the mouse work that creates
  // and edits them. Items are stored in page space and drawn inside a layer
  // turned with the page, so they rotate along with it.
  import { tick } from "svelte";
  import { on } from "svelte/events";
  import type { Doc, Overlay, PageItem } from "../lib/doc.svelte";
  import { displayToPage, layerTransform, normRect, rotateOffset, type Rotation } from "../lib/geometry";
  import { selectionRects } from "../lib/selection";
  import { newId, settings } from "../lib/settings.svelte";
  import { fontStack, showFont } from "../lib/fonts.svelte";
  import { replaceLine } from "../lib/edittext";
  import { textLines, type PageLine } from "../lib/pdfjs";
  import { isMac, mod, openDialog, toolColor, ui } from "../lib/ui.svelte";
  import { arrowHead, LINE_HEIGHT } from "../lib/layout";
  import { copyText, openMenu } from "../lib/contextmenu.svelte";
  import { command } from "../lib/commands.svelte";
  import { persist } from "../lib/settings.svelte";
  import { t } from "../lib/i18n/index.svelte";

  let { doc, page, scale, rotation, pageEl }: { doc: Doc; page: PageItem; scale: number; rotation: Rotation; pageEl: HTMLDivElement } = $props();

  const items = $derived(doc.overlays.filter((o) => o.page === page.id));
  const drawing = $derived(["text", "edittext", "ink", "rect", "ellipse", "arrow", "whiteout"].includes(ui.tool) || (ui.tool === "image" && !!ui.pendingImage));
  const markupTool = $derived(ui.tool === "highlight" || ui.tool === "underline" || ui.tool === "strike");

  let editingId = $state<string | null>(null);
  let createdId: string | null = null;
  let draft = $state<Overlay | null>(null);

  /** Pointer position in page space. */
  function toPage(e: { clientX: number; clientY: number }): [number, number] {
    const r = pageEl.getBoundingClientRect();
    return displayToPage((e.clientX - r.left) / scale, (e.clientY - r.top) / scale, rotation, page.w, page.h);
  }

  /** A screen-space movement as a page-space vector. */
  function deltaToPage(dx: number, dy: number): [number, number] {
    const [ox, oy] = displayToPage(0, 0, rotation, page.w, page.h);
    const [x, y] = displayToPage(dx / scale, dy / scale, rotation, page.w, page.h);
    return [x - ox, y - oy];
  }

  const clampX = (x: number) => Math.max(0, Math.min(page.w, x));
  const clampY = (y: number) => Math.max(0, Math.min(page.h, y));

  // ---- creating ---------------------------------------------------------

  let start: [number, number] | null = null;

  function onSurfaceDown(e: PointerEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    doc.selectedOverlay = null;
    const [x, y] = toPage(e);
    if (ui.tool === "edittext") {
      const line = lineAt(x, y);
      if (line) editLine(line);
      return;
    }
    const color = toolColor(ui.tool);
    switch (ui.tool) {
      case "text":
        addText(x, y);
        return;
      case "image": {
        const img = ui.pendingImage!;
        const o: Overlay = { id: newId("o"), page: page.id, kind: "image", x: x - img.width / 2, y: y - img.height / 2, w: img.width, h: img.height, src: img.src, rot: rotation };
        // Center on the click as seen on screen.
        const [cx, cy] = rotateOffset(img.width / 2, img.height / 2, rotation);
        o.x = x - cx;
        o.y = y - cy;
        doc.addOverlay(o);
        ui.pendingImage = null;
        ui.tool = "select";
        return;
      }
      case "ink":
        draft = { id: newId("o"), page: page.id, kind: "ink", points: [x, y], color, width: ui.strokeWidth };
        break;
      case "rect":
      case "ellipse":
        draft = { id: newId("o"), page: page.id, kind: ui.tool, x, y, w: 0, h: 0, color, fill: null, width: ui.strokeWidth };
        break;
      case "whiteout":
        draft = { id: newId("o"), page: page.id, kind: "rect", x, y, w: 0, h: 0, color: "#ffffff", fill: "#ffffff", width: 0 };
        break;
      case "arrow":
        draft = { id: newId("o"), page: page.id, kind: "arrow", x1: x, y1: y, x2: x, y2: y, color, width: ui.strokeWidth };
        break;
    }
    start = [x, y];
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onSurfaceMove(e: PointerEvent) {
    if (ui.tool === "edittext") {
      hovered = lineAt(...toPage(e)) ?? null;
      return;
    }
    if (!draft || !start) return;
    const [x, y] = toPage(e);
    const cx = clampX(x);
    const cy = clampY(y);
    if (draft.kind === "ink") {
      const p = draft.points;
      const dx = cx - p[p.length - 2];
      const dy = cy - p[p.length - 1];
      if (dx * dx + dy * dy > 0.8) draft.points = [...p, cx, cy];
    } else if (draft.kind === "rect" || draft.kind === "ellipse") {
      const r = normRect(start[0], start[1], cx, cy);
      draft = { ...draft, ...r };
    } else if (draft.kind === "arrow") {
      draft = { ...draft, x2: cx, y2: cy };
    }
  }

  function onSurfaceUp() {
    const d = draft;
    draft = null;
    start = null;
    if (!d) return;
    if ((d.kind === "rect" || d.kind === "ellipse") && (d.w < 3 || d.h < 3)) {
      // A click without dragging places a default-size shape.
      d.w = 90;
      d.h = d.kind === "ellipse" ? 60 : 50;
      d.x = Math.min(d.x, page.w - d.w);
      d.y = Math.min(d.y, page.h - d.h);
    }
    if (d.kind === "arrow" && Math.hypot(d.x2 - d.x1, d.y2 - d.y1) < 4) return;
    if (d.kind === "ink" && d.points.length < 4) return;
    doc.addOverlay(d);
  }

  /** A new text box at a page-space point, ready for typing. */
  function addText(x: number, y: number) {
    const o: Overlay = { id: newId("o"), page: page.id, kind: "text", x, y: Math.max(0, y - ui.fontSize * 0.6), w: Math.min(240, page.w - x - 8), text: "", size: ui.fontSize, color: toolColor("text"), rot: rotation, ...(settings.textFont ? { font: settings.textFont } : {}) };
    if (o.w < 40) o.w = 40;
    doc.addOverlay(o);
    createdId = o.id;
    startEditing(o.id);
    ui.tool = "select";
  }

  // ---- editing the page's own text (cover it, then type over it) --------

  let lines = $state<PageLine[]>([]);
  let hovered = $state<PageLine | null>(null);

  // The page's lines, read when the Edit text tool is picked.
  $effect(() => {
    if (ui.tool !== "edittext") {
      hovered = null;
      return;
    }
    let live = true;
    doc
      .pdfPage(page)
      .then(textLines)
      .then((found) => live && (lines = found))
      .catch(() => {});
    return () => {
      live = false;
    };
  });

  const lineAt = (x: number, y: number) => lines.find((l) => x >= l.rect.x - 2 && x <= l.rect.x + l.rect.w + 2 && y >= l.rect.y - 1 && y <= l.rect.y + l.rect.h + 1);

  /** The text box that replaces a line, made by Edit text (emptying it erases the line). */
  let replacingId: string | null = null;

  async function editLine(line: PageLine) {
    hovered = null;
    const box = await replaceLine(doc, page, line);
    ui.tool = "select";
    createdId = box.id;
    replacingId = box.id;
    await startEditing(box.id);
    editor?.select();
  }

  // ---- highlight / underline / strike from a text selection ------------

  function onMarkupUp() {
    if (markupTool) markSelection(ui.tool as MarkupStyle);
  }

  type MarkupStyle = "highlight" | "underline" | "strike";

  /** Marks this page's part of the text selection. */
  function markSelection(style: MarkupStyle) {
    const sel = window.getSelection();
    const rects = selectionRects(pageEl, page, scale, rotation);
    if (!sel || !rects.length) return;
    doc.addOverlay({ id: newId("o"), page: page.id, kind: "markup", style, rects, color: toolColor(style) });
    doc.selectedOverlay = null;
    // Every page sees this mouse-up; clear the selection only after all of them
    // had their turn, so a selection across two pages marks both.
    setTimeout(() => sel.removeAllRanges(), 0);
  }

  // From the right-click menu: every page marks its part, then the selection goes.
  $effect(() => {
    const onMark = (e: Event) => markSelection((e as CustomEvent<MarkupStyle>).detail);
    window.addEventListener("klikpaper:mark", onMark);
    return () => window.removeEventListener("klikpaper:mark", onMark);
  });

  function markFromMenu(style: MarkupStyle) {
    window.dispatchEvent(new CustomEvent("klikpaper:mark", { detail: style }));
  }

  // ---- right-click menus ------------------------------------------------

  function onPageMenu(e: MouseEvent) {
    const [x, y] = toPage(e);
    const sel = window.getSelection();
    const text = sel && !sel.isCollapsed ? sel.toString().trim() : "";
    const short = text.length > 28 ? `${text.slice(0, 27).trimEnd()}…` : text;
    openMenu(e, [
      text && { label: t("ctx.copy"), icon: "duplicate", shortcut: `${mod}C`, run: () => copyText(text) },
      text && { label: t("ctx.highlight"), icon: "highlight", run: () => markFromMenu("highlight") },
      text && { label: t("ctx.underline"), icon: "underline", run: () => markFromMenu("underline") },
      text && { label: t("ctx.strike"), icon: "strike", run: () => markFromMenu("strike") },
      text && { label: t("ctx.redact"), icon: "redact", run: () => window.dispatchEvent(new CustomEvent("klikpaper:redact")) },
      text && {
        label: t("ctx.findText", { text: short.replace(/\s+/g, " ") }),
        icon: "search",
        run: () => {
          ui.findQuery = text.replace(/\s+/g, " ");
          ui.findOpen = true;
        },
      },
      "sep",
      { label: t("ctx.addComment"), icon: "comment", run: () => addCommentAt(x, y) },
      { label: t("ctx.addText"), icon: "text", run: () => addText(x, y) },
      { label: t("ctx.ocr"), icon: "ocr", run: () => openDialog("ocr", { doc, which: "current" }) },
      "sep",
      { label: t("pages.rotateLeft"), icon: "rotate-ccw", run: () => doc.rotatePages([page.id], -90) },
      { label: t("pages.rotateRight"), icon: "rotate-cw", run: () => doc.rotatePages([page.id], 90) },
      "sep",
      { label: t("ctx.zoomIn"), icon: "zoom-in", shortcut: `${mod}+`, run: () => command("zoom-in") },
      { label: t("ctx.zoomOut"), icon: "zoom-out", shortcut: `${mod}-`, run: () => command("zoom-out") },
      { label: t("ctx.fitWidth"), icon: "fit", shortcut: `${mod}0`, run: () => command("zoom-fit") },
    ]);
  }

  function addCommentAt(x: number, y: number) {
    const ICON = 20;
    ui.tool = "select";
    doc.selectedComment = null;
    ui.commentDraft = { page: page.id, x: Math.max(0, Math.min(page.w - ICON, x)), y: Math.max(0, Math.min(page.h - ICON, y)) };
    if (!settings.showComments) {
      settings.showComments = true;
      persist();
    }
  }

  // Through svelte/events, so the menus of annotations and comment pins (attribute handlers) come first.
  $effect(() => {
    const el = pageEl;
    if (el) return on(el, "contextmenu", onPageMenu);
  });

  /** A copy of an item moved by (dx, dy) points. */
  function shifted(o: Overlay, dx: number, dy: number): Overlay {
    const c = { ...($state.snapshot(o) as Overlay), id: newId("o") };
    if ("x" in c && "y" in c) {
      c.x += dx;
      c.y += dy;
    } else if (c.kind === "arrow" || c.kind === "line") {
      c.x1 += dx;
      c.y1 += dy;
      c.x2 += dx;
      c.y2 += dy;
    } else if (c.kind === "ink") {
      c.points = c.points.map((v, i) => v + (i % 2 ? dy : dx));
    } else if (c.kind === "markup") {
      c.rects = c.rects.map((r) => ({ ...r, x: r.x + dx, y: r.y + dy }));
    }
    return c;
  }

  function onItemMenu(e: MouseEvent, o: Overlay) {
    if (editingId === o.id) return;
    doc.selectedOverlay = o.id;
    const [dx, dy] = deltaToPage(12, 12);
    openMenu(e, [
      o.kind === "text" && { label: t("ctx.editText"), icon: "edit-text", run: () => startEditing(o.id) },
      o.kind === "text" && o.text.trim() && { label: t("ctx.copyText"), icon: "duplicate", run: () => copyText(o.text) },
      o.kind !== "markup" && { label: t("pages.duplicate"), icon: "duplicate", run: () => doc.addOverlay(shifted(o, dx, dy)) },
      "sep",
      { label: t("ctx.delete"), icon: "trash", shortcut: isMac ? "⌫" : "Del", danger: true, run: () => doc.removeOverlay(o.id) },
    ]);
  }

  // ---- selecting, moving, resizing ------------------------------------

  let drag: { id: string; mode: "move" | "resize" | "p1" | "p2"; x: number; y: number; moved: boolean; orig: Overlay } | null = null;

  function onItemDown(e: PointerEvent, o: Overlay, mode: "move" | "resize" | "p1" | "p2" = "move") {
    if (ui.tool !== "select" || e.button !== 0 || editingId === o.id) return;
    e.stopPropagation();
    e.preventDefault();
    doc.selectedOverlay = o.id;
    drag = { id: o.id, mode, x: e.clientX, y: e.clientY, moved: false, orig: $state.snapshot(o) as Overlay };
    window.addEventListener("pointermove", onDragMove);
    window.addEventListener("pointerup", onDragUp, { once: true });
  }

  function onDragMove(e: PointerEvent) {
    if (!drag) return;
    const o = doc.overlay(drag.id);
    if (!o) return;
    const [dx, dy] = deltaToPage(e.clientX - drag.x, e.clientY - drag.y);
    if (!drag.moved) {
      if (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) < 3) return;
      drag.moved = true;
      doc.checkpoint();
    }
    const orig = drag.orig;
    if (drag.mode === "move") {
      if ("x" in o && "x" in orig) {
        o.x = orig.x + dx;
        o.y = orig.y + dy;
      } else if (o.kind === "arrow" || o.kind === "line") {
        const g = orig as typeof o;
        o.x1 = g.x1 + dx;
        o.y1 = g.y1 + dy;
        o.x2 = g.x2 + dx;
        o.y2 = g.y2 + dy;
      } else if (o.kind === "ink") {
        o.points = (orig as typeof o).points.map((v, i) => v + (i % 2 ? dy : dx));
      } else if (o.kind === "markup") {
        o.rects = (orig as typeof o).rects.map((r) => ({ ...r, x: r.x + dx, y: r.y + dy }));
      }
    } else if (drag.mode === "p1" && (o.kind === "arrow" || o.kind === "line")) {
      const g = orig as typeof o;
      o.x1 = g.x1 + dx;
      o.y1 = g.y1 + dy;
    } else if (drag.mode === "p2" && (o.kind === "arrow" || o.kind === "line")) {
      const g = orig as typeof o;
      o.x2 = g.x2 + dx;
      o.y2 = g.y2 + dy;
    } else if (drag.mode === "resize") {
      // Resizing happens in the item's own (possibly counter-rotated) axes.
      const rot = "rot" in o ? o.rot : 0;
      const [lx, ly] = rotateOffset(dx, dy, -rot);
      if (o.kind === "image" && orig.kind === "image") {
        const ratio = orig.h / orig.w;
        const w = Math.max(12, orig.w + Math.max(lx, ly / ratio));
        o.w = w;
        o.h = w * ratio;
      } else if ((o.kind === "rect" || o.kind === "ellipse") && (orig.kind === "rect" || orig.kind === "ellipse")) {
        o.w = Math.max(4, orig.w + lx);
        o.h = Math.max(4, orig.h + ly);
      } else if (o.kind === "text" && orig.kind === "text") {
        o.w = Math.max(30, orig.w + lx);
      }
    }
  }

  function onDragUp() {
    window.removeEventListener("pointermove", onDragMove);
    drag = null;
  }

  // ---- text editing -----------------------------------------------------

  let editor = $state<HTMLTextAreaElement | null>(null);

  async function startEditing(id: string) {
    editingId = id;
    doc.selectedOverlay = id;
    await tick();
    editor?.focus();
    autosize();
  }

  let editCheckpointed = false;
  function onEditInput(o: Extract<Overlay, { kind: "text" }>, value: string) {
    if (!editCheckpointed && createdId !== o.id) {
      doc.checkpoint();
      editCheckpointed = true;
    }
    o.text = value;
    doc.dirty = true;
    autosize();
  }

  function stopEditing() {
    const o = editingId ? doc.overlay(editingId) : undefined;
    if (o?.kind === "text" && !o.text.trim()) {
      if (replacingId === o.id) {
        // An emptied replacement leaves the cover: the line is erased, still one step to undo.
        doc.overlays = doc.overlays.filter((x) => x.id !== o.id);
        doc.selectedOverlay = null;
      } else if (createdId === o.id) {
        // An empty new text box is dropped, as if it was never added.
        doc.undo();
      } else doc.removeOverlay(o.id);
    }
    editingId = null;
    createdId = null;
    replacingId = null;
    editCheckpointed = false;
  }

  function autosize() {
    if (!editor) return;
    editor.style.height = "auto";
    editor.style.height = `${editor.scrollHeight}px`;
  }

  const lineGap = (size: number) => size * LINE_HEIGHT;

  function textHeight(o: Extract<Overlay, { kind: "text" }>) {
    return Math.max(1, o.text.split("\n").length) * lineGap(o.size);
  }

  function inkPath(points: number[]): string {
    let d = `M ${points[0]} ${points[1]}`;
    for (let i = 2; i < points.length; i += 2) d += ` L ${points[i]} ${points[i + 1]}`;
    return d;
  }

  function arrowPath(o: { x1: number; y1: number; x2: number; y2: number; width: number }): string {
    const [[ax, ay], [bx, by]] = arrowHead(o.x1, o.y1, o.x2, o.y2, o.width);
    return `M ${o.x1} ${o.y1} L ${o.x2} ${o.y2} M ${ax} ${ay} L ${o.x2} ${o.y2} L ${bx} ${by}`;
  }

  const all = $derived(draft ? [...items, draft] : items);
  // Installed fonts load into the page when a text box uses them.
  $effect(() => {
    for (const o of items) if (o.kind === "text" && o.font) showFont(o.font, !!o.bold).catch(() => {});
  });
  const highlights = $derived(items.filter((o): o is Extract<Overlay, { kind: "markup" }> => o.kind === "markup" && o.style === "highlight"));
</script>

<!-- Highlight colors get their own layer: the main layer is a stacking context, so a blend
     mode inside it would only mix with the layer itself and paint over the text. -->
{#if highlights.length}
  <div
    class="layer paint"
    style:width="{page.w * scale}px"
    style:height="{page.h * scale}px"
    style:transform={layerTransform(rotation, page.w, page.h, scale)}
  >
    <svg class="shapes" width={page.w * scale} height={page.h * scale} viewBox="0 0 {page.w} {page.h}">
      {#each highlights as o (o.id)}
        {#each o.rects as r, i (i)}
          <rect x={r.x} y={r.y} width={r.w} height={r.h} fill={o.color} />
        {/each}
      {/each}
    </svg>
  </div>
{/if}

<div
  class="layer"
  class:markup={markupTool}
  style:width="{page.w * scale}px"
  style:height="{page.h * scale}px"
  style:transform={layerTransform(rotation, page.w, page.h, scale)}
>
  <svg class="shapes" width={page.w * scale} height={page.h * scale} viewBox="0 0 {page.w} {page.h}">
    {#each all as o (o.id)}
      {#if o.kind === "markup"}
        <g class="hit" role="button" tabindex="-1" class:selected={doc.selectedOverlay === o.id} onpointerdown={(e) => onItemDown(e, o)} oncontextmenu={(e) => onItemMenu(e, o)}>
          {#each o.rects as r, i (i)}
            <!-- Highlight colors are drawn by the paint layer; this rect is the click target. -->
            <rect x={r.x} y={r.y} width={r.w} height={r.h} fill="transparent" />
            {#if o.style !== "highlight"}
              <line x1={r.x} x2={r.x + r.w} y1={o.style === "underline" ? r.y + r.h - Math.max(0.6, r.h / 14) : r.y + r.h / 2} y2={o.style === "underline" ? r.y + r.h - Math.max(0.6, r.h / 14) : r.y + r.h / 2} stroke={o.color} stroke-width={Math.max(0.6, r.h / 14)} />
            {/if}
          {/each}
        </g>
      {:else if o.kind === "rect"}
        <rect class="hit" role="button" tabindex="-1" x={o.x} y={o.y} width={o.w} height={o.h} fill={o.fill ?? "transparent"} stroke={o.width > 0 ? o.color : "none"} stroke-width={o.width} onpointerdown={(e) => onItemDown(e, o)} oncontextmenu={(e) => onItemMenu(e, o)} />
      {:else if o.kind === "ellipse"}
        <ellipse class="hit" role="button" tabindex="-1" cx={o.x + o.w / 2} cy={o.y + o.h / 2} rx={o.w / 2} ry={o.h / 2} fill={o.fill ?? "transparent"} stroke={o.color} stroke-width={o.width} onpointerdown={(e) => onItemDown(e, o)} oncontextmenu={(e) => onItemMenu(e, o)} />
      {:else if o.kind === "arrow" || o.kind === "line"}
        <path class="hit stroke" role="button" tabindex="-1" d={o.kind === "arrow" ? arrowPath(o) : `M ${o.x1} ${o.y1} L ${o.x2} ${o.y2}`} fill="none" stroke={o.color} stroke-width={o.width} stroke-linecap="round" stroke-linejoin="round" onpointerdown={(e) => onItemDown(e, o)} oncontextmenu={(e) => onItemMenu(e, o)} />
      {:else if o.kind === "ink"}
        <path class="hit stroke" role="button" tabindex="-1" d={inkPath(o.points)} fill="none" stroke={o.color} stroke-width={o.width} stroke-linecap="round" stroke-linejoin="round" onpointerdown={(e) => onItemDown(e, o)} oncontextmenu={(e) => onItemMenu(e, o)} />
      {/if}
    {/each}
    {#if hovered}
      <rect class="outline line" x={hovered.rect.x - 2} y={hovered.rect.y - 1} width={hovered.rect.w + 4} height={hovered.rect.h + 2} rx="1.5" />
    {/if}
    {#if doc.selectedOverlay}
      {@const sel = items.find((o) => o.id === doc.selectedOverlay)}
      {#if sel && (sel.kind === "rect" || sel.kind === "ellipse")}
        <rect class="outline" x={sel.x - 2} y={sel.y - 2} width={sel.w + 4} height={sel.h + 4} />
        <rect class="handle" role="button" tabindex="-1" x={sel.x + sel.w - 4} y={sel.y + sel.h - 4} width="8" height="8" onpointerdown={(e) => onItemDown(e, sel, "resize")} />
      {:else if sel && (sel.kind === "arrow" || sel.kind === "line")}
        <circle class="handle" role="button" tabindex="-1" cx={sel.x1} cy={sel.y1} r="4.5" onpointerdown={(e) => onItemDown(e, sel, "p1")} />
        <circle class="handle" role="button" tabindex="-1" cx={sel.x2} cy={sel.y2} r="4.5" onpointerdown={(e) => onItemDown(e, sel, "p2")} />
      {:else if sel && sel.kind === "ink"}
        {@const xs = sel.points.filter((_, i) => i % 2 === 0)}
        {@const ys = sel.points.filter((_, i) => i % 2 === 1)}
        <rect class="outline" x={Math.min(...xs) - 3} y={Math.min(...ys) - 3} width={Math.max(...xs) - Math.min(...xs) + 6} height={Math.max(...ys) - Math.min(...ys) + 6} />
      {:else if sel && sel.kind === "markup"}
        {#each sel.rects as r, i (i)}
          <rect class="outline" x={r.x - 1} y={r.y - 1} width={r.w + 2} height={r.h + 2} />
        {/each}
      {/if}
    {/if}
  </svg>

  {#each items as o (o.id)}
    {#if o.kind === "text"}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="box text"
        class:selected={doc.selectedOverlay === o.id}
        class:editing={editingId === o.id}
        style:left="{o.x * scale}px"
        style:top="{o.y * scale}px"
        style:width="{o.w * scale}px"
        style:min-height="{textHeight(o) * scale}px"
        style:transform="rotate({-o.rot}deg)"
        style:font-size="{o.size * scale}px"
        style:line-height={LINE_HEIGHT}
        style:color={o.color}
        style:font-weight={o.bold ? 700 : 400}
        style:font-family={fontStack(o.font)}
        onpointerdown={(e) => onItemDown(e, o)} oncontextmenu={(e) => onItemMenu(e, o)}
        ondblclick={() => ui.tool === "select" && startEditing(o.id)}
      >
        {#if editingId === o.id}
          <textarea
            bind:this={editor}
            value={o.text}
            oninput={(e) => onEditInput(o, e.currentTarget.value)}
            onblur={stopEditing}
            onkeydown={(e) => {
              if (e.key === "Escape") {
                e.stopPropagation();
                editor?.blur();
              }
            }}
            spellcheck="false"
          ></textarea>
        {:else}
          <div class="content">{o.text}</div>
        {/if}
        {#if doc.selectedOverlay === o.id && editingId !== o.id}
          <span class="handle side" role="button" tabindex="-1" onpointerdown={(e) => onItemDown(e, o, "resize")}></span>
        {/if}
      </div>
    {:else if o.kind === "image"}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="box image"
        class:selected={doc.selectedOverlay === o.id}
        style:left="{o.x * scale}px"
        style:top="{o.y * scale}px"
        style:width="{o.w * scale}px"
        style:height="{o.h * scale}px"
        style:transform="rotate({-o.rot}deg)"
        onpointerdown={(e) => onItemDown(e, o)} oncontextmenu={(e) => onItemMenu(e, o)}
      >
        <img src={o.src} alt="" draggable="false" />
        {#if doc.selectedOverlay === o.id}
          <span class="handle corner" role="button" tabindex="-1" onpointerdown={(e) => onItemDown(e, o, "resize")}></span>
        {/if}
      </div>
    {/if}
  {/each}
</div>

{#if drawing}
  <div
    class="surface"
    class:crosshair={ui.tool !== "text" && ui.tool !== "image"}
    class:texting={ui.tool === "text" || ui.tool === "edittext"}
    role="application"
    onpointerdown={onSurfaceDown}
    onpointermove={onSurfaceMove}
    onpointerup={onSurfaceUp}
  ></div>
{/if}
<svelte:window onpointerup={onMarkupUp} />

<style>
  .layer {
    position: absolute;
    left: 0;
    top: 0;
    transform-origin: 0 0;
    z-index: 4;
    pointer-events: none;
  }
  .layer.paint {
    mix-blend-mode: multiply;
  }
  .shapes {
    position: absolute;
    left: 0;
    top: 0;
    overflow: visible;
  }
  .hit {
    pointer-events: visiblePainted;
    cursor: move;
  }
  .hit.stroke {
    pointer-events: stroke;
  }
  .layer.markup .hit {
    pointer-events: none;
  }
  .outline.line {
    fill: color-mix(in srgb, var(--accent) 10%, transparent);
  }
  .outline {
    fill: none;
    stroke: var(--accent);
    stroke-width: 1;
    stroke-dasharray: 3 2;
    vector-effect: non-scaling-stroke;
  }
  .handle {
    fill: #fff;
    stroke: var(--accent);
    stroke-width: 1.5;
    vector-effect: non-scaling-stroke;
    pointer-events: all;
    cursor: nwse-resize;
  }
  .box {
    position: absolute;
    transform-origin: 0 0;
    pointer-events: auto;
    cursor: move;
  }
  .box.selected {
    outline: 1px dashed var(--accent);
    outline-offset: 2px;
  }
  .text {
    font-family: var(--page-font);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .text .content {
    min-height: 1em;
  }
  .text textarea {
    display: block;
    width: 100%;
    margin: 0;
    padding: 0;
    border: none;
    outline: 1px solid var(--accent);
    background: rgb(255 255 255 / 0.6);
    font: inherit;
    line-height: inherit;
    color: inherit;
    resize: none;
    overflow: hidden;
    -webkit-user-select: text;
    user-select: text;
  }
  .text.editing {
    cursor: text;
  }
  .image img {
    width: 100%;
    height: 100%;
    display: block;
    pointer-events: none;
  }
  span.handle {
    position: absolute;
    width: 10px;
    height: 10px;
    background: #fff;
    border: 1.5px solid var(--accent);
    border-radius: 2px;
  }
  span.handle.corner {
    right: -6px;
    bottom: -6px;
  }
  span.handle.side {
    right: -7px;
    top: calc(50% - 5px);
    cursor: ew-resize;
  }
  .surface {
    position: absolute;
    inset: 0;
    z-index: 5;
    cursor: copy;
  }
  .surface.crosshair {
    cursor: crosshair;
  }
  .surface.texting {
    cursor: text;
  }
</style>
