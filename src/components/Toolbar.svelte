<script lang="ts">
  import type { Doc } from "../lib/doc.svelte";
  import { command, ZOOM_STEPS } from "../lib/commands.svelte";
  import { settings } from "../lib/settings.svelte";
  import { mod, openDialog, ui, type Tool } from "../lib/ui.svelte";
  import { insertFiles } from "../lib/workspace.svelte";
  import { viewer } from "../lib/viewer.svelte";
  import { t, type Key } from "../lib/i18n/index.svelte";
  import { pickImage } from "../lib/images";
  import Icon from "./Icon.svelte";
  import Popover from "./Popover.svelte";
  import RedactBadge from "./RedactBadge.svelte";
  import EditBadge from "./EditBadge.svelte";
  import SignatureBadge from "./SignatureBadge.svelte";

  let { doc }: { doc: Doc } = $props();
  let moreOpen = $state(false);
  let pageInput = $state("");
  let editingPage = $state(false);

  const TOOLS: { id: Tool; icon: string; label: Key }[] = [
    { id: "select", icon: "select", label: "tool.select" },
    { id: "text", icon: "text", label: "tool.text" },
    { id: "edittext", icon: "edit-text", label: "tool.editText" },
    { id: "highlight", icon: "highlight", label: "tool.highlight" },
    { id: "underline", icon: "underline", label: "tool.underline" },
    { id: "strike", icon: "strike", label: "tool.strike" },
    { id: "ink", icon: "ink", label: "tool.ink" },
    { id: "rect", icon: "rect", label: "tool.rect" },
    { id: "ellipse", icon: "ellipse", label: "tool.ellipse" },
    { id: "arrow", icon: "arrow", label: "tool.arrow" },
    { id: "whiteout", icon: "whiteout", label: "tool.whiteout" },
    { id: "redact", icon: "redact", label: "tool.redact" },
    { id: "comment", icon: "comment", label: "comments.tool" },
  ];

  /** Picks a tool; clicking the active one again puts it away (back to Select). */
  function choose(tool: Tool) {
    ui.tool = ui.tool === tool ? "select" : tool;
    ui.pendingImage = null;
    doc.selectedOverlay = null;
    doc.selectedRedaction = null;
  }

  async function addImage() {
    // An image waiting to be placed is put away by clicking again.
    if (ui.tool === "image" && ui.pendingImage) return choose("image");
    const img = await pickImage();
    if (img) {
      ui.pendingImage = img;
      ui.tool = "image";
    }
  }

  async function addSignature() {
    const sig = await openDialog<{ src: string; width: number; height: number }>("signature");
    if (sig) {
      ui.pendingImage = sig;
      ui.tool = "image";
    }
  }

  function goToTyped() {
    const n = Number(pageInput);
    if (Number.isInteger(n)) viewer.goTo(n - 1);
    editingPage = false;
  }

  const zoomLabel = $derived(`${Math.round(doc.zoom * 100)}%`);
  const selectedPages = $derived(doc.selectedPages.length ? doc.selectedPages : doc.pages[doc.current] ? [doc.pages[doc.current].id] : []);
</script>

<div class="toolbar">
  <div class="group">
    <button class="icon-btn" class:on={settings.showSidebar} onclick={() => command("toggle-sidebar")} title="{t('toolbar.pages')} ({mod}B)" aria-label={t("toolbar.pages")}>
      <Icon name="sidebar" />
    </button>
    <button class="icon-btn" onclick={() => doc.undo()} disabled={!doc.history.undo} title="{t('toolbar.undo')} ({mod}Z)" aria-label={t("toolbar.undo")}>
      <Icon name="undo" />
    </button>
    <button class="icon-btn" onclick={() => doc.redo()} disabled={!doc.history.redo} title={t("toolbar.redo")} aria-label={t("toolbar.redo")}>
      <Icon name="redo" />
    </button>
  </div>
  <span class="sep"></span>
  <div class="group tools">
    {#each TOOLS as tool (tool.id)}
      <button class="icon-btn" class:on={ui.tool === tool.id} onclick={() => choose(tool.id)} title={t(tool.label)} aria-label={t(tool.label)} aria-pressed={ui.tool === tool.id}>
        <Icon name={tool.icon} />
      </button>
    {/each}
    <button class="icon-btn" class:on={ui.tool === "image" && !!ui.pendingImage} onclick={addImage} title={t("tool.image")} aria-label={t("tool.image")}>
      <Icon name="image" />
    </button>
    <button class="icon-btn" onclick={addSignature} title={t("tool.signature")} aria-label={t("tool.signature")}>
      <Icon name="signature" />
    </button>
  </div>

  <div class="spacer"></div>

  <!-- Rotating (also in the page list), Compress and Export (also under ⋯) give way in a narrow window. -->
  <div class="group wide-only">
    <button class="icon-btn" onclick={() => doc.rotatePages(selectedPages, -90)} title={t("pages.rotateLeft")} aria-label={t("pages.rotateLeft")}>
      <Icon name="rotate-ccw" />
    </button>
    <button class="icon-btn" onclick={() => doc.rotatePages(selectedPages, 90)} title={t("pages.rotateRight")} aria-label={t("pages.rotateRight")}>
      <Icon name="rotate-cw" />
    </button>
  </div>
  <span class="sep wide-only"></span>
  <div class="group nav">
    {#if editingPage}
      <!-- svelte-ignore a11y_autofocus -->
      <input
        class="field page-input"
        bind:value={pageInput}
        autofocus
        onkeydown={(e) => e.key === "Enter" && goToTyped()}
        onblur={() => (editingPage = false)}
        aria-label={t("toolbar.page")}
      />
    {:else}
      <button class="page-label" onclick={() => ((pageInput = String(doc.current + 1)), (editingPage = true))} title={t("toolbar.goTo")}>
        {doc.current + 1} / {doc.pages.length}
      </button>
    {/if}
  </div>
  <span class="sep"></span>
  <div class="group boxed">
    <button class="icon-btn" onclick={() => command("zoom-out")} disabled={doc.zoom <= ZOOM_STEPS[0]} title="{t('toolbar.zoomOut')} ({mod}-)" aria-label={t("toolbar.zoomOut")}>
      <Icon name="minus" size={14} />
    </button>
    <button class="zoom" class:on={doc.fitWidth} onclick={() => command("zoom-fit")} title="{t('toolbar.fitWidth')} ({mod}0)">{zoomLabel}</button>
    <button class="icon-btn" onclick={() => command("zoom-in")} disabled={doc.zoom >= ZOOM_STEPS[ZOOM_STEPS.length - 1]} title="{t('toolbar.zoomIn')} ({mod}+)" aria-label={t("toolbar.zoomIn")}>
      <Icon name="plus" size={14} />
    </button>
    <button class="icon-btn" class:on={doc.fitWidth} onclick={() => command("zoom-fit")} title="{t('toolbar.fitWidth')} ({mod}0)" aria-label={t("toolbar.fitWidth")}>
      <Icon name="fit" size={13} />
    </button>
  </div>
  <span class="sep"></span>
  <button class="icon-btn" class:on={ui.findOpen} onclick={() => command("find")} title="{t('find.title')} ({mod}F)" aria-label={t("find.title")}>
    <Icon name="search" />
  </button>
  <button class="icon-btn wide-only" onclick={() => command("compress")} title={t("menu.compress")} aria-label={t("menu.compress")}>
    <Icon name="compress" />
  </button>
  <button class="icon-btn wide-only" onclick={() => command("export-images")} title={t("menu.exportImages")} aria-label={t("menu.exportImages")}>
    <Icon name="images" />
  </button>
  <Popover bind:open={moreOpen}>
    {#snippet anchor()}
      <button class="icon-btn" class:on={moreOpen} onclick={() => (moreOpen = !moreOpen)} title={t("toolbar.more")} aria-label={t("toolbar.more")}>
        <Icon name="more" />
      </button>
    {/snippet}
    <button class="menu-item" onclick={() => command("save-as")}><Icon name="save" />{t("menu.saveAs")}</button>
    <button class="menu-item" onclick={() => command("print")}><Icon name="print" />{t("menu.print")}</button>
    <button class="menu-item" onclick={() => insertFiles(doc, doc.pages.length)}><Icon name="insert" />{t("menu.insertPdf")}</button>
    <div class="menu-sep"></div>
    <button class="menu-item" onclick={() => command("compress")}><Icon name="compress" />{t("menu.compress")}</button>
    <button class="menu-item" onclick={() => command("split")}><Icon name="split" />{t("menu.split")}</button>
    <button class="menu-item" onclick={() => command("resize")}><Icon name="resize" />{t("menu.resize")}</button>
    <button class="menu-item" onclick={() => command("export-images")}><Icon name="images" />{t("menu.exportImages")}</button>
    <button class="menu-item" onclick={() => command("clean-scan")}><Icon name="clean" />{t("menu.cleanScan")}</button>
    <button class="menu-item" onclick={() => command("ocr")}><Icon name="ocr" />{t("menu.ocr")}</button>
    <button class="menu-item" onclick={() => command("personal")}><Icon name="redact" />{t("menu.personal")}</button>
    <button class="menu-item" onclick={() => command("compare")}><Icon name="compare" />{t("menu.compare")}</button>
    <div class="menu-sep"></div>
    <button class="menu-item" onclick={() => command("watermark")}><Icon name="watermark" />{t("menu.watermark")}</button>
    <button class="menu-item" onclick={() => command("page-numbers")}><Icon name="hash" />{t("menu.pageNumbers")}</button>
    <button class="menu-item" onclick={() => command("security")}><Icon name="lock" />{t("menu.security")}</button>
    <button class="menu-item" onclick={() => command("info")}><Icon name="info" />{t("menu.info")}</button>
  </Popover>
  <SignatureBadge {doc} />
  <EditBadge {doc} />
  <RedactBadge {doc} />
  <span class="status" title={doc.path ?? ""}>
    <span class="status-dot" class:dirty={doc.dirty}></span>{doc.dirty ? t("toolbar.unsaved") : t("toolbar.saved")}
  </span>
  <button class="btn primary save" onclick={() => command("save")} disabled={!doc.dirty && !!doc.path} title="{t('toolbar.save')} ({mod}S)">
    <Icon name="save" size={14} /><span class="save-text">{t("toolbar.save")}</span>
  </button>
</div>

<style>
  .toolbar {
    height: 46px;
    flex: none;
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 0 10px;
    background: var(--panel);
    border-bottom: 1px solid var(--line);
  }
  .group {
    display: flex;
    align-items: center;
    gap: 1px;
  }
  /* In a narrow window the tools scroll sideways, so Save and the menus stay in view. */
  .group.tools {
    flex: 0 1 auto;
    min-width: 0;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .group.tools::-webkit-scrollbar {
    display: none;
  }
  .group.tools > :global(*) {
    flex: none;
  }
  .boxed {
    border: 1px solid var(--line);
    border-radius: 6px;
  }
  .spacer {
    flex: 1;
    min-width: 8px;
  }
  .page-label,
  .zoom {
    height: 28px;
    border: none;
    border-radius: 6px;
    background: none;
    font: 11px var(--mono);
    font-variant-numeric: tabular-nums;
    color: var(--muted);
  }
  .page-label {
    min-width: 64px;
  }
  .zoom {
    width: 48px;
  }
  .page-label:hover,
  .zoom:hover {
    color: var(--text);
  }
  .zoom.on {
    color: var(--accent);
  }
  .page-input {
    width: 64px;
    text-align: center;
    font-family: var(--mono);
  }
  .status {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0 8px 0 10px;
    font: 10.5px var(--mono);
    color: var(--muted);
    white-space: nowrap;
  }
  .status-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: color-mix(in srgb, var(--muted) 50%, transparent);
  }
  .status-dot.dirty {
    background: var(--accent);
    animation: pulse 2s ease-in-out infinite;
  }
  /* Wide enough for every tool and the badges only from about 1360 px. */
  @media (max-width: 1360px) {
    .status,
    .wide-only {
      display: none;
    }
  }
  @media (max-width: 980px) {
    .save-text {
      display: none;
    }
  }
  @keyframes pulse {
    50% {
      opacity: 0.45;
    }
  }
</style>
