<script lang="ts">
  // Color, stroke and size for the active tool or the selected annotation.
  import type { Doc } from "../lib/doc.svelte";
  import { settings, persist } from "../lib/settings.svelte";
  import { SWATCHES, toast, toolColor, ui } from "../lib/ui.svelte";
  import { errorText } from "../lib/ipc";
  import { fonts, loadSystemFonts, showFont } from "../lib/fonts.svelte";
  import { t } from "../lib/i18n/index.svelte";
  import Icon from "./Icon.svelte";

  let { doc }: { doc: Doc } = $props();

  const selected = $derived(doc.selectedOverlay ? doc.overlay(doc.selectedOverlay) : undefined);
  /** Which tool's style the style controls edit: the selected annotation's, or the active tool's. */
  const styleKey = $derived(
    selected ? (selected.kind === "markup" ? selected.style : selected.kind) : ui.tool,
  );
  const showColor = $derived(!["select", "image", "whiteout"].includes(styleKey) && styleKey !== "image");
  const showWidth = $derived(["ink", "rect", "ellipse", "arrow", "line"].includes(styleKey));
  const showSize = $derived(styleKey === "text");

  function currentColor(): string {
    if (selected && "color" in selected) return selected.color;
    return toolColor(styleKey);
  }

  function setColor(c: string) {
    settings.colors[styleKey] = c;
    persist();
    if (selected && "color" in selected) doc.change(() => ((selected as { color: string }).color = c));
  }

  function setWidth(w: number) {
    ui.strokeWidth = w;
    if (selected && "width" in selected) doc.change(() => ((selected as { width: number }).width = w));
  }

  function setSize(s: number) {
    ui.fontSize = s;
    if (selected?.kind === "text") doc.change(() => ((selected as { size: number }).size = s));
  }

  // The installed fonts are listed the first time a text style is shown.
  $effect(() => {
    if (showSize) loadSystemFonts().catch((e) => toast(errorText(e), "error"));
  });

  // A size set elsewhere (by an agent, say) joins the list so the box doesn't show blank.
  const sizes = $derived.by(() => {
    const list = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 40, 48, 64];
    const size = selected?.kind === "text" ? selected.size : ui.fontSize;
    return list.includes(size) ? list : [...list, size].sort((a, b) => a - b);
  });

  const currentFont = $derived(selected?.kind === "text" ? (selected.font ?? "") : settings.textFont);

  async function setFont(select: HTMLSelectElement) {
    const family = select.value;
    const target = selected?.kind === "text" ? selected : null;
    try {
      // Fails early for fonts whose license forbids embedding, before the user types with one.
      if (family) await showFont(family, !!target?.bold);
    } catch (e) {
      select.value = currentFont;
      return toast(errorText(e), "error");
    }
    settings.textFont = family;
    persist();
    if (target) doc.change(() => (target.font = family || undefined));
  }

  function toggleFill() {
    if (selected && (selected.kind === "rect" || selected.kind === "ellipse")) {
      const fill = selected.fill ? null : selected.color;
      doc.change(() => ((selected as { fill: string | null }).fill = fill));
    }
  }

</script>

{#if showColor || showWidth || showSize || selected}
  <div class="stylebar">
      {#if showColor}
        {#each SWATCHES as c (c)}
          <button class="swatch" class:on={currentColor() === c} style:background={c} onclick={() => setColor(c)} aria-label={c}></button>
        {/each}
        <input class="picker" type="color" value={currentColor()} onchange={(e) => setColor(e.currentTarget.value)} aria-label={t("toolbar.color")} />
      {/if}
      {#if showWidth}
        <select class="field small" value={selected && "width" in selected ? selected.width : ui.strokeWidth} onchange={(e) => setWidth(Number(e.currentTarget.value))} aria-label={t("toolbar.stroke")}>
          {#each [1, 2, 3, 4, 6, 8] as w (w)}<option value={w}>{w} pt</option>{/each}
        </select>
      {/if}
      {#if showSize}
        <select class="field small font" value={currentFont} onchange={(e) => setFont(e.currentTarget)} aria-label={t("toolbar.font")} title={t("toolbar.font")}>
          <option value="">{t("toolbar.fontDefault")}</option>
          {#if currentFont && !fonts.list.some((f) => f.family === currentFont)}
            <option value={currentFont}>{currentFont}</option>
          {/if}
          {#each fonts.list as f (f.family)}<option value={f.family}>{f.family}</option>{/each}
        </select>
        <select class="field small" value={selected?.kind === "text" ? selected.size : ui.fontSize} onchange={(e) => setSize(Number(e.currentTarget.value))} aria-label={t("toolbar.fontSize")}>
          {#each sizes as s (s)}<option value={s}>{s}</option>{/each}
        </select>
      {/if}
      {#if selected && (selected.kind === "rect" || selected.kind === "ellipse")}
        <button class="btn small" class:on={!!selected.fill} onclick={toggleFill}>{t("toolbar.fill")}</button>
      {/if}
      {#if selected}
        <button class="icon-btn" onclick={() => doc.removeOverlay(selected.id)} title={t("toolbar.deleteAnnotation")} aria-label={t("toolbar.deleteAnnotation")}>
          <Icon name="trash" />
        </button>
      {/if}
  </div>
{/if}


<style>
  .stylebar {
    position: absolute;
    top: 10px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 45;
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 8px;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 10px;
    box-shadow: var(--shadow-lg);
  }
  .swatch {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    border: 1px solid rgb(255 255 255 / 0.18);
    margin: 0 1px;
    padding: 0;
    flex: none;
  }
  .swatch.on {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  .picker {
    width: 24px;
    height: 22px;
    padding: 0;
    border: none;
    background: none;
    margin: 0 4px;
  }
  .small {
    height: 26px;
    font-size: 12px;
  }
  .font {
    max-width: 170px;
  }
</style>
