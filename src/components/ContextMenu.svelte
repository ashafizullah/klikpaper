<script lang="ts">
  // The right-click menu: opened by openMenu, kept inside the window, worked
  // with the mouse or the arrow keys, closed by a click elsewhere or Escape.
  import { tick } from "svelte";
  import { closeMenu, contextMenu, wantsSystemMenu, type MenuAction } from "../lib/contextmenu.svelte";
  import { toast } from "../lib/ui.svelte";
  import Icon from "./Icon.svelte";

  let el = $state<HTMLDivElement>();
  let pos = $state({ left: 0, top: 0 });
  let active = $state(-1);

  const menu = $derived(contextMenu.open);
  const actions = $derived((menu?.items ?? []).flatMap((item, i) => (item === "sep" || item.disabled ? [] : [i])));

  // Open at the pointer, flipped to stay inside the window.
  $effect(() => {
    const m = menu;
    active = -1;
    if (!m) return;
    pos = { left: m.x, top: m.y };
    tick().then(() => {
      if (!el) return;
      const r = el.getBoundingClientRect();
      const left = m.x + r.width > innerWidth - 6 ? Math.max(6, m.x - r.width) : m.x;
      const top = m.y + r.height > innerHeight - 6 ? Math.max(6, innerHeight - r.height - 6) : m.y;
      pos = { left, top };
    });
  });

  function run(item: MenuAction) {
    if (item.disabled) return;
    closeMenu();
    Promise.resolve()
      .then(item.run)
      .catch((e) => toast(e instanceof Error ? e.message : String(e), "error"));
  }

  function onKeydown(e: KeyboardEvent) {
    if (!menu) return;
    // The menu owns the keyboard while open.
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      closeMenu();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!actions.length) return;
      const at = actions.indexOf(active);
      const next = e.key === "ArrowDown" ? (at + 1) % actions.length : (at <= 0 ? actions.length : at) - 1;
      active = actions[next];
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const item = menu.items[active];
      if (item && item !== "sep") run(item);
    } else if (e.key === "Tab") {
      e.preventDefault();
    }
  }

  function onWindowPointer(e: PointerEvent) {
    if (menu && el && !el.contains(e.target as Node)) closeMenu();
  }

  // Anything not handled by a component: no web view menu (Reload, Inspect), except in text fields.
  function onWindowContextMenu(e: MouseEvent) {
    if (wantsSystemMenu(e.target)) return;
    if (import.meta.env.DEV && e.shiftKey) return;
    e.preventDefault();
    if (menu && el && !el.contains(e.target as Node)) closeMenu();
  }
</script>

<svelte:window
  onkeydowncapture={onKeydown}
  onpointerdowncapture={onWindowPointer}
  oncontextmenu={onWindowContextMenu}
  onblur={closeMenu}
  onresize={closeMenu}
  onwheelcapture={() => menu && closeMenu()}
/>

{#if menu}
  <div class="ctx" role="menu" tabindex="-1" bind:this={el} style:left="{pos.left}px" style:top="{pos.top}px" oncontextmenu={(e) => e.preventDefault()} onmousedown={(e) => e.preventDefault()}>
    {#each menu.items as item, i (i)}
      {#if item === "sep"}
        <div class="rule" role="separator"></div>
      {:else}
        <button
          class="item"
          class:danger={item.danger}
          class:active={active === i}
          role="menuitem"
          tabindex="-1"
          disabled={item.disabled}
          onpointerenter={() => (active = item.disabled ? -1 : i)}
          onpointerleave={() => (active = -1)}
          onclick={() => run(item)}
        >
          <span class="icon">{#if item.icon}<Icon name={item.icon} size={14} />{/if}</span>
          <span class="title">{item.label}</span>
          {#if item.shortcut}<span class="key">{item.shortcut}</span>{/if}
        </button>
      {/if}
    {/each}
  </div>
{/if}

<style>
  .ctx {
    position: fixed;
    font: 12px var(--sans);
    text-transform: none;
    letter-spacing: normal;
    z-index: 1000;
    min-width: 200px;
    max-width: 320px;
    padding: 4px;
    display: flex;
    flex-direction: column;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 8px;
    box-shadow: var(--shadow-lg);
    outline: none;
    animation: open 0.09s ease-out;
    transform-origin: top left;
  }
  @keyframes open {
    from {
      opacity: 0;
      transform: scale(0.97);
    }
  }
  .item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 8px;
    border: none;
    border-radius: 5px;
    background: none;
    color: var(--text);
    font-size: 12px;
    text-align: left;
    white-space: nowrap;
    cursor: default;
  }
  .icon {
    width: 14px;
    flex: none;
    display: flex;
    color: var(--muted);
  }
  .title {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .key {
    margin-left: 18px;
    color: var(--muted);
    font: 11px var(--mono);
  }
  .item.active {
    background: var(--hover);
  }
  .item.active .icon {
    color: var(--accent);
  }
  .item.danger {
    color: var(--danger);
  }
  .item.danger .icon {
    color: var(--danger);
  }
  .item.danger.active {
    background: color-mix(in srgb, var(--danger) 14%, transparent);
  }
  .item:disabled {
    opacity: 0.45;
  }
  .rule {
    height: 1px;
    margin: 4px 6px;
    background: var(--line);
  }
</style>
