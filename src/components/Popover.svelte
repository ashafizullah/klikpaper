<script lang="ts">
  import type { Snippet } from "svelte";

  let { open = $bindable(false), anchor, children, align = "right" }: { open?: boolean; anchor: Snippet; children: Snippet; align?: "left" | "right" } = $props();
  let root: HTMLDivElement;

  function onWindowPointer(e: PointerEvent) {
    if (open && root && !root.contains(e.target as Node)) open = false;
  }
</script>

<svelte:window onpointerdown={onWindowPointer} />

<div class="pop-root" bind:this={root}>
  {@render anchor()}
  {#if open}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="pop" class:left={align === "left"} onclick={() => (open = false)}>
      {@render children()}
    </div>
  {/if}
</div>

<style>
  .pop-root {
    position: relative;
    display: inline-flex;
  }
  .pop {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    min-width: 220px;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 8px;
    box-shadow: var(--shadow-lg);
    padding: 4px 0;
    z-index: 50;
    display: flex;
    flex-direction: column;
  }
  .pop.left {
    left: 0;
    right: auto;
  }
  .pop :global(.menu-item) {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 6px 12px;
    border: none;
    background: none;
    font-size: 12px;
    text-align: left;
    white-space: nowrap;
  }
  .pop :global(.menu-item svg) {
    width: 14px;
    height: 14px;
    color: var(--muted);
  }
  .pop :global(.menu-item:hover:not(:disabled) svg) {
    color: var(--accent);
  }
  .pop :global(.menu-item:hover:not(:disabled)) {
    background: var(--hover);
  }
  .pop :global(.menu-item:disabled) {
    opacity: 0.45;
    cursor: default;
  }
  .pop :global(.menu-sep) {
    height: 1px;
    background: var(--line);
    margin: 4px 0;
  }
</style>
