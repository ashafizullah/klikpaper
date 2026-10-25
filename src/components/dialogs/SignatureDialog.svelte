<script lang="ts">
  import Dialog from "../Dialog.svelte";
  import Icon from "../Icon.svelte";
  import { pickImage, fitSize } from "../../lib/images";
  import { newId, persist, settings, type Signature } from "../../lib/settings.svelte";
  import { closeDialog } from "../../lib/ui.svelte";
  import { t } from "../../lib/i18n/index.svelte";

  let tab = $state<"saved" | "draw" | "type">(settings.signatures.length ? "saved" : "draw");
  let canvas = $state<HTMLCanvasElement | null>(null);
  let drawn = $state(false);
  let typed = $state("");
  let typedFont = $state("cursive");
  let color = $state("#1b1916");
  let remember = $state(true);

  const FONTS = [
    ["cursive", "Cursive"],
    ["'Snell Roundhand', 'Segoe Script', 'Brush Script MT', cursive", "Script"],
    ["Georgia, serif", "Serif"],
  ];

  // ---- drawing pad
  let last: [number, number] | null = null;
  function pos(e: PointerEvent): [number, number] {
    const r = canvas!.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * canvas!.width, ((e.clientY - r.top) / r.height) * canvas!.height];
  }
  function down(e: PointerEvent) {
    canvas!.setPointerCapture(e.pointerId);
    last = pos(e);
  }
  function move(e: PointerEvent) {
    if (!last) return;
    const ctx = canvas!.getContext("2d")!;
    const p = pos(e);
    ctx.strokeStyle = color;
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(...last);
    ctx.lineTo(...p);
    ctx.stroke();
    last = p;
    drawn = true;
  }
  function clearPad() {
    canvas?.getContext("2d")!.clearRect(0, 0, canvas.width, canvas.height);
    drawn = false;
  }

  /** The drawn strokes cropped to their bounds, as a transparent PNG. */
  function cropped(source: HTMLCanvasElement): HTMLCanvasElement | null {
    const ctx = source.getContext("2d")!;
    const { width, height } = source;
    const data = ctx.getImageData(0, 0, width, height).data;
    let x0 = width, y0 = height, x1 = -1, y1 = -1;
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++)
        if (data[(y * width + x) * 4 + 3] > 8) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
    if (x1 < 0) return null;
    const pad = 8;
    const out = document.createElement("canvas");
    out.width = x1 - x0 + pad * 2;
    out.height = y1 - y0 + pad * 2;
    out.getContext("2d")!.drawImage(source, x0 - pad, y0 - pad, out.width, out.height, 0, 0, out.width, out.height);
    return out;
  }

  function typedCanvas(): HTMLCanvasElement {
    const c = document.createElement("canvas");
    c.width = 1200;
    c.height = 300;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = color;
    ctx.font = `120px ${typedFont}`;
    ctx.textBaseline = "middle";
    ctx.fillText(typed, 20, 150, 1160);
    return c;
  }

  function finish(sig: Omit<Signature, "id">) {
    if (remember && tab !== "saved") {
      settings.signatures = [{ ...sig, id: newId("sig") }, ...settings.signatures].slice(0, 8);
      persist();
    }
    closeDialog(sig);
  }

  function use() {
    const c = tab === "draw" ? (canvas && cropped(canvas)) : cropped(typedCanvas());
    if (!c) return;
    // Signatures start about 160 points (5.6 cm) wide.
    finish({ src: c.toDataURL("image/png"), ...fitSize(c.width, c.height, 160) });
  }

  async function upload() {
    const img = await pickImage();
    if (img) finish({ src: img.src, ...fitSize(img.width, img.height, 160) });
  }

  function forget(id: string) {
    settings.signatures = settings.signatures.filter((s) => s.id !== id);
    persist();
  }

</script>

<Dialog title={t("signature.title")} width={560}>
  <nav class="tabs">
    {#if settings.signatures.length}<button class="tab" class:on={tab === "saved"} onclick={() => (tab = "saved")}>{t("signature.saved")}</button>{/if}
    <button class="tab" class:on={tab === "draw"} onclick={() => (tab = "draw")}>{t("signature.draw")}</button>
    <button class="tab" class:on={tab === "type"} onclick={() => (tab = "type")}>{t("signature.type")}</button>
    <button class="tab" onclick={upload}>{t("signature.upload")}</button>
  </nav>

  {#if tab === "saved"}
    <div class="saved">
      {#each settings.signatures as s (s.id)}
        <div class="sig">
          <button class="sig-main" onclick={() => closeDialog({ src: s.src, width: s.width, height: s.height })}><img src={s.src} alt={t("signature.title")} /></button>
          <button class="icon-btn" onclick={() => forget(s.id)} aria-label={t("common.remove")}><Icon name="trash" /></button>
        </div>
      {/each}
    </div>
  {:else if tab === "draw"}
    <canvas class="pad" bind:this={canvas} width="1000" height="320" onpointerdown={down} onpointermove={move} onpointerup={() => (last = null)}></canvas>
    <div class="choice">
      {#each ["#1b1916", "#1d4ed8", "#0f766e"] as c (c)}<button class="swatch" class:on={color === c} style:background={c} onclick={() => (color = c)} aria-label={c}></button>{/each}
      <span style="flex:1"></span>
      <button class="btn" onclick={clearPad} disabled={!drawn}>{t("signature.clear")}</button>
    </div>
  {:else}
    <input class="field big" placeholder={t("signature.yourName")} bind:value={typed} style:font-family={typedFont} style:color />
    <div class="choice">
      {#each FONTS as [f, label] (f)}<button class="btn" class:on={typedFont === f} style:font-family={f} onclick={() => (typedFont = f)}>{label}</button>{/each}
    </div>
  {/if}
  {#if tab !== "saved"}<label class="row"><input type="checkbox" bind:checked={remember} />{t("signature.remember")}</label>{/if}
  <p class="note">{t("signature.note")}</p>
  {#snippet footer()}
    <button class="btn" onclick={() => closeDialog(null)}>{t("common.cancel")}</button>
    {#if tab !== "saved"}<button class="btn primary" disabled={tab === "draw" ? !drawn : !typed.trim()} onclick={use}>{t("signature.place")}</button>{/if}
  {/snippet}
</Dialog>

<style>
  .tabs {
    display: flex;
    gap: 2px;
    border-bottom: 1px solid var(--border);
    margin: -16px -16px 4px;
    padding: 0 14px;
  }
  .tab {
    border: none;
    background: none;
    padding: 8px 10px;
    border-bottom: 2px solid transparent;
    color: var(--muted);
  }
  .tab.on {
    color: var(--text);
    border-bottom-color: var(--accent);
    font-weight: 600;
  }
  .pad {
    width: 100%;
    height: 170px;
    background: #fff;
    border: 1px dashed var(--border);
    border-radius: 8px;
    touch-action: none;
    cursor: crosshair;
  }
  .swatch {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    border: 1px solid rgb(0 0 0 / 0.2);
    padding: 0;
  }
  .swatch.on {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  .big {
    height: 64px;
    font-size: 36px;
    background: #fff;
  }
  .saved {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 8px;
  }
  .sig {
    display: flex;
    align-items: center;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: #fff;
  }
  .sig-main {
    flex: 1;
    border: none;
    background: none;
    height: 70px;
    padding: 6px;
  }
  .sig-main img {
    max-width: 100%;
    max-height: 100%;
  }
  .sig .icon-btn {
    color: #555;
  }
</style>
