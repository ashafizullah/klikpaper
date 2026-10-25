<script lang="ts">
  import { dismissToast, ui } from "../lib/ui.svelte";
  import Icon from "./Icon.svelte";
</script>

<div class="toasts" aria-live="polite">
  {#each ui.toasts as toast (toast.id)}
    <div class="toast rise {toast.kind}">
      <span class="text selectable">{toast.text}</span>
      {#if toast.action}
        <button class="btn small" onclick={() => (toast.action!.run(), dismissToast(toast.id))}>{toast.action.label}</button>
      {/if}
      <button class="icon-btn close" onclick={() => dismissToast(toast.id)} aria-label="Close"><Icon name="close" size={12} /></button>
    </div>
  {/each}
</div>

<style>
  .toasts {
    position: fixed;
    left: 50%;
    bottom: 24px;
    transform: translateX(-50%);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    z-index: 200;
    width: max-content;
    max-width: min(560px, calc(100vw - 32px));
  }
  .toast {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 7px 6px 7px 14px;
    background: var(--panel-2);
    border: 1px solid var(--line);
    border-radius: 8px;
    box-shadow: var(--shadow);
    font-size: 12px;
  }
  .toast.ok {
    border-color: color-mix(in srgb, var(--ok) 45%, transparent);
  }
  .toast.error {
    border-color: color-mix(in srgb, var(--danger) 50%, transparent);
    background: #2a1512;
    color: var(--danger);
  }
  .text {
    flex: 1;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .small {
    height: 24px;
  }
  .close {
    width: 22px;
    height: 22px;
    color: var(--muted);
  }
</style>
