<script lang="ts">
  // App-wide tooltips, as in the other Klik apps. Native `title` tooltips in the
  // macOS webview are slow and never show on disabled buttons, so each `title`
  // is moved to `data-tip` on hover and drawn here instead.
  import { onMount, tick } from "svelte";
  import { ui } from "../lib/ui.svelte";

  const DELAY = 350;
  let tip = $state<{ text: string; rect: DOMRect } | null>(null);
  let pos = $state<{ left: number; top: number } | null>(null);
  let box = $state<HTMLDivElement>();
  let clearTip = () => {};
  // A dialog opening (from a shortcut or the menu bar, with the pointer still) covers what the tip was about.
  $effect(() => {
    void ui.dialogs.length;
    clearTip();
  });

  function target(x: number, y: number): HTMLElement | null {
    for (const el of document.elementsFromPoint(x, y)) {
      const found = (el as HTMLElement).closest?.("[title], [data-tip]") as HTMLElement | null;
      if (found) return found;
    }
    return null;
  }

  onMount(() => {
    let current: HTMLElement | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let frame = 0;
    const clear = () => {
      clearTimeout(timer);
      current = null;
      tip = null;
    };
    const onMove = (e: PointerEvent) => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const el = target(e.clientX, e.clientY);
        const native = el?.getAttribute("title");
        if (el && native) {
          el.setAttribute("data-tip", native);
          el.removeAttribute("title");
        }
        if (el === current) return;
        clear();
        const text = el?.getAttribute("data-tip");
        if (!el || !text) return;
        current = el;
        timer = setTimeout(() => (tip = { text, rect: el.getBoundingClientRect() }), DELAY);
      });
    };
    // An element that goes away under a still pointer (a tab closed from the keyboard) takes its tip along.
    const watch = setInterval(() => {
      if (current && !current.isConnected) clear();
    }, 400);
    clearTip = clear;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerdown", clear);
    window.addEventListener("wheel", clear, { passive: true });
    window.addEventListener("keydown", clear);
    window.addEventListener("blur", clear);
    return () => {
      clearInterval(watch);
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", clear);
      window.removeEventListener("wheel", clear);
      window.removeEventListener("keydown", clear);
      window.removeEventListener("blur", clear);
    };
  });

  // Below the element, flipped above near the bottom, kept inside the window.
  $effect(() => {
    const t = tip;
    pos = null;
    if (!t) return;
    tick().then(() => {
      if (!box || tip !== t) return;
      const b = box.getBoundingClientRect();
      const margin = 6;
      const left = Math.max(margin, Math.min(t.rect.left + t.rect.width / 2 - b.width / 2, window.innerWidth - b.width - margin));
      let top = t.rect.bottom + margin;
      if (top + b.height > window.innerHeight - margin) top = t.rect.top - b.height - margin;
      pos = { left, top };
    });
  });
</script>

{#if tip}
  <div class="tip" role="tooltip" bind:this={box} style:left="{pos?.left ?? -9999}px" style:top="{pos?.top ?? -9999}px">{tip.text}</div>
{/if}

<style>
  .tip {
    position: fixed;
    z-index: 300;
    max-width: 288px;
    padding: 4px 8px;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: #2c2720;
    color: var(--text);
    font-size: 11px;
    line-height: 1.35;
    box-shadow: 0 8px 20px rgb(0 0 0 / 0.5);
    pointer-events: none;
    white-space: pre-line;
  }
</style>
